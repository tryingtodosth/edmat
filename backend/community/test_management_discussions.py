"""A task, a plan, a need or a poll as a discussion location (`community/discussions.py`,
"A task, a plan, a need or a poll is a location too", 2026-10-08).

Pinned here rather than in `test_discussions.py` because the rules that file pins are the standing
pages' and still hold unchanged; what is new is that a `page` may now name a ROW, and a row can be
private, can be gone, and answers to a second kill switch. Each of those is a sentence somebody will
be tempted to simplify later.

Two organisations: one with an open board (a stranger sees its tasks and polls, `config/nodes.py:
is_open_board`), one closed. The same four rows on each, so every "a stranger is told nothing"
test has a twin that says "and the roster is told everything".
"""

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.minors import hold_for_review
from community import discussions
from community.models import Comment, DiscussionLocation
from decisions.models import Poll
from moderation.models import FeatureFlag
from moderation.services import build_report_queue
from needs.models import Need
from needs.rules import can_view_need, public_needs
from organizations.models import Organization, OrganizationMember
from plans.models import Plan
from tasks.models import Task
from telemetry.routers import all_log_shards
from testing.factories import make_user


def _flag(key, enabled):
    FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': enabled})


class ManagementLocationBase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        for key in ('about_discussions', 'tasks', 'plans', 'needs', 'decisions'):
            _flag(key, True)
        self.owner = make_user('ml-owner')
        self.member = make_user('ml-member')
        self.stranger = make_user('ml-stranger')
        self.staff = make_user('ml-staff', is_staff=True)
        self.open_org = self._org('open-board', open_board=True)
        self.closed_org = self._org('closed-board', open_board=False)
        self.policies_url = reverse('discussion-policies')
        self.thread_url = reverse('discussion-thread')
        self.locations_url = reverse('discussion-location-list')

    def _org(self, slug, *, open_board):
        org = Organization.objects.create(
            name=slug, slug=slug, created_by=self.owner, open_board=open_board
        )
        OrganizationMember.objects.create(organization=org, user=self.owner, role='owner')
        OrganizationMember.objects.create(organization=org, user=self.member, role='member')
        ct = ContentType.objects.get_for_model(Organization)
        org.task = Task.objects.create(
            content_type=ct, object_id=org.pk, title=f'Task on {slug}', created_by=self.owner
        )
        org.plan = Plan.objects.create(
            content_type=ct, object_id=org.pk, title=f'Plan on {slug}', status='active',
            created_by=self.owner,
        )
        org.draft_plan = Plan.objects.create(
            content_type=ct, object_id=org.pk, title=f'Draft plan on {slug}', status='draft',
            created_by=self.owner,
        )
        org.need = Need.objects.create(
            content_type=ct, object_id=org.pk, title=f'Need on {slug}', created_by=self.owner
        )
        org.poll = Poll.objects.create(
            content_type=ct, object_id=org.pk, question=f'Poll on {slug}?', status='open',
            eligibility='members',
        )
        return org

    @staticmethod
    def key(kind, row):
        return f'{kind}/{row.pk}'

    def policy(self, page, user=None):
        self.client.force_authenticate(user)
        return self.client.get(self.policies_url, {'page': page})

    def thread(self, page, user=None):
        self.client.force_authenticate(user)
        return self.client.get(self.thread_url, {'page': page})

    def post(self, page, body='Hello', user=None, **extra):
        self.client.force_authenticate(user)
        return self.client.post(self.thread_url, {'page': page, 'body': body, **extra}, format='json')


class KeyShapeTests(APITestCase):
    def test_a_row_key_parses_to_the_page_alone(self):
        for key in ['tasks/17', 'plans/3', 'needs/2', 'polls/1', 'tasks/1234567890']:
            with self.subTest(key=key):
                self.assertEqual(discussions.parse_key(key), (key, ''))
                self.assertEqual(discussions.management_kind(key), key.split('/')[0])

    def test_a_row_has_no_sections(self):
        with self.assertRaises(ValueError) as caught:
            discussions.parse_key('tasks/17#progress')
        self.assertEqual(str(caught.exception), 'section')

    def test_malformed_row_keys_are_refused_as_pages(self):
        """A leading zero, a missing id, an unknown word, a singular, an eleventh digit — all
        `page`, none of them a database lookup."""
        for bad in ['tasks/0', 'tasks/', 'tasks/017', 'task/17', 'things/1', 'tasks/12345678901',
                    'tasks/17/', 'Tasks/17']:
            with self.subTest(key=bad):
                with self.assertRaises(ValueError) as caught:
                    discussions.parse_key(bad)
                self.assertEqual(str(caught.exception), 'page')

    def test_a_standing_page_is_not_a_management_page(self):
        self.assertIsNone(discussions.management_kind('about'))
        self.assertIsNone(discussions.management_kind('about/guide/courses'))


