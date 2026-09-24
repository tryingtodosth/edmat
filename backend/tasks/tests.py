"""Refusals first, because almost everything a task board has to get right is a refusal.

`MANAGEMENT-BRIEF.md` §3.B, §4 rule 14, and `test.md` §5's shape. The thing that would fail
silently here is not "somebody ticked a task" — it is an event's attendee reading the organisers'
board, or a volunteer quietly handing their own task to somebody who is not on the rota. So the
visibility rules, the authority rules and the transition table get a test each before any happy
path, and the three derived numbers (`progress`, `is_overdue`, the `mine` ordering) get one each
because a recount that is wrong is worse than a stored count that is stale.

The node under test is an **event**, because its roster has the cleanest three-way split this app
cares about: a host who manages, a volunteer who is staff, and an attendee who is neither. One
test uses a **course** instead, to prove the node seam really is doing the dispatching rather than
`events` being special-cased anywhere below.
"""

from datetime import timedelta

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from courses.models import Course
from events.models import Event, EventStaff
from tasks import rules, work
from tasks.models import Task, TaskAssignee
from telemetry.routers import all_log_shards
from testing.factories import make_user


def _future(days=3, hour=10):
    when = timezone.localtime(timezone.now()) + timedelta(days=days)
    return when.replace(hour=hour, minute=0, second=0, microsecond=0)


class TaskTestCase(APITestCase):
    #: The telemetry log shards, like every other API test case here: a 404 walks through the
    #: request-logging middleware, which writes to them, and a test that does not declare them
    #: fails with `DatabaseOperationForbidden` rather than with anything about tasks.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('task-host')
        self.helper = make_user('task-helper')
        self.outsider = make_user('task-outsider')
        self.event = Event.objects.create(
            host=self.host,
            title='Open day',
            starts_at=_future(),
            duration_minutes=120,
            status='published',
            visibility='public',
        )
        EventStaff.objects.create(event=self.event, user=self.helper, role='volunteer')
        self.task = self.make_task('Print the badges', creator=self.host)

    # -- helpers ---------------------------------------------------------------------------------

    def make_task(self, title, *, creator=None, node=None, **kwargs):
        node = node or self.event
        return Task.objects.create(
            content_type=ContentType.objects.get_for_model(node),
            object_id=node.pk,
            title=title,
            created_by=creator or self.host,
            **kwargs,
        )

    def board(self, kind='event', pk=None):
        return reverse('node-tasks', args=[kind, pk or self.event.pk])

    def detail(self, task=None):
        return reverse('task-detail', args=[(task or self.task).pk])

    def act(self, verb, task=None, **body):
        return self.client.post(reverse(f'task-{verb}', args=[(task or self.task).pk]), body)


# ---- who may see a board at all ----------------------------------------------------------------


class VisibilityRefusalTests(TaskTestCase):
    def test_anonymous_gets_404_on_the_board(self):
        response = self.client.get(self.board())
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_stranger_gets_404_on_the_board_of_a_public_event(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.get(self.board())
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_stranger_gets_404_on_a_task_id_rather_than_403(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.detail()).status_code, status.HTTP_404_NOT_FOUND)

    def test_an_attendee_is_not_staff_and_sees_nothing(self):
        self.event.attendances.create(attendee=self.outsider, status='going')
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.board()).status_code, status.HTTP_404_NOT_FOUND)

    def test_staff_see_the_board(self):
        self.client.force_authenticate(self.helper)
        response = self.client.get(self.board())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row['title'] for row in response.data], ['Print the badges'])

    def test_unknown_node_kind_is_404(self):
        self.client.force_authenticate(self.host)
        self.assertEqual(
            self.client.get(self.board(kind='exercise')).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_a_non_numeric_task_id_is_a_404_not_a_500(self):
        """`config/routers.NUMERIC_PK_REGEX` — `/api/tasks/undefined/` is about nothing, and the
        honest answer to that is 404 rather than a `ValueError` from `int()`."""
        self.client.force_authenticate(self.host)
        self.assertEqual(self.client.get('/api/tasks/undefined/').status_code, status.HTTP_404_NOT_FOUND)

    def test_visible_tasks_is_empty_for_a_non_staff_reader(self):
        self.assertEqual(rules.visible_tasks(self.outsider, self.event).count(), 0)
        self.assertEqual(rules.visible_tasks(self.helper, self.event).count(), 1)

    def test_a_course_board_answers_through_the_same_seam(self):
        teacher = make_user('task-teacher')
        # `Course.save()` creates the owner's own `CourseStaff` row — a second one here is a
        # UNIQUE violation, which is how this test first failed.
        course = Course.objects.create(instructor=teacher, title='Analiza', visibility='public')
        self.make_task('Write the syllabus', creator=teacher, node=course)
        self.client.force_authenticate(teacher)
        response = self.client.get(self.board(kind='course', pk=course.pk))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row['title'] for row in response.data], ['Write the syllabus'])
        self.client.force_authenticate(self.outsider)
        self.assertEqual(
            self.client.get(self.board(kind='course', pk=course.pk)).status_code,
            status.HTTP_404_NOT_FOUND,
        )


