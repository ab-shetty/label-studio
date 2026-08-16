"""Cover the two ways a "Retrieve Predictions" run could report success while
achieving nothing.

Both were live at once on a real project and produced the same symptom -- click
the button, wait, see no boxes -- from opposite ends: one never called the model,
the other called it correctly and then hid the result.
"""
from unittest import mock

from data_manager.actions.basic import _parse_detection_floor, retrieve_tasks_predictions
from django.http import HttpRequest
from django.test import TestCase
from ml.models import MLBackend
from projects.tests.factories import ProjectFactory
from rest_framework.exceptions import ValidationError
from tasks.models import Prediction, Task
from tasks.tests.factories import TaskFactory

# What the RF-DETR backend actually reports: the run, the class count, and which
# pipeline stages are on. The stage suffix is why this cannot be pinned once.
MODEL_VERSION = 'rfdetr-nano-20260812-2202-173img-236cls+cascade+box+tpl'


def _request(framework='Recommended (as configured for this session)'):
    request = HttpRequest()
    request.data = {'framework': framework}
    return request


class TestRetrievePredictionsWithoutBackend(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.project = ProjectFactory()
        cls.task = TaskFactory(project=cls.project)

    def test_no_ml_backend_raises_instead_of_claiming_success(self):
        """evaluate_predictions() returns silently when nothing is attached. The
        action used to report the selection size regardless, so a project whose
        wizard-time addMLBackend call had failed reported "Retrieved 201
        predictions" for a run that made no HTTP call at all."""
        assert self.project.ml_backend is None

        with self.assertRaises(ValidationError) as ctx:
            retrieve_tasks_predictions(self.project, Task.objects.all(), request=_request())

        assert 'no ml backend' in str(ctx.exception).lower()
        assert Prediction.objects.count() == 0


class TestRetrievePredictionsModelVersion(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.project = ProjectFactory()
        cls.task_1 = TaskFactory(project=cls.project)
        cls.task_2 = TaskFactory(project=cls.project)

    def setUp(self):
        # Attaching a backend sets project.model_version to the backend's TITLE,
        # which is never what a prediction carries -- the mismatch under test.
        self.backend = MLBackend.objects.create(
            project=self.project, url='http://testserver:9091', title='default'
        )
        self.project.model_version = 'default'
        self.project.save(update_fields=['model_version'])

    def _fake_evaluate(self, queryset, context=None):
        for task in queryset:
            Prediction.objects.create(
                task=task, project=self.project, model_version=MODEL_VERSION, result=[], score=0.5
            )

    def test_project_model_version_follows_the_predictions(self):
        """Without this the labeling UI filters on 'default', matches nothing, and
        opens a blank image even though every prediction was stored correctly."""
        with mock.patch('data_manager.actions.basic.evaluate_predictions', self._fake_evaluate):
            result = retrieve_tasks_predictions(self.project, Task.objects.all(), request=_request())

        self.project.refresh_from_db()
        assert self.project.model_version == MODEL_VERSION
        assert result['processed_items'] == 2

    def test_predictions_are_visible_to_the_labeling_serializer(self):
        """The real assertion: not that the field changed, but that the serializer
        the labeling UI uses now returns the predictions."""
        from tasks.serializers import TaskWithAnnotationsAndPredictionsAndDraftsSerializer

        with mock.patch('data_manager.actions.basic.evaluate_predictions', self._fake_evaluate):
            retrieve_tasks_predictions(self.project, Task.objects.all(), request=_request())

        self.task_1.refresh_from_db()
        data = TaskWithAnnotationsAndPredictionsAndDraftsSerializer(self.task_1).data
        assert len(data['predictions']) == 1

    def test_a_later_run_on_a_different_framework_realigns(self):
        """Switching framework changes the backend's version string; the project
        has to follow it, or the previous run's choice keeps winning."""
        other = MODEL_VERSION.replace('+cascade+box+tpl', '')

        with mock.patch('data_manager.actions.basic.evaluate_predictions', self._fake_evaluate):
            retrieve_tasks_predictions(self.project, Task.objects.all(), request=_request())
        assert self.project.model_version == MODEL_VERSION

        def _fake_plain(queryset, context=None):
            for task in queryset:
                Prediction.objects.create(
                    task=task, project=self.project, model_version=other, result=[], score=0.5
                )

        with mock.patch('data_manager.actions.basic.evaluate_predictions', _fake_plain):
            retrieve_tasks_predictions(
                self.project, Task.objects.all(), request=_request('Plain RF-DETR -- no cascade, no proposals')
            )

        self.project.refresh_from_db()
        assert self.project.model_version == other

    def test_a_run_that_predicts_nothing_says_so(self):
        """A backend that is attached but returns nothing must not read as success."""
        with mock.patch('data_manager.actions.basic.evaluate_predictions', lambda qs, context=None: None):
            result = retrieve_tasks_predictions(self.project, Task.objects.all(), request=_request())

        assert result['processed_items'] == 0
        assert 'of 2 tasks' in result['detail']


class TestDetectionFloorParsing(TestCase):
    """A blank "detection floor" field must never reach the backend as a real 0.

    The Data Manager form serialises number inputs with Number(field.value), and
    Number("") is 0 -- so an untouched optional field submitted a hard floor of
    zero. That accepts every near-zero-confidence detection and pushes each one
    through the verification cascade: 156s/image against 6.5s, an 8-hour run that
    the 1-hour request timeout kills with nothing saved.
    """

    def test_blank_is_not_a_floor(self):
        assert _parse_detection_floor('') is None
        assert _parse_detection_floor(None) is None

    def test_zero_is_treated_as_blank(self):
        assert _parse_detection_floor(0) is None
        assert _parse_detection_floor('0') is None
        assert _parse_detection_floor(0.0) is None

    def test_a_real_floor_survives(self):
        assert _parse_detection_floor(0.2) == 0.2
        assert _parse_detection_floor('0.05') == 0.05
        assert _parse_detection_floor(1) == 1

    def test_junk_and_out_of_range_fall_back_to_the_default(self):
        assert _parse_detection_floor('abc') is None
        assert _parse_detection_floor(1.5) is None
        assert _parse_detection_floor(-1) is None