class VisibilityTests(ManagementLocationBase):
    """House rule 4 from the thread's side: the answer a stranger gets about a row's thread is the
    answer they get about the row."""

    def test_a_missing_row_is_404_on_every_read_and_on_the_write(self):
        for page in ['tasks/999999', 'plans/999999', 'needs/999999', 'polls/999999']:
            with self.subTest(page=page):
                self.assertEqual(self.policy(page).status_code, status.HTTP_404_NOT_FOUND)
                self.assertEqual(self.thread(page).status_code, status.HTTP_404_NOT_FOUND)
                self.assertEqual(
                    self.post(page, user=self.staff).status_code, status.HTTP_404_NOT_FOUND
                )
        self.assertEqual(DiscussionLocation.objects.count(), 0)

    def test_an_open_board_task_thread_is_readable_by_a_visitor(self):
        page = self.key('tasks', self.open_org.task)
        response = self.policy(page)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data['locations'][0]
        self.assertEqual(row['key'], page)
        self.assertEqual(row['section'], '')
        self.assertTrue(row['is_enabled'])
        self.assertEqual(row['comment_count'], 0)
        self.assertEqual(self.thread(page).status_code, status.HTTP_200_OK)

    def test_a_closed_board_task_is_404_to_a_stranger_and_open_to_the_roster(self):
        page = self.key('tasks', self.closed_org.task)
        self.assertEqual(self.policy(page).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.policy(page, self.stranger).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.thread(page, self.stranger).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.post(page, user=self.stranger).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.policy(page, self.member).status_code, status.HTTP_200_OK)
        self.assertEqual(self.thread(page, self.member).status_code, status.HTTP_200_OK)

    def test_a_draft_plan_is_404_to_a_stranger_and_an_active_one_is_not(self):
        self.assertEqual(
            self.policy(self.key('plans', self.open_org.draft_plan)).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.policy(self.key('plans', self.open_org.draft_plan), self.member).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.policy(self.key('plans', self.open_org.plan)).status_code, status.HTTP_200_OK
        )

    def test_a_need_follows_the_board_rule_and_the_two_rules_agree(self):
        need = self.open_org.need
        self.assertEqual(self.policy(self.key('needs', need)).status_code, status.HTTP_200_OK)
        need.status = 'fulfilled'
        need.save()
        self.assertEqual(
            self.policy(self.key('needs', need), self.stranger).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.policy(self.key('needs', need), self.member).status_code, status.HTTP_200_OK
        )
        # `can_view_need` is `public_needs` restated per row; this is the test that keeps them so.
        for user in (self.stranger, self.member, self.owner):
            for row in (self.open_org.need, self.closed_org.need):
                with self.subTest(user=user.username, need=row.title):
                    self.assertEqual(
                        can_view_need(user, row),
                        public_needs(user).filter(pk=row.pk).exists(),
                    )

    def test_a_poll_follows_the_poll_rule(self):
        """A members poll on an open board is readable by a visitor (that is what an open board
        means, `decisions.rules.visible_polls`); on a closed board only the roster sees it."""
        self.assertEqual(
            self.policy(self.key('polls', self.open_org.poll)).status_code, status.HTTP_200_OK
        )
        self.assertEqual(
            self.policy(self.key('polls', self.closed_org.poll), self.stranger).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.policy(self.key('polls', self.closed_org.poll), self.member).status_code,
            status.HTTP_200_OK,
        )

    def test_sections_are_refused_on_a_row(self):
        self.client.force_authenticate(None)
        response = self.client.get(
            self.policies_url, {'page': self.key('tasks', self.open_org.task), 'sections': 'x'}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'section')

    def test_reading_creates_no_row(self):
        page = self.key('tasks', self.open_org.task)
        self.policy(page)
        self.thread(page)
        self.client.get(self.policies_url, {'keys': page})
        self.assertEqual(DiscussionLocation.objects.count(), 0)