# ---- who may change what -----------------------------------------------------------------------


class AuthorityRefusalTests(TaskTestCase):
    def test_a_staff_member_who_is_neither_creator_nor_assignee_may_not_edit(self):
        self.client.force_authenticate(self.helper)
        response = self.client.patch(self.detail(), {'title': 'Mine now'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['reason'], 'not_allowed')

    def test_an_assignee_may_edit(self):
        TaskAssignee.objects.create(task=self.task, user=self.helper, assigned_by=self.host)
        self.client.force_authenticate(self.helper)
        response = self.client.patch(self.detail(), {'title': 'Print 200 badges'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['title'], 'Print 200 badges')

    def test_only_a_manager_may_assign(self):
        self.client.force_authenticate(self.helper)
        response = self.act('assign', user=self.helper.pk)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['reason'], 'not_manager')

    def test_an_assignee_must_be_node_staff(self):
        self.client.force_authenticate(self.host)
        response = self.act('assign', user=self.outsider.pk)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['reason'], 'not_staff')

    def test_assigning_a_missing_account_is_not_staff_too(self):
        self.client.force_authenticate(self.host)
        response = self.act('assign', user=99999)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['reason'], 'not_staff')

    def test_assigning_twice_is_409_already_assigned(self):
        self.client.force_authenticate(self.host)
        self.assertEqual(self.act('assign', user=self.helper.pk).status_code, status.HTTP_200_OK)
        response = self.act('assign', user=self.helper.pk)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'already_assigned')

    def test_unassigning_somebody_who_is_not_on_it(self):
        self.client.force_authenticate(self.host)
        response = self.act('unassign', user=self.helper.pk)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['reason'], 'not_assigned')

    def test_assign_then_unassign(self):
        self.client.force_authenticate(self.host)
        self.act('assign', user=self.helper.pk)
        response = self.act('unassign', user=self.helper.pk)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['assignees'], [])

    def test_deleting_is_not_a_bystanders_to_do(self):
        task = self.make_task('Hire the van', creator=self.host)
        self.client.force_authenticate(self.helper)
        response = self.client.delete(self.detail(task))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['reason'], 'not_allowed')

    def test_the_creator_may_delete_their_own(self):
        task = self.make_task('Book the room', creator=self.helper)
        self.client.force_authenticate(self.helper)
        self.assertEqual(
            self.client.delete(self.detail(task)).status_code, status.HTTP_204_NO_CONTENT
        )

    def test_a_task_with_subtasks_refuses_to_be_deleted(self):
        self.make_task('Order the toner', creator=self.host, parent=self.task)
        self.client.force_authenticate(self.host)
        response = self.client.delete(self.detail())
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'has_subtasks')


# ---- the transition table ------------------------------------------------------------------------


