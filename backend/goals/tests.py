"""`goals` — a goal, its definition of done, and the fact that `met` is derived from it.

The sentences worth pinning are the ones somebody will be tempted to simplify later: that nothing
writes `met` by hand, that a goal with no criteria can never be met, that `abandoned` survives a
recount, and that ticking a line and rewriting a line are two different permissions.

One organisation as the node, because its three roles map exactly onto the three tiers this app
distinguishes: an `owner` manages it (may edit a goal), a `member` is node staff (may tick a
criterion and nothing else), and a stranger may read it and touch nothing.
"""

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import DiscussionLocation
from goals.models import Goal, GoalCriterion
from goals import rules
from moderation.models import FeatureFlag
from organizations.models import Organization, OrganizationMember
from plans.models import Plan
from tasks.models import Task
from telemetry.routers import all_log_shards
from testing.factories import make_user


def _flag(key, enabled):
    FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': enabled})


class GoalsBase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        for key in ('goals', 'tasks', 'plans', 'about_discussions'):
            _flag(key, True)
        self.owner = make_user('goal-owner')
        self.member = make_user('goal-member')
        self.stranger = make_user('goal-stranger')
        self.staff = make_user('goal-staff', is_staff=True)
        self.org = Organization.objects.create(
            name='EdMat test', slug='edmat-test', created_by=self.owner
        )
        OrganizationMember.objects.create(organization=self.org, user=self.owner, role='owner')
        OrganizationMember.objects.create(organization=self.org, user=self.member, role='member')
        self.ct = ContentType.objects.get_for_model(Organization)
        self.node_url = reverse('node-goals', kwargs={'kind': 'organization', 'pk': self.org.pk})

    def goal(self, title='Every exercise has a reviewed solution', **extra):
        return Goal.objects.create(
            content_type=self.ct, object_id=self.org.pk, title=title,
            created_by=self.owner, **extra,
        )

    def criterion(self, goal, text='740 statements imported', **extra):
        return GoalCriterion.objects.create(goal=goal, text=text, **extra)

    def detail_url(self, goal):
        return reverse('goal-detail', kwargs={'pk': goal.pk})

    def tick_url(self, criterion):
        return reverse('goal-criterion-tick', kwargs={'pk': criterion.pk})

    def as_(self, user):
        self.client.force_authenticate(user)


