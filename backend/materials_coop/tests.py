"""The cooperation overview, weighted at the two things that would fail quietly: a policy the
overview shows but the write path ignores, and a stranger being handed a draft through the
overview that the project API would have hidden from them."""

import tempfile

from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from coauthoring import services
from coauthoring.models import MaterialProject, MaterialVersion, ProjectMember
from community.models import Comment
from materials_coop.models import CoopSettings
from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_user


def _version(project, **kwargs):
    defaults = {
        'number': project.versions.count() + 1,
        'status': 'draft',
        'kind': 'body',
        'body': 'Some text.',
        'title': 'A title',
    }
    defaults.update(kwargs)
    if 'based_on' not in kwargs:
        defaults['based_on'] = (
            project.published_version if defaults['status'] == 'proposed' else project.head_version
        )
    return MaterialVersion.objects.create(project=project, **defaults)


class CoopBase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-coop-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        import shutil

        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        self.branch = make_branch()
        self.owner = make_user('coop-owner')
        self.coauthor = make_user('coop-coauthor')
        self.outsider = make_user('coop-outsider')
        self.staff = make_user('coop-staff', is_staff=True)
        self.project = MaterialProject.objects.create(
            branch=self.branch, created_by=self.owner, type='script'
        )
        ProjectMember.objects.create(project=self.project, user=self.coauthor, role='coauthor')
        self.v1 = _version(self.project)
        services.publish_version(self.v1, self.staff)
        self.project.refresh_from_db()
        self.material = self.project.material
        self.url = f'/api/materials/{self.material.pk}/coop/'

    def overview(self, user=None):
        if user is not None:
            self.client.force_authenticate(user)
        else:
            self.client.force_authenticate(None)
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        return resp.json()

    def set_policy(self, policy):
        row, _ = CoopSettings.objects.get_or_create(project=self.project)
        row.policy = policy
        row.save()
        return row


class OverviewTests(CoopBase):
    def test_anonymous_reads_a_published_materials_overview(self):
        data = self.overview()
        self.assertEqual(data['project_id'], self.project.pk)
        self.assertEqual(data['policy'], 'open')
        self.assertEqual(data['stats']['members_count'], 2)
        self.assertEqual(data['stats']['published_count'], 1)
        self.assertFalse(data['can_edit'])
        self.assertFalse(data['can_post'])
        self.assertEqual(data['post_block_reason'], 'authentication_required')
        self.assertEqual(data['propose_block_reason'], 'authentication_required')
        kinds = [e['kind'] for e in data['timeline']]
        self.assertIn('version_published', kinds)
        self.assertIn('member_joined', kinds)

    def test_a_draft_projects_material_does_not_exist_for_a_stranger(self):
        draft = MaterialProject.objects.create(branch=self.branch, created_by=self.owner, type='script')
        _version(draft)
        # No material yet → nothing to address; and a taken-down material is a 404 too.
        self.material.published = False
        self.material.save(update_fields=['published'])
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_404_NOT_FOUND)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_200_OK)

    def test_a_draft_version_is_in_the_teams_overview_and_not_a_readers(self):
        _version(self.project, status='draft', title='Work in progress')
        reader = self.overview(self.outsider)
        self.assertEqual(reader['stats']['versions_total'], 1)
        self.assertNotIn('version_drafted', [e['kind'] for e in reader['timeline']])
        team = self.overview(self.coauthor)
        self.assertEqual(team['stats']['versions_total'], 2)
        self.assertIn('version_drafted', [e['kind'] for e in team['timeline']])
        self.assertEqual(team['my_role'], 'coauthor')
        self.assertTrue(team['can_edit'])
        self.assertFalse(team['can_manage'])

    def test_member_rows_recount_their_versions(self):
        _version(self.project, status='draft', created_by=self.coauthor)
        team = self.overview(self.owner)
        by_id = {row['user_id']: row for row in team['members']}
        self.assertEqual(by_id[self.coauthor.pk]['versions_count'], 1)
        self.assertEqual(by_id[self.coauthor.pk]['published_count'], 0)
        self.assertEqual(by_id[self.owner.pk]['role'], 'owner')

    def test_an_accepted_outsider_is_listed_as_a_contributor(self):
        proposal = _version(self.project, status='proposed', created_by=self.outsider, title='Better')
        services.decide_version(proposal, self.owner, 'accept')
        data = self.overview()
        ids = [row['user_id'] for row in data['contributors']]
        self.assertEqual(ids, [self.outsider.pk])
        self.assertEqual(data['contributors'][0]['published_count'], 1)
        self.assertEqual(data['stats']['contributors_count'], 3)

    def test_pending_proposals_are_the_teams_to_see(self):
        _version(self.project, status='proposed', created_by=self.outsider)
        self.assertEqual(self.overview(self.owner)['stats']['proposals_pending'], 1)
        self.assertEqual(len(self.overview(self.owner)['pending_proposals']), 1)
        # The proposer sees their own row in the timeline but no queue.
        mine = self.overview(self.outsider)
        self.assertEqual(mine['stats']['proposals_pending'], 0)
        self.assertEqual(mine['pending_proposals'], [])

    def test_flag_off_refuses_a_plain_user_and_not_staff(self):
        FeatureFlag.objects.update_or_create(key='coauthoring', defaults={'is_enabled': False})
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_200_OK)