class TransitionTests(TaskTestCase):
    def move(self, to, task=None):
        return self.act('transition', task=task, status=to)

    def test_the_forward_path_works(self):
        self.client.force_authenticate(self.host)
        for step in ('in_progress', 'review', 'done'):
            self.assertEqual(self.move(step).status_code, status.HTTP_200_OK, step)
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, 'done')
        self.assertIsNotNone(self.task.done_at)

    def test_skipping_a_step_is_409_illegal_transition(self):
        self.client.force_authenticate(self.host)
        response = self.move('done')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'illegal_transition')

    def test_moving_to_the_status_it_already_has_is_illegal(self):
        self.client.force_authenticate(self.host)
        self.assertEqual(self.move('todo').status_code, status.HTTP_409_CONFLICT)

    def test_anything_open_may_be_cancelled(self):
        self.client.force_authenticate(self.host)
        for start in ('todo', 'in_progress', 'review'):
            task = self.make_task(f'cancel from {start}', creator=self.host, status=start)
            self.assertEqual(self.move('cancelled', task).status_code, status.HTTP_200_OK, start)

    def test_a_cancelled_task_may_not_be_picked_back_up_directly(self):
        task = self.make_task('abandoned', creator=self.host, status='cancelled')
        self.client.force_authenticate(self.host)
        response = self.move('in_progress', task)
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'illegal_transition')

    def test_reopening_is_a_managers_call(self):
        task = self.make_task('finished', creator=self.helper, status='done', done_at=timezone.now())
        TaskAssignee.objects.create(task=task, user=self.helper, assigned_by=self.host)
        self.client.force_authenticate(self.helper)
        response = self.move('todo', task)
        # 403 rather than 409: the refusal is about authority, not about the world having moved —
        # the move itself is a legal one, for somebody else (backend/CLAUDE.md's status table).
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['reason'], 'not_manager')

    def test_a_manager_reopens_and_the_done_stamp_goes_with_it(self):
        task = self.make_task('finished', creator=self.host, status='done', done_at=timezone.now())
        self.client.force_authenticate(self.host)
        self.assertEqual(self.move('todo', task).status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        self.assertEqual(task.status, 'todo')
        self.assertIsNone(task.done_at)

    def test_a_status_that_is_not_a_status_is_a_400_not_a_409(self):
        self.client.force_authenticate(self.host)
        self.assertEqual(self.move('nearly').status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_bystander_may_not_move_it(self):
        self.client.force_authenticate(self.helper)
        response = self.move('in_progress')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['reason'], 'not_allowed')

    def test_the_second_of_two_simultaneous_moves_loses(self):
        """The WHERE-anchored `update()` (backend/CLAUDE.md SQLite rule 1): the loser's row no
        longer has the status their request was anchored to, so they get the same 409 a wrong move
        gets — which by then is what it is."""
        self.client.force_authenticate(self.host)
        Task.objects.filter(pk=self.task.pk).update(status='in_progress')
        response = self.move('in_progress')  # anchored on a `todo` that is already gone
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)


# ---- one level of subtasks -----------------------------------------------------------------------


class SubtaskTests(TaskTestCase):
    def test_a_subtask_lands_on_its_parents_node(self):
        self.client.force_authenticate(self.host)
        response = self.act('subtasks', title='Buy the lanyards')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        child = Task.objects.get(pk=response.data['id'])
        self.assertEqual(child.parent_id, self.task.pk)
        self.assertEqual(child.object_id, self.event.pk)

    def test_a_subtask_of_a_subtask_is_409_nested(self):
        self.client.force_authenticate(self.host)
        child_id = self.act('subtasks', title='Buy the lanyards').data['id']
        response = self.client.post(reverse('task-subtasks', args=[child_id]), {'title': 'deeper'})
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['reason'], 'nested')

    def test_a_bystander_may_not_add_one(self):
        self.client.force_authenticate(self.helper)
        response = self.act('subtasks', title='mine')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['reason'], 'not_allowed')

    def test_subtasks_travel_folded_under_their_parent_and_never_at_top_level(self):
        self.make_task('Order the toner', creator=self.host, parent=self.task)
        self.client.force_authenticate(self.host)
        rows = self.client.get(self.board()).data
        self.assertEqual(len(rows), 1)
        self.assertEqual([child['title'] for child in rows[0]['subtasks']], ['Order the toner'])
        self.assertEqual(rows[0]['subtasks'][0]['subtasks'], [])