class WritingTests(ManagementLocationBase):
    def test_a_member_writes_under_a_task_and_the_row_appears(self):
        page = self.key('tasks', self.open_org.task)
        response = self.post(page, 'Is this still wanted?', user=self.member)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(response.data['is_held'])
        row = DiscussionLocation.objects.get()
        self.assertEqual((row.page, row.section), (page, ''))

        thread = self.thread(page)
        self.assertEqual(len(thread.data['comments']), 1)
        self.assertEqual(thread.data['comments'][0]['body'], 'Is this still wanted?')
        self.assertEqual(self.policy(page).data['locations'][0]['comment_count'], 1)

    def test_a_reply_must_belong_to_the_same_row(self):
        first = self.post(self.key('tasks', self.open_org.task), user=self.member).data
        response = self.post(
            self.key('plans', self.open_org.plan), user=self.member, parent=first['id']
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(DiscussionLocation.objects.count(), 1)

    def test_the_two_settings_apply_to_a_row(self):
        page = self.key('tasks', self.open_org.task)
        DiscussionLocation.objects.create(page=page, section='', audience='staff')
        refused = self.post(page, user=self.member)
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(refused.data['detail'], 'staff_only')

        DiscussionLocation.objects.filter(page=page).update(audience='users', moderated=True)
        held = self.post(page, 'Held', user=self.member)
        self.assertEqual(held.status_code, status.HTTP_201_CREATED)
        self.assertTrue(held.data['is_held'])
        self.assertEqual(len(self.thread(page, self.stranger).data['comments']), 0)
        self.assertEqual(len(self.thread(page, self.staff).data['comments']), 1)

    def test_an_anonymous_comment_on_an_anyone_row_is_held(self):
        page = self.key('tasks', self.open_org.task)
        DiscussionLocation.objects.create(page=page, section='', audience='anyone')
        response = self.post(page, 'From the street', anon_name='Visitor')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['is_held'])

    def test_a_held_comment_on_a_row_carries_its_key_in_the_report_queue(self):
        """`report_location_key` knows nothing new — the key is the row's page, and the moderation
        tab's "Held: 1" link filters the queue to it."""
        page = self.key('tasks', self.open_org.task)
        DiscussionLocation.objects.create(page=page, section='', audience='anyone')
        self.post(page, 'From the street')
        comment = Comment.objects.get()
        rows = [r for r in build_report_queue() if r['kind'] == 'comment' and r['object_id'] == comment.pk]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['discussion_location'], page)


class KillSwitchTests(ManagementLocationBase):
    def test_the_rows_own_flag_sits_above_its_thread(self):
        """House rule 3: a killed board must not keep a live thread under rows nobody can reach."""
        page = self.key('polls', self.open_org.poll)
        DiscussionLocation.objects.create(page=page, section='')
        self.post(page, 'Before', user=self.member)
        _flag('decisions', False)
        policy = self.policy(page, self.member).data['locations'][0]
        self.assertFalse(policy['is_enabled'])
        self.assertFalse(policy['can_post'])
        self.assertEqual(policy['post_block_reason'], 'off')
        thread = self.thread(page, self.member)
        self.assertEqual(thread.status_code, status.HTTP_200_OK)
        self.assertEqual(thread.data['comments'], [])
        self.assertEqual(self.post(page, user=self.member).status_code, status.HTTP_403_FORBIDDEN)

    def test_the_discussions_flag_still_governs_a_row(self):
        _flag('about_discussions', False)
        page = self.key('tasks', self.open_org.task)
        self.assertFalse(self.policy(page).data['locations'][0]['is_enabled'])

    def test_one_kinds_flag_does_not_touch_another(self):
        _flag('tasks', False)
        self.assertFalse(
            self.policy(self.key('tasks', self.open_org.task)).data['locations'][0]['is_enabled']
        )
        self.assertTrue(
            self.policy(self.key('plans', self.open_org.plan)).data['locations'][0]['is_enabled']
        )


