"""Co-authoring, weighted at the refusals and the races.

The happy path is one test. The rest of this file is the things that fail quietly if they are wrong:
a stranger reaching a draft, two people saving at once, two people deciding at once, a second
`published` row, the projection drifting from the material it is supposed to BE, the feed getting a
row for something that was not public, a notification arriving for somebody who muted it, and every
one of the five refusals an invite can carry.

`make_viewer` for anybody who only needs to exist as an FK target; `make_user` only for accounts
something actually logs in as (testing/factories.py — the change that cut a suite from 52s to 12s).
"""

import tempfile
from datetime import timedelta

from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from activity.models import ActivityEvent
from coauthoring.models import (
    MaterialProject,
    MaterialVersion,
    ProjectInvite,
    ProjectJoinRequest,
    ProjectMember,
)
from coauthoring import services
from materials.models import Material, MaterialTranslation
from moderation.models import FeatureFlag, NodeGovernor
from notifications.models import Notification
from taxonomy.models import Branch, Topic
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_user, make_viewer, pdf_bytes


def _version(project, **kwargs):
    """A version row straight into the database — for setting up a state the API would take three
    requests to reach. Never used to test the write path itself.

    `based_on` defaults to what `services.save_version` would have recorded — the head for a draft,
    the published version for a proposal — so a row built here publishes, or is refused as stale,
    exactly as one saved through the API would be. Pass `based_on=` to build a deliberately odd one.
    """
    defaults = {
        'number': (project.versions.count() + 1),
        'status': 'draft',
        'kind': 'body',
        'body': 'Some text.',
        'title': 'A title',
    }
    defaults.update(kwargs)
    if 'based_on' not in kwargs:
        if defaults['status'] == 'proposed':
            defaults['based_on'] = project.published_version
        else:
            defaults['based_on'] = project.head_version
    return MaterialVersion.objects.create(project=project, **defaults)


class CoauthoringBase(APITestCase):
    """A branch, an owner, and a project with one draft version.

    `databases` covers the audit shards: every publish, decision and team change here writes an
    `AuditEvent`, which lives in its own SQLite file, and a view test that does not declare them
    fails on Django's cross-database guard rather than on anything under test (the note
    `courses/tests.py` already carries for the same reason).
    """

    databases = set(all_log_shards()) | {'default'}

    @classmethod
    def setUpClass(cls):
        # Every file this suite writes lands in a temporary MEDIA_ROOT, the discipline
        # galleries/tests.py records after its first version left 85 stray files behind.
        cls._media_root = tempfile.mkdtemp(prefix='edmat-coauth-test-')
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
        self.owner = make_user('proj-owner')
        self.outsider = make_user('proj-outsider')
        self.staff = make_user('proj-staff', is_staff=True)
        self.project = MaterialProject.objects.create(
            branch=self.branch, created_by=self.owner, type='script'
        )
        self.draft = _version(self.project)

    # --- helpers --------------------------------------------------------------------------------

    def publish_first(self, project=None, version=None, actor=None):
        """Get a project past its first publication, so it has a real `Material` behind it."""
        project = project or self.project
        version = version or project.versions.order_by('number').last()
        actor = actor or self.staff
        return services.publish_version(version, actor)


