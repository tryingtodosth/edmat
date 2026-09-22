"""The queue's `material_versions` section — what it shows, to whom, and what it deliberately is not.

Its own module rather than more of `moderation/tests.py`, following the
`test_governor_applications.py` precedent: this is one section of one payload, added by a different
feature, and keeping it separate means the largest suite in the project does not grow a co-authoring
chapter nobody looking for report handling wants to read.

The thing most worth pinning here is what is ABSENT. A proposal on a project that has a material and
a team never reaches this queue — its own co-authors decide it, which is the whole bet the feature
makes — so the two cases that DO arrive are the two where nobody else could: a project's first
publication, and a proposal on an orphan project with no members (every backfilled corpus material
with no `submitted_by` is one).
"""

from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from coauthoring import services
from coauthoring.models import MaterialProject, MaterialVersion, ProjectMember
from moderation.models import NodeGovernor
from moderation.services import build_moderation_queue_payload, count_pending_moderation
from moderation.views import _KIND_MODELS
from taxonomy.models import Branch
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_user, make_viewer


def _project_with_proposal(branch, author, *, title='A first publication'):
    """A project that has never published, with its first version waiting for a moderator."""
    project = MaterialProject.objects.create(branch=branch, created_by=author, type='script')
    version = MaterialVersion.objects.create(
        project=project,
        number=1,
        status='proposed',
        kind='body',
        body='Some text.',
        title=title,
        created_by=author,
    )
    return project, version


class MaterialVersionQueueTests(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch(slug='queue-branch')
        self.other_branch = make_branch(slug='queue-other-branch')
        self.staff = make_user('queue-staff', is_staff=True)
        self.author = make_viewer('queue-author')

    def test_a_first_publication_is_in_the_queue(self):
        _, version = _project_with_proposal(self.branch, self.author)
        payload = build_moderation_queue_payload(user=self.staff)
        rows = payload['material_versions']
        self.assertEqual([row['id'] for row in rows], [version.pk])
        row = rows[0]
        # The catalogue rides along because there is no `Material` to read it from yet — the
        # reviewer is deciding whether one exists.
        self.assertTrue(row['is_first_publication'])
        self.assertEqual(row['branch_id'], self.branch.slug)
        self.assertEqual(row['type'], 'script')
        self.assertEqual(row['body_excerpt'], 'Some text.')
        self.assertEqual(row['kind'], 'body')

    def test_a_proposal_a_team_can_decide_is_not_in_the_queue(self):
        """The whole open-science bet, stated as a test: a project with a material and members
        decides its own proposals and never bothers a moderator with them."""
        owner = make_user('queue-owner')
        project = MaterialProject.objects.create(
            branch=self.branch, created_by=owner, type='script'
        )
        first = MaterialVersion.objects.create(
            project=project, number=1, status='draft', kind='body', body='v1', title='v1'
        )
        services.publish_version(first, self.staff)
        project.refresh_from_db()
        MaterialVersion.objects.create(
            project=project,
            number=2,
            status='proposed',
            kind='body',
            body='v2',
            title='An improvement',
            created_by=self.author,
        )
        payload = build_moderation_queue_payload(user=self.staff)
        self.assertEqual(payload['material_versions'], [])

    def test_a_proposal_on_an_orphan_project_is_in_the_queue(self):
        owner = make_user('queue-orphan-owner')
        project = MaterialProject.objects.create(
            branch=self.branch, created_by=owner, type='script'
        )
        first = MaterialVersion.objects.create(
            project=project, number=1, status='draft', kind='body', body='v1', title='v1'
        )
        services.publish_version(first, self.staff)
        # Nobody looks after it any more — the state every backfilled corpus material starts in.
        ProjectMember.objects.filter(project=project).delete()
        proposal = MaterialVersion.objects.create(
            project=project,
            number=2,
            status='proposed',
            kind='body',
            body='v2',
            title='An improvement',
            created_by=self.author,
        )
        payload = build_moderation_queue_payload(user=self.staff)
        self.assertEqual([row['id'] for row in payload['material_versions']], [proposal.pk])
        self.assertFalse(payload['material_versions'][0]['is_first_publication'])

    def test_a_governor_sees_only_their_own_branches_and_staff_see_everything(self):
        mine, mine_version = _project_with_proposal(self.branch, self.author, title='Mine')
        _project_with_proposal(self.other_branch, self.author, title='Somebody else\'s')

        governor = make_viewer('queue-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.branch.pk,
        )
        scoped = build_moderation_queue_payload(user=governor)
        self.assertEqual([row['id'] for row in scoped['material_versions']], [mine_version.pk])

        unscoped = build_moderation_queue_payload(user=self.staff)
        self.assertEqual(len(unscoped['material_versions']), 2)
        self.assertEqual(mine.branch_id, self.branch.pk)

    def test_a_governor_with_no_grants_sees_nothing(self):
        """`governed_branch_ids` returns an EMPTY SET for a zero-grant governor and `None` for
        staff — collapsing the two would make this person see the whole queue."""
        _project_with_proposal(self.branch, self.author)
        nobody = make_viewer('queue-zero-governor')
        payload = build_moderation_queue_payload(user=nobody)
        self.assertEqual(payload['material_versions'], [])

    def test_the_count_matches_the_section(self):
        _project_with_proposal(self.branch, self.author)
        _project_with_proposal(self.other_branch, self.author, title='Another')
        payload = build_moderation_queue_payload(user=self.staff)
        counts = count_pending_moderation(user=self.staff)
        self.assertEqual(counts['material_versions'], len(payload['material_versions']))
        self.assertEqual(counts['material_versions'], 2)
        # A number that disagreed with the page it links to would be worse than no number.
        self.assertIn('material_versions', counts)
        self.assertEqual(counts['total'], sum(v for k, v in counts.items() if k != 'total'))

    def test_the_queue_does_not_gain_a_moderation_kind(self):
        """Decisions go through `/api/material-versions/{id}/decide/`, never a new `_KIND_MODELS`
        entry — the solution-entry precedent (`moderation/CLAUDE.md`): one claim, one notification
        sequence, one deciding circle to keep correct rather than two that can drift."""
        self.assertNotIn('material_version', _KIND_MODELS)
        self.assertNotIn('version', _KIND_MODELS)


class MaterialVersionQueueEndpointTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch(slug='queue-api-branch')
        self.staff = make_user('queue-api-staff', is_staff=True)
        self.author = make_user('queue-api-author')

    def test_staff_read_the_section_and_decide_through_the_app_endpoint(self):
        project, version = _project_with_proposal(self.branch, self.author)
        self.client.force_authenticate(self.staff)
        queue = self.client.get('/api/moderation/queue/')
        self.assertEqual(queue.status_code, status.HTTP_200_OK)
        self.assertEqual([row['id'] for row in queue.json()['material_versions']], [version.pk])

        decided = self.client.post(
            f'/api/material-versions/{version.pk}/decide/',
            {'decision': 'accept'},
            format='json',
        )
        self.assertEqual(decided.status_code, status.HTTP_200_OK)
        self.assertEqual(decided.json()['status'], 'published')
        project.refresh_from_db()
        self.assertIsNotNone(project.material_id)

        # …and the queue is empty afterwards, from the same one code path.
        self.assertEqual(self.client.get('/api/moderation/queue/').json()['material_versions'], [])
