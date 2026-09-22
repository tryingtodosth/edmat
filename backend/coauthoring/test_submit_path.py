"""The single-shot submit path, on its new home: `POST /api/material-projects/`.

**Every test here is a port.** `moderation/tests.py` carried ten classes' worth of behaviour for
`MaterialSubmission` — the upload endpoint, the verified-contributor restriction, the auto-publish
fast path, approval, the storage quota, the reject-time file reclaim, the throttle, the image
re-encode and the link-only shape. That model was folded into a project with a team of one
(`coauthoring/0003_fold_material_submissions`) and deleted, so every one of those behaviours had to
land somewhere or quietly stop being true. This module is where they landed; the old classes were
removed only once these passed.

Where a behaviour genuinely has no equivalent any more, the port keeps the INTENT and its docstring
says so in as many words — "a regular user only sees their own submissions" is `?mine=1` plus the
queue's own governor scoping, "the rejection response says the file was reclaimed" is the version's
`file_reclaimed_at`/`file_url`, and a moderator's `/api/moderation/material/{id}/approve/` is
`POST /api/material-versions/{id}/decide/`. Two things from the old suite are deliberately NOT
ported and are named in the report rather than left to be discovered: the auto-publish `review_note`
text (a version published by its own author carries no decision fields at all, which says the same
thing structurally) and the 403 shape of the verified-contributor refusal (it is a 400 on `file`
now — the restriction is checked inside the service, because it restricts one SHAPE of request
rather than one action).

The four classes at the end are not ports: the two kill switches now answer per project rather than
per endpoint, the queue and the shared moderation action lost a section and a kind, a merged-away
material type has to follow a draft project rather than a submission, and the fold migration itself
needs pinning.
"""

from __future__ import annotations

import importlib
import json
import os
import shutil
import tempfile

from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings
from django.urls import NoReverseMatch, reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.test_throttling import ThrottleTestCase
from coauthoring.models import MaterialProject, MaterialVersion, ProjectMember
from materials.models import Material
from moderation.models import FeatureFlag, NodeGovernor
from taxonomy.models import Branch
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_topic, make_user, pdf_bytes


def _pdf(name='practice.pdf', size=None):
    return SimpleUploadedFile(name, pdf_bytes(size) if size else b'%PDF-1.4 real content')


class _TempMediaRoot:
    """Every file this module writes lands in a temporary `MEDIA_ROOT` and is swept afterwards.

    Not tidiness: the class this replaces recorded that the suite had been writing scratch PDFs into
    the live `backend/media/` tree beside genuine uploads, found by listing the directory rather than
    reasoned about. It is also what makes the reclaim tests mean anything — "was the file really
    deleted?" has to be asked of a directory the test owns.
    """

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-submit-test-')
        cls._media_override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._media_override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._media_override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def stored_file_count(self):
        """How many version blobs are actually on disk. `material_versions/` is where a new upload
        goes; a folded row may still name `material_submissions/`, which nothing here writes."""
        directory = os.path.join(self._media_root, 'material_versions')
        return len(os.listdir(directory)) if os.path.isdir(directory) else 0


class SubmitPathBase(_TempMediaRoot, APITestCase):
    """A branch, a submitter, and the one request that used to be `POST /api/material-submissions/`.

    `databases` covers the audit shards: a publication or a decision writes an `AuditEvent`, which
    lives in its own SQLite file, and a view test that does not declare them fails on Django's
    cross-database guard rather than on anything under test.
    """

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        # Creating a project is throttled (`material_submission`, 20/hour) and DRF counts through
        # Django's cache, which — unlike the database — is NOT rolled back between tests. SQLite
        # hands out the same primary keys again after each rollback, so every test here
        # authenticates as the same numeric ident and would otherwise share one budget across the
        # whole class, eventually handing a later test a 429 that has nothing to do with what it is
        # testing. The trap `accounts/test_throttling.py` documents, met from the other direction.
        cache.clear()
        self.branch = make_branch(slug='submit-path-branch')
        self.student = make_user('submit-student')
        self.other_student = make_user('submit-other-student')
        self.moderator = make_user('submit-moderator', is_staff=True)

    # --- the request under test ------------------------------------------------------------------

    def submit(self, client=None, **overrides):
        """The submit form's own request: a catalogue, one payload, and "…and send it".

        Multipart, because that is what a browser sends when a file rides along — and because it is
        the shape that proves `publish` survives arriving as the string 'true'. A `None` override
        drops the key entirely, which is how a test asks for a request with no file.
        """
        data = {
            'branch': self.branch.slug,
            'type': 'practice_test',
            'title': 'A submitted practice test',
            'description': 'Real practice problems.',
            'locale': 'en',
            'kind': 'file',
            'file': _pdf(),
            'publish': 'true',
            **overrides,
        }
        data = {key: value for key, value in data.items() if value is not None}
        return (client or self.client).post('/api/material-projects/', data, format='multipart')

    def head_id(self, response):
        return response.json()['head_version']['id']

    def decide(self, version_id, decision, note='', *, user=None):
        self.client.force_authenticate(user or self.moderator)
        return self.client.post(
            f'/api/material-versions/{version_id}/decide/',
            {'decision': decision, 'note': note},
            format='json',
        )