# ---- the derived numbers --------------------------------------------------------------------------


class DerivedNumberTests(TaskTestCase):
    def test_progress_is_recounted_and_a_childless_task_is_zero_of_zero(self):
        self.assertEqual(rules.progress(self.task), (0, 0))
        self.make_task('a', creator=self.host, parent=self.task, status='done')
        self.make_task('b', creator=self.host, parent=self.task)
        self.assertEqual(rules.progress(self.task), (1, 2))
        self.task.subtasks.filter(status='done').delete()
        self.assertEqual(rules.progress(self.task), (0, 1))

    def test_a_cancelled_subtask_stays_in_the_denominator(self):
        self.make_task('a', creator=self.host, parent=self.task, status='cancelled')
        self.assertEqual(rules.progress(self.task), (0, 1))

    def test_overdue_is_open_and_past_only(self):
        past = timezone.now() - timedelta(days=1)
        self.assertFalse(rules.is_overdue(self.task))
        self.task.due_at = past
        self.assertTrue(rules.is_overdue(self.task))
        self.task.status = 'done'
        self.assertFalse(rules.is_overdue(self.task))
        self.task.status = 'cancelled'
        self.assertFalse(rules.is_overdue(self.task))

    def test_the_board_filters(self):
        overdue = self.make_task('late', creator=self.host, due_at=timezone.now() - timedelta(days=2))
        self.make_task('doing', creator=self.host, status='in_progress')
        self.client.force_authenticate(self.host)
        self.assertEqual(
            [row['title'] for row in self.client.get(self.board() + '?status=in_progress').data],
            ['doing'],
        )
        self.assertEqual(
            [row['title'] for row in self.client.get(self.board() + '?overdue=1').data],
            [overdue.title],
        )
        TaskAssignee.objects.create(task=overdue, user=self.host, assigned_by=self.host)
        self.assertEqual(
            [row['title'] for row in self.client.get(self.board() + '?assignee=me').data],
            [overdue.title],
        )


# ---- writing, and what is done to what was written --------------------------------------------------


