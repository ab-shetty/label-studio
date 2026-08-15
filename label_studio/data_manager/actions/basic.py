"""This file and its contents are licensed under the Apache License 2.0. Please see the included NOTICE for copyright information and LICENSE for a copy of the license."""

import logging
from datetime import datetime

from core.feature_flags import flag_set
from core.permissions import AllPermissions
from core.redis import start_job_async_or_sync
from core.utils.common import load_func
from data_manager.actions import DataManagerAction
from data_manager.functions import evaluate_predictions
from django.conf import settings
from projects.models import Project
from rest_framework.exceptions import ValidationError
from tasks.functions import update_tasks_counters
from tasks.models import Annotation, AnnotationDraft, Prediction, Task
from users.models import User
from webhooks.models import WebhookAction
from webhooks.utils import emit_webhooks_for_instance

all_permissions = AllPermissions()
logger = logging.getLogger(__name__)


# Trader Joe's / RF-DETR project: cascade mode is normally baked into the
# native ML backend process as env vars at session start (CASCADE_ENABLED /
# SHELF_TAGS_ENABLED), the same for every prediction. This lets a user
# override it per pre-annotation run instead -- threaded through as
# context={'cascade_mode': ...} down to the backend's predict() call, which
# falls back to its env-var defaults when no override is given (e.g. the
# automatic retrieve-on-task-open path never sets this).
# Each option is (cascade_mode, propose_boxes, name_proposals). None means
# "leave it to the backend's env default", so the recommended entry follows
# whatever session_start.sh configured rather than pinning a second copy of the
# policy here.
#
# The old list named only cascade modes, which stopped being the whole story
# once box proposals and template naming existed: picking "plain RF-DETR" still
# produced proposed boxes and template-guessed names, so the label was simply
# untrue. It also gave shelf-tag correction equal billing with the recommended
# path after that measured worse in every run (see pipeline_dryrun.py).
RETRIEVE_PREDICTIONS_FRAMEWORK_CHOICES = {
    'Recommended (as configured for this session)': (None, None, None),
    'Boxes only -- no SKU guesses': (None, True, False),
    'Cascade only -- no proposed boxes': ('cascade', False, False),
    'Plain RF-DETR -- no cascade, no proposals': ('off', False, False),
    'Shelf-tag correction (measured worse; for comparison)': ('cascade_shelf_tags', None, None),
}


def retrieve_tasks_predictions_form(user, project):
    return [
        {
            'columnCount': 1,
            'fields': [
                {
                    'type': 'select',
                    'name': 'framework',
                    'label': 'Pre-annotation framework',
                    'options': list(RETRIEVE_PREDICTIONS_FRAMEWORK_CHOICES.keys()),
                },
                {
                    'type': 'number',
                    'name': 'detection_floor',
                    'label': 'Detection floor (0-1, blank = configured default)',
                    'min': 0,
                    'max': 1,
                    'step': 0.05,
                    'placeholder': 'e.g. 0.20',
                },
            ],
        }
    ]


def _parse_detection_floor(raw):
    """Validate the optional detection-floor field. Blank means "leave it to the
    backend's own default" (CASCADE_FLOOR); anything unparseable or out of
    [0, 1] is ignored rather than raised, so a typo degrades to the default
    instead of failing a long bulk run outright.
    """
    if raw is None or raw == '':
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        logger.warning(f'Ignoring non-numeric detection_floor: {raw!r}')
        return None
    if not 0 <= value <= 1:
        logger.warning(f'Ignoring out-of-range detection_floor: {value}')
        return None
    return value


def _align_project_model_version(project, queryset):
    """Point the project at the model version its predictions actually carry.

    The labeling UI filters predictions by project.model_version (see
    tasks/serializers.py TaskWithAnnotationsAndPredictionsAndDraftsSerializer.
    get_predictions -- the ff_front_dev_1682 flag is off here, so the plain
    `filter(model_version=project.model_version)` branch runs). Attaching an ML
    backend sets that field to the backend's *title*, normally "default", while
    the predictions the backend returns carry its real version string
    ("rfdetr-nano-<run>-236cls+cascade+box+tpl"). Those two never match, so a
    run could create every prediction correctly and still open on a blank image
    -- no error anywhere, because nothing failed.

    Re-checked on every run rather than pinned once, because that version string
    encodes which stages are enabled: switching pre-annotation framework in this
    very dialog changes it, so any value written once at attach time is
    guaranteed to go stale.
    """
    latest = (
        Prediction.objects.filter(task__in=queryset)
        .order_by('-created_at')
        .values_list('model_version', flat=True)
        .first()
    )
    if latest and project.model_version != latest:
        logger.info(
            f'project={project.id} model_version {project.model_version!r} -> {latest!r} '
            f'so the predictions just retrieved are actually visible'
        )
        project.model_version = latest
        project.save(update_fields=['model_version'])
    return latest