class SubmitApiTests(SubmitPathBase):
    """Ported from `MaterialSubmissionApiTests` — the endpoint itself, rather than the validators it
    calls (those moved to `materials/test_validators.py`)."""

    def test_authenticated_upload_succeeds_and_records_an_honest_scan_status(self):
        self.client.force_authenticate(self.student)
        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        head = response.json()['head_version']
        # An ordinary account's first publication waits for a moderator — the status a pending
        # submission used to carry, on the row that carries it now.
        self.assertEqual(head['status'], 'proposed')
        self.assertIsNone(response.json()['material_id'])
        # No ClamAV daemon in this environment, so `scan_status` must honestly read 'skipped',
        # never a silently-assumed 'clean' (house rule 10).
        self.assertEqual(head['scan_status'], 'skipped')

    def test_author_and_source_url_are_accepted_and_stored(self):
        self.client.force_authenticate(self.student)

        response = self.submit(
            author='dr hab. Anna Kowalska',
            source_url='https://example.edu/branches/am2/materials',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.json()['author'], 'dr hab. Anna Kowalska')
        self.assertEqual(
            response.json()['source_url'], 'https://example.edu/branches/am2/materials'
        )

    def test_a_malformed_source_url_is_rejected_rather_than_stored(self):
        """A `URLField`, not free text — a stored non-URL would render as a broken link on every
        material card that shows it, and provenance nobody can follow is worse than none."""
        self.client.force_authenticate(self.student)

        response = self.submit(source_url='not a url at all')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('source_url', response.data)
        self.assertFalse(MaterialProject.objects.filter(source_url='not a url at all').exists())

    def test_anonymous_upload_is_rejected(self):
        response = self.submit()
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_disguised_executable_upload_is_rejected_with_a_400(self):
        self.client.force_authenticate(self.student)
        response = self.submit(
            file=SimpleUploadedFile(
                'totally_a_pdf.pdf',
                b'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00' + b'A' * 200,
            )
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # And nothing was left behind by the refusal — the project is created after the file has
        # passed, and torn down again if anything later fails.
        self.assertEqual(MaterialProject.objects.count(), 0)

    def test_uploading_with_a_valid_coverage_entry_is_accepted(self):
        topic = make_topic(self.branch, 'submit-api-topic')
        self.client.force_authenticate(self.student)
        response = self.submit(coverage=json.dumps([{'topic_id': topic.pk, 'level': 40}]))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(
            response.json()['coverage'], [{'topic_id': topic.pk, 'level': 40, 'kind': 'covers'}]
        )

    def test_uploading_with_a_coverage_topic_from_a_different_course_is_rejected(self):
        other_branch = make_branch(slug='submit-path-other-branch')
        other_topic = make_topic(other_branch, 'submit-api-other-topic')
        self.client.force_authenticate(self.student)
        response = self.submit(coverage=json.dumps([{'topic_id': other_topic.pk, 'level': 40}]))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_uploading_with_an_out_of_range_coverage_level_is_rejected(self):
        topic = make_topic(self.branch, 'submit-api-range-topic')
        self.client.force_authenticate(self.student)
        response = self.submit(coverage=json.dumps([{'topic_id': topic.pk, 'level': 999}]))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_regular_user_only_sees_their_own(self):
        """Ported intent, not shape: there is no `/api/material-submissions/` list any more, and the
        two halves of what it did are now `?mine=1` (a project you are a member of) and the queue's
        own governor scoping (what a moderator sees). Somebody else's unpublished project is not
        merely absent from your listing — it 404s, because for you it does not exist (house rule 4).
        """
        self.client.force_authenticate(self.student)
        mine = self.submit(title='Mine')
        self.client.force_authenticate(self.other_student)
        theirs = self.submit(title="Someone else's")

        self.client.force_authenticate(self.student)
        listed = self.client.get('/api/material-projects/?mine=1')
        self.assertEqual({row['title'] for row in listed.json()}, {'Mine'})
        self.assertEqual(
            self.client.get(f"/api/material-projects/{theirs.json()['id']}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(mine.status_code, status.HTTP_201_CREATED)

    def test_a_moderator_sees_every_pending_upload(self):
        """The other half of the same port: a moderator's view of what is waiting is the queue's
        `material_versions` section, which is unscoped for staff."""
        self.client.force_authenticate(self.student)
        self.submit(title='Mine')
        self.client.force_authenticate(self.other_student)
        self.submit(title="Someone else's")

        self.client.force_authenticate(self.moderator)
        queue = self.client.get(reverse('moderation-queue'))
        titles = {row['title'] for row in queue.json()['material_versions']}
        self.assertEqual(titles, {'Mine', "Someone else's"})

    def test_upload_can_optionally_declare_requirements_price_and_a_time_estimate(self):
        """Multipart form fields always arrive as bare strings — `requirements` is sent as a
        JSON-encoded string here, the real shape a browser's own FormData would produce, not the
        native Python list a JSON-format test request could send instead."""
        self.client.force_authenticate(self.student)
        response = self.submit(
            requirements=json.dumps(['English B2+', 'basic algebra']),
            price_amount='19.99',
            price_currency='EUR',
            estimated_minutes='30',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        body = response.json()
        self.assertEqual(body['requirements'], ['English B2+', 'basic algebra'])
        self.assertEqual(body['price_amount'], '19.99')
        self.assertEqual(body['price_currency'], 'EUR')
        self.assertEqual(body['estimated_minutes'], 30)

    def test_a_submission_with_no_requirements_price_or_estimate_stays_genuinely_optional(self):
        self.client.force_authenticate(self.student)
        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        body = response.json()
        self.assertEqual(body['requirements'], [])
        self.assertIsNone(body['price_amount'])
        self.assertIsNone(body['estimated_minutes'])

    def test_a_case_insensitive_duplicate_requirement_at_submission_time_is_rejected(self):
        """The identical check `materials/views.py`'s governor-only bulk-replace endpoint enforces
        on an already-published Material — shared via `materials/services.py`'s
        `find_duplicate_requirement_label` so a brand-new upload cannot sneak in duplicates
        either."""
        self.client.force_authenticate(self.student)
        response = self.submit(requirements=json.dumps(['English B2+', '  english b2+  ']))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('requirements', response.data)

    def test_an_unknown_material_type_is_refused(self):
        self.client.force_authenticate(self.student)
        response = self.submit(type='not-a-real-type')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('type', response.data)

    def test_scan_required_rejects_the_upload_when_no_scanner_is_reachable(self):
        """`MATERIAL_SCAN_REQUIRED` (config/settings.py) is False by default in this project's own
        sandboxed dev environment (no ClamAV daemon exists to reach at all) — flipping it True here
        is what a real deployment that actually runs ClamAV would do, which should turn "couldn't
        scan it" into a hard rejection rather than the honest-skip default this environment uses.

        The second half is the port's own addition: the failed upload must leave NO project behind
        either. A submission row used to be deleted on this path; a project is created before the
        scan can run, so `create_project` tears it down again rather than leaving an empty one in
        somebody's listing from a request they watched fail.
        """
        self.client.force_authenticate(self.student)
        # Counted as a DIFFERENCE, not against zero: `MEDIA_ROOT` is per class and the database
        # rolls back between tests while the filesystem does not, so an absolute count here would
        # be measuring whichever tests ran before this one.
        before = self.stored_file_count()
        with override_settings(MATERIAL_SCAN_REQUIRED=True):
            response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(MaterialProject.objects.count(), 0)
        self.assertEqual(MaterialVersion.objects.count(), 0)
        self.assertEqual(self.stored_file_count(), before)

    def test_a_draft_is_still_possible_without_publish(self):
        """`publish` is optional, and omitting it is the co-authoring path: start something, keep
        writing, publish when it is ready. The submit form sends it; `/material-projects/new` does
        not."""
        self.client.force_authenticate(self.student)
        response = self.submit(publish=None)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.json()['head_version']['status'], 'draft')


class VerifiedContributorUploadGateTests(SubmitPathBase):
    """Ported from `MaterialUploadVerifiedContributorGateTests` — the `material_uploads_verified_only`
    flag, a NARROWER restriction than the blanket `material_submissions` kill switch beside it.

    **The refusal changed shape and that is the port's one real difference.** It used to be a 403
    from a permission class on `create`; it is a 400 naming `file` now, raised inside
    `coauthoring.services._require_verified_contributor_for_uploads`, because the restriction applies
    to one SHAPE of request rather than to one action — the same endpoint takes a link or a written
    text from anybody, and a permission class cannot see which of the three a version carries.
    """

    def setUp(self):
        super().setUp()
        self.verified = make_user('submit-verified', is_verified_contributor=True)

    def _set_flag(self, enabled):
        FeatureFlag.objects.update_or_create(
            key='material_uploads_verified_only', defaults={'is_enabled': enabled}
        )

    def test_flag_defaults_to_off_and_a_plain_user_can_upload(self):
        # No explicit _set_flag call — this is the real, migration-seeded default (0011), not a
        # value this test itself sets up, so it doubles as a regression test for that seed.
        self.client.force_authenticate(self.student)
        self.assertEqual(self.submit().status_code, status.HTTP_201_CREATED)

    def test_when_enabled_a_plain_user_is_blocked(self):
        self._set_flag(True)
        self.client.force_authenticate(self.student)
        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('file', response.data)
        self.assertEqual(MaterialProject.objects.count(), 0)

    def test_when_enabled_a_verified_contributor_can_still_upload(self):
        self._set_flag(True)
        self.client.force_authenticate(self.verified)
        self.assertEqual(self.submit().status_code, status.HTTP_201_CREATED)

    def test_when_enabled_a_moderator_can_still_upload(self):
        self._set_flag(True)
        self.client.force_authenticate(self.moderator)
        self.assertEqual(self.submit().status_code, status.HTTP_201_CREATED)

    def test_when_enabled_a_plain_user_can_still_send_a_link(self):
        """New, and the reason this is not a permission class: the restriction is about BYTES. A
        link costs no disk and is refused by nothing."""
        self._set_flag(True)
        self.client.force_authenticate(self.student)
        response = self.submit(kind='link', file=None, url='https://example.edu/lecture-9')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

    def test_when_enabled_a_plain_user_can_still_list_what_they_already_sent(self):
        # The restriction is scoped to the upload alone — confirmed by first submitting while the
        # flag is OFF (a real, pre-existing project), then turning it ON and re-checking that the
        # same, now-restricted user can still read it back.
        self.client.force_authenticate(self.student)
        self.submit(title='Uploaded before the restriction turned on')

        self._set_flag(True)
        response = self.client.get('/api/material-projects/?mine=1')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            {row['title'] for row in response.json()},
            {'Uploaded before the restriction turned on'},
        )

    def test_the_platform_wide_kill_switch_still_applies_independently(self):
        # material_submissions=False must still block EVERYONE, verified or not — a completely
        # separate, unrelated flag from material_uploads_verified_only.
        FeatureFlag.objects.update_or_create(
            key='material_submissions', defaults={'is_enabled': False}
        )
        self.client.force_authenticate(self.verified)
        self.assertEqual(self.submit().status_code, status.HTTP_403_FORBIDDEN)


class AutoPublishTests(SubmitPathBase):
    """Ported from `MaterialSubmissionAutoPublishTests` — who skips the queue.

    `access.can_autopublish_first` is the circle now (staff, a verified contributor, or the branch's
    governor), and the branch governor is new: the old fast path knew only about verified
    contributors, so that case gets its own test rather than being assumed from the shared helper.
    """

    def setUp(self):
        super().setUp()
        self.verified = make_user('submit-autopub-verified', is_verified_contributor=True)

    def test_a_verified_contributors_upload_publishes_immediately(self):
        self.client.force_authenticate(self.verified)
        response = self.submit(title='Autopublish candidate')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        body = response.json()
        self.assertEqual(body['head_version']['status'], 'published')
        self.assertIsNotNone(body['material_id'])
        material = Material.objects.get(pk=body['material_id'])
        self.assertTrue(material.published)
        self.assertEqual(material.branch_id, self.branch.pk)
        self.assertEqual(material.submitted_by_id, self.verified.pk)

    def test_nobody_is_recorded_as_having_reviewed_an_auto_published_upload(self):
        """Ported intent. The old row said so with `reviewed_by=None` plus a `review_note` reading
        "Auto-published — submitted by a verified contributor."; a version says it structurally, by
        carrying no decision at all — there was none. The note has no equivalent and none was
        invented (a decision note is what a DECIDER wrote)."""
        self.client.force_authenticate(self.verified)
        response = self.submit()

        version = MaterialVersion.objects.get(pk=self.head_id(response))
        self.assertEqual(version.status, 'published')
        self.assertIsNone(version.decided_by_id)
        self.assertIsNone(version.decided_at)
        self.assertEqual(version.decision_note, '')

    def test_a_branch_governor_publishes_their_first_version_immediately(self):
        governor = make_user('submit-autopub-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.branch.pk,
        )
        self.client.force_authenticate(governor)
        response = self.submit()

        self.assertEqual(response.json()['head_version']['status'], 'published')

    def test_a_non_verified_users_upload_still_queues(self):
        self.client.force_authenticate(self.student)
        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()['head_version']['status'], 'proposed')
        self.assertIsNone(response.json()['material_id'])
        self.assertFalse(Material.objects.exists())

    def test_a_disguised_executable_is_still_refused_even_for_a_verified_contributor(self):
        """The fast path skips the moderation QUEUE, never the safety checks that run before it —
        every one of them (content-type sniff, size cap, storage allowance, the malware scan)
        applies identically regardless of who is uploading."""
        self.client.force_authenticate(self.verified)
        response = self.submit(
            title='Autopublish candidate',
            file=SimpleUploadedFile(
                'totally_a_pdf.pdf',
                b'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00' + b'A' * 200,
            ),
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(MaterialVersion.objects.filter(title='Autopublish candidate').exists())
        self.assertFalse(Material.objects.exists())

    def test_a_proposed_material_type_longer_than_the_old_20_character_cap_is_accepted(self):
        """A real, found-live regression: `type` used to cap out at 20/32 characters — a leftover
        from when the vocabulary was a short, fixed `choices=` enum. A freely-typed proposed type's
        slug routinely exceeds either, and used to 400 with "no more than 20 characters" the first
        time a submission ever tried to use one (found by actually driving the "Other…" proposal
        flow end to end, not by reading the code)."""
        from materials.models import MaterialType

        long_slug = 'a-genuinely-long-proposed-material-type-name'  # 45 chars, over the old caps
        self.assertGreater(len(long_slug), 32)
        MaterialType.objects.create(slug=long_slug, status='pending', proposed_by=self.student)

        self.client.force_authenticate(self.verified)
        response = self.submit(type=long_slug)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.json()['type'], long_slug)


class FirstPublicationDecisionTests(SubmitPathBase):
    """Ported from `MaterialSubmissionApprovalTests` — approve/reject, through the endpoint that
    replaced `POST /api/moderation/material/{id}/{decision}/`.

    Decisions go to `POST /api/material-versions/{id}/decide/`, the SAME endpoint a project's own
    team uses for an ordinary proposal — never a fourth `_KIND_MODELS` kind, for the reason
    `moderation/CLAUDE.md` records about solution entries: one claim, one deciding circle, one
    notification sequence to keep correct rather than two that drift.
    """

    def _queued(self, **overrides):
        """One first publication waiting in the queue, submitted by an ordinary account."""
        self.client.force_authenticate(self.student)
        response = self.submit(**overrides)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return response.json()['id'], self.head_id(response)

    def test_accepting_a_first_publication_creates_a_real_published_material(self):
        project_id, version_id = self._queued()

        response = self.decide(version_id, 'accept')

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.json()['status'], 'published')
        project = MaterialProject.objects.get(pk=project_id)
        self.assertIsNotNone(project.material_id)
        material = project.material
        self.assertEqual(material.branch, self.branch)
        self.assertTrue(material.published)
        self.assertEqual(material.type, 'practice_test')
        translation = material.translations.get(locale='en')
        self.assertEqual(translation.title, 'A submitted practice test')
        # The SAME already-uploaded file, not a re-saved copy under a new path.
        version = MaterialVersion.objects.get(pk=version_id)
        self.assertEqual(material.file.name, version.file.name)

    def test_declared_author_and_source_url_carry_onto_the_published_material(self):
        """Provenance is only knowable by the uploader — a moderator cannot recover an author or an
        origin from a PDF's bytes. If it is captured at submission time but dropped on approval, the
        record is lost at exactly the moment it becomes public, so this pins the carry-over."""
        project_id, version_id = self._queued(
            author='dr hab. Anna Kowalska', source_url='https://example.edu/handout.pdf'
        )

        self.decide(version_id, 'accept')

        material = MaterialProject.objects.get(pk=project_id).material
        self.assertEqual(material.author, 'dr hab. Anna Kowalska')
        self.assertEqual(material.source_url, 'https://example.edu/handout.pdf')

    def test_one_declaring_neither_still_publishes_cleanly(self):
        """Both fields are deliberately optional — a scan of a paper handout has no URL, and forcing
        one would produce fabricated provenance, which is the opposite of the point."""
        project_id, version_id = self._queued()

        self.decide(version_id, 'accept')

        material = MaterialProject.objects.get(pk=project_id).material
        self.assertEqual(material.author, '')
        self.assertEqual(material.source_url, '')

    def test_the_moderation_queue_shows_provenance_to_the_reviewer(self):
        """Storing it is not enough: the decide call is where a provenance/copyright judgment
        actually gets made, so it has to reach the reviewer's queue. The row carries the project's
        catalogue because there is no `Material` to read it from yet."""
        self._queued(author='Prof. Jan Nowak', source_url='https://example.edu/handout.pdf')

        self.client.force_authenticate(self.moderator)
        queue = self.client.get(reverse('moderation-queue'))

        self.assertEqual(queue.status_code, status.HTTP_200_OK)
        row = next(r for r in queue.json()['material_versions'] if r['author'] == 'Prof. Jan Nowak')
        self.assertEqual(row['source_url'], 'https://example.edu/handout.pdf')
        self.assertTrue(row['is_first_publication'])
        self.assertTrue(row['file_url'])

    def test_accepting_records_a_real_clickable_submitted_by(self):
        """A real, found gap when this was the submission path: the resulting Material was built
        with NO attribution at all, so a community-submitted material had no clickable byline. The
        project's OWNER is that byline now — whose material this is, not who pressed accept."""
        project_id, version_id = self._queued()

        self.decide(version_id, 'accept')

        material = MaterialProject.objects.get(pk=project_id).material
        self.assertEqual(material.submitted_by, self.student)

    def test_requirements_price_and_estimate_carry_over(self):
        """The project's own `requirements` (a plain list[str] draft) becomes real, ORDERED
        `MaterialRequirement` rows only once published — there is no real Material row for them to
        attach to before that."""
        project_id, version_id = self._queued(
            requirements=json.dumps(['English B2+', 'basic algebra']),
            price_amount='29.99',
            price_currency='EUR',
            estimated_minutes='45',
        )

        self.decide(version_id, 'accept')

        material = MaterialProject.objects.get(pk=project_id).material
        self.assertEqual(str(material.price_amount), '29.99')
        self.assertEqual(material.price_currency, 'EUR')
        self.assertEqual(material.estimated_minutes, 45)
        labels = list(material.requirements.order_by('order').values_list('label', flat=True))
        self.assertEqual(labels, ['English B2+', 'basic algebra'])

    def test_coverage_becomes_real_material_coverage_rows(self):
        topic = make_topic(self.branch, 'submit-approval-topic')
        project_id, version_id = self._queued(
            coverage=json.dumps([{'topic_id': topic.pk, 'level': 60}])
        )

        self.decide(version_id, 'accept')

        material = MaterialProject.objects.get(pk=project_id).material
        rows = list(material.coverage.all())
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].topic_id, topic.pk)
        self.assertEqual(rows[0].level, 60)
        self.assertEqual(rows[0].proposed_by, self.student)

    def test_rejecting_never_creates_a_material(self):
        project_id, version_id = self._queued()

        response = self.decide(version_id, 'reject', note='Wrong branch.')

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.json()['status'], 'rejected')
        self.assertIsNone(MaterialProject.objects.get(pk=project_id).material_id)
        self.assertFalse(Material.objects.exists())

    def test_a_rejection_needs_a_note(self):
        """New beside the old path, which accepted an empty `review_note`: a refusal without a
        reason tells somebody who wanted to help nothing they can act on (house rule 6)."""
        _project_id, version_id = self._queued()

        response = self.decide(version_id, 'reject', note='   ')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()['detail'], 'note_required')
        self.assertEqual(MaterialVersion.objects.get(pk=version_id).status, 'proposed')

    def test_a_double_decision_returns_conflict(self):
        _project_id, version_id = self._queued()

        first = self.decide(version_id, 'accept')
        second = self.decide(version_id, 'accept')

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.json()['detail'], 'already_decided')

    def test_two_uploads_with_the_same_title_get_distinct_slugs(self):
        """`materials.publish.create_material`'s own slug-collision loop, reached through this
        path."""
        first_project, first_version = self._queued(title='Duplicate Title')
        cache.clear()
        second_project, second_version = self._queued(title='Duplicate Title')

        for version_id in (first_version, second_version):
            self.assertEqual(self.decide(version_id, 'accept').status_code, status.HTTP_200_OK)

        slugs = {
            MaterialProject.objects.get(pk=first_project).material.slug,
            MaterialProject.objects.get(pk=second_project).material.slug,
        }
        self.assertEqual(len(slugs), 2)

    def test_a_node_governor_with_no_authority_over_this_branch_cannot_decide(self):
        """Ported intent; the answer changed from 403 to 404 and that is the honest one: a governor
        of somebody else's branch cannot SEE a queued first publication at all
        (`access.can_view_version`), so "forbidden" would confirm it exists (house rule 4)."""
        other_branch = make_branch(slug='submit-approval-other-branch')
        governor = make_user('submit-approval-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=other_branch.pk,
        )
        _project_id, version_id = self._queued()

        response = self.decide(version_id, 'accept', user=governor)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(MaterialVersion.objects.get(pk=version_id).status, 'proposed')

    def test_the_branchs_own_governor_can_decide_it(self):
        """The other side of the same rule, which the old suite pinned in
        `ModerationActionScopingTests` for exercises and never for materials."""
        governor = make_user('submit-approval-own-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.branch.pk,
        )
        project_id, version_id = self._queued()

        response = self.decide(version_id, 'accept', user=governor)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIsNotNone(MaterialProject.objects.get(pk=project_id).material_id)


