"""Tests for `needs` (MANAGEMENT-BRIEF.md §3.C, §4 rule 14) — refusals first."""

from django.test import TestCase
from rest_framework.test import APIClient

from courses.models import Course
from moderation.models import FeatureFlag
from testing.factories import make_user

from .models import Need, NeedApplication
from .rules import (
    ALREADY_APPLIED,
    ALREADY_DECIDED,
    FULL,
    MINOR,
    NOT_OPEN,
    OWN_NODE,
    apply_block_reason,
    can_manage,
    decide_block_reason,
    node_needs,
    public_needs,
    recount,
)


def _course(instructor, *, visibility='public', title='Analiza I'):
    # `Course.save()` creates the owner `CourseStaff` row itself (courses/CLAUDE.md) — creating one
    # by hand here would double it and trip the partial-unique-owner index.
    return Course.objects.create(
        instructor=instructor, title=title, visibility=visibility, status='open',
        enrollment_policy='open',
    )


class NeedsBaseTestCase(TestCase):
    def setUp(self):
        FeatureFlag.objects.update_or_create(key='needs', defaults={'is_enabled': True})
        self.manager = make_user('manager')
        self.stranger = make_user('stranger')
        self.applicant = make_user('applicant')
        self.course = _course(self.manager)
        self.client = APIClient()


class RulesTests(NeedsBaseTestCase):
    def _make_need(self, **kwargs):
        from django.contrib.contenttypes.models import ContentType

        ct = ContentType.objects.get_for_model(Course)
        defaults = dict(
            content_type=ct, object_id=self.course.pk, title='Help with grading',
            created_by=self.manager,
        )
        defaults.update(kwargs)
        return Need.objects.create(**defaults)

    def test_public_needs_shows_open_needs_on_visible_nodes(self):
        need = self._make_need()
        self.assertIn(need, public_needs(self.stranger))
        self.assertIn(need, public_needs(None))

    def test_public_needs_hides_non_open_needs_from_non_staff(self):
        need = self._make_need(status='in_progress')
        self.assertNotIn(need, public_needs(self.stranger))
        self.assertIn(need, public_needs(self.manager))

    def test_node_needs_narrows_to_open_for_non_staff(self):
        open_need = self._make_need(title='Open one')
        hidden_need = self._make_need(title='Hidden one', status='cancelled')
        rows = list(node_needs(self.stranger, self.course))
        self.assertIn(open_need, rows)
        self.assertNotIn(hidden_need, rows)
        rows_for_manager = list(node_needs(self.manager, self.course))
        self.assertIn(hidden_need, rows_for_manager)

    def test_can_manage_is_the_node_manager_only(self):
        need = self._make_need()
        self.assertTrue(can_manage(self.manager, need))
        self.assertFalse(can_manage(self.stranger, need))
        self.assertFalse(can_manage(self.applicant, need))

    def test_apply_block_reason_not_open(self):
        need = self._make_need(status='cancelled')
        self.assertEqual(apply_block_reason(self.applicant, need), NOT_OPEN)

    def test_apply_block_reason_own_node(self):
        need = self._make_need()
        self.assertEqual(apply_block_reason(self.manager, need), OWN_NODE)

    def test_apply_block_reason_minor(self):
        need = self._make_need()
        minor = make_user('kid')
        minor.profile.is_minor = True
        minor.profile.save(update_fields=['is_minor'])
        self.assertEqual(apply_block_reason(minor, need), MINOR)

    def test_apply_block_reason_already_applied(self):
        need = self._make_need()
        NeedApplication.objects.create(need=need, user=self.applicant)
        self.assertEqual(apply_block_reason(self.applicant, need), ALREADY_APPLIED)

    def test_apply_block_reason_full(self):
        need = self._make_need(wanted_count=1)
        accepted_user = make_user('accepted')
        NeedApplication.objects.create(need=need, user=accepted_user, status='accepted')
        self.assertEqual(apply_block_reason(self.applicant, need), FULL)

    def test_apply_block_reason_none_when_open(self):
        need = self._make_need()
        self.assertIsNone(apply_block_reason(self.applicant, need))

    def test_decide_block_reason(self):
        need = self._make_need()
        application = NeedApplication.objects.create(need=need, user=self.applicant)
        self.assertIsNone(decide_block_reason(application))
        application.status = 'accepted'
        self.assertEqual(decide_block_reason(application), ALREADY_DECIDED)

    def test_recount_marks_fulfilled_and_never_touches_cancelled(self):
        need = self._make_need(wanted_count=1)
        NeedApplication.objects.create(need=need, user=self.applicant, status='accepted')
        recount(need)
        need.refresh_from_db()
        self.assertEqual(need.status, 'fulfilled')

        cancelled = self._make_need(wanted_count=1, status='cancelled')
        NeedApplication.objects.create(need=cancelled, user=self.applicant, status='accepted')
        recount(cancelled)
        cancelled.refresh_from_db()
        self.assertEqual(cancelled.status, 'cancelled')

    def test_recount_reopens_when_an_accepted_applicant_leaves(self):
        need = self._make_need(wanted_count=1, status='fulfilled')
        application = NeedApplication.objects.create(need=need, user=self.applicant, status='accepted')
        application.status = 'withdrawn'
        application.save(update_fields=['status'])
        recount(need)
        need.refresh_from_db()
        self.assertEqual(need.status, 'open')