class BatchReadTests(ManagementLocationBase):
    """`GET /api/discussions/?keys=…` — one request per panel."""

    def test_it_answers_one_entry_per_readable_key_in_the_order_asked(self):
        keys = [
            self.key('tasks', self.open_org.task),
            self.key('plans', self.open_org.plan),
            self.key('needs', self.open_org.need),
            self.key('polls', self.open_org.poll),
            'about#money-and-openness',
        ]
        self.post(keys[1], 'One on the plan', user=self.member)
        self.client.force_authenticate(None)
        response = self.client.get(self.policies_url, {'keys': ','.join(keys)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row['key'] for row in response.data['locations']], keys)
        counts = {row['key']: row['comment_count'] for row in response.data['locations']}
        self.assertEqual(counts[keys[1]], 1)
        self.assertEqual(counts[keys[0]], 0)

    def test_the_cost_does_not_grow_with_the_rows(self):
        """The N+1 this form exists to avoid, asserted as a property rather than a number: asking
        about three tasks costs exactly what asking about one does. (The first run of the suite
        pinned "12 queries" and failed under `--parallel` at 21 — a fresh worker pays one query
        per feature flag on a cold cache, nine of them here. So the cache is warmed first, and
        what is compared is two warm requests that differ only in how many rows they name.)"""
        ct = ContentType.objects.get_for_model(Organization)
        more = [
            Task.objects.create(
                content_type=ct, object_id=self.open_org.pk, title=f'More {n}', created_by=self.owner
            )
            for n in range(2)
        ]
        one = [self.key('tasks', self.open_org.task), self.key('plans', self.open_org.plan)]
        three = one + [self.key('tasks', row) for row in more]
        self.client.force_authenticate(None)
        self.client.get(self.policies_url, {'keys': ','.join(three)})  # warm the flag cache

        with self.settings(DEBUG=True):
            from django.db import connection, reset_queries

            reset_queries()
            self.client.get(self.policies_url, {'keys': ','.join(one)})
            cost_one = len(connection.queries)
            reset_queries()
            response = self.client.get(self.policies_url, {'keys': ','.join(three)})
            cost_three = len(connection.queries)
        self.assertEqual([row['key'] for row in response.data['locations']], three)
        self.assertEqual(cost_three, cost_one, f'{cost_one} queries for two keys, {cost_three} for four')

    def test_a_key_the_reader_may_not_open_is_simply_absent(self):
        keys = [self.key('tasks', self.open_org.task), self.key('tasks', self.closed_org.task),
                'tasks/999999']
        self.client.force_authenticate(self.stranger)
        response = self.client.get(self.policies_url, {'keys': ','.join(keys)})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row['key'] for row in response.data['locations']], keys[:1])

        self.client.force_authenticate(self.member)
        response = self.client.get(self.policies_url, {'keys': ','.join(keys)})
        self.assertEqual([row['key'] for row in response.data['locations']], keys[:2])

    def test_a_malformed_key_is_400_and_duplicates_collapse(self):
        page = self.key('tasks', self.open_org.task)
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(self.policies_url, {'keys': f'{page},things/1'}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        response = self.client.get(self.policies_url, {'keys': f'{page}, {page},,'})
        self.assertEqual([row['key'] for row in response.data['locations']], [page])

    def test_too_many_keys_is_refused_not_served(self):
        self.client.force_authenticate(None)
        keys = ','.join(f'tasks/{n}' for n in range(1, 202))
        response = self.client.get(self.policies_url, {'keys': keys})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'too_many_keys')


class ModeratorAddTests(ManagementLocationBase):
    """The one caller who types a page by hand: the moderation tab's add form."""

    def test_a_moderator_can_configure_a_rows_location_ahead_of_any_comment(self):
        self.client.force_authenticate(self.staff)
        page = self.key('needs', self.closed_org.need)
        response = self.client.post(
            self.locations_url, {'page': page, 'audience': 'verified'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['key'], page)
        self.assertEqual(response.data['section'], '')

    def test_a_row_that_does_not_exist_is_refused(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(self.locations_url, {'page': 'tasks/999999'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('page', response.data)

    def test_a_section_under_a_row_is_refused(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            self.locations_url,
            {'page': self.key('tasks', self.open_org.task), 'section': 'progress'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('section', response.data)

    def test_a_standing_page_still_works_as_before(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            self.locations_url, {'page': 'about/guide/courses', 'section': 'enrolling'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_a_held_comment_counts_on_the_rows_line(self):
        page = self.key('tasks', self.open_org.task)
        DiscussionLocation.objects.create(page=page, section='', audience='anyone')
        self.post(page, 'From the street')
        self.client.force_authenticate(self.staff)
        rows = {row['key']: row for row in self.client.get(self.locations_url).data}
        self.assertEqual(rows[page]['held_count'], 1)
        self.assertEqual(rows[page]['comment_count'], 0)