class StorageQuotaTests(SubmitPathBase):
    """Ported from `MaterialSubmissionStorageQuotaTests` — `Profile.material_upload_quota_bytes`,
    enforced on the real upload endpoint.

    The arithmetic itself is pinned in `accounts/tests.py`; what is under test here is the
    endpoint's own behaviour: what it accepts, what it refuses, and what it leaves on disk when it
    refuses.
    """

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.student)

    def _set_allowance(self, quota_bytes, user=None):
        profile = (user or self.student).profile
        profile.material_upload_quota_bytes = quota_bytes
        profile.save(update_fields=['material_upload_quota_bytes'])

    def _upload(self, size, *, title='A submitted practice test'):
        return self.submit(title=title, file=_pdf(size=size))

    def test_the_default_allowance_changes_nothing_for_anybody(self):
        """The whole point of defaulting to 0/uncapped: an account nobody has configured behaves
        exactly as it did before this field existed."""
        for i in range(3):
            self.assertEqual(
                self._upload(200_000, title=f'Upload {i}').status_code, status.HTTP_201_CREATED
            )

        self.assertIsNone(self.student.profile.material_upload_bytes_left)

    def test_an_upload_that_fits_is_accepted(self):
        self._set_allowance(50_000)

        self.assertEqual(self._upload(20_000).status_code, status.HTTP_201_CREATED)

    def test_an_upload_that_would_overrun_the_allowance_is_refused(self):
        self._set_allowance(30_000)
        self.assertEqual(self._upload(20_000, title='First').status_code, status.HTTP_201_CREATED)

        response = self._upload(20_000, title='Second')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('file', response.data)
        self.assertFalse(MaterialVersion.objects.filter(title='Second').exists())
        # …and no empty project either: the allowance is weighed before anything is created.
        self.assertEqual(MaterialProject.objects.count(), 1)

    def test_a_refused_upload_leaves_nothing_on_disk(self):
        """The check runs before the file is written. Refusing afterwards would mean storing bytes
        only to unlink them — the exact disk pressure the quota exists to prevent — and would orphan
        a real file if the unlink ever failed."""
        self._set_allowance(10_000)
        # A difference rather than an absolute count — see the note in `SubmitApiTests`: the
        # temporary `MEDIA_ROOT` outlives each test's database rollback.
        before = self.stored_file_count()

        response = self._upload(20_000)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.stored_file_count(), before)

    def test_the_incoming_file_is_weighed_too_not_only_what_is_already_stored(self):
        """An account sitting just under its allowance must refuse what would take it over rather
        than accepting it and going over silently — the boundary is where a quota is either right or
        off by one file."""
        self._set_allowance(10_000)

        self.assertEqual(
            self._upload(10_000, title='Exactly the allowance').status_code,
            status.HTTP_201_CREATED,
        )

        # Nothing is left, so even the smallest possible upload has to be refused now.
        self.assertEqual(
            self._upload(100, title='One more').status_code, status.HTTP_400_BAD_REQUEST
        )

    def test_one_accounts_uploads_do_not_spend_anothers_allowance(self):
        other = make_user('submit-quota-other')
        self._set_allowance(30_000)
        self._set_allowance(30_000, user=other)

        self.client.force_authenticate(other)
        self.assertEqual(
            self._upload(25_000, title="Other's").status_code, status.HTTP_201_CREATED
        )

        self.client.force_authenticate(self.student)
        self.assertEqual(self._upload(25_000, title='Mine').status_code, status.HTTP_201_CREATED)

    def test_rejecting_an_earlier_upload_gives_its_room_back(self):
        """The end-to-end consequence of reclaiming a rejected file: a moderator's rejection is what
        makes the allowance mean "what you are storing" rather than "what you have ever sent". Runs
        through the real endpoints on both halves rather than editing rows directly."""
        self._set_allowance(30_000)
        filled = self._upload(25_000, title='Filled it')
        self.assertEqual(filled.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._upload(25_000, title='Refused').status_code, status.HTTP_400_BAD_REQUEST)

        self.decide(self.head_id(filled), 'reject', note='Not this branch.')

        self.client.force_authenticate(self.student)
        self.assertEqual(
            self._upload(25_000, title='Room again').status_code, status.HTTP_201_CREATED
        )