class DefinitionOfDoneTests(GoalsBase):
    """`met` is derived from the criteria and nothing else writes it (`rules.py`, "`met` is
    DERIVED")."""

    def test_a_goal_with_no_criteria_stays_open_however_often_it_is_recounted(self):
        goal = self.goal()
        for _ in range(3):
            rules.recount(goal)
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'open')
        self.assertIsNone(goal.met_at)

    def test_ticking_the_last_criterion_meets_the_goal_and_records_who(self):
        goal = self.goal()
        first = self.criterion(goal)
        second = self.criterion(goal, text='every one has a reviewed solution')
        self.as_(self.member)

        response = self.client.post(self.tick_url(first))
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(response.data['criterion']['is_met'])
        self.assertEqual(response.data['goal']['status'], 'open')
        self.assertEqual(response.data['goal']['criteria_met_count'], 1)
        self.assertEqual(response.data['goal']['criteria_count'], 2)

        response = self.client.post(self.tick_url(second))
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['goal']['status'], 'met')
        self.assertIsNotNone(response.data['goal']['met_at'])
        self.assertEqual(response.data['goal']['met_by']['id'], self.member.pk)

    def test_un_ticking_a_criterion_reopens_a_met_goal_and_clears_the_moment(self):
        goal = self.goal()
        only = self.criterion(goal)
        self.as_(self.member)
        self.client.post(self.tick_url(only))
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'met')

        self.client.delete(self.tick_url(only))
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'open')
        self.assertIsNone(goal.met_at)
        self.assertIsNone(goal.met_by_id)

    def test_adding_an_open_criterion_reopens_a_met_goal(self):
        """The definition of done got longer, so the goal is no longer met — which is the whole
        reason `recount` runs on a change to the LIST and not only on a tick."""
        goal = self.goal()
        only = self.criterion(goal)
        self.as_(self.member)
        self.client.post(self.tick_url(only))

        self.as_(self.owner)
        response = self.client.post(
            reverse('goal-add-criterion', kwargs={'pk': goal.pk}),
            {'text': 'and the KaTeX check is clean'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'open')

    def test_removing_the_last_open_criterion_meets_the_goal(self):
        goal = self.goal()
        done = self.criterion(goal)
        open_one = self.criterion(goal, text='not yet')
        self.as_(self.member)
        self.client.post(self.tick_url(done))
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'open')

        self.as_(self.owner)
        response = self.client.delete(
            reverse('goal-criterion-detail', kwargs={'pk': open_one.pk})
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'met')

    def test_abandoned_survives_a_recount_in_both_directions(self):
        goal = self.goal(status='abandoned')
        only = self.criterion(goal)
        rules.recount(goal)
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'abandoned')

        GoalCriterion.objects.filter(pk=only.pk).update(met_at='2026-10-08T10:00:00Z')
        rules.recount(goal)
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'abandoned')

    def test_a_hand_written_met_is_refused_with_its_reason(self):
        goal = self.goal()
        self.criterion(goal)
        self.as_(self.owner)
        response = self.client.patch(self.detail_url(goal), {'status': 'met'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('status', response.data)
        self.assertIn('tick the criteria', str(response.data['status']))
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'open')


class TransitionTests(GoalsBase):
    def test_a_manager_may_abandon_a_goal_and_bring_it_back(self):
        goal = self.goal()
        self.as_(self.owner)
        response = self.client.patch(self.detail_url(goal), {'status': 'abandoned'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['status'], 'abandoned')
        response = self.client.patch(self.detail_url(goal), {'status': 'open'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'open')

    def test_a_met_goal_cannot_be_reopened_by_asserting_it(self):
        """The one refusal that is the whole app: `met -> open` is not a hand move. The request was
        well formed; the world is not where it thought it was, so 409 (root CLAUDE.md)."""
        goal = self.goal()
        only = self.criterion(goal)
        self.as_(self.member)
        self.client.post(self.tick_url(only))
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'met')

        self.as_(self.owner)
        response = self.client.patch(self.detail_url(goal), {'status': 'open'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], rules.ILLEGAL_TRANSITION)
        # Un-ticking is the honest move, and it works.
        self.as_(self.member)
        self.client.delete(self.tick_url(only))
        goal.refresh_from_db()
        self.assertEqual(goal.status, 'open')

    def test_a_patch_that_sets_the_status_it_already_has_is_a_no_op(self):
        goal = self.goal(status='abandoned')
        self.as_(self.owner)
        response = self.client.patch(self.detail_url(goal), {'status': 'abandoned'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'abandoned')
        # The rule module itself still calls it illegal, which is what a future status would hit.
        self.assertEqual(
            rules.transition_block_reason(goal, 'abandoned'), rules.ILLEGAL_TRANSITION
        )


class AuthorityTests(GoalsBase):
    """Writing what done MEANS and recording that it is TRUE are two permissions."""

    def test_a_manager_writes_a_goal_and_a_stranger_cannot(self):
        self.as_(self.owner)
        response = self.client.post(self.node_url, {'title': 'A goal'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['status'], 'open')
        self.assertEqual(response.data['criteria'], [])
        self.assertTrue(response.data['can_edit'])

        self.as_(self.stranger)
        refused = self.client.post(self.node_url, {'title': 'Mine now'}, format='json')
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(refused.data['detail'], rules.NOT_MANAGER)

    def test_node_staff_may_tick_but_not_rewrite(self):
        goal = self.goal()
        only = self.criterion(goal)
        self.as_(self.member)
        self.assertEqual(self.client.post(self.tick_url(only)).status_code, status.HTTP_200_OK)
        refused = self.client.patch(
            self.detail_url(goal), {'title': 'Something else'}, format='json'
        )
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(refused.data['detail'], rules.NOT_MANAGER)
        refused = self.client.patch(
            reverse('goal-criterion-detail', kwargs={'pk': only.pk}),
            {'text': 'reworded'},
            format='json',
        )
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_reader_who_is_not_staff_may_not_tick(self):
        goal = self.goal()
        only = self.criterion(goal)
        self.as_(self.stranger)
        refused = self.client.post(self.tick_url(only))
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(refused.data['detail'], rules.NOT_STAFF)

    def test_the_goals_own_author_may_edit_it_without_managing_the_node(self):
        goal = Goal.objects.create(
            content_type=self.ct, object_id=self.org.pk, title='Mine', created_by=self.member
        )
        self.as_(self.member)
        response = self.client.patch(self.detail_url(goal), {'title': 'Mine, edited'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

    def test_a_goal_nobody_relied_on_can_be_deleted(self):
        """The `sweep_discussion_locations` test applied to a goal: a row nobody decided anything
        about loses no decision when it goes (`rules.delete_block_reason`)."""
        goal = self.goal(title='Untitlde')
        self.criterion(goal)
        self.as_(self.owner)
        response = self.client.delete(self.detail_url(goal))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Goal.objects.filter(pk=goal.pk).exists())

    def test_a_goal_somebody_is_working_towards_is_abandoned_not_deleted(self):
        goal = self.goal()
        Task.objects.create(
            content_type=self.ct, object_id=self.org.pk, title='Mine', goal=goal,
            created_by=self.owner,
        )
        self.as_(self.owner)
        response = self.client.delete(self.detail_url(goal))
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], rules.HAS_WORK)
        self.assertTrue(Goal.objects.filter(pk=goal.pk).exists())

    def test_a_goal_people_have_talked_under_is_abandoned_not_deleted(self):
        """Any comment at all, tombstones and held rows included — a thread that exists has to
        resolve."""
        goal = self.goal()
        page = f'goals/{goal.pk}'
        self.as_(self.member)
        posted = self.client.post(
            reverse('discussion-thread'), {'page': page, 'body': 'Why this one?'}, format='json'
        )
        self.assertEqual(posted.status_code, status.HTTP_201_CREATED, posted.data)
        self.as_(self.owner)
        response = self.client.delete(self.detail_url(goal))
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], rules.HAS_COMMENTS)

    def test_a_stranger_cannot_delete_a_goal_nobody_relied_on(self):
        goal = self.goal()
        self.as_(self.stranger)
        response = self.client.delete(self.detail_url(goal))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], rules.NOT_MANAGER)


