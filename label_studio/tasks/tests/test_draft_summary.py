from core.utils.common import load_func
from django.conf import settings
from django.test import TestCase
from projects.models import ProjectSummary
from tasks.models import AnnotationDraft
from tasks.tests.factories import TaskFactory

UserFactory = load_func(settings.USER_FACTORY)

CONFIG = """
<View>
  <Image name="image" value="$image"/>
  <RectangleLabels name="bbox" toName="image">
    <Label value="Product"/>
  </RectangleLabels>
</View>
"""


def region(label):
    return {
        'from_name': 'bbox',
        'to_name': 'image',
        'type': 'rectanglelabels',
        'value': {'x': 1, 'y': 1, 'width': 10, 'height': 10, 'rectanglelabels': [label]},
    }


class TestDraftSummaryCounts(TestCase):
    """ProjectSummary.created_labels_drafts must track the drafts as they are.

    update_created_labels_drafts() only adds, so before the fix in
    AnnotationDraft.save() every autosave counted the same regions again and
    the summary drifted upward for as long as anyone kept labelling. That
    matters beyond cosmetics: sync_label_config.py reads this to decide whether
    a class being renamed is still in use, and phantom counts make it refuse
    the rename forever.
    """

    def setUp(self):
        self.task = TaskFactory(project__label_config=CONFIG)
        self.project = self.task.project
        self.user = UserFactory()
        if not hasattr(self.project, 'summary'):
            ProjectSummary.objects.create(project=self.project)
        self.project.refresh_from_db()

    def counts(self):
        self.project.summary.refresh_from_db()
        return self.project.summary.created_labels_drafts.get('bbox', {})

    def test_create_counts_once(self):
        AnnotationDraft.objects.create(task=self.task, result=[region('Product')], user=self.user)
        assert self.counts() == {'Product': 1}

    def test_resave_does_not_double_count(self):
        draft = AnnotationDraft.objects.create(
            task=self.task, result=[region('Product')], user=self.user)
        for _ in range(4):
            draft.save()
        assert self.counts() == {'Product': 1}

    def test_edit_replaces_old_labels(self):
        draft = AnnotationDraft.objects.create(
            task=self.task, result=[region('Product')], user=self.user)
        draft.result = [region('Product'), region('Product')]
        draft.save()
        assert self.counts() == {'Product': 2}

        draft.result = [region('Product')]
        draft.save()
        assert self.counts() == {'Product': 1}

    def test_delete_clears(self):
        draft = AnnotationDraft.objects.create(
            task=self.task, result=[region('Product')], user=self.user)
        draft.delete()
        assert self.counts() == {}

    def test_multiple_regions_from_empty_summary(self):
        """Every region counts, even when the summary starts without the control.

        update_created_labels_drafts used to test `from_name not in
        self.created_labels_drafts` while accumulating into a separate dict, so
        from empty it reset the bucket once per result and reported 1 for any
        number of regions.
        """
        self.project.summary.created_labels_drafts = {}
        self.project.summary.save(update_fields=['created_labels_drafts'])
        AnnotationDraft.objects.create(
            task=self.task,
            result=[region('Product'), region('Product'), region('Product')],
            user=self.user)
        assert self.counts() == {'Product': 3}