class RejectedFileReclaimTests(SubmitPathBase):
    """Ported from `RejectedMaterialFileReclaimTests` — rejecting drops the blob and keeps the row.

    The tension this resolves is unchanged (`services.reclaim_version_file` carries the argument
    the old `_reclaim_rejected_material_file` made): the requirement forbids silent data loss on
    moderation, and what it is about is the RECORD — who sent what, when, and whether it was taken —
    while the disk is about the BYTES, which the record does not consist of. Both halves are pinned
    here, because a future change that quietly dropped either would look like a passing suite.
    """

    def _queued(self, size=4096, **overrides):
        self.client.force_authenticate(self.student)
        response = self.submit(file=_pdf(size=size), **overrides)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return MaterialVersion.objects.get(pk=self.head_id(response))

    def test_rejecting_removes_the_stored_bytes(self):
        version = self._queued()
        path = version.file.path
        self.assertTrue(os.path.exists(path))

        response = self.decide(version.pk, 'reject', note='Wrong branch.')

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(os.path.exists(path))
        version.refresh_from_db()
        self.assertFalse(version.file)

    def test_rejecting_keeps_the_row_and_everything_that_says_what_was_rejected(self):
        """The blob is not the record — the title, the description, the declared provenance, the
        recorded scan outcome, the reviewer and the note are."""
        version = self._queued(
            author='dr hab. Anna Kowalska',
            source_url='https://example.edu/handout.pdf',
            requirements=json.dumps(['English B2+']),
        )

        self.decide(version.pk, 'reject', note='Copyright unclear.')

        kept = MaterialVersion.objects.get(pk=version.pk)
        project = kept.project
        self.assertEqual(kept.status, 'rejected')
        self.assertEqual(kept.title, 'A submitted practice test')
        self.assertEqual(kept.description, 'Real practice problems.')
        self.assertEqual(kept.decision_note, 'Copyright unclear.')
        self.assertEqual(kept.decided_by, self.moderator)
        self.assertEqual(kept.created_by, self.student)
        self.assertEqual(project.author, 'dr hab. Anna Kowalska')
        self.assertEqual(project.source_url, 'https://example.edu/handout.pdf')
        self.assertEqual(project.requirements, ['English B2+'])

    def test_the_reclaim_is_recorded_rather_than_left_looking_like_a_file_that_never_existed(self):
        """Without these two a reclaimed row is indistinguishable from one that never had a file,
        and "where did the PDF go?" has no answer anywhere. The size in particular survives nowhere
        else once the bytes are gone."""
        version = self._queued(size=7000)

        self.decide(version.pk, 'reject', note='No.')

        version.refresh_from_db()
        self.assertIsNotNone(version.file_reclaimed_at)
        self.assertEqual(version.file_size, 7000)

    def test_the_rejection_response_says_the_file_was_reclaimed(self):
        """Ported intent: the old body carried `file_reclaimed_at`/`reclaimed_file_bytes` on the
        submission; the version's own `file_reclaimed_at` (added to the full serializer for exactly
        this) plus `file_size` and an emptied `file_url` say it now. The moderator who just clicked
        Reject is handed this body, and a file that has silently become null with nothing to explain
        it reads as a bug rather than as the intended outcome."""
        version = self._queued(size=5000)

        response = self.decide(version.pk, 'reject', note='No.')

        body = response.json()
        self.assertIsNotNone(body['file_reclaimed_at'])
        self.assertEqual(body['file_size'], 5000)
        self.assertEqual(body['file_url'], '')

    def test_accepting_leaves_the_file_completely_alone(self):
        """The published `Material` is handed the SAME stored path, so reclaiming on acceptance
        would delete a live material's file out from under it."""
        version = self._queued()
        path = version.file.path

        response = self.decide(version.pk, 'accept')

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        version.refresh_from_db()
        self.assertTrue(os.path.exists(path))
        self.assertIsNone(version.file_reclaimed_at)
        self.assertEqual(version.project.material.file.name, version.file.name)

    def test_the_reclaim_refuses_to_touch_a_version_that_became_a_material(self):
        """The status guard that makes the accepted path safe even if something calls the reclaim
        directly — the same guarantee the old code's `resulting_material` check gave."""
        from coauthoring import services

        version = self._queued()
        self.decide(version.pk, 'accept')
        version.refresh_from_db()
        path = version.file.path

        services.reclaim_version_file(version)

        version.refresh_from_db()
        self.assertTrue(os.path.exists(path))
        self.assertTrue(version.file)
        self.assertIsNone(version.file_reclaimed_at)

    def test_rejecting_an_exercise_submission_is_untouched_by_any_of_this(self):
        """The shared moderation action lost its `material` kind and kept every other one. Both
        halves are asserted here because the old test's whole point was that removing material
        handling must not disturb the three kinds beside it."""
        from moderation.models import ExerciseSubmission

        exercise_submission = ExerciseSubmission.objects.create(
            branch=self.branch,
            submitted_by=self.student,
            payload={'title': 'A submitted exercise', 'statement': 'Prove it.'},
        )

        self.client.force_authenticate(self.moderator)
        response = self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'submission', 'pk': exercise_submission.pk, 'decision': 'reject'},
            ),
            {'review_note': 'Duplicate.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        exercise_submission.refresh_from_db()
        self.assertEqual(exercise_submission.status, 'rejected')


class SubmitThrottleTests(_TempMediaRoot, ThrottleTestCase):
    """Ported from `MaterialSubmissionThrottleTests` — the `material_submission` scope, which now
    sits on `POST /api/material-projects/`.

    The budget deliberately did not change with the endpoint: it bounds the ability ("bring a NEW
    material into being"), and a rename that reset somebody's allowance would be a bug. Saving a
    FURTHER version keeps its own looser `material_version` scope, which the last test pins — two
    budgets, because editing what you already sent is not sending another one.

    Inherits `accounts/test_throttling.py`'s base rather than repeating its setup, because that
    class encodes a trap this codebase found the hard way: `SimpleRateThrottle` binds
    `THROTTLE_RATES` as a CLASS attribute at import time, so `override_settings` genuinely does not
    reach it.
    """

    databases = set(all_log_shards()) | {'default'}
    RATES = {'material_submission': '2/hour', 'material_version': '20/hour'}

    def setUp(self):
        super().setUp()
        self.branch = make_branch(slug='submit-throttle-branch')
        self.student = make_user('submit-throttle-student')
        self.client.force_authenticate(self.student)

    def _submit(self, title='Throttled upload'):
        return self.client.post(
            '/api/material-projects/',
            {
                'branch': self.branch.slug,
                'type': 'practice_test',
                'title': title,
                'locale': 'en',
                'kind': 'file',
                'file': _pdf(size=2000),
            },
            format='multipart',
        )

    def test_repeated_uploads_are_eventually_throttled(self):
        for i in range(2):
            self.assertEqual(
                self._submit(title=f'Upload {i}').status_code,
                status.HTTP_201_CREATED,
                msg=f'upload {i + 1} should still be allowed through',
            )

        self.assertEqual(self._submit().status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_reading_back_what_you_sent_is_not_spent_by_the_upload_budget(self):
        """The scope is on the write alone: listing what you have already sent is an ordinary cheap
        GET, and having it share a budget with 25MB writes would throttle reading for no reason —
        including, at exactly the wrong moment, the read that would show somebody what they had
        already uploaded."""
        for i in range(3):
            self._submit(title=f'Upload {i}')
        # The upload budget really is spent by this point, or the rest proves nothing.
        self.assertEqual(self._submit().status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        for _ in range(4):
            response = self.client.get('/api/material-projects/?mine=1')
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.assertEqual(len(response.json()), 2)

    def test_saving_a_further_version_spends_the_other_budget(self):
        """Two scopes, not one: the create budget is exhausted here and a second version on an
        existing project still saves."""
        created = self._submit(title='First')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self._submit(title='Second')
        self.assertEqual(self._submit(title='Third').status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        project_id = created.json()['id']
        head_id = created.json()['head_version']['id']
        response = self.client.post(
            f'/api/material-projects/{project_id}/versions/',
            {'kind': 'body', 'title': 'A second version', 'body': 'Text.', 'based_on': head_id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)


def _material_image_bytes(width=3600, height=1800, fmt='JPEG', exif=None):
    """A real, encoded image, patterned and non-square so a working resize can be told from a no-op
    and a rotation from a crop. A fixture that silently carried no EXIF would pass the strip
    assertions for free."""
    import io as _io

    from PIL import Image as _Image

    image = _Image.new('RGB', (width, height), (30, 120, 200))
    for x in range(0, width, 60):
        for y in range(0, height, 60):
            image.paste((240, 200, 40), (x, y, x + 30, y + 30))
    buffer = _io.BytesIO()
    image.save(buffer, fmt, **({'exif': exif} if exif is not None else {}))
    return buffer.getvalue()


def _phone_exif():
    """What a phone actually writes — including the GPS fix that is the reason for all this."""
    from PIL import Image as _Image

    exif = _Image.Exif()
    exif[0x010F] = 'ACME Phone'
    exif[0x0132] = '2026:03:14 09:41:00'
    gps = exif.get_ifd(0x8825)
    gps[1] = 'N'
    gps[2] = (52.0, 13.0, 0.0)
    gps[3] = 'E'
    gps[4] = (21.0, 1.0, 0.0)
    return exif


class SubmittedImageTests(SubmitPathBase):
    """Ported from `MaterialSubmissionImageTests` — a material publishes through a PUBLIC endpoint,
    so a phone photo sent as one used to put the coordinates of the room it was taken in in front of
    the whole site.

    Every assertion is on the STORED file rather than on the response, because the response was
    always fine — the leak was in the bytes on disk.
    """

    def _submit_image(self, filename, content):
        self.client.force_authenticate(self.student)
        return self.submit(title='A photographed page', file=SimpleUploadedFile(filename, content))

    def _stored(self, response):
        return MaterialVersion.objects.get(pk=self.head_id(response)).file

    def test_a_photo_loses_its_exif_and_its_gps(self):
        from PIL import Image

        original = _material_image_bytes(exif=_phone_exif())
        self.assertIn(b'ACME Phone', original, 'the fixture must really carry what we strip')

        response = self._submit_image('board.jpg', original)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        with Image.open(self._stored(response).path) as stored:
            self.assertEqual(dict(stored.getexif()), {})
            self.assertEqual(dict(stored.getexif().get_ifd(0x8825)), {})

    def test_the_stored_bytes_are_not_the_uploaded_bytes(self):
        original = _material_image_bytes(exif=_phone_exif())

        response = self._submit_image('board.jpg', original)

        with open(self._stored(response).path, 'rb') as handle:
            self.assertNotEqual(handle.read(), original)

    def test_it_keeps_its_shape_rather_than_being_cropped_square(self):
        """A material image is a scan of a page: centre-cropping takes the ends off exactly the
        content that runs to the edges."""
        from PIL import Image

        response = self._submit_image('board.jpg', _material_image_bytes(3600, 1800))

        with Image.open(self._stored(response).path) as stored:
            self.assertEqual(stored.width, 2 * stored.height)

    def test_a_large_scan_is_bounded(self):
        from PIL import Image

        response = self._submit_image('board.jpg', _material_image_bytes(3600, 1800))

        with Image.open(self._stored(response).path) as stored:
            self.assertLessEqual(max(stored.size), 2400)

    def test_a_small_scan_is_not_blown_up(self):
        """Upscaling would add bytes and invent detail the source never had."""
        from PIL import Image

        response = self._submit_image('board.png', _material_image_bytes(800, 600, fmt='PNG'))

        with Image.open(self._stored(response).path) as stored:
            self.assertEqual(stored.size, (800, 600))

    def test_a_pdf_is_stored_byte_for_byte(self):
        """The half of the old promise that is kept: for a document the bytes ARE the thing, and
        rewriting them would corrupt the file while claiming to clean it."""
        original = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

        response = self._submit_image('paper.pdf', original)

        with open(self._stored(response).path, 'rb') as handle:
            self.assertEqual(handle.read(), original)

    def test_a_published_material_carries_the_cleaned_file(self):
        """The strip happens on the way in, and publication points the real Material at that same
        stored file — so the published one is clean without a second pass."""
        from PIL import Image

        response = self._submit_image('board.jpg', _material_image_bytes(exif=_phone_exif()))
        decision = self.decide(self.head_id(response), 'accept')
        self.assertEqual(decision.status_code, status.HTTP_200_OK, decision.data)

        project = MaterialProject.objects.get(pk=response.json()['id'])
        with Image.open(project.material.file.path) as published:
            self.assertEqual(dict(published.getexif()), {})


class LinkOnlyMaterialTests(SubmitPathBase):
    """Ported from `LinkOnlyMaterialTests` — a material can be a LINK: a recording, a department
    page, somebody's published notes.

    Requiring an upload meant either losing those or re-hosting somebody else's work just to point
    at it. The rule is one payload or another, and the thing to pin is that "neither" is still
    refused: a title pointing at nothing is not a material.
    """

    def _submit_link(self, **overrides):
        self.client.force_authenticate(self.student)
        return self.submit(kind='link', file=None, title='A linked recording', **overrides)

    def test_a_link_alone_is_accepted(self):
        response = self._submit_link(url='https://example.edu/lecture-3')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        head = response.json()['head_version']
        self.assertEqual(head['url'], 'https://example.edu/lecture-3')
        self.assertFalse(head['file_url'])
        self.assertEqual(head['kind'], 'link')

    def test_a_file_alone_is_still_accepted(self):
        """The path that existed before this, unchanged."""
        self.client.force_authenticate(self.student)
        self.assertEqual(self.submit().status_code, status.HTTP_201_CREATED)

    def test_neither_is_refused_and_says_so(self):
        self.client.force_authenticate(self.student)
        response = self.submit(kind=None, file=None)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('file', response.data)

    def test_a_link_costs_no_quota(self):
        """It occupies no disk, so it cannot be what fills an account's byte cap. Falls out of
        `material_upload_bytes` skipping a row with no file, rather than needing its own rule."""
        self._submit_link(url='https://example.edu/lecture-4')

        self.assertEqual(self.student.profile.material_upload_bytes, 0)

    def test_publishing_one_produces_a_material_that_is_the_link(self):
        submitted = self._submit_link(url='https://example.edu/lecture-5')

        decision = self.decide(self.head_id(submitted), 'accept')

        self.assertEqual(decision.status_code, status.HTTP_200_OK, decision.data)
        material = MaterialProject.objects.get(pk=submitted.json()['id']).material
        self.assertEqual(material.url, 'https://example.edu/lecture-5')
        self.assertFalse(material.file)

    def test_the_model_refuses_a_material_with_neither(self):
        """On the model too, so the Django admin — the one write path that skips DRF — is held to
        the same rule."""
        from django.core.exceptions import ValidationError as DjangoValidationError

        material = Material(branch=self.branch, slug='nothing-at-all', type='practice_test')

        with self.assertRaises(DjangoValidationError):
            material.full_clean()

    def test_a_link_material_is_readable_over_the_api(self):
        submitted = self._submit_link(url='https://example.edu/lecture-6')
        self.decide(self.head_id(submitted), 'accept')
        material = MaterialProject.objects.get(pk=submitted.json()['id']).material

        self.client.force_authenticate(None)
        response = self.client.get(f'/api/materials/{material.pk}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['url'], 'https://example.edu/lecture-6')


class TwoSwitchesTests(SubmitPathBase):
    """Not a port: the two kill switches answer PER PROJECT now.

    `material_submissions` gates bringing a new material into being — creating a project, publishing
    its first version, and deciding that first version — while `coauthoring` gates everything that
    happens on a material that already exists. Which one applies is `access.governing_switch`, asked
    of the version in front of the endpoint rather than baked into it, because with collaboration
    switched off somebody must still be able to send a new material and a moderator must still be
    able to accept it. Staff bypass both, as `feature_gate` always has.
    """

    def _kill(self, key):
        FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': False})

    def test_with_coauthoring_off_a_new_material_still_goes_through_end_to_end(self):
        self._kill('coauthoring')
        self.client.force_authenticate(self.student)

        created = self.submit()
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        self.assertEqual(created.json()['head_version']['status'], 'proposed')

        decided = self.decide(self.head_id(created), 'accept')
        self.assertEqual(decided.status_code, status.HTTP_200_OK, decided.data)

        material = MaterialProject.objects.get(pk=created.json()['id']).material
        self.assertIsNotNone(material)
        # …and the material is as public as any other, which is the whole reason the projection
        # exists: a killed collaboration switch can never hide content.
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(f'/api/materials/{material.pk}/').status_code, status.HTTP_200_OK
        )

    def test_with_coauthoring_off_a_branch_governor_can_still_accept_one(self):
        """The half a staff bypass would have hidden: a governor is not staff, and accepting a first
        publication is the ability `material_submissions` governs, not `coauthoring`."""
        governor = make_user('submit-switch-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.branch.pk,
        )
        self.client.force_authenticate(self.student)
        created = self.submit()
        self._kill('coauthoring')

        decided = self.decide(self.head_id(created), 'accept', user=governor)

        self.assertEqual(decided.status_code, status.HTTP_200_OK, decided.data)

    def test_with_material_submissions_off_creating_is_refused(self):
        self._kill('material_submissions')
        self.client.force_authenticate(self.student)

        response = self.submit()

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            response.json()['detail'], 'This feature is currently disabled by a moderator.'
        )

    def test_with_material_submissions_off_publishing_a_first_version_is_refused(self):
        """The same ability by another route: a draft project already exists, and publishing it is
        still bringing a new material into being."""
        self.client.force_authenticate(self.student)
        created = self.submit(publish=None)
        version_id = self.head_id(created)
        self._kill('material_submissions')

        response = self.client.post(f'/api/material-versions/{version_id}/publish/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            response.json()['detail'], 'This feature is currently disabled by a moderator.'
        )
        self.assertEqual(MaterialVersion.objects.get(pk=version_id).status, 'draft')

    def test_with_material_submissions_off_a_governor_cannot_decide_but_staff_can(self):
        governor = make_user('submit-switch-governor-2')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.branch.pk,
        )
        self.client.force_authenticate(self.student)
        created = self.submit()
        version_id = self.head_id(created)
        self._kill('material_submissions')

        refused = self.decide(version_id, 'accept', user=governor)
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)

        allowed = self.decide(version_id, 'accept')
        self.assertEqual(allowed.status_code, status.HTTP_200_OK, allowed.data)

    def test_with_material_submissions_off_a_later_version_still_publishes(self):
        """The other side of two switches: once the material exists, publishing answers to
        `coauthoring`, which is still on."""
        verified = make_user('submit-switch-verified', is_verified_contributor=True)
        self.client.force_authenticate(verified)
        created = self.submit()
        project_id = created.json()['id']
        self.assertIsNotNone(created.json()['material_id'])
        self._kill('material_submissions')

        second = self.client.post(
            f'/api/material-projects/{project_id}/versions/',
            {
                'kind': 'body',
                'title': 'A better one',
                'body': 'Text.',
                'based_on': self.head_id(created),
            },
            format='json',
        )
        self.assertEqual(second.status_code, status.HTTP_201_CREATED, second.data)
        published = self.client.post(
            f"/api/material-versions/{second.json()['id']}/publish/", {}, format='json'
        )

        self.assertEqual(published.status_code, status.HTTP_200_OK, published.data)
        self.assertEqual(published.json()['status'], 'published')

    def test_can_publish_is_false_when_the_switch_that_governs_it_is_off(self):
        """`can_publish` reads the same three rules the action enforces, so a button is never drawn
        for a publish the server would refuse."""
        self.client.force_authenticate(self.student)
        created = self.submit(publish=None)
        version_id = self.head_id(created)
        self.assertTrue(self.client.get(f'/api/material-versions/{version_id}/').json()['can_publish'])

        self._kill('material_submissions')

        self.assertFalse(
            self.client.get(f'/api/material-versions/{version_id}/').json()['can_publish']
        )


class RetiredSurfaceTests(SubmitPathBase):
    """Not a port either: what must no longer exist.

    A retirement that leaves its endpoint answering, its queue section rendering or its moderation
    kind decidable has not retired anything — it has made two paths where the point was to have one.
    """

    def test_the_material_submissions_route_is_gone(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(
            self.client.get('/api/material-submissions/').status_code, status.HTTP_404_NOT_FOUND
        )
        with self.assertRaises(NoReverseMatch):
            reverse('material-submission-list')

    def test_the_shared_moderation_action_has_no_material_kind(self):
        from moderation.views import _KIND_MODELS

        self.assertNotIn('material', _KIND_MODELS)
        self.client.force_authenticate(self.moderator)
        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'material', 'pk': 1, 'decision': 'approve'}),
            {},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_queue_payload_and_count_lost_their_material_submissions_section(self):
        from moderation.services import build_moderation_queue_payload, count_pending_moderation

        self.client.force_authenticate(self.student)
        self.submit()

        payload = build_moderation_queue_payload(user=self.moderator)
        counts = count_pending_moderation(user=self.moderator)

        self.assertNotIn('material_submissions', payload)
        self.assertNotIn('material_submissions', counts)
        # …and the one section that answers the same question carries the row instead.
        self.assertEqual(len(payload['material_versions']), 1)
        self.assertEqual(counts['material_versions'], 1)
        self.assertEqual(counts['total'], sum(v for k, v in counts.items() if k != 'total'))

    def test_the_model_is_gone_from_the_moderation_app(self):
        from django.apps import apps

        with self.assertRaises(LookupError):
            apps.get_model('moderation', 'MaterialSubmission')

    def test_the_upload_path_helper_survives_for_the_migration_history(self):
        """`moderation/0005` and `0021` import it by dotted path. Deleting it would make the
        historical chain unimportable on a fresh database."""
        from moderation.models import material_submission_upload_path

        self.assertTrue(
            material_submission_upload_path(None, 'x.pdf').startswith('material_submissions/')
        )


class MaterialTypeMergeTests(SubmitPathBase):
    """Merging a duplicate material type re-points what is filed under it — including a project that
    has not published yet.

    Ported behaviour rather than new: `TaxonomyProposalActionView._move_content` rewrote
    `Material.type` AND `MaterialSubmission.type`, because a queued upload filed under a
    merged-away slug would otherwise produce a material naming a type nobody can look up. A draft
    project is where that value lives now (`MaterialProject.type`, read until the first publication
    writes it onto the real row), so that is what the merge follows.
    """

    def test_a_merge_re_points_a_draft_project_filed_under_the_old_slug(self):
        from materials.models import MaterialType

        proposed = MaterialType.objects.create(
            slug='skrypt-kursu', status='pending', proposed_by=self.student
        )
        self.client.force_authenticate(self.student)
        created = self.submit(type='skrypt-kursu')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)

        self.client.force_authenticate(self.moderator)
        merged = self.client.post(
            reverse('moderation-taxonomy-action', kwargs={'kind': 'material_type', 'pk': proposed.pk}),
            {'decision': 'merge', 'target': 'script'},
            format='json',
        )

        self.assertEqual(merged.status_code, status.HTTP_200_OK, merged.data)
        self.assertEqual(MaterialProject.objects.get(pk=created.json()['id']).type, 'script')


