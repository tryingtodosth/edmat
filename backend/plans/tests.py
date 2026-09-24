"""Tests for `plans` — refusals first (MANAGEMENT-BRIEF.md §3.D, §4 rule 14)."""

from django.utils import timezone
from rest_framework.test import APITestCase

from courses.models import Course
from moderation.models import FeatureFlag
from testing.factories import make_user

from .models import Plan, PlanStep, PlanSuggestion


def _node_plans_url(kind, pk):
    return f'/api/nodes/{kind}/{pk}/plans/'


class PlansTestCase(APITestCase):
    def setUp(self):
        self.owner = make_user('owner')
        self.other_staff = make_user('assistant')
        self.stranger = make_user('stranger')
        self.minor = make_user('minor')
        self.minor.profile.is_minor = True
        self.minor.profile.save(update_fields=['is_minor'])

        self.course = Course.objects.create(instructor=self.owner, title='Analiza', visibility='public')

    def _login(self, user):
        self.client.force_authenticate(user)

    def _create_plan(self, *, status='draft'):
        self._login(self.owner)
        resp = self.client.post(
            _node_plans_url('course', self.course.pk), {'title': 'Roadmap', 'description': ''}
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        plan = Plan.objects.get(pk=resp.data['id'])
        if status != 'draft':
            self.client.post(f'/api/plans/{plan.pk}/transition/', {'status': status})
            plan.refresh_from_db()
        return plan


class NodePlansViewTests(PlansTestCase):
    def test_anonymous_cannot_list_a_course_that_does_not_exist(self):
        resp = self.client.get(_node_plans_url('course', 999999))
        self.assertEqual(resp.status_code, 404)

    def test_unknown_kind_is_404(self):
        resp = self.client.get(_node_plans_url('spaceship', self.course.pk))
        self.assertEqual(resp.status_code, 404)

    def test_non_manager_cannot_create_a_plan(self):
        self._login(self.stranger)
        resp = self.client.post(
            _node_plans_url('course', self.course.pk), {'title': 'Sneaky plan'}
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data['detail'], 'not_editor')

    def test_manager_can_create_a_draft_plan(self):
        self._login(self.owner)
        resp = self.client.post(
            _node_plans_url('course', self.course.pk), {'title': 'Roadmap', 'description': '<script>x</script>'}
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['status'], 'draft')
        # Sanitized on write (house rule 8) — a <script> never reaches the row.
        self.assertNotIn('<script>', resp.data['description'])

    def test_a_blank_title_is_rejected(self):
        self._login(self.owner)
        resp = self.client.post(_node_plans_url('course', self.course.pk), {'title': '   '})
        self.assertEqual(resp.status_code, 400)

    def test_a_stranger_does_not_see_a_draft_plan_in_the_list(self):
        plan = self._create_plan(status='draft')
        self._login(self.stranger)
        resp = self.client.get(_node_plans_url('course', self.course.pk))
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn(plan.pk, [row['id'] for row in resp.data])

    def test_a_stranger_sees_an_active_plan_in_the_list(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        resp = self.client.get(_node_plans_url('course', self.course.pk))
        self.assertEqual(resp.status_code, 200)
        self.assertIn(plan.pk, [row['id'] for row in resp.data])

    def test_the_feature_flag_hides_the_endpoint_from_ordinary_users(self):
        FeatureFlag.objects.update_or_create(key='plans', defaults={'is_enabled': False})
        self._login(self.stranger)
        resp = self.client.get(_node_plans_url('course', self.course.pk))
        self.assertEqual(resp.status_code, 403)

    def test_the_feature_flag_never_blocks_staff(self):
        FeatureFlag.objects.update_or_create(key='plans', defaults={'is_enabled': False})
        staff = make_user('mod', is_staff=True)
        self._login(staff)
        resp = self.client.get(_node_plans_url('course', self.course.pk))
        self.assertEqual(resp.status_code, 200)


class PlanDetailTests(PlansTestCase):
    def test_a_stranger_gets_404_on_a_draft_plan(self):
        plan = self._create_plan(status='draft')
        self._login(self.stranger)
        resp = self.client.get(f'/api/plans/{plan.pk}/')
        self.assertEqual(resp.status_code, 404)

    def test_a_stranger_can_read_an_active_plan(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        resp = self.client.get(f'/api/plans/{plan.pk}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['id'], plan.pk)
        self.assertEqual(resp.data['node']['kind'], 'course')

    def test_non_editor_cannot_patch(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        resp = self.client.patch(f'/api/plans/{plan.pk}/', {'title': 'Hijacked'})
        self.assertEqual(resp.status_code, 403)

    def test_editor_can_rename(self):
        plan = self._create_plan(status='draft')
        self._login(self.owner)
        resp = self.client.patch(f'/api/plans/{plan.pk}/', {'title': 'New title'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['title'], 'New title')

    def test_delete_only_while_draft(self):
        plan = self._create_plan(status='active')
        self._login(self.owner)
        resp = self.client.delete(f'/api/plans/{plan.pk}/')
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data['detail'], 'not_draft')

    def test_delete_a_draft(self):
        plan = self._create_plan(status='draft')
        self._login(self.owner)
        resp = self.client.delete(f'/api/plans/{plan.pk}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Plan.objects.filter(pk=plan.pk).exists())


class TransitionTests(PlansTestCase):
    def test_illegal_transition_is_409(self):
        plan = self._create_plan(status='draft')
        self._login(self.owner)
        resp = self.client.post(f'/api/plans/{plan.pk}/transition/', {'status': 'completed'})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data['detail'], 'illegal_transition')

    def test_activate(self):
        plan = self._create_plan(status='draft')
        self._login(self.owner)
        resp = self.client.post(f'/api/plans/{plan.pk}/transition/', {'status': 'active'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'active')

    def test_complete_is_blocked_while_a_step_is_pending(self):
        plan = self._create_plan(status='active')
        self._login(self.owner)
        self.client.post(f'/api/plans/{plan.pk}/steps/', {'title': 'Step one'})
        resp = self.client.post(f'/api/plans/{plan.pk}/transition/', {'status': 'completed'})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data['detail'], 'steps_pending')

    def test_complete_once_every_step_is_done_or_skipped(self):
        plan = self._create_plan(status='active')
        self._login(self.owner)
        step_resp = self.client.post(f'/api/plans/{plan.pk}/steps/', {'title': 'Step one'})
        step_id = step_resp.data['id']
        self.client.patch(f'/api/plan-steps/{step_id}/', {'status': 'done'})
        resp = self.client.post(f'/api/plans/{plan.pk}/transition/', {'status': 'completed'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'completed')

    def test_non_editor_cannot_transition(self):
        # Must be visible to the stranger first (house rule 4) — an active plan is, so this
        # actually reaches the authority check rather than 404ing on visibility alone.
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        resp = self.client.post(f'/api/plans/{plan.pk}/transition/', {'status': 'archived'})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data['detail'], 'not_editor')


class StepTests(PlansTestCase):
    def test_a_substep_may_not_itself_have_a_parent(self):
        plan = self._create_plan(status='active')
        self._login(self.owner)
        top = self.client.post(f'/api/plans/{plan.pk}/steps/', {'title': 'Top'}).data
        sub = self.client.post(
            f'/api/plans/{plan.pk}/steps/', {'title': 'Sub', 'parent': top['id']}
        ).data
        resp = self.client.post(
            f'/api/plans/{plan.pk}/steps/', {'title': 'Too deep', 'parent': sub['id']}
        )
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data['detail'], 'nested')

    def test_marking_done_records_who_and_when(self):
        plan = self._create_plan(status='active')
        self._login(self.owner)
        step = self.client.post(f'/api/plans/{plan.pk}/steps/', {'title': 'Step'}).data
        resp = self.client.patch(f'/api/plan-steps/{step["id"]}/', {'status': 'done'})
        self.assertEqual(resp.status_code, 200)
        row = PlanStep.objects.get(pk=step['id'])
        self.assertEqual(row.done_by_id, self.owner.pk)
        self.assertIsNotNone(row.done_at)

    def test_un_doing_a_step_clears_done_by(self):
        plan = self._create_plan(status='active')
        self._login(self.owner)
        step = self.client.post(f'/api/plans/{plan.pk}/steps/', {'title': 'Step'}).data
        self.client.patch(f'/api/plan-steps/{step["id"]}/', {'status': 'done'})
        self.client.patch(f'/api/plan-steps/{step["id"]}/', {'status': 'pending'})
        row = PlanStep.objects.get(pk=step['id'])
        self.assertIsNone(row.done_by_id)
        self.assertIsNone(row.done_at)

    def test_non_editor_cannot_add_a_step(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        resp = self.client.post(f'/api/plans/{plan.pk}/steps/', {'title': 'Sneaky'})
        self.assertEqual(resp.status_code, 403)


class ReorderTests(PlansTestCase):
    def test_a_reorder_that_is_not_exactly_the_group_is_rejected(self):
        plan = self._create_plan(status='active')
        self._login(self.owner)
        a = self.client.post(f'/api/plans/{plan.pk}/steps/', {'title': 'A'}).data
        self.client.post(f'/api/plans/{plan.pk}/steps/', {'title': 'B'}).data
        resp = self.client.post(f'/api/plans/{plan.pk}/reorder/', {'ids': [a['id']]})
        self.assertEqual(resp.status_code, 400)

    def test_a_full_reorder_takes(self):
        plan = self._create_plan(status='active')
        self._login(self.owner)
        a = self.client.post(f'/api/plans/{plan.pk}/steps/', {'title': 'A'}).data
        b = self.client.post(f'/api/plans/{plan.pk}/steps/', {'title': 'B'}).data
        resp = self.client.post(f'/api/plans/{plan.pk}/reorder/', {'ids': [b['id'], a['id']]})
        self.assertEqual(resp.status_code, 200)
        titles = [s['title'] for s in resp.data['steps']]
        self.assertEqual(titles, ['B', 'A'])


class SuggestionTests(PlansTestCase):
    def test_suggesting_on_a_non_active_plan_is_refused(self):
        # A draft plan is visible only to node staff (house rule 4) — the "not_active" refusal is
        # reachable only by somebody who CAN see the plan, which for a draft means staff, and
        # `suggest_block_reason` checks `not_active` before `own_plan` so even the plan's own
        # editor sees this refusal rather than "own_plan" while it is still a draft.
        plan = self._create_plan(status='draft')
        self._login(self.owner)
        resp = self.client.post(f'/api/plans/{plan.pk}/suggestions/', {'text': 'Add a step'})
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data['detail'], 'not_active')

    def test_a_stranger_cannot_reach_a_draft_plans_suggestion_box_at_all(self):
        plan = self._create_plan(status='draft')
        self._login(self.stranger)
        resp = self.client.post(f'/api/plans/{plan.pk}/suggestions/', {'text': 'Add a step'})
        self.assertEqual(resp.status_code, 404)

    def test_a_minor_may_not_suggest(self):
        plan = self._create_plan(status='active')
        self._login(self.minor)
        resp = self.client.post(f'/api/plans/{plan.pk}/suggestions/', {'text': 'Add a step'})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data['detail'], 'minor')

    def test_an_editor_does_not_suggest(self):
        plan = self._create_plan(status='active')
        self._login(self.owner)
        resp = self.client.post(f'/api/plans/{plan.pk}/suggestions/', {'text': 'Add a step'})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data['detail'], 'own_plan')

    def test_a_reader_can_suggest(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        resp = self.client.post(f'/api/plans/{plan.pk}/suggestions/', {'text': 'Add a step'})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['status'], 'pending')

    def test_accepting_a_suggestion_creates_a_step(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        suggestion = self.client.post(
            f'/api/plans/{plan.pk}/suggestions/', {'text': 'Add exercises'}
        ).data
        self._login(self.owner)
        resp = self.client.post(
            f'/api/plan-suggestions/{suggestion["id"]}/decide/', {'decision': 'accept'}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'accepted')
        self.assertIsNotNone(resp.data['created_step'])
        step = PlanStep.objects.get(pk=resp.data['created_step'])
        self.assertEqual(step.plan_id, plan.pk)

    def test_rejecting_a_suggestion_creates_no_step(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        suggestion = self.client.post(
            f'/api/plans/{plan.pk}/suggestions/', {'text': 'Nope'}
        ).data
        self._login(self.owner)
        resp = self.client.post(
            f'/api/plan-suggestions/{suggestion["id"]}/decide/', {'decision': 'reject'}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'rejected')
        self.assertIsNone(resp.data['created_step'])

    def test_deciding_twice_is_409(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        suggestion = self.client.post(
            f'/api/plans/{plan.pk}/suggestions/', {'text': 'Add exercises'}
        ).data
        self._login(self.owner)
        self.client.post(f'/api/plan-suggestions/{suggestion["id"]}/decide/', {'decision': 'accept'})
        resp = self.client.post(
            f'/api/plan-suggestions/{suggestion["id"]}/decide/', {'decision': 'reject'}
        )
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data['detail'], 'already_decided')

    def test_only_the_author_may_withdraw(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        suggestion = self.client.post(
            f'/api/plans/{plan.pk}/suggestions/', {'text': 'Add exercises'}
        ).data
        self._login(self.other_staff)
        resp = self.client.post(f'/api/plan-suggestions/{suggestion["id"]}/withdraw/')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data['detail'], 'not_own_suggestion')

    def test_the_author_can_withdraw(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        suggestion = self.client.post(
            f'/api/plans/{plan.pk}/suggestions/', {'text': 'Add exercises'}
        ).data
        resp = self.client.post(f'/api/plan-suggestions/{suggestion["id"]}/withdraw/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'withdrawn')

    def test_only_a_manager_sees_the_suggestion_queue(self):
        plan = self._create_plan(status='active')
        self._login(self.stranger)
        self.client.post(f'/api/plans/{plan.pk}/suggestions/', {'text': 'Add exercises'})
        resp = self.client.get(f'/api/plans/{plan.pk}/suggestions/')
        self.assertEqual(resp.status_code, 403)


class WorkItemsTests(PlansTestCase):
    def test_due_step_on_a_plan_i_edit_is_a_work_item(self):
        from .work import work_items

        plan = self._create_plan(status='active')
        self._login(self.owner)
        soon = timezone.now() + timezone.timedelta(days=1)
        self.client.post(
            f'/api/plans/{plan.pk}/steps/',
            {'title': 'Due soon', 'due_at': soon.isoformat()},
        )
        items = work_items(self.owner)
        kinds = [item['kind'] for item in items]
        self.assertIn('plan_step', kinds)

    def test_a_stranger_never_sees_it(self):
        from .work import work_items

        plan = self._create_plan(status='active')
        self._login(self.owner)
        soon = timezone.now() + timezone.timedelta(days=1)
        self.client.post(
            f'/api/plans/{plan.pk}/steps/',
            {'title': 'Due soon', 'due_at': soon.isoformat()},
        )
        self.assertEqual(work_items(self.stranger), [])

    def test_a_pending_suggestion_on_a_plan_i_manage_is_a_work_item(self):
        from .work import work_items

        plan = self._create_plan(status='active')
        self._login(self.stranger)
        self.client.post(f'/api/plans/{plan.pk}/suggestions/', {'text': 'Consider this'})
        items = work_items(self.owner)
        kinds = [item['kind'] for item in items]
        self.assertIn('plan_suggestion', kinds)

    def test_anonymous_gets_nothing(self):
        from .work import work_items

        self.assertEqual(work_items(None), [])