def retrieve_tasks_predictions(project, queryset, request, **kwargs):
    """Retrieve predictions by tasks ids

    :param project: project instance
    :param queryset: filtered tasks db queryset
    :param request: originating request; may carry 'framework' and
        'detection_floor' fields (see retrieve_tasks_predictions_form) selecting
        which parts of the pre-annotation pipeline to run and what detection
        cutoff to use. Anything the chosen option leaves as None is omitted from
        the context, so the backend falls back to its env defaults rather than
        to a second copy of the policy living here.
    """
    # evaluate_predictions() returns silently when the project has no ML backend
    # attached, and this action then reported "Retrieved N predictions" for a run
    # that called nothing at all. A project created while the RF-DETR backend was
    # down lands in exactly that state: the Create Project wizard's addMLBackend
    # call fails, the project is created anyway, and every later pre-annotation
    # run is a no-op that claims success.
    if project.ml_backend is None:
        raise ValidationError(
            'No ML backend is connected to this project, so there is nothing to retrieve '
            'predictions from. Attach one under Settings > Machine Learning. (New projects '
            'normally get the RF-DETR backend attached automatically, but that step is '
            'skipped without comment if the backend was unreachable at the moment the '
            'project was created.)'
        )

    context = {}
    framework = request.data.get('framework')
    if framework in RETRIEVE_PREDICTIONS_FRAMEWORK_CHOICES:
        cascade_mode, propose_boxes, name_proposals = RETRIEVE_PREDICTIONS_FRAMEWORK_CHOICES[framework]
        for key, value in (('cascade_mode', cascade_mode),
                           ('propose_boxes', propose_boxes),
                           ('name_proposals', name_proposals)):
            if value is not None:
                context[key] = value
    detection_floor = _parse_detection_floor(request.data.get('detection_floor'))
    if detection_floor is not None:
        context['detection_floor'] = detection_floor
    evaluate_predictions(queryset, context=context or None)

    version = _align_project_model_version(project, queryset)
    # Count what the run actually produced, not how many tasks were selected --
    # the old message reported the selection size either way, which is what let a
    # no-op run look like a success.
    predicted = (
        Prediction.objects.filter(task__in=queryset, model_version=version).values('task').distinct().count()
        if version
        else 0
    )
    selected = queryset.count()
    detail = f'Retrieved predictions for {predicted} of {selected} tasks'
    if predicted < selected:
        detail += ' — the rest returned nothing; check the ML backend log'
    return {'processed_items': predicted, 'detail': detail}


def delete_tasks(project, queryset, **kwargs):
    """Delete tasks by ids

    :param project: project instance
    :param queryset: filtered tasks db queryset
    """
    tasks_ids = list(queryset.values('id'))
    count = len(tasks_ids)
    tasks_ids_list = [task['id'] for task in tasks_ids]
    project_count = project.tasks.count()
    # unlink tasks from project
    queryset = Task.objects.filter(id__in=tasks_ids_list)
    queryset.update(project=None)
    # delete all project tasks
    if count == project_count:
        start_job_async_or_sync(Task.delete_tasks_without_signals_from_task_ids, tasks_ids_list, queue_name='low')
        logger.info(f'calling reset project_id={project.id} delete_tasks()')
        project.summary.reset()

    # delete only specific tasks
    else:
        # update project summary and delete tasks
        start_job_async_or_sync(async_project_summary_recalculation, tasks_ids_list, project.id)

    project.update_tasks_states(
        maximum_annotations_changed=False, overlap_cohort_percentage_changed=False, tasks_number_changed=True
    )
    # emit webhooks for project
    emit_webhooks_for_instance(project.organization, project, WebhookAction.TASKS_DELETED, tasks_ids)

    # remove all tabs if there are no tasks in project
    reload = False
    if not project.tasks.exists():
        project.views.all().delete()
        reload = True

    # Execute actions after delete tasks
    Task.after_bulk_delete_actions(tasks_ids_list, project)

    return {'processed_items': count, 'reload': reload, 'detail': 'Deleted ' + str(count) + ' tasks'}