class FoldMigrationTests(_TempMediaRoot, TransactionTestCase):
    """`coauthoring/0003_fold_material_submissions`, run for real against historical models.

    A `TransactionTestCase` because there is no other way: the fold reads a table that
    `moderation/0038` drops, so the test has to migrate the database backwards, write submission
    rows through the historical model, and migrate forwards again — and `schema_editor` refuses to
    run inside the transaction an ordinary `TestCase` wraps every test in (SQLite cannot alter a
    schema with foreign-key checks on inside one). Django's runner puts every `TransactionTestCase`
    last for the reason that matters here: this flushes the database afterwards, including rows the
    data migrations seeded.

    What is pinned: the four statuses map where they should, nothing is re-uploaded, a minor gets no
    owner row, an approved submission teaches its material's existing version 1 rather than making a
    second project, and running the whole thing twice changes nothing.
    """

    databases = {'default'}

    before = [('coauthoring', '0002_backfill_projects'), ('moderation', '0037_seed_coauthoring_flag')]
    fold_target = [('coauthoring', '0003_fold_material_submissions')]

    def setUp(self):
        executor = MigrationExecutor(connection)
        executor.migrate(self.before)
        executor.loader.build_graph()
        self.historical = executor.loader.project_state(self.before).apps
        self.branch = make_branch(slug='fold-branch')
        self.sender = make_user('fold-sender')
        self.reviewer = make_user('fold-reviewer', is_staff=True)

    def tearDown(self):
        # Put the database back where the rest of the suite expects it, BEFORE the flush that
        # `TransactionTestCase` runs afterwards.
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    # --- helpers ---------------------------------------------------------------------------------

    def _submission(self, **overrides):
        MaterialSubmission = self.historical.get_model('moderation', 'MaterialSubmission')
        defaults = {
            'branch_id': self.branch.pk,
            'submitted_by_id': self.sender.pk,
            'type': 'exam_collection',
            'title': 'A submitted exam collection',
            'description': 'Three past exams.',
            'locale': 'en',
            'audience': 'university',
            'file': SimpleUploadedFile('exams.pdf', pdf_bytes(4096)),
            'scan_status': 'skipped',
            'scan_detail': 'No ClamAV daemon reachable.',
        }
        defaults.update(overrides)
        return MaterialSubmission.objects.create(**defaults)

    def _run_fold(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(self.fold_target)

    def _fold_again(self):
        """The migration's own function, called a second time — the honest way to test idempotency,
        since Django will not re-apply a migration it has recorded."""
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        state = executor.loader.project_state(self.fold_target[0]).apps
        importlib.import_module('coauthoring.migrations.0003_fold_material_submissions').fold(
            state, None
        )

    # --- the tests -------------------------------------------------------------------------------

    def test_each_status_becomes_the_right_row(self):
        pending = self._submission(title='Still waiting', status='pending')
        rejected = self._submission(
            title='Turned down',
            status='rejected',
            reviewed_by_id=self.reviewer.pk,
            review_note='Copyright unclear.',
        )
        pending_name = pending.file.name
        rejected_name = rejected.file.name

        self._run_fold()

        waiting = MaterialVersion.objects.get(title='Still waiting')
        self.assertEqual(waiting.status, 'proposed')
        self.assertEqual(waiting.number, 1)
        self.assertEqual(waiting.kind, 'file')
        # The SAME stored name, never a second copy of the bytes — and still under the directory the
        # submission wrote it to, which `version_upload_path` records as expected.
        self.assertEqual(waiting.file.name, pending_name)
        self.assertEqual(waiting.file_size, 4096)
        self.assertEqual(waiting.created_at, pending.created_at)
        self.assertEqual(waiting.scan_status, 'skipped')
        self.assertIsNone(waiting.project.material_id)
        self.assertEqual(waiting.project.type, 'exam_collection')
        self.assertEqual(waiting.project.locale, 'en')
        self.assertEqual(
            [(m.user_id, m.role) for m in waiting.project.members.all()],
            [(self.sender.pk, 'owner')],
        )

        refused = MaterialVersion.objects.get(title='Turned down')
        self.assertEqual(refused.status, 'rejected')
        self.assertEqual(refused.decided_by_id, self.reviewer.pk)
        self.assertEqual(refused.decision_note, 'Copyright unclear.')
        self.assertEqual(refused.file.name, rejected_name)

    def test_a_rejected_submission_whose_blob_was_already_reclaimed_keeps_the_stamp(self):
        from django.utils import timezone

        when = timezone.now()
        self._submission(
            title='Reclaimed already',
            status='rejected',
            file='',
            file_reclaimed_at=when,
            reclaimed_file_bytes=9000,
            reviewed_by_id=self.reviewer.pk,
            review_note='No.',
        )

        self._run_fold()

        version = MaterialVersion.objects.get(title='Reclaimed already')
        self.assertEqual(version.status, 'rejected')
        self.assertFalse(version.file)
        self.assertEqual(version.file_reclaimed_at, when)
        # The size survives nowhere else once the bytes are gone, and the kind still says a file is
        # what was sent.
        self.assertEqual(version.file_size, 9000)
        self.assertEqual(version.kind, 'file')
        self.assertEqual(version.decided_at, when)

    def test_an_approved_submission_teaches_its_materials_existing_version_one(self):
        """No second project: the material already has one from the backfill, and what the backfill
        could not know — who approved it, what they said, what the scanner found — lands on its
        version 1."""
        from testing.factories import make_material

        material = make_material(self.branch, slug='fold-approved-material', title='Approved thing')
        material.submitted_by = self.sender
        material.save(update_fields=['submitted_by'])
        submission = self._submission(
            title='Approved thing',
            status='approved',
            resulting_material_id=material.pk,
            reviewed_by_id=self.reviewer.pk,
            review_note='Looks right.',
            scan_status='clean',
            scan_detail='Scanned by a real daemon.',
        )

        self._run_fold()

        projects = MaterialProject.objects.filter(material=material)
        self.assertEqual(projects.count(), 1)
        version = projects.get().versions.get(number=1)
        self.assertEqual(version.status, 'published')
        self.assertEqual(version.decided_by_id, self.reviewer.pk)
        self.assertEqual(version.decision_note, 'Looks right.')
        self.assertEqual(version.scan_status, 'clean')
        self.assertEqual(version.scan_detail, 'Scanned by a real daemon.')
        self.assertEqual(version.created_by_id, self.sender.pk)
        self.assertEqual(version.created_at, submission.created_at)
        self.assertEqual(version.decided_at, material.created_at)
        # Nothing was created for it.
        self.assertEqual(MaterialProject.objects.filter(material__isnull=True).count(), 0)

    def test_an_approved_submission_whose_material_is_gone_is_skipped(self):
        self._submission(title='Its material was deleted', status='approved', resulting_material_id=None)

        self._run_fold()

        self.assertFalse(MaterialVersion.objects.filter(title='Its material was deleted').exists())
        self.assertFalse(MaterialProject.objects.exists())

    def test_a_minor_gets_a_project_but_never_an_owner_row(self):
        """A minor may propose and may not own (COAUTHORING-BRIEF.md §0), and the retired form never
        asked. Their submission is still preserved in full, with `created_by` naming them so the
        byline stays theirs when a moderator accepts it."""
        child = make_user('fold-minor')
        child.profile.is_minor = True
        child.profile.save(update_fields=['is_minor'])
        self._submission(title="A minor's upload", status='pending', submitted_by_id=child.pk)

        self._run_fold()

        version = MaterialVersion.objects.get(title="A minor's upload")
        self.assertEqual(version.created_by_id, child.pk)
        self.assertEqual(version.project.created_by_id, child.pk)
        self.assertEqual(version.project.members.count(), 0)
        self.assertEqual(ProjectMember.objects.filter(user=child).count(), 0)

    def test_running_it_twice_changes_nothing(self):
        self._submission(title='Still waiting', status='pending')
        self._submission(
            title='Turned down', status='rejected', reviewed_by_id=self.reviewer.pk, review_note='No.'
        )

        self._run_fold()
        before = (MaterialProject.objects.count(), MaterialVersion.objects.count(), ProjectMember.objects.count())
        self._fold_again()

        self.assertEqual(
            (MaterialProject.objects.count(), MaterialVersion.objects.count(), ProjectMember.objects.count()),
            before,
        )

    def test_a_material_with_no_project_gets_one_before_an_approved_row_is_read(self):
        """A material approved through the old path AFTER the backfill ran never got a project —
        a real window on any environment that deployed the two phases separately. The fold re-runs
        the backfill first rather than skipping such a row or crashing on it."""
        from testing.factories import make_material

        orphan = make_material(self.branch, slug='fold-orphan', title='No project yet')
        self.assertFalse(MaterialProject.objects.filter(material=orphan).exists())
        self._submission(
            title='No project yet',
            status='approved',
            resulting_material_id=orphan.pk,
            reviewed_by_id=self.reviewer.pk,
            review_note='Fine.',
        )

        self._run_fold()

        project = MaterialProject.objects.get(material=orphan)
        version = project.versions.get(number=1)
        self.assertEqual(version.status, 'published')
        self.assertEqual(version.decided_by_id, self.reviewer.pk)