class VisibilityTests(GoalsBase):
    def test_a_goal_is_public_on_a_node_anybody_can_view(self):
        goal = self.goal()
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.detail_url(goal)).status_code, status.HTTP_200_OK)
        listed = self.client.get(self.node_url)
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual([row['id'] for row in listed.data], [goal.pk])

    def test_a_dissolved_organisations_goals_are_404_to_everybody_else(self):
        goal = self.goal()
        self.org.is_active = False
        self.org.save(update_fields=['is_active'])
        self.as_(self.stranger)
        self.assertEqual(
            self.client.get(self.detail_url(goal)).status_code, status.HTTP_404_NOT_FOUND
        )
        self.as_(self.member)
        self.assertEqual(self.client.get(self.detail_url(goal)).status_code, status.HTTP_200_OK)

    def test_an_abandoned_goal_is_still_listed(self):
        """House rule 12: the record of what was once wanted stays, and it stays visible."""
        self.goal(status='abandoned')
        self.client.force_authenticate(None)
        rows = self.client.get(self.node_url).data
        self.assertEqual([row['status'] for row in rows], ['abandoned'])


class KillSwitchTests(GoalsBase):
    def test_the_flag_closes_the_surface_for_everybody_but_staff(self):
        goal = self.goal()
        _flag('goals', False)
        self.as_(self.stranger)
        self.assertEqual(
            self.client.get(self.detail_url(goal)).status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(self.client.get(self.node_url).status_code, status.HTTP_403_FORBIDDEN)
        self.as_(self.staff)
        self.assertEqual(self.client.get(self.detail_url(goal)).status_code, status.HTTP_200_OK)


class ServesGoalTests(GoalsBase):
    """The `goal` FK on a task and on a plan, and the one rule both of them ask."""

    def test_a_task_may_serve_a_goal_on_its_own_node(self):
        goal = self.goal()
        task = Task.objects.create(
            content_type=self.ct, object_id=self.org.pk, title='Import the sheets',
            created_by=self.owner,
        )
        self.as_(self.owner)
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.pk}), {'goal': goal.pk}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['goal'], goal.pk)
        self.assertEqual(response.data['goal_title'], goal.title)

    def test_a_task_may_not_serve_another_nodes_goal(self):
        other = Organization.objects.create(
            name='Somebody else', slug='somebody-else', created_by=self.owner
        )
        OrganizationMember.objects.create(organization=other, user=self.owner, role='owner')
        elsewhere = Goal.objects.create(
            content_type=self.ct, object_id=other.pk, title='Theirs', created_by=self.owner
        )
        task = Task.objects.create(
            content_type=self.ct, object_id=self.org.pk, title='Mine', created_by=self.owner
        )
        self.as_(self.owner)
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.pk}), {'goal': elsewhere.pk}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual([str(m) for m in response.data['goal']], [rules.OTHER_NODE])

    def test_a_plan_may_serve_a_goal_and_says_so(self):
        goal = self.goal()
        plan = Plan.objects.create(
            content_type=self.ct, object_id=self.org.pk, title='The roadmap', status='active',
            created_by=self.owner,
        )
        self.as_(self.owner)
        response = self.client.patch(
            reverse('plan-detail', kwargs={'pk': plan.pk}), {'goal': goal.pk}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['goal_title'], goal.title)

    def test_the_link_survives_the_goal_being_abandoned_and_dies_with_nothing(self):
        goal = self.goal()
        task = Task.objects.create(
            content_type=self.ct, object_id=self.org.pk, title='Mine', goal=goal,
            created_by=self.owner,
        )
        goal.status = 'abandoned'
        goal.save(update_fields=['status'])
        task.refresh_from_db()
        self.assertEqual(task.goal_id, goal.pk)