class ProjectVisibilityTests(CoauthoringBase):
    def test_stranger_gets_404_on_a_draft_project_and_its_versions(self):
        """A draft does not exist for somebody who is not on it — house rule 4's honest answer."""
        self.client.force_authenticate(self.outsider)
        detail = self.client.get(f'/api/material-projects/{self.project.pk}/')
        self.assertEqual(detail.status_code, status.HTTP_404_NOT_FOUND)
        versions = self.client.get(f'/api/material-projects/{self.project.pk}/versions/')
        self.assertEqual(versions.status_code, status.HTTP_404_NOT_FOUND)
        one = self.client.get(f'/api/material-versions/{self.draft.pk}/')
        self.assertEqual(one.status_code, status.HTTP_404_NOT_FOUND)

    def test_anonymous_gets_404_on_a_draft_project(self):
        resp = self.client.get(f'/api/material-projects/{self.project.pk}/')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_seeking_draft_is_a_teaser_for_a_stranger(self):
        self.project.seeking_coauthors = True
        self.project.seeking_note = 'Looking for somebody who knows measure theory.'
        self.project.save()
        self.client.force_authenticate(self.outsider)
        resp = self.client.get(f'/api/material-projects/{self.project.pk}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        body = resp.json()
        # The pitch and the title are the point of a teaser; the versions are not.
        self.assertTrue(body['seeking_coauthors'])
        self.assertEqual(body['title'], 'A title')
        self.assertIsNone(body['head_version'])
        self.assertIsNone(body['published_version'])
        self.assertIsNone(body['my_role'])
        self.assertFalse(body['can_edit'])
        self.assertFalse(body['can_manage'])
        self.assertEqual(body['pending_proposals_count'], 0)
        self.assertEqual(body['pending_join_requests_count'], 0)

    def test_owner_sees_the_whole_project(self):
        self.client.force_authenticate(self.owner)
        body = self.client.get(f'/api/material-projects/{self.project.pk}/').json()
        self.assertEqual(body['my_role'], 'owner')
        self.assertTrue(body['can_edit'])
        self.assertTrue(body['can_manage'])
        self.assertEqual(body['head_version']['number'], 1)
        self.assertEqual(body['member_count'], 1)

    def test_visible_projects_agrees_with_can_view(self):
        """The two halves of house rule 4, pinned against each other rather than against a comment.

        A filter and an object check that disagree is exactly the bug the rule exists to stop, and
        it is invisible until somebody guesses an id.
        """
        from coauthoring.access import can_view, visible_projects

        seeking = MaterialProject.objects.create(
            branch=self.branch, created_by=self.owner, seeking_coauthors=True
        )
        published_project, _ = self._published_project()
        for user in (None, self.outsider, self.owner, self.staff):
            visible = set(visible_projects(user).values_list('pk', flat=True))
            for project in (self.project, seeking, published_project):
                self.assertEqual(
                    project.pk in visible,
                    can_view(project, user),
                    f'{project.pk} for {user}',
                )

    def _published_project(self):
        project = MaterialProject.objects.create(
            branch=self.branch, created_by=self.owner, type='script'
        )
        version = _version(project, title='Published thing')
        services.publish_version(version, self.staff)
        project.refresh_from_db()
        return project, version


class VersionSaveTests(CoauthoringBase):
    def test_member_save_is_a_draft_and_an_outsider_save_is_a_proposal(self):
        self.publish_first()
        self.project.refresh_from_db()
        published = self.project.published_version

        self.client.force_authenticate(self.owner)
        mine = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {'kind': 'body', 'title': 'Mine', 'body': 'x', 'based_on': published.pk},
            format='json',
        )
        self.assertEqual(mine.status_code, status.HTTP_201_CREATED)
        self.assertEqual(mine.json()['status'], 'draft')

        self.client.force_authenticate(self.outsider)
        theirs = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {'kind': 'body', 'title': 'Theirs', 'body': 'y', 'based_on': published.pk},
            format='json',
        )
        self.assertEqual(theirs.status_code, status.HTTP_201_CREATED)
        self.assertEqual(theirs.json()['status'], 'proposed')

    def test_a_stale_save_is_409_and_carries_the_head(self):
        self.publish_first()
        self.project.refresh_from_db()
        published = self.project.published_version
        newer = _version(self.project, title='Landed first', number=published.number + 1)

        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {'kind': 'body', 'title': 'Mine', 'body': 'x', 'based_on': published.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.json()['detail'], 'stale')
        self.assertEqual(resp.json()['head']['id'], newer.pk)
        self.assertEqual(resp.json()['head']['title'], 'Landed first')

    def test_a_proposal_must_be_based_on_the_published_version(self):
        self.publish_first()
        self.project.refresh_from_db()
        published = self.project.published_version
        _version(self.project, title='A draft nobody else can see', number=published.number + 1)

        self.client.force_authenticate(self.outsider)
        ok = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {'kind': 'body', 'title': 'Improved', 'body': 'x', 'based_on': published.pk},
            format='json',
        )
        # A proposer cannot see the draft, so the published row is the only basis they could have
        # had — and it is accepted even though it is not the project's own head.
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED)

    def test_second_open_proposal_from_the_same_person_is_refused_with_its_reason(self):
        self.publish_first()
        self.project.refresh_from_db()
        published = self.project.published_version
        self.client.force_authenticate(self.outsider)
        payload = {'kind': 'body', 'title': 'A', 'body': 'x', 'based_on': published.pk}
        self.client.post(f'/api/material-projects/{self.project.pk}/versions/', payload, format='json')
        again = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/', payload, format='json'
        )
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(again.json()['detail'], 'pending_exists')

    def test_a_version_needs_exactly_one_payload(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {'kind': 'link', 'title': 'No link here', 'based_on': self.draft.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('url', resp.json())


class PublishTests(CoauthoringBase):
    def test_the_projection_equals_the_material(self):
        """`sync_material` is the whole reason nothing else in the codebase had to change."""
        self.publish_first()
        self.project.refresh_from_db()
        material = self.project.material
        self.assertIsNotNone(material)
        self.assertEqual(material.body, 'Some text.')
        self.assertEqual(material.url, '')
        self.assertFalse(material.file)

        published = self.project.published_version
        second = _version(
            self.project,
            number=published.number + 1,
            kind='link',
            body='',
            url='https://example.org/notes.pdf',
            title='Now a link',
            description='It moved.',
        )
        services.publish_version(second, self.owner)
        material.refresh_from_db()
        self.assertEqual(material.url, 'https://example.org/notes.pdf')
        # The other two shapes are cleared, so a material that used to be a text does not keep
        # offering it beside the new link.
        self.assertEqual(material.body, '')
        translation = MaterialTranslation.objects.get(material=material, locale='pl')
        self.assertEqual(translation.title, 'Now a link')
        self.assertEqual(translation.description, 'It moved.')

    def test_publishing_supersedes_the_previous_version(self):
        self.publish_first()
        self.project.refresh_from_db()
        first = self.project.published_version
        second = _version(self.project, number=first.number + 1, title='Second')
        services.publish_version(second, self.owner)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.status, 'superseded')
        self.assertEqual(second.status, 'published')
        self.assertIsNotNone(second.published_at)

    def test_only_one_published_version_per_project(self):
        """The partial unique index, not a convention somebody has to remember."""
        self.publish_first()
        self.project.refresh_from_db()
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                _version(
                    self.project,
                    number=99,
                    status='published',
                    title='A second published row',
                )

    def test_a_first_publication_from_an_ordinary_account_goes_to_the_queue(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(f'/api/material-versions/{self.draft.pk}/publish/', {}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # The same button, two outcomes — the caller reads `status` rather than assuming.
        self.assertEqual(resp.json()['status'], 'proposed')
        self.project.refresh_from_db()
        self.assertIsNone(self.project.material_id)

    def test_a_verified_contributor_publishes_their_first_version_immediately(self):
        verified = make_user('proj-verified', is_verified_contributor=True)
        project = MaterialProject.objects.create(
            branch=self.branch, created_by=verified, type='script'
        )
        draft = _version(project, title='Straight through')
        self.client.force_authenticate(verified)
        resp = self.client.post(f'/api/material-versions/{draft.pk}/publish/', {}, format='json')
        self.assertEqual(resp.json()['status'], 'published')
        project.refresh_from_db()
        self.assertIsNotNone(project.material_id)
        self.assertEqual(project.material.submitted_by_id, verified.pk)

    def test_republishing_a_draft_older_than_the_published_row_is_refused(self):
        """Publishing a draft numbered below the published row is a revert, not a publication —
        and reverting that way would leave the history claiming the old text was written later
        than it was. Saving a new version from the old one is the honest way to go back."""
        self.publish_first()
        self.project.refresh_from_db()
        older_draft = _version(self.project, number=2, title='Older draft')
        newer_draft = _version(self.project, number=3, title='Newer draft')
        services.publish_version(newer_draft, self.owner)
        with self.assertRaises(services.Stale):
            services.publish_version(older_draft, self.owner)

    def test_publish_is_not_available_to_a_stranger(self):
        self.project.seeking_coauthors = True
        self.project.save()
        self.client.force_authenticate(self.outsider)
        resp = self.client.post(f'/api/material-versions/{self.draft.pk}/publish/', {}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


class DecisionTests(CoauthoringBase):
    def setUp(self):
        super().setUp()
        self.publish_first()
        self.project.refresh_from_db()
        self.proposer = make_user('proj-proposer')
        self.proposal = _version(
            self.project,
            number=self.project.published_version.number + 1,
            status='proposed',
            title='An improvement',
            created_by=self.proposer,
            based_on=self.project.published_version,
        )

    def test_a_member_decides_and_the_version_publishes(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            f'/api/material-versions/{self.proposal.pk}/decide/',
            {'decision': 'accept', 'note': ''},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.json()['status'], 'published')
        self.project.refresh_from_db()
        self.assertEqual(self.project.material.body, 'Some text.')

    def test_a_double_decision_is_409(self):
        self.client.force_authenticate(self.owner)
        first = self.client.post(
            f'/api/material-versions/{self.proposal.pk}/decide/',
            {'decision': 'reject', 'note': 'Not this one.'},
            format='json',
        )
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        second = self.client.post(
            f'/api/material-versions/{self.proposal.pk}/decide/',
            {'decision': 'accept'},
            format='json',
        )
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.json()['detail'], 'already_decided')

    def test_a_rejection_needs_a_note(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            f'/api/material-versions/{self.proposal.pk}/decide/',
            {'decision': 'reject', 'note': '  '},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json()['detail'], 'note_required')
        self.proposal.refresh_from_db()
        self.assertEqual(self.proposal.status, 'proposed')

    def test_the_deciding_circle(self):
        """Who may decide a proposal, per state — the answer this app is most likely to get wrong.

        On a project WITH a material and members: any member, staff, or the material's governor.
        Not a stranger, and not the branch governor by way of a shortcut — the branch governor
        qualifies here only because `is_governor_of_material` cascades up to the branch, which is
        the documented behaviour rather than an accident.
        """
        from coauthoring.access import can_decide

        member = make_viewer('proj-member')
        ProjectMember.objects.create(project=self.project, user=member, role='coauthor')
        branch_governor = make_viewer('proj-branch-gov')
        NodeGovernor.objects.create(
            user=branch_governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.branch.pk,
        )
        material_governor = make_viewer('proj-material-gov')
        NodeGovernor.objects.create(
            user=material_governor,
            content_type=ContentType.objects.get_for_model(Material),
            object_id=self.project.material_id,
        )
        self.project.refresh_from_db()
        self.proposal.refresh_from_db()
        self.assertTrue(can_decide(self.proposal, self.owner))
        self.assertTrue(can_decide(self.proposal, member))
        self.assertTrue(can_decide(self.proposal, self.staff))
        self.assertTrue(can_decide(self.proposal, material_governor))
        self.assertTrue(can_decide(self.proposal, branch_governor))
        self.assertFalse(can_decide(self.proposal, self.outsider))
        self.assertFalse(can_decide(self.proposal, None))

    def test_a_first_publication_is_decided_by_staff_and_not_by_the_owner(self):
        """The other circle: nobody has vouched for this project, so its own team does not decide."""
        from coauthoring.access import can_decide, needs_staff_review

        project = MaterialProject.objects.create(
            branch=self.branch, created_by=self.owner, type='script'
        )
        first = _version(project, status='proposed', created_by=self.owner)
        self.assertTrue(needs_staff_review(project))
        self.assertFalse(can_decide(first, self.owner))
        self.assertTrue(can_decide(first, self.staff))

        self.client.force_authenticate(self.owner)
        refused = self.client.post(
            f'/api/material-versions/{first.pk}/decide/', {'decision': 'accept'}, format='json'
        )
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_orphan_project_is_decided_by_staff(self):
        """Every backfilled corpus material with no submitter is one of these."""
        from coauthoring.access import needs_staff_review

        self.project.members.all().delete()
        self.project.refresh_from_db()
        self.assertTrue(needs_staff_review(self.project))

    def test_a_stranger_cannot_decide(self):
        self.client.force_authenticate(self.outsider)
        resp = self.client.post(
            f'/api/material-versions/{self.proposal.pk}/decide/',
            {'decision': 'accept'},
            format='json',
        )
        # Not 403: an outsider cannot see somebody else's proposal at all.
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_proposer_withdraws_and_only_the_proposer_can(self):
        self.client.force_authenticate(self.outsider)
        theirs = self.client.post(
            f'/api/material-versions/{self.proposal.pk}/withdraw/', {}, format='json'
        )
        self.assertEqual(theirs.status_code, status.HTTP_404_NOT_FOUND)

        self.client.force_authenticate(self.proposer)
        mine = self.client.post(
            f'/api/material-versions/{self.proposal.pk}/withdraw/', {}, format='json'
        )
        self.assertEqual(mine.status_code, status.HTTP_200_OK)
        self.assertEqual(mine.json()['status'], 'withdrawn')
        again = self.client.post(
            f'/api/material-versions/{self.proposal.pk}/withdraw/', {}, format='json'
        )
        self.assertEqual(again.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(again.json()['detail'], 'not_proposed')

    def test_a_rejected_proposal_keeps_its_row_and_its_reason(self):
        self.client.force_authenticate(self.owner)
        self.client.post(
            f'/api/material-versions/{self.proposal.pk}/decide/',
            {'decision': 'reject', 'note': 'The scan is unreadable.'},
            format='json',
        )
        self.proposal.refresh_from_db()
        self.assertEqual(self.proposal.status, 'rejected')
        self.assertEqual(self.proposal.decision_note, 'The scan is unreadable.')
        # The proposer keeps being able to read why (house rule 6 applied to a row).
        self.client.force_authenticate(self.proposer)
        resp = self.client.get(f'/api/material-versions/{self.proposal.pk}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.json()['decision_note'], 'The scan is unreadable.')


class FileTests(CoauthoringBase):
    def _upload(self, size=2048, name='paper.pdf'):
        return SimpleUploadedFile(name, pdf_bytes(size), content_type='application/pdf')

    def test_a_file_version_records_its_scan_and_size(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {
                'kind': 'file',
                'title': 'A scan',
                'based_on': str(self.draft.pk),
                'file': self._upload(),
            },
            format='multipart',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        body = resp.json()
        # No ClamAV daemon in this environment, so `skipped` — never "clean" (house rule 10).
        self.assertEqual(body['scan_status'], 'skipped')
        self.assertEqual(body['file_size'], 2048)
        self.assertTrue(body['file_url'])

    def test_the_quota_counts_version_files(self):
        profile = self.owner.profile
        profile.material_upload_quota_bytes = 3000
        profile.save(update_fields=['material_upload_quota_bytes'])
        self.client.force_authenticate(self.owner)

        first = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {'kind': 'file', 'title': 'One', 'based_on': str(self.draft.pk), 'file': self._upload(2000)},
            format='multipart',
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.owner.profile.material_upload_bytes, 2000)

        head = MaterialVersion.objects.filter(project=self.project).order_by('-number').first()
        second = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {'kind': 'file', 'title': 'Two', 'based_on': str(head.pk), 'file': self._upload(2000)},
            format='multipart',
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        # The refusal names the three numbers somebody can act on.
        self.assertIn('storage allowance', second.json()['file'][0])

    def test_a_rejected_file_version_keeps_its_row_and_loses_its_bytes(self):
        self.publish_first()
        self.project.refresh_from_db()
        published = self.project.published_version
        proposer = make_user('proj-file-proposer')
        self.client.force_authenticate(proposer)
        created = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {
                'kind': 'file',
                'title': 'A proposal with a file',
                'based_on': str(published.pk),
                'file': self._upload(1500),
            },
            format='multipart',
        )
        version_id = created.json()['id']

        self.client.force_authenticate(self.owner)
        self.client.post(
            f'/api/material-versions/{version_id}/decide/',
            {'decision': 'reject', 'note': 'Already covered by version 1.'},
            format='json',
        )
        version = MaterialVersion.objects.get(pk=version_id)
        self.assertEqual(version.status, 'rejected')
        self.assertFalse(version.file)
        self.assertIsNotNone(version.file_reclaimed_at)
        # The record survives — who proposed what, when, and why it was refused.
        self.assertEqual(version.file_size, 1500)
        self.assertEqual(version.decision_note, 'Already covered by version 1.')

    def test_a_published_versions_file_is_never_reclaimed(self):
        self.publish_first()
        self.project.refresh_from_db()
        published = self.project.published_version
        services.reclaim_version_file(published)
        published.refresh_from_db()
        self.assertIsNone(published.file_reclaimed_at)


class TeamTests(CoauthoringBase):
    def test_adding_removing_and_leaving(self):
        friend = make_user('proj-friend')
        self.client.force_authenticate(self.owner)
        added = self.client.post(
            f'/api/material-projects/{self.project.pk}/members/',
            {'user_id': friend.pk},
            format='json',
        )
        self.assertEqual(added.status_code, status.HTTP_201_CREATED)
        self.assertEqual(added.json()['role'], 'coauthor')

        again = self.client.post(
            f'/api/material-projects/{self.project.pk}/members/',
            {'user_id': friend.pk},
            format='json',
        )
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(again.json()['detail'], 'already_member')

        # Leaving is the same endpoint as being removed — to the row they are the same act.
        self.client.force_authenticate(friend)
        left = self.client.delete(
            f'/api/material-projects/{self.project.pk}/members/{friend.pk}/'
        )
        self.assertEqual(left.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(self.project.members.filter(user=friend).exists())

    def test_the_owner_cannot_be_removed(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.delete(
            f'/api/material-projects/{self.project.pk}/members/{self.owner.pk}/'
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json()['detail'], 'owner_immutable')

    def test_a_minor_cannot_be_added(self):
        child = make_user('proj-child')
        child.profile.is_minor = True
        child.profile.save(update_fields=['is_minor'])
        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            f'/api/material-projects/{self.project.pk}/members/',
            {'user_id': child.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json()['detail'], 'minor')

    def test_a_minor_cannot_create_a_project_but_can_propose(self):
        child = make_user('proj-child-2')
        child.profile.is_minor = True
        child.profile.save(update_fields=['is_minor'])
        self.client.force_authenticate(child)
        refused = self.client.post(
            '/api/material-projects/',
            {
                'branch': self.branch.slug,
                'locale': 'pl',
                'type': 'script',
                'kind': 'body',
                'title': 'Mine',
                'body': 'Text',
            },
            format='json',
        )
        self.assertEqual(refused.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(refused.json()['detail'], 'minor')

        self.publish_first()
        self.project.refresh_from_db()
        allowed = self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {
                'kind': 'body',
                'title': 'An improvement',
                'body': 'Better',
                'based_on': self.project.published_version.pk,
            },
            format='json',
        )
        # A person reads every proposal, which is why this one is allowed.
        self.assertEqual(allowed.status_code, status.HTTP_201_CREATED)
        self.assertEqual(allowed.json()['status'], 'proposed')

    def test_transfer_demotes_then_promotes(self):
        friend = make_user('proj-heir')
        ProjectMember.objects.create(project=self.project, user=friend, role='coauthor')
        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            f'/api/material-projects/{self.project.pk}/transfer/',
            {'user_id': friend.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.project.members.get(user=friend).role, 'owner'
        )
        self.assertEqual(self.project.members.get(user=self.owner).role, 'coauthor')

    def test_a_coauthor_cannot_transfer(self):
        friend = make_user('proj-coauthor')
        ProjectMember.objects.create(project=self.project, user=friend, role='coauthor')
        self.client.force_authenticate(friend)
        resp = self.client.post(
            f'/api/material-projects/{self.project.pk}/transfer/',
            {'user_id': friend.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class InviteTests(CoauthoringBase):
    def _invite(self, **kwargs):
        return ProjectInvite.objects.create(
            project=self.project,
            token=ProjectInvite.new_token(),
            created_by=self.owner,
            **kwargs,
        )

    def test_preview_is_readable_logged_out_and_accept_needs_an_account(self):
        invite = self._invite()
        preview = self.client.get(f'/api/project-invites/{invite.token}/')
        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertEqual(preview.json()['project_id'], self.project.pk)
        self.assertEqual(preview.json()['title'], 'A title')
        self.assertTrue(preview.json()['is_usable'])

        anonymous = self.client.post(f'/api/project-invites/{invite.token}/accept/', {}, format='json')
        self.assertIn(
            anonymous.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_an_unknown_token_is_404(self):
        self.assertEqual(
            self.client.get('/api/project-invites/nothing-here/').status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_accepting_makes_a_coauthor(self):
        invite = self._invite()
        self.client.force_authenticate(self.outsider)
        resp = self.client.post(f'/api/project-invites/{invite.token}/accept/', {}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.json()['my_role'], 'coauthor')
        invite.refresh_from_db()
        self.assertEqual(invite.uses, 1)

    def test_the_five_refusals(self):
        revoked = self._invite(revoked_at=timezone.now())
        expired = self._invite(expires_at=timezone.now() - timedelta(days=1))
        used_up = self._invite(max_uses=1, uses=1)

        self.client.force_authenticate(self.outsider)
        for invite, reason in ((revoked, 'revoked'), (expired, 'expired'), (used_up, 'used_up')):
            resp = self.client.post(
                f'/api/project-invites/{invite.token}/accept/', {}, format='json'
            )
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertEqual(resp.json()['detail'], reason)

        child = make_user('proj-invited-child')
        child.profile.is_minor = True
        child.profile.save(update_fields=['is_minor'])
        live = self._invite()
        self.client.force_authenticate(child)
        minor = self.client.post(f'/api/project-invites/{live.token}/accept/', {}, format='json')
        self.assertEqual(minor.json()['detail'], 'minor')

        self.client.force_authenticate(self.owner)
        already = self.client.post(f'/api/project-invites/{live.token}/accept/', {}, format='json')
        self.assertEqual(already.json()['detail'], 'already_member')

    def test_the_last_use_goes_to_exactly_one_person(self):
        """`used_up` is claimed with one conditional UPDATE, not under a lock (SQLite rule 1)."""
        invite = self._invite(max_uses=1)
        second = make_user('proj-second')
        self.client.force_authenticate(self.outsider)
        first = self.client.post(f'/api/project-invites/{invite.token}/accept/', {}, format='json')
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.client.force_authenticate(second)
        loser = self.client.post(f'/api/project-invites/{invite.token}/accept/', {}, format='json')
        self.assertEqual(loser.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(loser.json()['detail'], 'used_up')
        self.assertEqual(self.project.members.count(), 2)

    def test_revoking_keeps_the_row(self):
        invite = self._invite()
        self.client.force_authenticate(self.owner)
        resp = self.client.delete(
            f'/api/material-projects/{self.project.pk}/invites/{invite.pk}/'
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        invite.refresh_from_db()
        self.assertIsNotNone(invite.revoked_at)
        self.assertEqual(invite.unusable_reason(), 'revoked')

    def test_only_a_manager_sees_the_links(self):
        self._invite()
        self.project.seeking_coauthors = True
        self.project.save()
        self.client.force_authenticate(self.outsider)
        resp = self.client.get(f'/api/material-projects/{self.project.pk}/invites/')
        # Visible project, but a link IS the authorisation — so 403, not 404.
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class JoinRequestTests(CoauthoringBase):
    def setUp(self):
        super().setUp()
        self.project.seeking_coauthors = True
        self.project.save()

    def test_the_whole_flow(self):
        self.client.force_authenticate(self.outsider)
        resp = self.client.post(
            f'/api/material-projects/{self.project.pk}/join-requests/',
            {'statement': 'I wrote the lecture notes this is based on.'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        row_id = resp.json()['id']

        # A requester can read their own pending row — otherwise they could not withdraw it.
        mine = self.client.get(f'/api/material-projects/{self.project.pk}/join-requests/')
        self.assertEqual([r['id'] for r in mine.json()], [row_id])

        self.client.force_authenticate(self.owner)
        decided = self.client.post(
            f'/api/project-join-requests/{row_id}/decide/',
            {'decision': 'accept'},
            format='json',
        )
        self.assertEqual(decided.status_code, status.HTTP_200_OK)
        self.assertEqual(decided.json()['status'], 'accepted')
        self.assertTrue(self.project.members.filter(user=self.outsider).exists())

    def test_a_short_statement_is_refused(self):
        self.client.force_authenticate(self.outsider)
        resp = self.client.post(
            f'/api/material-projects/{self.project.pk}/join-requests/',
            {'statement': 'hi'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('statement', resp.json())

    def test_the_block_reasons(self):
        from coauthoring.access import join_block_reason

        child = make_user('proj-join-child')
        child.profile.is_minor = True
        child.profile.save(update_fields=['is_minor'])
        self.assertEqual(join_block_reason(self.project, None), 'authentication_required')
        self.assertEqual(join_block_reason(self.project, self.owner), 'member')
        self.assertEqual(join_block_reason(self.project, child), 'minor')
        self.assertIsNone(join_block_reason(self.project, self.outsider))

        ProjectJoinRequest.objects.create(
            project=self.project, user=self.outsider, statement='x' * 30
        )
        self.assertEqual(join_block_reason(self.project, self.outsider), 'pending_exists')

        self.project.seeking_coauthors = False
        self.project.save()
        self.assertEqual(join_block_reason(self.project, make_viewer('nobody')), 'not_seeking')

        self.publish_first()
        self.project.refresh_from_db()
        self.assertEqual(join_block_reason(self.project, make_viewer('nobody2')), 'published')

    def test_a_decline_needs_a_note(self):
        row = ProjectJoinRequest.objects.create(
            project=self.project, user=self.outsider, statement='x' * 30
        )
        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            f'/api/project-join-requests/{row.pk}/decide/',
            {'decision': 'decline'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.json()['detail'], 'note_required')

    def test_withdrawing_is_the_requesters_own(self):
        row = ProjectJoinRequest.objects.create(
            project=self.project, user=self.outsider, statement='x' * 30
        )
        self.client.force_authenticate(self.owner)
        theirs = self.client.post(
            f'/api/project-join-requests/{row.pk}/withdraw/', {}, format='json'
        )
        self.assertEqual(theirs.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.outsider)
        mine = self.client.post(f'/api/project-join-requests/{row.pk}/withdraw/', {}, format='json')
        self.assertEqual(mine.json()['status'], 'withdrawn')


class FeatureFlagTests(CoauthoringBase):
    def setUp(self):
        super().setUp()
        FeatureFlag.objects.update_or_create(
            key='coauthoring', defaults={'is_enabled': False}
        )

    def test_the_switch_closes_the_api_for_an_ordinary_account(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.get(f'/api/material-projects/{self.project.pk}/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_bypass_the_switch(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.get(f'/api/material-projects/{self.project.pk}/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_material_submissions_gates_creation_separately(self):
        """Two abilities, two switches — killing collaboration must not kill the submit form, and
        killing submissions must not kill an existing team."""
        FeatureFlag.objects.update_or_create(key='coauthoring', defaults={'is_enabled': True})
        FeatureFlag.objects.update_or_create(
            key='material_submissions', defaults={'is_enabled': False}
        )
        self.client.force_authenticate(self.owner)
        create = self.client.post(
            '/api/material-projects/',
            {
                'branch': self.branch.slug,
                'type': 'script',
                'kind': 'body',
                'title': 'New',
                'body': 'Text',
            },
            format='json',
        )
        self.assertEqual(create.status_code, status.HTTP_403_FORBIDDEN)
        # …while the existing project keeps working.
        self.assertEqual(
            self.client.get(f'/api/material-projects/{self.project.pk}/').status_code,
            status.HTTP_200_OK,
        )


class SideEffectTests(CoauthoringBase):
    def test_an_activity_row_only_for_a_new_version_of_a_published_material(self):
        ActivityEvent.objects.all().delete()
        self.publish_first()
        # A first publication announces the MATERIAL (from `create_material`), never a version.
        self.assertFalse(ActivityEvent.objects.filter(kind='material_version').exists())
        self.assertTrue(ActivityEvent.objects.filter(kind='material').exists())

        self.project.refresh_from_db()
        second = _version(
            self.project,
            number=self.project.published_version.number + 1,
            title='Second',
            created_by=self.owner,
        )
        services.publish_version(second, self.owner)
        row = ActivityEvent.objects.get(kind='material_version')
        self.assertEqual(row.material_id, self.project.material_id)
        self.assertEqual(row.target_label, 'Second')
        self.assertEqual(row.actor_id, self.owner.pk)

    def test_deleting_a_version_takes_its_feed_row_with_it(self):
        self.publish_first()
        self.project.refresh_from_db()
        second = _version(
            self.project,
            number=self.project.published_version.number + 1,
            title='Second',
            created_by=self.owner,
        )
        services.publish_version(second, self.owner)
        self.assertEqual(ActivityEvent.objects.filter(kind='material_version').count(), 1)
        second.delete()
        self.assertEqual(ActivityEvent.objects.filter(kind='material_version').count(), 0)

    def test_the_backfill_projects_an_existing_material_and_announces_nothing(self):
        """The data migration, run against the real models.

        A migration that filled the feed with hundreds of "new version" rows dated today would be
        exactly the failure the feed's public-by-construction contract forbids, and a notification
        for it would be a message about something nobody did.
        """
        import importlib

        from django.apps import apps as global_apps
        from testing.factories import make_material

        module = importlib.import_module('coauthoring.migrations.0002_backfill_projects')
        material = make_material(self.branch, slug='legacy-corpus-thing', title='Stare notatki')
        ActivityEvent.objects.all().delete()
        Notification.objects.all().delete()

        module.backfill(global_apps, None)

        project = MaterialProject.objects.get(material=material)
        self.assertEqual(project.locale, 'pl')
        self.assertEqual(project.type, material.type)
        version = project.versions.get()
        self.assertEqual(version.number, 1)
        self.assertEqual(version.status, 'published')
        self.assertEqual(version.kind, 'file')
        # The SAME stored reference, never a second copy of the bytes.
        self.assertEqual(version.file.name, material.file.name)
        self.assertEqual(version.title, 'Stare notatki')
        self.assertEqual(version.published_at, material.created_at)
        # No `submitted_by` on a corpus material, so no owner — an orphan project, which is
        # exactly what `needs_staff_review` is for.
        self.assertEqual(project.members.count(), 0)
        self.assertFalse(ActivityEvent.objects.exists())
        self.assertFalse(Notification.objects.exists())

        # Idempotent: running it again adds nothing.
        module.backfill(global_apps, None)
        self.assertEqual(MaterialProject.objects.filter(material=material).count(), 1)

    def test_a_proposal_notifies_every_member_except_its_author(self):
        self.publish_first()
        self.project.refresh_from_db()
        friend = make_viewer('proj-notified')
        ProjectMember.objects.create(project=self.project, user=friend, role='coauthor')
        Notification.objects.all().delete()

        self.client.force_authenticate(self.outsider)
        self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {
                'kind': 'body',
                'title': 'An improvement',
                'body': 'x',
                'based_on': self.project.published_version.pk,
            },
            format='json',
        )
        recipients = set(
            Notification.objects.filter(type='material_version_proposed').values_list(
                'recipient_id', flat=True
            )
        )
        self.assertEqual(recipients, {self.owner.pk, friend.pk})

    def test_a_muted_category_means_the_row_is_never_created(self):
        self.publish_first()
        self.project.refresh_from_db()
        profile = self.owner.profile
        profile.notify_on_content_action = False
        profile.save(update_fields=['notify_on_content_action'])
        Notification.objects.all().delete()

        self.client.force_authenticate(self.outsider)
        self.client.post(
            f'/api/material-projects/{self.project.pk}/versions/',
            {
                'kind': 'body',
                'title': 'An improvement',
                'body': 'x',
                'based_on': self.project.published_version.pk,
            },
            format='json',
        )
        self.assertFalse(
            Notification.objects.filter(
                type='material_version_proposed', recipient=self.owner
            ).exists()
        )

    def test_a_notification_about_a_draft_project_links_to_the_project(self):
        """`material_project` is the FK for the half of this feature that happens before there is a
        material to link to."""
        friend = make_viewer('proj-draft-notified')
        ProjectMember.objects.create(project=self.project, user=friend, role='coauthor')
        Notification.objects.all().delete()
        services.add_member(self.project, self.outsider, added_by=self.owner)
        row = Notification.objects.get(type='project_member_added')
        self.assertEqual(row.material_project_id, self.project.pk)
        self.assertIsNone(row.material_id)


class TranslationStaleTests(CoauthoringBase):
    def test_a_translation_older_than_the_published_version_is_marked_stale(self):
        self.publish_first()
        self.project.refresh_from_db()
        material = self.project.material
        english = MaterialTranslation.objects.create(
            material=material, locale='en', title='English title', description=''
        )
        # A queryset update bypasses `auto_now`, which is the only way to make a row older than the
        # thing it describes in a test that runs in one second.
        MaterialTranslation.objects.filter(pk=english.pk).update(
            updated_at=timezone.now() - timedelta(days=30)
        )

        stale = self.client.get(f'/api/materials/{material.pk}/?lang=en').json()
        self.assertTrue(stale['translation_stale'])
        # The project's OWN locale is never stale — publishing rewrites exactly that row.
        fresh = self.client.get(f'/api/materials/{material.pk}/?lang=pl').json()
        self.assertFalse(fresh['translation_stale'])

    def test_a_material_with_no_project_is_never_stale(self):
        from testing.factories import make_material

        material = make_material(self.branch, slug='lonely')
        body = self.client.get(f'/api/materials/{material.pk}/').json()
        self.assertFalse(body['translation_stale'])
        self.assertIsNone(body['project_id'])


class ListingQueryCountTests(CoauthoringBase):
    """`project_id` and `translation_stale` both walk the reverse one-to-one, which is one query per
    row without `select_related('project')` and one more per row without the published-version
    prefetch (`materials.views.published_version_prefetch`).

    Pinned with counts rather than a comment, because an N+1 is invisible until somebody measures
    it — `MaterialSerializer.project_id`'s own docstring predicted this exact one the moment
    `coauthoring` landed, and this listing has grown one before.

    **Six bulk queries plus THREE per row**, and the three are all pre-existing: the branch behind
    `branch_slug`, and the `AVG`/`COUNT` behind `average_rating`/`review_count`, which
    `MaterialSerializer` already documents as a deliberate trade for a corpus this size. The point
    of the second measurement is the growth: adding two materials adds exactly six queries, so
    neither the project nor its published version is among the per-row ones.
    """

    def _publish(self, count, *, offset=0):
        for index in range(count):
            project = MaterialProject.objects.create(
                branch=self.branch, created_by=self.owner, type='script'
            )
            version = _version(project, title=f'Material {offset + index}')
            services.publish_version(version, self.staff)

    def test_the_materials_listing_does_not_pay_a_query_per_project(self):
        self._publish(4)
        self.assertEqual(Material.objects.filter(published=True).count(), 4)

        with self.assertNumQueries(6 + 3 * 4):
            resp = self.client.get('/api/materials/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        rows = resp.json()
        self.assertEqual(len(rows), 4)
        self.assertTrue(all(row['project_id'] for row in rows))
        self.assertTrue(all(row['translation_stale'] is False for row in rows))

        self._publish(2, offset=4)
        with self.assertNumQueries(6 + 3 * 6):
            self.assertEqual(len(self.client.get('/api/materials/').json()), 6)

    def test_the_branch_materials_tab_matches(self):
        """The drifted copy in `taxonomy/views.py`, which has fallen behind this listing before and
        carries a comment saying so."""
        # Four more fixed queries than the cross-branch listing, all spent before a single material
        # is read: `get_object()` loads the branch with its translations, topics and chapters. After
        # that it is the same six bulk queries and the same three pre-existing per-row ones.
        self._publish(3)
        with self.assertNumQueries(4 + 6 + 3 * 3):
            resp = self.client.get(f'/api/branches/{self.branch.slug}/materials/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.json()), 3)

        self._publish(2, offset=3)
        with self.assertNumQueries(4 + 6 + 3 * 5):
            self.assertEqual(
                len(self.client.get(f'/api/branches/{self.branch.slug}/materials/').json()), 5
            )


class CatalogueTests(CoauthoringBase):
    def test_coverage_topics_must_belong_to_the_branch(self):
        """`materials.publish.create_material` is explicit that each `topic_id` is the CALLER's to
        have validated — so the caller validates it, or a first publication would make a real claim
        on a real material with a topic from somebody else's branch."""
        other_branch = make_branch(slug='other-branch')
        foreign = Topic.objects.create(branch=other_branch, slug='foreign-topic')
        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            '/api/material-projects/',
            {
                'branch': self.branch.slug,
                'type': 'script',
                'kind': 'body',
                'title': 'With coverage',
                'body': 'Text',
                'coverage': [{'topic_id': foreign.pk, 'level': 50, 'kind': 'covers'}],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('coverage', resp.json())

    def test_a_valid_coverage_claim_becomes_a_real_row_on_publication(self):
        topic = Topic.objects.create(branch=self.branch, slug='a-topic')
        verified = make_user('proj-cat-verified', is_verified_contributor=True)
        self.client.force_authenticate(verified)
        created = self.client.post(
            '/api/material-projects/',
            {
                'branch': self.branch.slug,
                'type': 'script',
                'kind': 'body',
                'title': 'With coverage',
                'body': 'Text',
                'coverage': [{'topic_id': topic.pk, 'level': 60, 'kind': 'requires'}],
            },
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        version_id = created.json()['head_version']['id']
        self.client.post(f'/api/material-versions/{version_id}/publish/', {}, format='json')
        project = MaterialProject.objects.get(pk=created.json()['id'])
        project.refresh_from_db()
        claim = project.material.coverage.get()
        self.assertEqual(claim.topic_id, topic.pk)
        self.assertEqual(claim.level, 60)
        self.assertEqual(claim.kind, 'requires')

    def test_a_catalogue_patch_after_publication_writes_to_the_material(self):
        self.publish_first()
        self.project.refresh_from_db()
        self.client.force_authenticate(self.owner)
        resp = self.client.patch(
            f'/api/material-projects/{self.project.pk}/',
            {'type': 'syllabus', 'author': 'A. Nowak', 'estimated_minutes': 45},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.project.material.refresh_from_db()
        self.assertEqual(self.project.material.type, 'syllabus')
        self.assertEqual(self.project.material.author, 'A. Nowak')
        self.assertEqual(self.project.material.estimated_minutes, 45)
        # The project's own frozen copies are untouched, and the response reads the material.
        self.project.refresh_from_db()
        self.assertEqual(self.project.type, 'script')
        self.assertEqual(resp.json()['type'], 'syllabus')

    def test_a_stranger_cannot_patch_a_seeking_draft(self):
        self.project.seeking_coauthors = True
        self.project.save()
        self.client.force_authenticate(self.outsider)
        resp = self.client.patch(
            f'/api/material-projects/{self.project.pk}/',
            {'seeking_note': 'mine now'},
            format='json',
        )
        # Visible, so 403 rather than 404 — pretending it does not exist would be a lie they can
        # disprove by reloading the page they are looking at.
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class SanitizationTests(CoauthoringBase):
    def test_a_version_is_sanitized_on_write(self):
        version = _version(
            self.project,
            title='<script>alert(1)</script>Title',
            body='<p>ok</p><img src=x onerror=alert(1)>',
        )
        version.refresh_from_db()
        self.assertNotIn('<script>', version.title)
        self.assertNotIn('onerror', version.body)
        self.assertIn('<p>ok</p>', version.body)

    def test_latex_survives_sanitization(self):
        """The content pipeline's whole point: `\\[ … \\]` must come out the other side intact."""
        version = _version(self.project, body=r'Consider \[ \int_0^1 x\,dx \] and stop.')
        version.refresh_from_db()
        self.assertIn(r'\[ \int_0^1 x\,dx \]', version.body)


class ListTests(CoauthoringBase):
    def test_mine_seeking_and_material_selectors(self):
        seeking = MaterialProject.objects.create(
            branch=self.branch, created_by=self.outsider, seeking_coauthors=True
        )
        _version(seeking, title='Open to help')
        self.publish_first()
        self.project.refresh_from_db()

        self.client.force_authenticate(self.owner)
        mine = self.client.get('/api/material-projects/?mine=1').json()
        self.assertEqual({row['id'] for row in mine}, {self.project.pk})

        looking = self.client.get('/api/material-projects/?seeking=1').json()
        self.assertEqual({row['id'] for row in looking}, {seeking.pk})

        by_material = self.client.get(
            f'/api/material-projects/?material={self.project.material_id}'
        ).json()
        self.assertEqual([row['id'] for row in by_material], [self.project.pk])

    def test_mine_needs_an_account(self):
        resp = self.client.get('/api/material-projects/?mine=1')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_junk_material_id_is_an_empty_list_not_a_500(self):
        resp = self.client.get('/api/material-projects/?material=not-a-number')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.json(), [])


class CommentThreadTests(CoauthoringBase):
    def test_the_review_thread_follows_the_versions_own_visibility(self):
        self.publish_first()
        self.project.refresh_from_db()
        proposal = _version(
            self.project,
            number=self.project.published_version.number + 1,
            status='proposed',
            title='A proposal',
            created_by=self.outsider,
            based_on=self.project.published_version,
        )
        self.client.force_authenticate(self.owner)
        posted = self.client.post(
            f'/api/material-versions/{proposal.pk}/comments/',
            {'body': 'Could you add the answers?'},
            format='json',
        )
        self.assertEqual(posted.status_code, status.HTTP_201_CREATED)

        # The proposer can read it; a stranger cannot even see the version.
        self.client.force_authenticate(self.outsider)
        self.assertEqual(
            len(self.client.get(f'/api/material-versions/{proposal.pk}/comments/').json()), 1
        )
        self.client.force_authenticate(make_user('proj-nosy'))
        self.assertEqual(
            self.client.get(f'/api/material-versions/{proposal.pk}/comments/').status_code,
            status.HTTP_404_NOT_FOUND,
        )


class ReviewFindingsTests(CoauthoringBase):
    """Regressions for what the 2026-09-22 review of this app found. Each test names its bug."""

    def test_a_link_version_passes_the_models_own_clean(self):
        """`clean()` keyed its payload check by COLUMN (`url`) and compared it with the KIND
        (`link`), so every link version failed `full_clean()` — which is what the admin runs."""
        version = _version(self.project, kind='link', body='', url='https://example.org/notes')
        version.full_clean()

    def test_a_draft_written_before_an_accepted_proposal_cannot_overwrite_it(self):
        """The lost update. A proposal (v2) and a member's draft (v3) are both written against v1.
        The proposal is accepted first. The draft is numbered higher, so a number-only check let it
        publish — silently replacing the accepted proposal with text that never contained it."""
        self.publish_first()
        self.project.refresh_from_db()
        first = self.project.published_version
        proposer = make_viewer('proj-proposer')
        proposal = _version(
            self.project, status='proposed', created_by=proposer, title='Proposal'
        )
        draft = _version(self.project, title='Member draft', created_by=self.owner)
        self.assertEqual(proposal.based_on_id, first.pk)
        self.assertEqual(draft.based_on_id, first.pk)

        services.decide_version(proposal, self.owner, 'accept')
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, 'published')

        self.client.force_authenticate(self.owner)
        shown = self.client.get(f'/api/material-versions/{draft.pk}/').json()
        self.assertFalse(shown['can_publish'])
        resp = self.client.post(f'/api/material-versions/{draft.pk}/publish/', {}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.json()['detail'], 'stale')
        self.assertEqual(resp.json()['head']['id'], proposal.pk)
        draft.refresh_from_db()
        self.assertEqual(draft.status, 'draft')
        translation = MaterialTranslation.objects.get(
            material=self.project.material, locale=self.project.locale
        )
        self.assertEqual(translation.title, 'Proposal')

    def test_a_draft_saved_on_the_current_version_still_publishes(self):
        """The other side of the rule: a chain of drafts on top of the published row is fine."""
        self.publish_first()
        self.project.refresh_from_db()
        middle = _version(self.project, title='Middle draft')
        top = _version(self.project, title='Top draft')
        self.assertEqual(top.based_on_id, middle.pk)
        services.publish_version(top, self.owner)
        top.refresh_from_db()
        self.assertEqual(top.status, 'published')

    def test_a_stranger_reads_the_published_title_not_a_members_draft(self):
        """The project serializer named itself by the raw head, which is a draft whenever a member
        has one open — so an unpublished working title and description were public."""
        self.publish_first()
        self.project.refresh_from_db()
        _version(self.project, title='Unpublished working title', description='Secret plans.')

        self.client.force_authenticate(self.outsider)
        body = self.client.get(f'/api/material-projects/{self.project.pk}/').json()
        self.assertEqual(body['title'], 'A title')
        self.assertNotEqual(body['description'], 'Secret plans.')
        listed = self.client.get(
            f'/api/material-projects/?material={self.project.material_id}'
        ).json()
        self.assertEqual(listed[0]['title'], 'A title')

        self.client.force_authenticate(self.owner)
        mine = self.client.get(f'/api/material-projects/{self.project.pk}/').json()
        self.assertEqual(mine['title'], 'Unpublished working title')

    def test_whoever_presses_publish_is_not_told_about_it(self):
        """A publication names the version's AUTHOR as its actor, so `notify()`'s own guard skipped
        the author but not the co-author who pressed Publish on their draft."""
        coauthor = make_user('proj-coauthor')
        third = make_user('proj-third')
        ProjectMember.objects.create(project=self.project, user=coauthor, role='coauthor')
        ProjectMember.objects.create(project=self.project, user=third, role='coauthor')
        self.publish_first()
        self.project.refresh_from_db()
        Notification.objects.all().delete()

        draft = _version(self.project, title='By the co-author', created_by=coauthor)
        services.publish_version(draft, self.owner)
        told = set(
            Notification.objects.filter(type='material_version_published').values_list(
                'recipient_id', flat=True
            )
        )
        self.assertEqual(told, {third.pk})

    def test_a_stranger_gets_404_on_somebody_elses_join_request(self):
        """A 403 confirmed that somebody had asked to join that project."""
        self.project.seeking_coauthors = True
        self.project.save()
        applicant = make_user('proj-applicant')
        row = ProjectJoinRequest.objects.create(
            project=self.project, user=applicant, statement='I would like to help with this one.'
        )
        self.client.force_authenticate(self.outsider)
        for action in ('decide', 'withdraw'):
            resp = self.client.post(
                f'/api/project-join-requests/{row.pk}/{action}/',
                {'decision': 'accept'},
                format='json',
            )
            self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND, action)

        self.client.force_authenticate(applicant)
        resp = self.client.post(
            f'/api/project-join-requests/{row.pk}/decide/', {'decision': 'accept'}, format='json'
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_unknown_currency_is_refused(self):
        """A plain CharField stored any three letters, and the column's `choices` is not enforced
        by the database, so a bad code rode through to the `Material` row at publication."""
        self.client.force_authenticate(self.owner)
        resp = self.client.post(
            '/api/material-projects/',
            {
                'branch': self.branch.slug,
                'type': 'script',
                'kind': 'body',
                'title': 'Priced',
                'body': 'Text',
                'price_amount': '10.00',
                'price_currency': 'XYZ',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('price_currency', resp.json())


class ImportedMaterialsGetProjectsTests(CoauthoringBase):
    """A material created the way the corpus importer creates one — directly, and AFTER every
    migration has already run — still ends up with a project.

    On a clean clone `setup.sh` migrates (the backfill migration finds an empty database and does
    nothing) and imports the corpus second, so without `coauthoring.backfill.ensure_projects` every
    one of the 740-exercise corpus's materials would have no version history, no team and no
    "Improve this material" — the feature silently absent on exactly the install somebody is seeing
    for the first time. An applied migration never runs again, so the importer has to ask.
    """

    def test_a_material_created_after_the_migration_still_gets_its_project(self):
        from coauthoring.backfill import ensure_projects

        material = Material.objects.create(
            branch=self.branch, slug='imported-script', type='script', body='Corpus text.'
        )
        MaterialTranslation.objects.create(
            material=material, locale='pl', title='Skrypt', description='Opis skryptu.'
        )
        self.assertEqual(ensure_projects(), 1)

        project = MaterialProject.objects.get(material=material)
        version = project.versions.get(number=1)
        self.assertEqual(version.status, 'published')
        self.assertEqual(version.kind, 'body')
        self.assertEqual(version.title, 'Skrypt')
        # The material's own creation time, never now — or every translation would read as stale
        # the moment this ran.
        self.assertEqual(version.published_at, material.created_at)
        self.assertEqual(project.locale, 'pl')
        # Nobody submitted a corpus material, so nobody owns it: an orphan project, whose proposals
        # go to staff (`access.needs_staff_review`).
        self.assertEqual(project.members.count(), 0)

    def test_it_is_idempotent_and_seats_a_submitter_as_owner(self):
        from coauthoring.backfill import ensure_projects

        mine = Material.objects.create(
            branch=self.branch,
            slug='mine',
            type='script',
            body='Text.',
            submitted_by=self.owner,
        )
        self.assertEqual(ensure_projects(), 1)
        project = MaterialProject.objects.get(material=mine)
        self.assertEqual(
            [(row.user_id, row.role) for row in project.members.all()],
            [(self.owner.pk, 'owner')],
        )
        # Running it again makes nothing: a re-import, or a second run after a partial one, is safe.
        self.assertEqual(ensure_projects(), 0)
        self.assertEqual(project.versions.count(), 1)