class WriteTests(TaskTestCase):
    def test_a_staff_member_who_is_not_a_manager_may_still_write_a_task(self):
        self.client.force_authenticate(self.helper)
        response = self.client.post(self.board(), {'title': 'Find a second projector'})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['created_by']['id'], self.helper.pk)

    def test_a_stranger_may_not_write_one(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.post(self.board(), {'title': 'Cancel everything'})
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_description_is_sanitized_on_write(self):
        self.client.force_authenticate(self.host)
        response = self.client.post(
            self.board(),
            {'title': 'Tidy up', 'description': '<script>alert(1)</script><p>Real text</p>'},
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotIn('<script>', response.data['description'])
        self.assertIn('Real text', response.data['description'])

    def test_status_cannot_be_set_by_a_patch(self):
        """The one guarded path must be the only path — a PATCH that set `status` would be a second
        copy of the transition table with none of its refusals."""
        self.client.force_authenticate(self.host)
        response = self.client.patch(self.detail(), {'status': 'done'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, 'todo')

    def test_a_title_is_required(self):
        self.client.force_authenticate(self.host)
        self.assertEqual(
            self.client.post(self.board(), {'title': ''}).status_code, status.HTTP_400_BAD_REQUEST
        )


# ---- my tasks, and the work dashboard row -----------------------------------------------------------


class MineTests(TaskTestCase):
    def setUp(self):
        super().setUp()
        self.url = reverse('task-mine')

    def test_assigned_and_created_are_two_lists_and_nothing_is_in_both(self):
        TaskAssignee.objects.create(task=self.task, user=self.host, assigned_by=self.host)
        self.make_task('Waiting on somebody', creator=self.host, status='review')
        self.client.force_authenticate(self.host)
        data = self.client.get(self.url).data
        self.assertEqual([row['title'] for row in data['assigned']], ['Print the badges'])
        self.assertEqual([row['title'] for row in data['created']], ['Waiting on somebody'])

    def test_overdue_comes_first(self):
        soon = self.make_task('soon', creator=self.host, due_at=timezone.now() + timedelta(days=1))
        late = self.make_task('late', creator=self.host, due_at=timezone.now() - timedelta(days=1))
        undated = self.make_task('someday', creator=self.host)
        for task in (soon, late, undated):
            TaskAssignee.objects.create(task=task, user=self.host, assigned_by=self.host)
        self.client.force_authenticate(self.host)
        titles = [row['title'] for row in self.client.get(self.url).data['assigned']]
        self.assertEqual(titles, ['late', 'soon', 'someday'])

    def test_a_task_on_a_node_i_have_left_is_gone_from_my_list(self):
        task = self.make_task('Hand over the keys', creator=self.helper)
        TaskAssignee.objects.create(task=task, user=self.helper, assigned_by=self.host)
        self.client.force_authenticate(self.helper)
        self.assertEqual(len(self.client.get(self.url).data['assigned']), 1)
        EventStaff.objects.filter(event=self.event, user=self.helper).delete()
        self.assertEqual(self.client.get(self.url).data['assigned'], [])

    def test_anonymous_may_not_ask(self):
        self.assertIn(
            self.client.get(self.url).status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )


class WorkProviderTests(TaskTestCase):
    def test_the_rows_carry_every_key_the_dashboard_reads(self):
        TaskAssignee.objects.create(task=self.task, user=self.helper, assigned_by=self.host)
        items = work.work_items(self.helper)
        self.assertEqual(len(items), 1)
        self.assertEqual(
            set(items[0]), {'kind', 'title', 'url', 'due_at', 'status', 'urgency', 'node'}
        )
        self.assertEqual(items[0]['kind'], 'task')
        self.assertEqual(items[0]['url'], f'/tasks/{self.task.pk}')
        self.assertEqual(items[0]['node']['kind'], 'event')

    def test_a_finished_task_is_not_waiting_on_anybody(self):
        Task.objects.filter(pk=self.task.pk).update(status='done')
        TaskAssignee.objects.create(task=self.task, user=self.helper, assigned_by=self.host)
        self.assertEqual(work.work_items(self.helper), [])

    def test_what_i_created_shows_up_only_once_it_is_in_review(self):
        task = self.make_task('Somebody else is on it', creator=self.helper)
        self.assertEqual(work.work_items(self.helper), [])
        Task.objects.filter(pk=task.pk).update(status='review')
        self.assertEqual([row['title'] for row in work.work_items(self.helper)], [task.title])

    def test_urgency_scale(self):
        now = timezone.now()
        self.assertEqual(work.urgency_of(None, now), 0)
        self.assertEqual(work.urgency_of(now - timedelta(hours=1), now), 3)
        self.assertEqual(work.urgency_of(now + timedelta(days=3), now), 2)
        self.assertEqual(work.urgency_of(now + timedelta(days=20), now), 1)
        self.assertEqual(work.urgency_of(now + timedelta(days=90), now), 0)

    def test_an_anonymous_caller_has_no_work(self):
        self.assertEqual(work.work_items(None), [])


# ---- the kill switch ------------------------------------------------------------------------------


class FeatureFlagTests(TaskTestCase):
    def setUp(self):
        super().setUp()
        from moderation.models import FeatureFlag

        FeatureFlag.objects.update_or_create(key='tasks', defaults={'is_enabled': False})

    def test_the_board_closes_for_an_ordinary_staff_member(self):
        self.client.force_authenticate(self.host)
        self.assertEqual(self.client.get(self.board()).status_code, status.HTTP_403_FORBIDDEN)

    def test_a_moderator_still_reaches_their_own_tools(self):
        moderator = make_user('task-moderator')
        moderator.is_staff = True
        moderator.save(update_fields=['is_staff'])
        EventStaff.objects.create(event=self.event, user=moderator, role='organiser')
        self.client.force_authenticate(moderator)
        self.assertEqual(self.client.get(self.board()).status_code, status.HTTP_200_OK)