def delete_tasks_annotations(project, queryset, **kwargs):
    """Delete all annotations and drafts by tasks ids

    :param project: project instance
    :param queryset: filtered tasks db queryset
    """
    request = kwargs['request']
    annotator_id = request.data.get('annotator')

    task_ids = queryset.values_list('id', flat=True)
    annotations = Annotation.objects.filter(task__id__in=task_ids)
    if annotator_id:
        annotations = annotations.filter(completed_by=int(annotator_id))

    # take only tasks where annotations are going to be deleted
    real_task_ids = set(list(annotations.values_list('task__id', flat=True)))
    annotations_ids = list(annotations.values('id'))
    # remove deleted annotations from project.summary
    project.summary.remove_created_annotations_and_labels(annotations)
    # also remove drafts for the task. This includes task and annotation level
    # drafts by design.
    drafts = AnnotationDraft.objects.filter(task__id__in=task_ids)
    if annotator_id:
        drafts = drafts.filter(user=int(annotator_id))
    project.summary.remove_created_drafts_and_labels(drafts)

    # count before delete to return the number of deleted items, not including cascade deletions
    count = annotations.count()
    annotations.delete()
    drafts.delete()  # since task-level annotation drafts will not have been deleted by CASCADE
    emit_webhooks_for_instance(project.organization, project, WebhookAction.ANNOTATIONS_DELETED, annotations_ids)
    request = kwargs['request']

    tasks = Task.objects.filter(id__in=real_task_ids)
    tasks.update(updated_at=datetime.now(), updated_by=request.user)
    # Update tasks counter and is_labeled. It should be a single operation as counters affect bulk is_labeled update
    project.update_tasks_counters_and_is_labeled(tasks_queryset=real_task_ids)

    # LSE postprocess
    postprocess = load_func(settings.DELETE_TASKS_ANNOTATIONS_POSTPROCESS)
    if postprocess is not None:
        tasks = Task.objects.filter(id__in=task_ids)
        postprocess(project, tasks, **kwargs)

    return {'processed_items': count, 'detail': 'Deleted ' + str(count) + ' annotations'}


def delete_tasks_annotations_form(user, project):
    annotator_ids = list(Annotation.objects.filter(project=project).values_list('completed_by', flat=True))
    draft_annotator_ids = list(AnnotationDraft.objects.filter(task__project=project).values_list('user', flat=True))
    users = User.objects.filter(id__in=annotator_ids + draft_annotator_ids)
    return [
        {
            'columnCount': 1,
            'fields': [
                {
                    'type': 'select',
                    'name': 'annotator',
                    'label': 'Annotator',
                    'options': [
                        {'value': str(user.id), 'label': user.get_full_name() or user.username or user.email}
                        for user in users
                    ],
                    'placeholder': 'All',
                    'searchable': True,
                }
            ],
        }
    ]


def delete_tasks_predictions(project, queryset, **kwargs):
    """Delete all predictions by tasks ids

    :param project: project instance
    :param queryset: filtered tasks db queryset
    """
    task_ids = queryset.values_list('id', flat=True)
    predictions = Prediction.objects.filter(task__id__in=task_ids)
    if flag_set('fflag_root_223_optimize_delete_predictions', organization=project.organization):
        real_task_ids = predictions.order_by().values_list('task_id', flat=True).distinct()
    else:
        real_task_ids = set(list(predictions.values_list('task_id', flat=True)))

    count = predictions.count()
    predictions.delete()
    start_job_async_or_sync(update_tasks_counters, Task.objects.filter(id__in=real_task_ids))
    return {'processed_items': count, 'detail': 'Deleted ' + str(count) + ' predictions'}


def async_project_summary_recalculation(tasks_ids_list, project_id):
    queryset = Task.objects.filter(id__in=tasks_ids_list)
    project = Project.objects.get(id=project_id)
    project.summary.remove_created_annotations_and_labels(Annotation.objects.filter(task__in=queryset))
    project.summary.remove_data_columns(queryset)
    Task.delete_tasks_without_signals(queryset)


actions: list[DataManagerAction] = [
    {
        'entry_point': retrieve_tasks_predictions,
        'permission': all_permissions.predictions_any,
        'title': 'Retrieve Predictions',
        'order': 90,
        'dialog': {
            'title': 'Retrieve Predictions',
            'text': 'Send the selected tasks to the ML backend connected to the project. '
            'Choose which pre-annotation framework to run -- picking one re-predicts the '
            'selected tasks even if they already have predictions from a previous run. '
            'This operation might be abruptly interrupted due to a timeout. '
            'The recommended way to get predictions is to update tasks using the Label Studio API.'
            'Please confirm your action.',
            'type': 'confirm',
            'form': retrieve_tasks_predictions_form,
        },
    },
    {
        'entry_point': delete_tasks,
        'permission': all_permissions.tasks_delete,
        'title': 'Delete Tasks',
        'order': 100,
        'reload': True,
        'dialog': {
            'text': 'You are going to delete the selected tasks. Please confirm your action.',
            'type': 'confirm',
        },
    },
    {
        'entry_point': delete_tasks_annotations,
        'permission': [all_permissions.tasks_change, all_permissions.annotations_delete],
        'title': 'Delete Annotations',
        'order': 101,
        'dialog': {
            'text': 'You are going to delete annotations from the selected tasks.\n'
            'You can select specific annotators to delete annotations for.\n'
            'Please confirm your action.',
            'type': 'confirm',
            'form': delete_tasks_annotations_form,
        },
    },
    {
        'entry_point': delete_tasks_predictions,
        'permission': all_permissions.predictions_any,
        'title': 'Delete Predictions',
        'order': 102,
        'dialog': {
            'text': 'You are going to delete all predictions from the selected tasks. Please confirm your action.',
            'type': 'confirm',
        },
    },
]