class ReorderTests(GoalsBase):
    def test_the_whole_list_or_nothing(self):
        goal = self.goal()
        first = self.criterion(goal, text='one', order=0)
        second = self.criterion(goal, text='two', order=1)
        url = reverse('goal-reorder', kwargs={'pk': goal.pk})
        self.as_(self.owner)
        partial = self.client.post(url, {'ids': [second.pk]}, format='json')
        self.assertEqual(partial.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('ids', partial.data)

        response = self.client.post(url, {'ids': [second.pk, first.pk]}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual([row['text'] for row in response.data['criteria']], ['two', 'one'])


class GoalDiscussionTests(GoalsBase):
    """A goal is a `DiscussionLocation` page like the other management rows
    (`community/discussions.py`) — which is the "and also commentable" half of the ask."""

    def setUp(self):
        super().setUp()
        self.policies_url = reverse('discussion-policies')
        self.thread_url = reverse('discussion-thread')

    def test_a_goals_thread_is_readable_and_writable_and_carries_its_key(self):
        goal = self.goal()
        page = f'goals/{goal.pk}'
        self.client.force_authenticate(None)
        policy = self.client.get(self.policies_url, {'page': page})
        self.assertEqual(policy.status_code, status.HTTP_200_OK)
        self.assertEqual(policy.data['locations'][0]['key'], page)
        self.assertTrue(policy.data['locations'][0]['is_enabled'])

        self.as_(self.member)
        posted = self.client.post(
            self.thread_url, {'page': page, 'body': 'Is the third line really needed?'},
            format='json',
        )
        self.assertEqual(posted.status_code, status.HTTP_201_CREATED, posted.data)
        self.assertTrue(DiscussionLocation.objects.filter(page=page, section='').exists())

    def test_a_goal_nobody_may_see_has_no_thread(self):
        goal = self.goal()
        self.org.is_active = False
        self.org.save(update_fields=['is_active'])
        page = f'goals/{goal.pk}'
        self.as_(self.stranger)
        self.assertEqual(
            self.client.get(self.policies_url, {'page': page}).status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_the_goals_flag_closes_the_thread_with_the_surface(self):
        goal = self.goal()
        page = f'goals/{goal.pk}'
        _flag('goals', False)
        self.as_(self.member)
        policy = self.client.get(self.policies_url, {'page': page})
        self.assertEqual(policy.status_code, status.HTTP_200_OK)
        self.assertFalse(policy.data['locations'][0]['is_enabled'])
        self.assertEqual(policy.data['locations'][0]['post_block_reason'], 'off')