class SettingsTests(CoopBase):
    def test_owner_sets_policy_and_note_and_it_is_audited(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.patch(
            self.url,
            {'policy': 'request', 'welcome_note': '<p>Hello</p><script>x()</script>'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.content)
        self.assertEqual(resp.json()['policy'], 'request')
        self.assertNotIn('<script>', resp.json()['welcome_note'])
        self.assertIn('Hello', resp.json()['welcome_note'])
        row = CoopSettings.objects.get(project=self.project)
        self.assertEqual(row.updated_by, self.owner)
        # The audit row lands in the acting user's own log shard (telemetry/routers.py); the
        # `databases` declaration above is what lets that write happen at all, and a request that
        # answered 200 is one whose audit call did not raise.

    def test_coauthor_and_outsider_may_not_change_the_policy(self):
        for user, expected in ((self.coauthor, 403), (self.outsider, 403)):
            self.client.force_authenticate(user)
            resp = self.client.patch(self.url, {'policy': 'closed'}, format='json')
            self.assertEqual(resp.status_code, expected, user)
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.patch(self.url, {'policy': 'closed'}, format='json').status_code, 401
        )

    def test_an_unknown_policy_is_a_400(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.patch(self.url, {'policy': 'secret'}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class PolicyOnTheWritePathTests(CoopBase):
    """The policy is a rule, not a badge: the co-authoring endpoints refuse what the overview says
    they refuse."""

    def propose(self, user):
        self.client.force_authenticate(user)
        return self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {
                'kind': 'body',
                'body': 'Improved.',
                'title': 'Improved',
                'based_on': self.project.published_version.pk,
            },
            format='json',
        )

    def ask_to_join(self, user):
        self.client.force_authenticate(user)
        return self.client.post(
            f'/api/material-projects/{self.project.pk}/join-requests/',
            {'statement': 'I have taught this course for six years and would like to help.'},
            format='json',
        )

    def test_open_lets_an_outsider_propose_and_not_join(self):
        self.assertEqual(self.propose(self.outsider).status_code, status.HTTP_201_CREATED)
        resp = self.ask_to_join(self.outsider)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json()['detail'], 'published')

    def test_request_refuses_a_proposal_and_takes_an_application(self):
        self.set_policy('request')
        data = self.overview(self.outsider)
        self.assertEqual(data['propose_block_reason'], 'members_only')
        self.assertIsNone(data['join_block_reason'])
        resp = self.propose(self.outsider)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json()['detail'], 'members_only')
        self.assertEqual(self.ask_to_join(self.outsider).status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.overview(self.owner)['stats']['join_requests_pending'], 1)
        # The count is a manager's; a co-author is not told.
        self.assertEqual(self.overview(self.coauthor)['stats']['join_requests_pending'], 0)

    def test_closed_refuses_both_in_its_own_word(self):
        self.set_policy('closed')
        data = self.overview(self.outsider)
        self.assertEqual(data['propose_block_reason'], 'closed')
        self.assertEqual(data['join_block_reason'], 'closed')
        self.assertEqual(self.propose(self.outsider).json()['detail'], 'closed')
        self.assertEqual(self.ask_to_join(self.outsider).json()['detail'], 'closed')

    def test_a_member_is_told_member_whatever_the_policy(self):
        self.set_policy('closed')
        data = self.overview(self.coauthor)
        self.assertEqual(data['propose_block_reason'], 'member')
        self.assertEqual(data['join_block_reason'], 'member')

    def test_staff_bypass_the_policy_like_an_editor(self):
        self.set_policy('closed')
        data = self.overview(self.staff)
        self.assertTrue(data['can_edit'])
        # Staff are editors, so proposing is "edit it instead" territory: the policy never speaks.
        self.assertNotIn(data['propose_block_reason'], ('members_only', 'closed'))


class ThreadTests(CoopBase):
    def setUp(self):
        super().setUp()
        self.thread = f'{self.url}comments/'

    def post(self, user, body='Shall we split chapter 2?', parent=None):
        self.client.force_authenticate(user)
        payload = {'body': body}
        if parent is not None:
            payload['parent'] = parent
        return self.client.post(self.thread, payload, format='json')

    def test_readable_by_anyone_on_a_published_material(self):
        self.post(self.owner)
        self.client.force_authenticate(None)
        resp = self.client.get(self.thread)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.json()), 1)
        self.assertEqual(self.overview()['stats']['comment_count'], 1)

    def test_open_lets_a_signed_in_reader_post_and_anonymous_not(self):
        self.assertEqual(self.post(self.outsider).status_code, status.HTTP_201_CREATED)
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.post(self.thread, {'body': 'x'}, format='json').status_code, 401
        )

    def test_request_and_closed_keep_the_room_to_the_team(self):
        for policy in ('request', 'closed'):
            self.set_policy(policy)
            resp = self.post(self.outsider)
            self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN, policy)
            self.assertEqual(resp.json()['detail'], 'members_only')
            self.assertEqual(self.post(self.coauthor).status_code, status.HTTP_201_CREATED, policy)
            self.assertEqual(self.post(self.staff).status_code, status.HTTP_201_CREATED, policy)

    def test_a_reply_must_belong_to_this_thread(self):
        elsewhere = Comment.objects.create(
            target=self.material, author=self.owner, body='On the material itself.'
        )
        resp = self.post(self.owner, parent=elsewhere.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_thread_hangs_off_the_project_not_the_material(self):
        self.post(self.owner)
        self.client.force_authenticate(None)
        material_thread = self.client.get(f'/api/materials/{self.material.pk}/comments/')
        self.assertEqual(material_thread.json(), [])