class ApiTests(NeedsBaseTestCase):
    def setUp(self):
        super().setUp()
        from django.contrib.contenttypes.models import ContentType

        self.ct = ContentType.objects.get_for_model(Course)

    def _need(self, **kwargs):
        defaults = dict(
            content_type=self.ct, object_id=self.course.pk, title='Help with grading',
            created_by=self.manager,
        )
        defaults.update(kwargs)
        return Need.objects.create(**defaults)

    def test_feature_flag_off_blocks_non_staff(self):
        FeatureFlag.objects.filter(key='needs').update(is_enabled=False)
        self.client.force_authenticate(self.stranger)
        response = self.client.get('/api/needs/')
        self.assertEqual(response.status_code, 403)

    def test_feature_flag_off_does_not_block_staff(self):
        FeatureFlag.objects.filter(key='needs').update(is_enabled=False)
        staff = make_user('staffer', is_staff=True)
        self.client.force_authenticate(staff)
        response = self.client.get('/api/needs/')
        self.assertEqual(response.status_code, 200)

    def test_board_lists_open_needs(self):
        self._need()
        response = self.client.get('/api/needs/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertIn('node', response.data[0])
        self.assertEqual(response.data[0]['node']['kind'], 'course')

    def test_board_filters_by_kind_and_remote(self):
        self._need(kind='equipment', title='A laptop', is_remote=True)
        self._need(kind='help', title='Grading', is_remote=False)
        response = self.client.get('/api/needs/?kind=equipment')
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['title'], 'A laptop')
        response = self.client.get('/api/needs/?remote=1')
        self.assertEqual(len(response.data), 1)
        self.assertTrue(response.data[0]['isRemote'] if 'isRemote' in response.data[0] else response.data[0]['is_remote'])

    def test_stranger_cannot_see_a_needs_detail_404(self):
        # A course a stranger genuinely cannot view (members-only) makes the need itself invisible.
        private_course = Course.objects.create(
            instructor=self.manager, title='Private', visibility='only_you', status='open',
            enrollment_policy='open',
        )
        need = Need.objects.create(
            content_type=self.ct, object_id=private_course.pk, title='Secret', created_by=self.manager
        )
        self.client.force_authenticate(self.stranger)
        response = self.client.get(f'/api/needs/{need.pk}/')
        self.assertEqual(response.status_code, 404)

    def test_node_nested_create_requires_manager(self):
        self.client.force_authenticate(self.stranger)
        response = self.client.post(
            f'/api/nodes/course/{self.course.pk}/needs/', {'title': 'X', 'kind': 'help'}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'not_manager')

    def test_node_nested_create_by_manager(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f'/api/nodes/course/{self.course.pk}/needs/',
            {'title': 'Grading help', 'kind': 'help', 'wanted_count': 2},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['status'], 'open')
        self.assertEqual(Need.objects.count(), 1)

    def test_cannot_create_directly_fulfilled(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f'/api/nodes/course/{self.course.pk}/needs/',
            {'title': 'X', 'kind': 'help', 'status': 'fulfilled'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_apply_and_accept_flow(self):
        need = self._need(wanted_count=1)
        self.client.force_authenticate(self.applicant)
        response = self.client.post(f'/api/needs/{need.pk}/apply/', {'message': 'I can help!'}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        application_id = response.data['id']

        # A second application from the same person is refused, not a second row.
        response = self.client.post(f'/api/needs/{need.pk}/apply/', {}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], ALREADY_APPLIED)

        # The manager decides.
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f'/api/need-applications/{application_id}/decide/', {'decision': 'accept'}, format='json'
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['status'], 'accepted')

        need.refresh_from_db()
        self.assertEqual(need.status, 'fulfilled')

        # Deciding again is refused — the world already moved.
        response = self.client.post(
            f'/api/need-applications/{application_id}/decide/', {'decision': 'decline'}, format='json'
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], ALREADY_DECIDED)

    def test_stranger_cannot_decide(self):
        need = self._need()
        application = NeedApplication.objects.create(need=need, user=self.applicant)
        self.client.force_authenticate(self.stranger)
        response = self.client.post(
            f'/api/need-applications/{application.pk}/decide/', {'decision': 'accept'}, format='json'
        )
        self.assertEqual(response.status_code, 404)

    def test_applications_queue_is_manager_only(self):
        need = self._need()
        NeedApplication.objects.create(need=need, user=self.applicant)
        self.client.force_authenticate(self.stranger)
        response = self.client.get(f'/api/needs/{need.pk}/applications/')
        self.assertEqual(response.status_code, 404)
        self.client.force_authenticate(self.manager)
        response = self.client.get(f'/api/needs/{need.pk}/applications/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_withdraw(self):
        need = self._need()
        self.client.force_authenticate(self.applicant)
        self.client.post(f'/api/needs/{need.pk}/apply/', {}, format='json')
        response = self.client.post(f'/api/needs/{need.pk}/withdraw/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'withdrawn')

        response = self.client.post(f'/api/needs/{need.pk}/withdraw/')
        self.assertEqual(response.status_code, 409)

    def test_manager_cannot_apply_to_own_need(self):
        need = self._need()
        self.client.force_authenticate(self.manager)
        response = self.client.post(f'/api/needs/{need.pk}/apply/', {}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], OWN_NODE)

    def test_only_manager_can_put_either(self):
        """The same rule through the other verb.

        `NeedViewSet` takes `UpdateModelMixin`, which binds BOTH `PUT → update` and
        `PATCH → partial_update`; only the second was overridden, so `PUT` ran DRF's own `update`,
        which asks `get_queryset()` (= `public_needs`, *visibility*) and no authority question at
        all. Any signed-in reader of an open posting could rewrite it. Found by
        `events/test_permission_matrix.py` when the management rows landed (§17BI.H).
        """
        need = self._need()
        self.client.force_authenticate(self.stranger)
        response = self.client.put(
            f'/api/needs/{need.pk}/', {'title': 'Mine now', 'kind': 'help'}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['detail'], 'not_manager')
        need.refresh_from_db()
        self.assertEqual(need.title, 'Help with grading')

        self.client.force_authenticate(self.manager)
        response = self.client.put(
            f'/api/needs/{need.pk}/', {'title': 'Renamed', 'kind': 'help'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['title'], 'Renamed')

    def test_only_manager_can_patch(self):
        need = self._need()
        self.client.force_authenticate(self.stranger)
        response = self.client.patch(f'/api/needs/{need.pk}/', {'title': 'Renamed'}, format='json')
        self.assertEqual(response.status_code, 403)
        self.client.force_authenticate(self.manager)
        response = self.client.patch(f'/api/needs/{need.pk}/', {'status': 'cancelled'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'cancelled')


class WorkItemsTests(NeedsBaseTestCase):
    def setUp(self):
        super().setUp()
        from django.contrib.contenttypes.models import ContentType

        self.ct = ContentType.objects.get_for_model(Course)
        self.need = Need.objects.create(
            content_type=self.ct, object_id=self.course.pk, title='Grading help', created_by=self.manager
        )

    def test_applicant_sees_own_pending_application(self):
        from .work import work_items

        NeedApplication.objects.create(need=self.need, user=self.applicant)
        rows = work_items(self.applicant)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['kind'], 'need_application')

    def test_manager_sees_pending_decision_row(self):
        from .work import work_items

        NeedApplication.objects.create(need=self.need, user=self.applicant)
        rows = work_items(self.manager)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['kind'], 'need_decision')
        self.assertEqual(rows[0]['status'], '1 pending')

    def test_stranger_sees_nothing(self):
        from .work import work_items

        NeedApplication.objects.create(need=self.need, user=self.applicant)
        self.assertEqual(work_items(self.stranger), [])
