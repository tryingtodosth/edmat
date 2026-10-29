"""The open board (2026-10-08): an organisation with `open_board=True` lets anyone who can view it
read its tasks and its open and closed polls, and nothing else changes — writes stay with the
roster, votes with the eligible, drafts with the managers, ballots with the managers. A body
with the board closed answers exactly as before (404 on tasks, no polls), and that is asserted
beside every open-board assertion so the default cannot drift open.

The rule is asked through `config.nodes.is_open_board` by `tasks.rules`, `decisions.rules` and
`node_ref`; the API field is on the organisation's detail and write serializers, manager-only to
set.
"""

from rest_framework.test import APITestCase

from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_user

from .models import Organization, OrganizationMember


def _found(owner, *, slug, open_board):
    organization = Organization.objects.create(
        name=slug.title(), slug=slug, kind='student_circle', created_by=owner, open_board=open_board
    )
    OrganizationMember.objects.create(organization=organization, user=owner, role='owner')
    return organization


class OpenBoardTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        for key in ('organizations', 'tasks', 'decisions'):
            FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': True})
        self.owner = make_user('owner')
        self.stranger = make_user('stranger')
        self.open = _found(self.owner, slug='open-circle', open_board=True)
        self.closed = _found(self.owner, slug='closed-circle', open_board=False)

    # ---- the field ------------------------------------------------------------------------------

    def test_the_field_is_read_by_anyone_and_set_by_a_manager_only(self):
        self.assertTrue(self.client.get(f'/api/organizations/{self.open.pk}/').json()['open_board'])
        self.assertFalse(self.client.get(f'/api/organizations/{self.closed.pk}/').json()['open_board'])
        self.client.force_authenticate(self.stranger)
        refused = self.client.patch(f'/api/organizations/{self.closed.pk}/', {'open_board': True}, format='json')
        self.assertEqual(refused.status_code, 403)
        self.closed.refresh_from_db()
        self.assertFalse(self.closed.open_board)
        self.client.force_authenticate(self.owner)
        ok = self.client.patch(f'/api/organizations/{self.closed.pk}/', {'open_board': True}, format='json')
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(ok.json()['open_board'])
        self.closed.refresh_from_db()
        self.assertTrue(self.closed.open_board)

    def test_the_node_ref_says_whether_the_board_is_open(self):
        self.assertTrue(self.client.get(f'/api/nodes/organization/{self.open.pk}/').json()['open_board'])
        self.assertFalse(self.client.get(f'/api/nodes/organization/{self.closed.pk}/').json()['open_board'])

    # ---- tasks ----------------------------------------------------------------------------------

    def _task(self, organization, title):
        from config import nodes
        from tasks.models import Task

        return Task.objects.create(
            content_type=nodes.node_content_type(organization), object_id=organization.pk,
            title=title, created_by=self.owner,
        )

    def test_tasks_on_an_open_board_are_read_by_anyone_and_written_by_the_roster_alone(self):
        shown = self._task(self.open, 'Visible to the street')
        hidden = self._task(self.closed, 'Inside the team')
        for who in (None, self.stranger):
            self.client.force_authenticate(who)
            listed = self.client.get(f'/api/nodes/organization/{self.open.pk}/tasks/')
            self.assertEqual(listed.status_code, 200)
            self.assertEqual([row['title'] for row in listed.json()], ['Visible to the street'])
            self.assertFalse(listed.json()[0]['can_edit'])
            self.assertEqual(self.client.get(f'/api/tasks/{shown.pk}/').status_code, 200)
            self.assertEqual(self.client.get(f'/api/nodes/organization/{self.closed.pk}/tasks/').status_code, 404)
            self.assertEqual(self.client.get(f'/api/tasks/{hidden.pk}/').status_code, 404)
        self.client.force_authenticate(self.stranger)
        created = self.client.post(
            f'/api/nodes/organization/{self.open.pk}/tasks/', {'title': 'Not mine to add'}, format='json'
        )
        self.assertIn(created.status_code, (403, 404))
        moved = self.client.post(f'/api/tasks/{shown.pk}/transition/', {'status': 'in_progress'}, format='json')
        self.assertIn(moved.status_code, (403, 404))
        shown.refresh_from_db()
        self.assertEqual(shown.status, 'todo')

    # ---- polls ----------------------------------------------------------------------------------

    def _poll(self, organization, question, status):
        from config import nodes
        from decisions.models import Poll, PollOption

        poll = Poll.objects.create(
            content_type=nodes.node_content_type(organization), object_id=organization.pk,
            question=question, status=status, eligibility='members', created_by=self.owner,
        )
        PollOption.objects.create(poll=poll, text='Yes', order=1)
        PollOption.objects.create(poll=poll, text='No', order=2)
        return poll

    def test_polls_on_an_open_board_are_read_by_anyone_but_drafts_votes_and_ballots_are_not(self):
        open_poll = self._poll(self.open, 'Shall we?', 'open')
        closed_poll = self._poll(self.open, 'Did we?', 'closed')
        draft = self._poll(self.open, 'Not yet asked', 'draft')
        private = self._poll(self.closed, 'Inside the room', 'open')
        for who in (None, self.stranger):
            self.client.force_authenticate(who)
            listed = self.client.get(f'/api/nodes/organization/{self.open.pk}/polls/')
            self.assertEqual(listed.status_code, 200)
            self.assertEqual({row['question'] for row in listed.json()}, {'Shall we?', 'Did we?'})
            row = next(r for r in listed.json() if r['id'] == open_poll.pk)
            self.assertFalse(row['can_vote'])
            self.assertTrue(row['can_see_results'])
            self.assertEqual(self.client.get(f'/api/polls/{draft.pk}/').status_code, 404)
            self.assertEqual(self.client.get(f'/api/nodes/organization/{self.closed.pk}/polls/').json(), [])
            self.assertEqual(self.client.get(f'/api/polls/{private.pk}/').status_code, 404)
            results = self.client.get(f'/api/polls/{open_poll.pk}/results/')
            self.assertEqual(results.status_code, 200)
            self.assertEqual([o['count'] for o in results.json()['options']], [0, 0])
            self.assertEqual(results.json()['ballots'], [])  # the tally, never who
        self.client.force_authenticate(self.stranger)
        option = open_poll.options.first().pk
        vote = self.client.post(f'/api/polls/{open_poll.pk}/vote/', {'options': [option]}, format='json')
        self.assertEqual(vote.status_code, 409)
        self.assertEqual(vote.json()['detail'], 'not_eligible')
        self.assertEqual(self.client.get(f'/api/polls/{closed_poll.pk}/').status_code, 200)
        # the owner's own reading: eligible, so the form is drawn
        self.client.force_authenticate(self.owner)
        row = next(r for r in self.client.get(f'/api/nodes/organization/{self.open.pk}/polls/').json() if r['id'] == open_poll.pk)
        self.assertTrue(row['can_vote'])
