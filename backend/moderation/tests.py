"""This project's first real automated test suite (CLAUDE.md Section 17I's own "Left open" note —
`manage.py test` used to report `Found 0 test(s)` everywhere). Moderation gets the first and largest
share of coverage on purpose: it's where this project's own history of found-and-fixed real bugs
concentrates (the submission number-collision race, Section 17I; the translation-publish race and
the more severe, non-concurrent bug found alongside it, Section 17K) — exactly the kind of thing a
regression suite exists to lock in place, not just a convenient place to start.

Uses Django's own `TestCase` + DRF's `APIClient`, both already dependencies — no new package added,
matching this project's own "every runtime dependency is a flagged decision" discipline.
"""

import os
import shutil
import tempfile

from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

# The throttle base class lives in accounts/ because that is where this project first hit the
# class-attribute trap it encodes (see its own docstring); imported rather than copied, so a future
# correction to that setup reaches every throttle test at once.
from accounts.test_throttling import ThrottleTestCase
from community.models import Comment
from exercises.models import Exercise, ExerciseTranslation
from moderation.models import ContentView, FeatureFlag, NodeGovernor, Report
from moderation.services import governed_branch_ids, is_feature_enabled, is_governor_of_course
from taxonomy.models import Discipline
from testing.factories import (
    make_course,
    make_exercise,
    make_material,
    make_topic,
    make_user,
    make_viewer,
    pdf_bytes,
)


class TranslationApprovalTests(APITestCase):
    """Regression tests for CLAUDE.md Section 17K's fix. Each one mirrors a scenario that was
    reproduced LIVE (against a real, running server, or a direct ORM call) before this suite existed
    — see that section for the full story of why each one used to fail deterministically, not just
    under concurrency."""

    def setUp(self):
        self.moderator = make_user('mod', is_staff=True)
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        self.client.force_authenticate(self.moderator)

    def _approve_url(self, pk):
        return reverse('moderation-action', kwargs={'kind': 'translation', 'pk': pk, 'decision': 'approve'})

    def _reject_url(self, pk):
        return reverse('moderation-action', kwargs={'kind': 'translation', 'pk': pk, 'decision': 'reject'})

    def test_approving_a_translation_superseding_an_existing_published_one_succeeds(self):
        """The DETERMINISTIC bug: this used to 500 on the very first, ordinary, single-moderator
        approval — not just under concurrency — because the claim step flipped this row to
        'published' before the old one was deleted, colliding with the uniqueness constraint."""
        old = ExerciseTranslation.objects.create(
            exercise=self.exercise, locale='en', title='Old EN', statement='old', status='published'
        )
        new = ExerciseTranslation.objects.create(
            exercise=self.exercise, locale='en', title='New EN', statement='new', status='pending'
        )

        response = self.client.post(self._approve_url(new.pk), {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'published')
        self.assertFalse(ExerciseTranslation.objects.filter(pk=old.pk).exists())
        self.assertEqual(
            ExerciseTranslation.objects.get(pk=new.pk).status, 'published'
        )
        # Exactly one published row for this (exercise, locale) — the actual invariant this whole
        # fix exists to protect, not just "no exception was raised".
        self.assertEqual(
            ExerciseTranslation.objects.filter(
                exercise=self.exercise, locale='en', status='published'
            ).count(),
            1,
        )

    def test_two_pending_translations_for_the_same_new_locale_can_coexist(self):
        """Used to 500 at CREATE time — the old all-statuses unique_together blocked a second
        'pending' row for the same (exercise, locale), not just a second 'published' one."""
        a = ExerciseTranslation.objects.create(
            exercise=self.exercise, locale='de', title='A', statement='a', status='pending'
        )
        b = ExerciseTranslation.objects.create(
            exercise=self.exercise, locale='de', title='B', statement='b', status='pending'
        )
        self.assertTrue(ExerciseTranslation.objects.filter(pk__in=[a.pk, b.pk]).count() == 2)

    def test_rejecting_a_resubmission_after_an_earlier_rejection_succeeds(self):
        """Used to 500 — old rejected rows are never purged, and the old all-statuses constraint
        blocked a second 'rejected' row for the same locale just as much as a second 'published' or
        'pending' one."""
        ExerciseTranslation.objects.create(
            exercise=self.exercise, locale='uk', title='old', statement='x', status='rejected'
        )
        resubmission = ExerciseTranslation.objects.create(
            exercise=self.exercise, locale='uk', title='resub', statement='y', status='pending'
        )

        response = self.client.post(self._reject_url(resubmission.pk), {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(ExerciseTranslation.objects.get(pk=resubmission.pk).status, 'rejected')

    def test_double_decision_on_the_same_translation_returns_conflict(self):
        """The idempotency guard this fix had to preserve, not just the ordering fix — a second
        decision on an already-decided row must fail cleanly (409), never double-apply."""
        translation = ExerciseTranslation.objects.create(
            exercise=self.exercise, locale='es', title='Es', statement='es', status='pending'
        )
        first = self.client.post(self._approve_url(translation.pk), {}, format='json')
        second = self.client.post(self._approve_url(translation.pk), {}, format='json')

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(ExerciseTranslation.objects.get(pk=translation.pk).status, 'published')

    def test_non_moderator_cannot_approve_a_translation(self):
        translation = ExerciseTranslation.objects.create(
            exercise=self.exercise, locale='fr', title='Fr', statement='fr', status='pending'
        )
        self.client.force_authenticate(make_user('not-a-mod'))

        response = self.client.post(self._approve_url(translation.pk), {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(ExerciseTranslation.objects.get(pk=translation.pk).status, 'pending')


class SubmissionApprovalTests(APITestCase):
    """Regression coverage for the submission number-allocation race (CLAUDE.md Section 17I) and the
    idempotency guard both were built to fix."""

    def setUp(self):
        self.moderator = make_user('mod2', is_staff=True)
        self.student = make_user('student', is_verified_contributor=False)
        self.branch = make_course(slug='uw-submission-branch')
        self.client.force_authenticate(self.moderator)

    def _submit(self, **payload_overrides):
        from moderation.models import ExerciseSubmission

        payload = {
            'difficulty': 'easy',
            'locale': 'pl',
            'title': 'A submitted exercise',
            'statement': 'Prove something.',
            **payload_overrides,
        }
        return ExerciseSubmission.objects.create(
            branch=self.branch, submitted_by=self.student, payload=payload
        )

    def test_approving_a_submission_creates_a_real_exercise(self):
        submission = self._submit()

        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'approve'}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        self.assertEqual(submission.status, 'approved')
        self.assertIsNotNone(submission.resulting_exercise)
        exercise = submission.resulting_exercise
        self.assertEqual(exercise.branch, self.branch)
        translation = exercise.translations.get(locale='pl')
        self.assertEqual(translation.title, 'A submitted exercise')
        self.assertEqual(translation.status, 'published')

    def test_approving_a_submission_with_requirements_creates_real_exercise_requirement_rows(self):
        submission = self._submit(requirements=['basic algebra', 'epsilon-delta proofs'])

        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'approve'}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        exercise = submission.resulting_exercise
        self.assertEqual(
            list(exercise.requirements.order_by('order').values_list('label', flat=True)),
            ['basic algebra', 'epsilon-delta proofs'],
        )

    def test_submitting_an_exercise_with_duplicate_requirement_labels_is_rejected(self):
        self.client.force_authenticate(self.student)
        response = self.client.post(
            reverse('exercise-submission-list'),
            {
                'branch': self.branch.slug,
                'payload': {
                    'difficulty': 'easy',
                    'locale': 'pl',
                    'title': 'Dup requirements',
                    'statement': 'Prove something.',
                    'requirements': ['basic algebra', '  Basic Algebra  '],
                },
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_rejecting_a_submission_never_creates_an_exercise(self):
        submission = self._submit()

        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'reject'}),
            {'review_note': 'Not mathematically sound.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        self.assertEqual(submission.status, 'rejected')
        self.assertIsNone(submission.resulting_exercise)
        self.assertEqual(submission.review_note, 'Not mathematically sound.')
        self.assertEqual(Exercise.objects.filter(branch=self.branch).count(), 0)

    def test_double_decision_on_the_same_submission_returns_conflict(self):
        submission = self._submit()
        url = reverse(
            'moderation-action', kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'approve'}
        )

        first = self.client.post(url, {}, format='json')
        second = self.client.post(url, {}, format='json')

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(Exercise.objects.filter(branch=self.branch).count(), 1)

    def test_sequentially_approved_submissions_get_distinct_exercise_numbers(self):
        """A lighter-weight, single-threaded regression for the retry-loop fix (real concurrent
        reproduction already lives in CLAUDE.md Section 17I's own writeup) — confirms the everyday,
        non-concurrent path still allocates a clean, gapless sequence."""
        submissions = [self._submit(title=f'Submission {i}') for i in range(5)]
        numbers = []
        for submission in submissions:
            response = self.client.post(
                reverse(
                    'moderation-action',
                    kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'approve'},
                ),
                {},
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            submission.refresh_from_db()
            numbers.append(submission.resulting_exercise.number)

        self.assertEqual(len(numbers), len(set(numbers)), 'exercise numbers must all be distinct')


class _TempMediaRootMixin:
    """Redirects `MEDIA_ROOT` at a temporary directory for the whole class, and empties it after.

    **A real, pre-existing leak, not only a convenience for the new tests below.** Every class that
    posts a material upload stores genuine bytes, and none of them redirected `MEDIA_ROOT` — so
    running the suite wrote dozens of scratch PDFs into the live `backend/media/material_submissions/`
    tree, next to actual user uploads, and left them there. Found by listing that directory after a
    run rather than reasoned about, which is exactly how `accounts/test_throttling.py` records
    catching the identical mistake with avatars; the fix that landed there is applied here to every
    upload-storing class, not just the ones added alongside this mixin.

    It is also what makes the reclaim tests mean anything: "was the file actually deleted?" has to be
    asked of a directory the test owns, or it is a question about the deployment's media tree.
    """

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-material-test-')
        cls._media_override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._media_override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._media_override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def stored_file_count(self):
        submissions_dir = os.path.join(self._media_root, 'material_submissions')
        if not os.path.isdir(submissions_dir):
            return 0
        return len(os.listdir(submissions_dir))


class MaterialSubmissionValidatorTests(APITestCase):
    """`materials/validators.py`'s own content-type sniffing and size cap — "exams, tests, etc.
    should be accepted... but also scanned and kept safe." Each real-content-type case here was
    verified directly against `python-magic` before being trusted (see that module's own doc
    comment), not assumed from the library's docs; these are the permanent regression form of that
    same check."""

    def test_a_real_pdf_is_accepted(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import validate_material_submission_file

        f = SimpleUploadedFile('exam.pdf', b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
        validate_material_submission_file(f)  # must not raise

    def test_a_real_png_is_accepted(self):
        import base64

        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import validate_material_submission_file

        png = base64.b64decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY'
            '42YAAAAASUVORK5CYII='
        )
        f = SimpleUploadedFile('scan.png', png)
        validate_material_submission_file(f)  # must not raise

    def test_a_real_tex_file_is_accepted(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import validate_material_submission_file

        f = SimpleUploadedFile('notes.tex', rb'\documentclass{article}\begin{document}Hi\end{document}')
        validate_material_submission_file(f)  # must not raise

    def test_an_executable_disguised_as_a_pdf_is_rejected(self):
        from django.core.exceptions import ValidationError
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import validate_material_submission_file

        # A real Windows PE header ('MZ...'), padded well past the point python-magic needs to
        # positively identify it as an executable rather than falling back to a generic guess.
        f = SimpleUploadedFile(
            'totally_a_pdf.pdf',
            b'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00' + b'A' * 200,
        )
        with self.assertRaises(ValidationError):
            validate_material_submission_file(f)

    def test_an_oversized_file_is_rejected(self):
        from django.core.exceptions import ValidationError
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import MAX_MATERIAL_SUBMISSION_SIZE_BYTES, validate_material_submission_file

        f = SimpleUploadedFile('huge.pdf', b'%PDF-1.4' + b'0' * (MAX_MATERIAL_SUBMISSION_SIZE_BYTES + 1))
        with self.assertRaises(ValidationError):
            validate_material_submission_file(f)

    def test_a_disallowed_extension_is_rejected(self):
        from django.core.exceptions import ValidationError
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import validate_material_submission_file

        f = SimpleUploadedFile('script.sh', b'#!/bin/bash\necho hi')
        with self.assertRaises(ValidationError):
            validate_material_submission_file(f)

    def test_scan_for_malware_gracefully_degrades_with_no_daemon_reachable(self):
        """This project's own sandboxed dev environment has no ClamAV daemon at all (confirmed: no
        clamscan/clamdscan/freshclam binary anywhere, no root access to install one) — the honest,
        common outcome here is `scanned=False`, never silently upgraded to "clean" without also
        checking that flag, which is exactly why `scan_for_malware` returns a real dataclass instead
        of a bare bool."""
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import scan_for_malware

        f = SimpleUploadedFile('exam.pdf', b'%PDF-1.4 some content')
        outcome = scan_for_malware(f)
        self.assertFalse(outcome.scanned)
        self.assertTrue(outcome.clean)  # "couldn't check" defaults to not-blocking, see MATERIAL_SCAN_REQUIRED
        self.assertTrue(outcome.detail)


class MaterialSubmissionApiTests(_TempMediaRootMixin, APITestCase):
    """`POST /api/material-submissions/` — the real, multipart upload endpoint itself (as opposed
    to the validators it calls, covered above)."""

    def setUp(self):
        # Uploading is throttled per account now (`material_submission`, 20/hour, wired onto
        # `create` alone), and DRF counts through Django's cache — which, unlike the database, is
        # NOT rolled back between tests. SQLite hands out the same primary keys again after each
        # rollback, so every test in this class authenticates as the same numeric ident and would
        # otherwise share one budget across the whole class, eventually handing a later test a 429
        # that has nothing to do with what it is testing. Same trap accounts/test_throttling.py
        # documents, met from the other direction: by tests that never meant to involve throttling.
        cache.clear()
        self.branch = make_course(slug='uw-material-submission-branch')
        self.student = make_user('matsub_student')
        self.other_student = make_user('matsub_other_student')

    def _upload(self, client, **overrides):
        from django.core.files.uploadedfile import SimpleUploadedFile

        data = {
            'branch': self.branch.slug,
            'type': 'practice_test',
            'title': 'A submitted practice test',
            'description': 'Real practice problems.',
            'locale': 'en',
            'file': SimpleUploadedFile('practice.pdf', b'%PDF-1.4 real content'),
            **overrides,
        }
        return client.post('/api/material-submissions/', data, format='multipart')

    def test_authenticated_upload_succeeds_and_records_an_honest_scan_status(self):
        self.client.force_authenticate(self.student)
        response = self._upload(self.client)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['status'], 'pending')
        # No ClamAV daemon in this test environment — scan_status must honestly read 'skipped',
        # never a silently-assumed 'clean' the way it would if perform_create ignored `scanned`.
        self.assertEqual(response.data['scan_status'], 'skipped')

    def test_author_and_source_url_are_accepted_and_stored(self):
        self.client.force_authenticate(self.student)

        response = self._upload(
            self.client,
            author='dr hab. Anna Kowalska',
            source_url='https://example.edu/branches/am2/materials',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['author'], 'dr hab. Anna Kowalska')
        self.assertEqual(response.data['source_url'], 'https://example.edu/branches/am2/materials')

    def test_a_malformed_source_url_is_rejected_rather_than_stored(self):
        """A `URLField`, not free text — a stored non-URL would render as a broken link on every
        material card that shows it, and provenance nobody can follow is worse than none."""
        from moderation.models import MaterialSubmission

        self.client.force_authenticate(self.student)

        response = self._upload(self.client, source_url='not a url at all')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('source_url', response.data)
        self.assertFalse(MaterialSubmission.objects.filter(source_url='not a url at all').exists())

    def test_anonymous_upload_is_rejected(self):
        response = self._upload(self.client)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_disguised_executable_upload_is_rejected_with_a_400(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.client.force_authenticate(self.student)
        response = self._upload(
            self.client,
            file=SimpleUploadedFile(
                'totally_a_pdf.pdf', b'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00' + b'A' * 200
            ),
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_uploading_with_a_valid_coverage_entry_is_accepted(self):
        import json

        topic = make_topic(self.branch, 'matsub-api-topic')
        self.client.force_authenticate(self.student)
        response = self._upload(
            self.client, coverage=json.dumps([{'topic_id': topic.pk, 'level': 40}])
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['coverage'], [{'topic_id': topic.pk, 'level': 40}])

    def test_uploading_with_a_coverage_topic_from_a_different_course_is_rejected(self):
        import json

        other_course = make_course(slug='uw-material-submission-other-branch')
        other_topic = make_topic(other_course, 'matsub-api-other-topic')
        self.client.force_authenticate(self.student)
        response = self._upload(
            self.client, coverage=json.dumps([{'topic_id': other_topic.pk, 'level': 40}])
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_uploading_with_an_out_of_range_coverage_level_is_rejected(self):
        import json

        topic = make_topic(self.branch, 'matsub-api-range-topic')
        self.client.force_authenticate(self.student)
        response = self._upload(
            self.client, coverage=json.dumps([{'topic_id': topic.pk, 'level': 999}])
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_regular_user_only_sees_their_own_submissions(self):
        self.client.force_authenticate(self.student)
        self._upload(self.client, title='Mine')
        self.client.force_authenticate(self.other_student)
        self._upload(self.client, title='Someone else\'s')

        self.client.force_authenticate(self.student)
        response = self.client.get('/api/material-submissions/')
        titles = {row['title'] for row in response.data}
        self.assertEqual(titles, {'Mine'})

    def test_a_moderator_sees_every_submission(self):
        moderator = make_user('matsub_mod', is_staff=True)
        self.client.force_authenticate(self.student)
        self._upload(self.client, title='Mine')
        self.client.force_authenticate(self.other_student)
        self._upload(self.client, title='Someone else\'s')

        self.client.force_authenticate(moderator)
        response = self.client.get('/api/material-submissions/')
        titles = {row['title'] for row in response.data}
        self.assertEqual(titles, {'Mine', "Someone else's"})

    def test_upload_can_optionally_declare_requirements_price_and_a_time_estimate(self):
        """Multipart form fields always arrive as bare strings — `requirements` is sent as a
        JSON-encoded string here, the real shape a browser's own FormData would produce, not the
        native Python list a JSON-format test request could send instead."""
        import json

        self.client.force_authenticate(self.student)
        response = self._upload(
            self.client,
            requirements=json.dumps(['English B2+', 'basic algebra']),
            price_amount='19.99',
            price_currency='EUR',
            estimated_minutes='30',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['requirements'], ['English B2+', 'basic algebra'])
        self.assertEqual(response.data['price_amount'], '19.99')
        self.assertEqual(response.data['price_currency'], 'EUR')
        self.assertEqual(response.data['estimated_minutes'], 30)

    def test_a_submission_with_no_requirements_price_or_estimate_stays_genuinely_optional(self):
        self.client.force_authenticate(self.student)
        response = self._upload(self.client)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['requirements'], [])
        self.assertIsNone(response.data['price_amount'])
        self.assertIsNone(response.data['estimated_minutes'])

    def test_a_case_insensitive_duplicate_requirement_at_submission_time_is_rejected(self):
        """The identical check `materials/views.py`'s governor-only bulk-replace endpoint enforces
        on an already-published Material (materials/tests.py's own
        MaterialRequirementApiTests) — shared via materials/services.py's
        `find_duplicate_requirement_label` so a brand-new submission can't sneak in duplicates
        either."""
        import json

        self.client.force_authenticate(self.student)
        response = self._upload(
            self.client, requirements=json.dumps(['English B2+', '  english b2+  '])
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('requirements', response.data)

    def test_scan_required_rejects_the_upload_when_no_scanner_is_reachable(self):
        """`MATERIAL_SCAN_REQUIRED` (config/settings.py) is False by default in this project's own
        sandboxed dev environment (no ClamAV daemon exists to reach at all) — flipping it True here
        is what a real deployment that actually runs ClamAV would do, which should turn "couldn't
        scan it" into a hard rejection rather than the honest-skip default this environment uses."""
        from django.test import override_settings

        from moderation.models import MaterialSubmission

        self.client.force_authenticate(self.student)
        with override_settings(MATERIAL_SCAN_REQUIRED=True):
            response = self._upload(self.client)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(MaterialSubmission.objects.count(), 0)  # the failed submission was cleaned up, not left dangling


class MaterialUploadVerifiedContributorGateTests(_TempMediaRootMixin, APITestCase):
    """The `material_uploads_verified_only` flag — a NARROWER, differently-shaped restriction from
    the blanket `material_submissions` kill switch (which stays entirely untouched and unrelated
    here): when turned ON, only a verified contributor (or real staff) may submit a NEW upload,
    while an ordinary authenticated user can still list/retrieve their own past submissions."""

    def setUp(self):
        # See MaterialSubmissionApiTests.setUp for why the throttle cache is cleared here.
        cache.clear()
        self.branch = make_course(slug='uw-verified-gate-branch')
        self.plain_user = make_user('gate_plain_user')
        self.verified_user = make_user('gate_verified_user', is_verified_contributor=True)
        self.moderator = make_user('gate_moderator', is_staff=True)

    def _upload(self, client, **overrides):
        from django.core.files.uploadedfile import SimpleUploadedFile

        data = {
            'branch': self.branch.slug,
            'type': 'practice_test',
            'title': 'A submitted practice test',
            'description': 'Real practice problems.',
            'locale': 'en',
            'file': SimpleUploadedFile('practice.pdf', b'%PDF-1.4 real content'),
            **overrides,
        }
        return client.post('/api/material-submissions/', data, format='multipart')

    def _set_flag(self, enabled):
        FeatureFlag.objects.update_or_create(
            key='material_uploads_verified_only', defaults={'is_enabled': enabled}
        )

    def test_flag_defaults_to_off_and_a_plain_user_can_upload(self):
        # No explicit _set_flag call — this is the real, migration-seeded default (0011), not a
        # value this test itself sets up, so it doubles as a regression test for that seed.
        self.client.force_authenticate(self.plain_user)
        response = self._upload(self.client)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_when_enabled_a_plain_user_is_blocked(self):
        self._set_flag(True)
        self.client.force_authenticate(self.plain_user)
        response = self._upload(self.client)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_when_enabled_a_verified_contributor_can_still_upload(self):
        self._set_flag(True)
        self.client.force_authenticate(self.verified_user)
        response = self._upload(self.client)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_when_enabled_a_moderator_can_still_upload(self):
        self._set_flag(True)
        self.client.force_authenticate(self.moderator)
        response = self._upload(self.client)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_when_enabled_a_plain_user_can_still_list_their_own_past_submissions(self):
        # The restriction is scoped to `create` alone — confirmed by first uploading while the flag
        # is OFF (a real, pre-existing submission), then turning it ON and re-checking `list` still
        # works for that same, now-restricted user.
        self.client.force_authenticate(self.plain_user)
        self._upload(self.client, title='Uploaded before the restriction turned on')

        self._set_flag(True)
        response = self.client.get('/api/material-submissions/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {row['title'] for row in response.data}
        self.assertEqual(titles, {'Uploaded before the restriction turned on'})

    def test_the_platform_wide_kill_switch_still_applies_independently(self):
        # material_submissions=False must still block EVERYONE, verified or not — a completely
        # separate, unrelated flag from material_uploads_verified_only.
        FeatureFlag.objects.update_or_create(
            key='material_submissions', defaults={'is_enabled': False}
        )
        self.client.force_authenticate(self.verified_user)
        response = self._upload(self.client)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class MaterialSubmissionApprovalTests(_TempMediaRootMixin, APITestCase):
    """Approve/reject via the shared ModerationActionView, the same real endpoint every other kind
    (submission/edit/translation) already goes through — `_apply_material_submission`'s own real
    behavior (a new, published Material + MaterialTranslation) is what's under test here, not the
    upload endpoint itself (MaterialSubmissionApiTests, above)."""

    def setUp(self):
        self.moderator = make_user('matsub_approve_mod', is_staff=True)
        self.student = make_user('matsub_approve_student')
        self.branch = make_course(slug='uw-material-approval-branch')
        self.client.force_authenticate(self.moderator)

    def _submit(self, **overrides):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from moderation.models import MaterialSubmission

        defaults = {
            'branch': self.branch,
            'submitted_by': self.student,
            'type': 'exam_collection',
            'title': 'A submitted exam collection',
            'description': 'Three past exams.',
            'locale': 'en',
            'file': SimpleUploadedFile('exams.pdf', b'%PDF-1.4 real content'),
        }
        defaults.update(overrides)
        return MaterialSubmission.objects.create(**defaults)

    def test_approving_a_material_submission_creates_a_real_published_material(self):
        submission = self._submit()

        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        self.assertEqual(submission.status, 'approved')
        self.assertIsNotNone(submission.resulting_material)
        material = submission.resulting_material
        self.assertEqual(material.branch, self.branch)
        self.assertTrue(material.published)
        self.assertEqual(material.type, 'exam_collection')
        translation = material.translations.get(locale='en')
        self.assertEqual(translation.title, 'A submitted exam collection')
        # The SAME already-uploaded file, not a re-saved copy under a new path.
        self.assertEqual(material.file.name, submission.file.name)

    def test_declared_author_and_source_url_carry_onto_the_published_material(self):
        """Provenance is only knowable by the uploader — a moderator cannot recover an author or an
        origin from a PDF's bytes. If it is captured at submission time but dropped on approval, the
        record is lost at exactly the moment it becomes public, so this pins the carry-over."""
        submission = self._submit(
            author='dr hab. Anna Kowalska',
            source_url='https://example.edu/branches/am2/materials',
        )

        response = self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        material = submission.resulting_material
        self.assertEqual(material.author, 'dr hab. Anna Kowalska')
        self.assertEqual(material.source_url, 'https://example.edu/branches/am2/materials')

    def test_a_submission_declaring_neither_still_approves_cleanly(self):
        """Both fields are deliberately optional — a scan of a paper handout has no URL, and forcing
        one would produce fabricated provenance, which is the opposite of the point."""
        submission = self._submit()

        response = self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        self.assertEqual(submission.resulting_material.author, '')
        self.assertEqual(submission.resulting_material.source_url, '')

    def test_the_moderation_queue_shows_provenance_to_the_reviewer(self):
        """Storing it is not enough: the approve/reject call is where a provenance/copyright judgment
        actually gets made (CLAUDE.md Section 18 item 2), so it has to reach the reviewer's queue."""
        self._submit(author='Prof. Jan Nowak', source_url='https://example.edu/handout.pdf')

        response = self.client.get(reverse('moderation-queue'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = next(
            r for r in response.data['material_submissions'] if r['author'] == 'Prof. Jan Nowak'
        )
        self.assertEqual(row['source_url'], 'https://example.edu/handout.pdf')

    def test_approving_a_material_submission_records_a_real_clickable_submitted_by(self):
        """A real, found gap: `_apply_material_submission` used to build the resulting Material
        with NO attribution at all — `Material.author` (a free-text field) was never set from the
        submission either, so a community-submitted material had zero clickable byline, unlike an
        Exercise's own `submitted_by`. Confirms the fix: the real submitter carries over."""
        submission = self._submit()

        self.client.post(
            reverse('moderation-action', kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'}),
            {},
            format='json',
        )

        submission.refresh_from_db()
        self.assertEqual(submission.resulting_material.submitted_by, self.student)

    def test_approving_a_submission_with_requirements_price_and_estimate_carries_them_over(self):
        """The submission's own `requirements` (a plain list[str] draft) becomes real, ORDERED
        MaterialRequirement rows only once approved — there's no real Material row for them to
        attach to before that."""
        submission = self._submit(
            requirements=['English B2+', 'basic algebra'],
            price_amount='29.99',
            price_currency='EUR',
            estimated_minutes=45,
        )

        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        material = submission.resulting_material
        self.assertEqual(str(material.price_amount), '29.99')
        self.assertEqual(material.price_currency, 'EUR')
        self.assertEqual(material.estimated_minutes, 45)
        labels = list(material.requirements.order_by('order').values_list('label', flat=True))
        self.assertEqual(labels, ['English B2+', 'basic algebra'])

    def test_approving_a_submission_with_coverage_creates_real_material_coverage_rows(self):
        topic = make_topic(self.branch, 'matsub-approval-topic')
        submission = self._submit(coverage=[{'topic_id': topic.pk, 'level': 60}])

        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        material = submission.resulting_material
        coverage_rows = list(material.coverage.all())
        self.assertEqual(len(coverage_rows), 1)
        self.assertEqual(coverage_rows[0].topic_id, topic.pk)
        self.assertEqual(coverage_rows[0].level, 60)
        self.assertEqual(coverage_rows[0].proposed_by, self.student)

    def test_rejecting_a_material_submission_never_creates_a_material(self):
        submission = self._submit()

        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'reject'}),
            {'review_note': 'Wrong branch.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        self.assertEqual(submission.status, 'rejected')
        self.assertIsNone(submission.resulting_material)

    def test_double_decision_on_the_same_material_submission_returns_conflict(self):
        submission = self._submit()
        url = reverse('moderation-action', kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'})

        first = self.client.post(url, {}, format='json')
        second = self.client.post(url, {}, format='json')

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)

    def test_two_submissions_with_the_same_title_get_distinct_slugs(self):
        """`_apply_material_submission`'s own slug-collision retry, the material-file counterpart to
        `_apply_submission`'s number-allocation retry (SubmissionApprovalTests, above)."""
        first_submission = self._submit(title='Duplicate Title')
        second_submission = self._submit(title='Duplicate Title')

        for submission in (first_submission, second_submission):
            response = self.client.post(
                reverse(
                    'moderation-action', kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'}
                ),
                {},
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        first_submission.refresh_from_db()
        second_submission.refresh_from_db()
        self.assertNotEqual(first_submission.resulting_material.slug, second_submission.resulting_material.slug)

    def test_a_node_governor_with_no_authority_over_this_course_is_forbidden(self):
        from moderation.models import NodeGovernor
        from taxonomy.models import Branch

        other_course = make_course(slug='uw-material-approval-other-branch')
        governor = make_user('matsub_approve_governor')
        NodeGovernor.objects.create(user=governor, content_type=ContentType.objects.get_for_model(Branch), object_id=other_course.pk)
        submission = self._submit()

        self.client.force_authenticate(governor)
        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class MaterialSubmissionStorageQuotaTests(_TempMediaRootMixin, APITestCase):
    """`Profile.material_upload_quota_bytes`, enforced on the real upload endpoint.

    The gap this closes: `TaughtCourse.upload_quota_bytes` was the only storage limit in this app
    and it is checked in exactly one place (the course-content path, classroom/views.py), so
    `POST /api/material-submissions/` — the main upload route, behind /submit-material — was bounded
    only by the 25MB per-FILE cap and had no aggregate limit of any kind.

    The arithmetic itself is pinned in accounts/tests.py (`ProfileMaterialUploadQuotaTests`); what
    is under test here is the endpoint's own behaviour: what it accepts, what it refuses, and what
    it leaves on disk when it refuses.
    """

    def setUp(self):
        # See MaterialSubmissionApiTests.setUp — these tests upload several times each, so they are
        # exactly the ones that would otherwise exhaust a shared budget partway through the class
        # and start reporting a 429 where a quota decision was under test.
        cache.clear()
        self.branch = make_course(slug='uw-upload-quota-branch')
        self.student = make_user('upload_quota_student')
        self.client.force_authenticate(self.student)

    def _set_allowance(self, quota_bytes, user=None):
        profile = (user or self.student).profile
        profile.material_upload_quota_bytes = quota_bytes
        profile.save(update_fields=['material_upload_quota_bytes'])

    def _upload(self, size, *, title='A submitted practice test'):
        return self.client.post(
            '/api/material-submissions/',
            {
                'branch': self.branch.slug,
                'type': 'practice_test',
                'title': title,
                'locale': 'en',
                'file': SimpleUploadedFile('practice.pdf', pdf_bytes(size)),
            },
            format='multipart',
        )

    def test_the_default_allowance_changes_nothing_for_anybody(self):
        """The whole point of defaulting to 0/uncapped: an account nobody has configured behaves
        exactly as it did before this field existed. Worth its own test rather than left implied by
        the other cases passing — a wrong default would be the one failure that inconveniences every
        real user at once."""
        for i in range(3):
            self.assertEqual(self._upload(200_000, title=f'Upload {i}').status_code, status.HTTP_201_CREATED)

        self.assertIsNone(self.student.profile.material_upload_bytes_left)

    def test_an_upload_that_fits_is_accepted(self):
        self._set_allowance(50_000)

        response = self._upload(20_000)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_an_upload_that_would_overrun_the_allowance_is_refused(self):
        from moderation.models import MaterialSubmission

        self._set_allowance(30_000)
        self.assertEqual(self._upload(20_000, title='First').status_code, status.HTTP_201_CREATED)

        response = self._upload(20_000, title='Second')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('file', response.data)
        self.assertEqual(MaterialSubmission.objects.filter(title='Second').count(), 0)

    def test_a_refused_upload_leaves_nothing_on_disk(self):
        """The check runs before `serializer.save()`, which is what writes the file. Refusing
        afterwards would mean storing bytes only to unlink them — the exact disk pressure the quota
        exists to prevent — and would orphan a real file if the unlink ever failed."""
        self._set_allowance(10_000)

        response = self._upload(20_000)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.stored_file_count(), 0)

    def test_the_incoming_file_is_weighed_too_not_only_what_is_already_stored(self):
        """An account sitting just under its allowance must refuse what would take it over rather
        than accepting it and going over silently — the same rule the course-side check states, and
        the boundary is where a quota is either right or off by one file."""
        self._set_allowance(10_000)

        exact_fit = self._upload(10_000, title='Exactly the allowance')
        self.assertEqual(exact_fit.status_code, status.HTTP_201_CREATED)

        # Nothing is left, so even the smallest possible upload has to be refused now.
        self.assertEqual(self._upload(100, title='One more').status_code, status.HTTP_400_BAD_REQUEST)

    def test_one_accounts_uploads_do_not_spend_anothers_allowance(self):
        other = make_user('upload_quota_other_student')
        self._set_allowance(30_000)
        self._set_allowance(30_000, user=other)

        self.client.force_authenticate(other)
        self.assertEqual(self._upload(25_000, title="Other's").status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(self.student)
        self.assertEqual(self._upload(25_000, title='Mine').status_code, status.HTTP_201_CREATED)

    def test_rejecting_an_earlier_upload_gives_its_room_back(self):
        """The end-to-end consequence of reclaiming a rejected file: a moderator's rejection is what
        makes the allowance mean "what you are storing" rather than "what you have ever sent". Runs
        through the real endpoints on both halves rather than editing rows directly."""
        from moderation.models import MaterialSubmission

        self._set_allowance(30_000)
        self.assertEqual(self._upload(25_000, title='Filled it').status_code, status.HTTP_201_CREATED)
        self.assertEqual(self._upload(25_000, title='Refused').status_code, status.HTTP_400_BAD_REQUEST)

        moderator = make_user('upload_quota_mod', is_staff=True)
        first = MaterialSubmission.objects.get(title='Filled it')
        self.client.force_authenticate(moderator)
        rejection = self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'material', 'pk': first.pk, 'decision': 'reject'},
            ),
            {'review_note': 'Not this course.'},
            format='json',
        )
        self.assertEqual(rejection.status_code, status.HTTP_200_OK)

        self.client.force_authenticate(self.student)
        self.assertEqual(self._upload(25_000, title='Room again').status_code, status.HTTP_201_CREATED)


class RejectedMaterialFileReclaimTests(_TempMediaRootMixin, APITestCase):
    """Rejecting a material submission drops its stored blob and keeps everything else.

    The tension this resolves is written out in full on `_reclaim_rejected_material_file`
    (moderation/views.py): CLAUDE.md's own non-functional requirements forbid silent data loss on
    moderation, and nothing here had ever deleted a `MaterialSubmission.file`, so a rejected 25MB
    upload sat on a shared filesystem permanently for a file no reader could ever be shown. These
    tests pin both halves — the bytes really go, and the record of what was rejected and why really
    stays — because a future change that quietly drops either one would look like a passing suite.
    """

    def setUp(self):
        self.branch = make_course(slug='uw-reclaim-branch')
        self.student = make_user('reclaim_student')
        self.moderator = make_user('reclaim_mod', is_staff=True)

    def _submit(self, size=4096, **overrides):
        from moderation.models import MaterialSubmission

        defaults = {
            'branch': self.branch,
            'submitted_by': self.student,
            'type': 'exam_collection',
            'title': 'A submitted exam collection',
            'description': 'Three past exams.',
            'locale': 'en',
            'file': SimpleUploadedFile('exams.pdf', pdf_bytes(size)),
        }
        defaults.update(overrides)
        return MaterialSubmission.objects.create(**defaults)

    def _decide(self, submission, decision, note=''):
        self.client.force_authenticate(self.moderator)
        return self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'material', 'pk': submission.pk, 'decision': decision},
            ),
            {'review_note': note},
            format='json',
        )

    def test_rejecting_removes_the_stored_bytes(self):
        submission = self._submit()
        path = submission.file.path
        self.assertTrue(os.path.exists(path))

        response = self._decide(submission, 'reject', note='Wrong course.')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(os.path.exists(path))
        submission.refresh_from_db()
        self.assertFalse(submission.file)

    def test_rejecting_keeps_the_row_and_everything_that_says_what_was_rejected(self):
        """This is the requirement the reclaim had to be built around, not against: "rejecting a
        submission should keep a record of what was rejected and why, not just delete it". The blob
        is not the record — the title, the description, the declared provenance, the recorded scan
        outcome, the reviewer and the note are."""
        from moderation.models import MaterialSubmission

        submission = self._submit(
            author='dr hab. Anna Kowalska',
            source_url='https://example.edu/handout.pdf',
            requirements=['English B2+'],
        )

        self._decide(submission, 'reject', note='Copyright unclear.')

        kept = MaterialSubmission.objects.get(pk=submission.pk)
        self.assertEqual(kept.status, 'rejected')
        self.assertEqual(kept.title, 'A submitted exam collection')
        self.assertEqual(kept.description, 'Three past exams.')
        self.assertEqual(kept.author, 'dr hab. Anna Kowalska')
        self.assertEqual(kept.source_url, 'https://example.edu/handout.pdf')
        self.assertEqual(kept.requirements, ['English B2+'])
        self.assertEqual(kept.review_note, 'Copyright unclear.')
        self.assertEqual(kept.reviewed_by, self.moderator)
        self.assertEqual(kept.submitted_by, self.student)

    def test_the_reclaim_is_recorded_rather_than_left_looking_like_a_file_that_never_existed(self):
        """Without these two columns a reclaimed submission is indistinguishable from one that
        somehow never had a file, and "where did the PDF go?" has no answer anywhere. The size in
        particular survives nowhere else once the bytes are gone."""
        submission = self._submit(size=7000)

        self._decide(submission, 'reject')

        submission.refresh_from_db()
        self.assertIsNotNone(submission.file_reclaimed_at)
        self.assertEqual(submission.reclaimed_file_bytes, 7000)

    def test_the_rejection_response_says_the_file_was_reclaimed(self):
        """The moderator who just clicked Reject is handed this body; a `file` that has silently
        become null with nothing to explain it reads as a bug rather than as the intended outcome."""
        submission = self._submit(size=5000)

        response = self._decide(submission, 'reject')

        self.assertIsNotNone(response.data['file_reclaimed_at'])
        self.assertEqual(response.data['reclaimed_file_bytes'], 5000)

    def test_approving_leaves_the_file_completely_alone(self):
        """The published `Material` is handed the SAME stored path (`_apply_material_submission`
        copies the reference, never the bytes), so reclaiming on approval would delete a live
        material's file out from under it."""
        submission = self._submit()
        path = submission.file.path

        response = self._decide(submission, 'approve')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        self.assertTrue(os.path.exists(path))
        self.assertIsNone(submission.file_reclaimed_at)
        self.assertEqual(submission.resulting_material.file.name, submission.file.name)

    def test_the_reclaim_refuses_to_touch_a_submission_that_became_a_material(self):
        """The claim step already guarantees a rejected row was `pending` and so cannot have a
        resulting Material — this pins the guard that makes that guarantee not the only thing
        standing between a wrong call and a published material losing its file."""
        from moderation.views import _reclaim_rejected_material_file

        submission = self._submit()
        self._decide(submission, 'approve')
        submission.refresh_from_db()
        path = submission.file.path

        _reclaim_rejected_material_file(submission)

        submission.refresh_from_db()
        self.assertTrue(os.path.exists(path))
        self.assertTrue(submission.file)
        self.assertIsNone(submission.file_reclaimed_at)

    def test_rejecting_an_exercise_submission_is_untouched_by_any_of_this(self):
        """The reclaim is scoped to `kind == 'material'` — an ExerciseSubmission has no file at all,
        and the shared action must keep behaving exactly as it did for every other kind."""
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


class MaterialSubmissionThrottleTests(_TempMediaRootMixin, ThrottleTestCase):
    """The `material_submission` throttle scope, wired onto `create` alone.

    Inherits `accounts/test_throttling.py`'s own base rather than repeating its setup, because that
    class exists to encode a trap this codebase found the hard way and would find again:
    `SimpleRateThrottle` binds `THROTTLE_RATES = api_settings.DEFAULT_THROTTLE_RATES` as a CLASS
    attribute at import time, so `override_settings(REST_FRAMEWORK=...)` genuinely does not reach it
    and a test written that way runs against production rates while appearing to declare its own.
    `patch.dict` on the shared dict is what works, and the cache has to be cleared between tests or
    one test's requests spend the next one's budget.
    """

    RATES = {'material_submission': '2/hour'}

    def setUp(self):
        super().setUp()
        self.branch = make_course(slug='uw-upload-throttle-branch')
        self.student = make_user('upload_throttle_student')
        self.client.force_authenticate(self.student)

    def _upload(self, title='Throttled upload'):
        return self.client.post(
            '/api/material-submissions/',
            {
                'branch': self.branch.slug,
                'type': 'practice_test',
                'title': title,
                'locale': 'en',
                'file': SimpleUploadedFile('practice.pdf', pdf_bytes(2000)),
            },
            format='multipart',
        )

    def test_repeated_uploads_are_eventually_throttled(self):
        for i in range(2):
            self.assertEqual(
                self._upload(title=f'Upload {i}').status_code,
                status.HTTP_201_CREATED,
                msg=f'upload {i + 1} should still be allowed through',
            )

        self.assertEqual(self._upload().status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_reading_back_your_own_submissions_is_not_spent_by_the_upload_budget(self):
        """The scope is deliberately set on `create` alone: listing what you have already sent is an
        ordinary cheap GET, and having it share a 20/hour budget with 25MB writes would throttle
        reading for no reason at all — including, at exactly the wrong moment, the read that would
        show somebody what they had already uploaded."""
        for i in range(3):
            self._upload(title=f'Upload {i}')
        # The upload budget really is spent by this point, or the rest proves nothing.
        self.assertEqual(self._upload().status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        for _ in range(4):
            response = self.client.get('/api/material-submissions/')
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.assertEqual(len(response.data), 2)


class EditSuggestionApprovalTests(APITestCase):
    def setUp(self):
        self.moderator = make_user('mod3', is_staff=True)
        self.branch = make_course(slug='uw-edit-branch')
        self.exercise = make_exercise(self.branch, 1)
        self.client.force_authenticate(self.moderator)

    def _suggest(self, field='hint', proposed_value='A helpful hint.'):
        from moderation.models import EditSuggestion

        return EditSuggestion.objects.create(
            exercise=self.exercise,
            locale='pl',
            field=field,
            proposed_value=proposed_value,
            submitted_by=self.moderator,
        )

    def test_approving_an_edit_suggestion_mutates_the_target_field(self):
        suggestion = self._suggest()

        response = self.client.post(
            reverse(
                'moderation-action', kwargs={'kind': 'edit', 'pk': suggestion.pk, 'decision': 'approve'}
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        translation = self.exercise.translations.get(locale='pl')
        self.assertEqual(translation.hint, 'A helpful hint.')

    def test_rejecting_an_edit_suggestion_leaves_the_field_unchanged(self):
        original_hint = self.exercise.translations.get(locale='pl').hint
        suggestion = self._suggest()

        response = self.client.post(
            reverse(
                'moderation-action', kwargs={'kind': 'edit', 'pk': suggestion.pk, 'decision': 'reject'}
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        translation = self.exercise.translations.get(locale='pl')
        self.assertEqual(translation.hint, original_hint)


class ModerationQueuePermissionTests(APITestCase):
    def test_non_moderator_is_forbidden(self):
        self.client.force_authenticate(make_user('visitor'))
        response = self.client.get(reverse('moderation-queue'))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_moderator_can_view_the_queue(self):
        self.client.force_authenticate(make_user('mod4', is_staff=True))
        response = self.client.get(reverse('moderation-queue'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)


def _report(client, kind, object_id, reason=''):
    return client.post(reverse('report-list'), {'kind': kind, 'object_id': object_id, 'reason': reason}, format='json')


def _record_views(exercise, count):
    """Simulates `count` distinct registered viewers loading this exercise's own detail page —
    the real ContentView rows moderation/services.py's check_auto_hide divides a report count
    against. Uses make_viewer, not make_user — these accounts are never logged into, only ever
    referenced as a ContentView's own FK, so there's no reason to pay create_user's real (and
    deliberately slow) password-hashing cost up to 100 times per test."""
    for i in range(count):
        viewer = make_viewer(f'viewer{exercise.pk}-{i}')
        ContentView.objects.create(user=viewer, exercise=exercise)


class AutoHideTests(APITestCase):
    """CLAUDE.md's own community-driven auto-hide rule (moderation/services.py's `check_auto_hide`):
    "+20% of users who viewed that content report it" hides it right away, with a real
    `MIN_REPORTS_FOR_AUTO_HIDE = 3` floor so a single bad-faith report can't hide something with a
    tiny viewer pool on its own (1 report / 4 viewers = 25%, well above the raw 20% rule)."""

    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)

    def test_reports_below_the_minimum_count_do_not_hide_even_at_a_high_percentage(self):
        _record_views(self.exercise, 4)  # 2/4 = 50%, comfortably over 20% — but only 2 reporters
        for i in range(2):
            reporter = make_user(f'reporter{i}')
            self.client.force_authenticate(reporter)
            response = _report(self.client, 'exercise', self.exercise.pk)
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        self.exercise.refresh_from_db()
        self.assertIsNone(self.exercise.auto_hidden_at)
        self.assertTrue(self.exercise.published)

    def test_reports_below_the_percentage_threshold_do_not_hide(self):
        _record_views(self.exercise, 100)  # 3/100 = 3% — well under 20%, despite meeting the floor
        for i in range(3):
            reporter = make_user(f'reporter{i}')
            self.client.force_authenticate(reporter)
            _report(self.client, 'exercise', self.exercise.pk)

        self.exercise.refresh_from_db()
        self.assertIsNone(self.exercise.auto_hidden_at)

    def test_reports_crossing_both_thresholds_hide_the_exercise(self):
        _record_views(self.exercise, 10)  # 3/10 = 30%, over both the floor and the percentage
        for i in range(3):
            reporter = make_user(f'reporter{i}')
            self.client.force_authenticate(reporter)
            _report(self.client, 'exercise', self.exercise.pk)

        self.exercise.refresh_from_db()
        self.assertIsNotNone(self.exercise.auto_hidden_at)
        self.assertFalse(self.exercise.published)

    def test_reporting_a_comment_is_measured_against_its_own_exercises_viewer_pool(self):
        """A Comment has no view-tracking of its own — resolve_view_scope_exercise borrows whichever
        Exercise it's attached to."""
        _record_views(self.exercise, 10)
        content_type = ContentType.objects.get_for_model(Exercise)
        comment = Comment.objects.create(
            content_type=content_type,
            object_id=self.exercise.pk,
            author=make_user('comment-author'),
            body='A comment that will be reported.',
        )

        for i in range(3):
            reporter = make_user(f'reporter{i}')
            self.client.force_authenticate(reporter)
            response = _report(self.client, 'comment', comment.pk)
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        comment.refresh_from_db()
        self.assertIsNotNone(comment.auto_hidden_at)

    def test_reporting_the_same_target_twice_by_the_same_user_is_rejected(self):
        reporter = make_user('repeat-reporter')
        self.client.force_authenticate(reporter)
        first = _report(self.client, 'exercise', self.exercise.pk)
        second = _report(self.client, 'exercise', self.exercise.pk)

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Report.objects.filter(object_id=self.exercise.pk).count(), 1)

    def test_an_already_hidden_exercise_is_not_double_processed_by_a_further_report(self):
        _record_views(self.exercise, 10)
        for i in range(3):
            reporter = make_user(f'reporter{i}')
            self.client.force_authenticate(reporter)
            _report(self.client, 'exercise', self.exercise.pk)
        self.exercise.refresh_from_db()
        first_hidden_at = self.exercise.auto_hidden_at

        extra_reporter = make_user('extra-reporter')
        self.client.force_authenticate(extra_reporter)
        response = _report(self.client, 'exercise', self.exercise.pk)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.exercise.refresh_from_db()
        self.assertEqual(self.exercise.auto_hidden_at, first_hidden_at)


class MaterialCoverageCommentReportTests(APITestCase):
    """CLAUDE.md's own note: `REPORT_KIND_MODELS = {'exercise': Exercise, 'comment': Comment,
    'review': Review}` means ANY Comment row — including a reply inside a MaterialCoverage
    discussion — is already reportable via the existing `POST /api/reports/`, completely
    generically, regardless of what the comment's own `content_type`/`object_id` points at.
    Confirmed here directly rather than assumed."""

    def test_reporting_a_comment_attached_to_a_material_coverage_claim_succeeds(self):
        from materials.models import MaterialCoverage

        branch = make_course(slug='uw-coverage-report-branch')
        material = make_material(branch, 'skrypt')
        topic = make_topic(branch)
        coverage = MaterialCoverage.objects.create(
            material=material, topic=topic, level=60, proposed_by=make_user('coverage-report-proposer')
        )
        comment = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(MaterialCoverage),
            object_id=coverage.pk,
            author=make_user('coverage-comment-author'),
            body='A reply inside a coverage discussion, reported by someone else.',
        )
        reporter = make_user('coverage-comment-reporter')
        self.client.force_authenticate(reporter)

        response = _report(self.client, 'comment', comment.pk, reason='Off-topic.')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            Report.objects.filter(
                content_type=ContentType.objects.get_for_model(Comment), object_id=comment.pk, reported_by=reporter
            ).exists()
        )

    def test_a_materialcoverage_comment_has_no_viewer_pool_so_it_never_auto_hides(self):
        """MaterialCoverage has no view-tracking concept at all (`resolve_view_scope_exercise`
        returns None for anything that isn't an Exercise/Review/Comment-eventually-resolving-to-one)
        — real reports against a coverage-attached comment must still be recorded, and
        `check_auto_hide` must gracefully no-op (no crash, no division by zero), not silently
        auto-hide something with no real denominator to measure against."""
        from materials.models import MaterialCoverage
        from moderation.services import check_auto_hide

        branch = make_course(slug='uw-coverage-noautohide-branch')
        material = make_material(branch, 'skrypt')
        topic = make_topic(branch)
        coverage = MaterialCoverage.objects.create(
            material=material, topic=topic, level=60, proposed_by=make_user('noautohide-proposer')
        )
        comment = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(MaterialCoverage),
            object_id=coverage.pk,
            author=make_user('noautohide-comment-author'),
            body='Reported three times, still no viewer pool to measure against.',
        )

        for i in range(3):
            reporter = make_user(f'noautohide-reporter{i}')
            self.client.force_authenticate(reporter)
            response = _report(self.client, 'comment', comment.pk)
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        comment.refresh_from_db()
        self.assertIsNone(comment.auto_hidden_at)
        self.assertFalse(check_auto_hide(comment))
        self.assertEqual(Report.objects.filter(object_id=comment.pk, status='pending').count(), 3)


class ReportActionViewTests(APITestCase):
    def setUp(self):
        self.moderator = make_user('report-mod', is_staff=True)
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        _record_views(self.exercise, 10)
        for i in range(3):
            reporter = make_user(f'action-reporter{i}')
            self.client.force_authenticate(reporter)
            _report(self.client, 'exercise', self.exercise.pk)
        self.exercise.refresh_from_db()
        self.assertIsNotNone(self.exercise.auto_hidden_at)  # sanity: the fixture really is auto-hidden
        self.client.force_authenticate(self.moderator)

    def test_moderator_can_restore_an_auto_hidden_exercise(self):
        response = self.client.post(
            reverse(
                'moderation-report-action',
                kwargs={'kind': 'exercise', 'pk': self.exercise.pk, 'decision': 'restore'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.exercise.refresh_from_db()
        self.assertIsNone(self.exercise.auto_hidden_at)
        self.assertTrue(self.exercise.published)
        self.assertFalse(Report.objects.filter(object_id=self.exercise.pk, status='pending').exists())

    def test_moderator_can_permanently_remove_a_reported_exercise(self):
        response = self.client.post(
            reverse(
                'moderation-report-action',
                kwargs={'kind': 'exercise', 'pk': self.exercise.pk, 'decision': 'remove'},
            ),
            {'resolved_note': 'Genuinely wrong.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.exercise.refresh_from_db()
        self.assertFalse(self.exercise.published)
        self.assertIsNone(self.exercise.auto_hidden_at)

    def test_non_moderator_cannot_act_on_a_report(self):
        self.client.force_authenticate(make_user('not-a-mod-either'))

        response = self.client.post(
            reverse(
                'moderation-report-action',
                kwargs={'kind': 'exercise', 'pk': self.exercise.pk, 'decision': 'restore'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.exercise.refresh_from_db()
        self.assertIsNotNone(self.exercise.auto_hidden_at)


class ReportActionScopingTests(APITestCase):
    """Node-governor scoping on ReportActionView — including a real regression test for a bug
    found (not just reasoned about) while building this feature: the response this view returns
    reuses build_report_queue(), and the FIRST version of this fix left that one final call
    unscoped, which would have handed a course governor back every OTHER pending report on the
    platform the moment they resolved one of their own."""

    def _hidden_exercise_in(self, branch):
        exercise = make_exercise(branch, 1)
        _record_views(exercise, 10)
        for i in range(3):
            reporter = make_user(f'rep-scope-{branch.slug}-{i}')
            self.client.force_authenticate(reporter)
            _report(self.client, 'exercise', exercise.pk)
        exercise.refresh_from_db()
        assert exercise.auto_hidden_at is not None
        return exercise

    def test_a_course_governor_can_restore_an_auto_hidden_exercise_in_their_own_course(self):
        branch = make_course('report-scope-a')
        exercise = self._hidden_exercise_in(branch)
        governor = make_user('report-scope-gov')
        _grant(governor, 'branch', branch)
        self.client.force_authenticate(governor)

        response = self.client.post(
            reverse(
                'moderation-report-action',
                kwargs={'kind': 'exercise', 'pk': exercise.pk, 'decision': 'restore'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        exercise.refresh_from_db()
        self.assertIsNone(exercise.auto_hidden_at)

    def test_a_course_governor_cannot_act_on_a_report_outside_their_own_course(self):
        governed_course = make_course('report-scope-b')
        other_course = make_course('report-scope-c')
        exercise = self._hidden_exercise_in(other_course)
        governor = make_user('report-scope-gov2')
        _grant(governor, 'branch', governed_course)
        self.client.force_authenticate(governor)

        response = self.client.post(
            reverse(
                'moderation-report-action',
                kwargs={'kind': 'exercise', 'pk': exercise.pk, 'decision': 'restore'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        exercise.refresh_from_db()
        self.assertIsNotNone(exercise.auto_hidden_at)  # untouched

    def test_the_returned_queue_after_resolving_one_report_stays_scoped_to_the_governors_own_course(self):
        governed_course = make_course('report-scope-d')
        other_course = make_course('report-scope-e')
        own_exercise = self._hidden_exercise_in(governed_course)
        other_exercise = self._hidden_exercise_in(other_course)
        governor = make_user('report-scope-gov3')
        _grant(governor, 'branch', governed_course)
        self.client.force_authenticate(governor)

        response = self.client.post(
            reverse(
                'moderation-report-action',
                kwargs={'kind': 'exercise', 'pk': own_exercise.pk, 'decision': 'restore'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        returned_ids = {row['object_id'] for row in response.data if row['kind'] == 'exercise'}
        # own_exercise was just resolved, so it's no longer pending and correctly absent; the real
        # check is that other_exercise (a DIFFERENT course this governor doesn't govern) is ALSO
        # absent — the bug this test guards against would have leaked it into the response.
        self.assertNotIn(other_exercise.pk, returned_ids)


class ReportQueueTests(APITestCase):
    """`build_report_queue` (moderation/services.py) — rewritten from a real, measured N+1 into a
    small, fixed number of bulk queries (CLAUDE.md Section 17F); these tests exercise its actual
    output shape, not just that it runs without error."""

    def test_reports_on_the_same_target_are_grouped_with_a_correct_count(self):
        branch = make_course()
        exercise = make_exercise(branch, 1)
        _record_views(exercise, 10)
        for i in range(2):
            reporter = make_user(f'queue-reporter{i}')
            self.client.force_authenticate(reporter)
            _report(self.client, 'exercise', exercise.pk, reason=f'reason {i}')

        self.client.force_authenticate(make_user('queue-mod', is_staff=True))
        response = self.client.get(reverse('moderation-queue'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        groups = [g for g in response.data['reports'] if g['kind'] == 'exercise' and g['object_id'] == exercise.pk]
        self.assertEqual(len(groups), 1)
        group = groups[0]
        self.assertEqual(group['report_count'], 2)
        self.assertEqual(group['view_count'], 10)
        self.assertEqual(group['percent_reported'], 20)
        self.assertFalse(group['is_auto_hidden'])
        self.assertEqual(len(group['reasons']), 2)


class TagMaterialRequirementReportTests(APITestCase):
    """Reporting a Tag, a Material, or a MaterialRequirement ("skill tag") — the newest three
    REPORT_KIND_MODELS entries (moderation/services.py). None of the three has a viewer-pool
    concept (same as the pre-existing `service` kind), so none of them ever auto-hide on their own
    — they queue immediately on the first report and wait on a moderator's own decision. This also
    exercises the real bug this feature's own build found: `build_report_queue`'s target-resolution
    branch used to assume "anything that isn't Exercise/Review/Service is a reported Comment" and
    would have crashed (an AttributeError reading a Comment-only field) the instant one of these
    three showed up in a real pending queue."""

    def setUp(self):
        self.moderator = make_user('tmr-mod', is_staff=True)
        self.branch = make_course('tmr-branch')

    def _report_as_new_users(self, kind, object_id, prefix, count=1):
        for i in range(count):
            reporter = make_user(f'tmr-reporter-{prefix}-{i}')
            self.client.force_authenticate(reporter)
            response = _report(self.client, kind, object_id)
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_reporting_a_tag_queues_it_and_a_moderator_can_remove_it(self):
        from exercises.models import Tag

        tag = Tag.objects.create(slug='tmr-bad-tag')
        self._report_as_new_users('tag', tag.pk, 'tag')

        self.client.force_authenticate(self.moderator)
        response = self.client.get(reverse('moderation-queue'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        groups = [g for g in response.data['reports'] if g['kind'] == 'tag' and g['object_id'] == tag.pk]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['preview'], '#tmr-bad-tag')
        self.assertFalse(groups[0]['is_auto_hidden'])
        self.assertIsNone(groups[0]['view_count'])

        response = self.client.post(
            reverse('moderation-report-action', kwargs={'kind': 'tag', 'pk': tag.pk, 'decision': 'remove'}),
            {}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        tag.refresh_from_db()
        self.assertTrue(tag.is_removed)
        self.assertFalse(Tag.objects.filter(pk=tag.pk, is_removed=False).exists())

    def test_reporting_a_material_queues_it_and_a_moderator_can_remove_and_restore_it(self):
        material = make_material(self.branch, 'tmr-material', title='Report Me')
        self._report_as_new_users('material', material.pk, 'mat')

        self.client.force_authenticate(self.moderator)
        response = self.client.get(reverse('moderation-queue'))
        groups = [
            g for g in response.data['reports'] if g['kind'] == 'material' and g['object_id'] == material.pk
        ]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['preview'], 'Report Me')

        response = self.client.post(
            reverse('moderation-report-action', kwargs={'kind': 'material', 'pk': material.pk, 'decision': 'remove'}),
            {}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        material.refresh_from_db()
        self.assertFalse(material.published)

        # A removed Material disappears from the public read API entirely, same as Exercise.
        detail = self.client.get(reverse('material-detail', kwargs={'pk': material.pk}))
        self.assertEqual(detail.status_code, status.HTTP_404_NOT_FOUND)

        response = self.client.post(
            reverse('moderation-report-action', kwargs={'kind': 'material', 'pk': material.pk, 'decision': 'restore'}),
            {}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        material.refresh_from_db()
        self.assertTrue(material.published)

    def test_reporting_a_requirement_queues_it_and_a_moderator_can_remove_it(self):
        from materials.models import MaterialRequirement

        material = make_material(self.branch, 'tmr-material-2', title='Has A Requirement')
        requirement = MaterialRequirement.objects.create(material=material, label='basic algebra')
        self._report_as_new_users('requirement', requirement.pk, 'req')

        self.client.force_authenticate(self.moderator)
        response = self.client.get(reverse('moderation-queue'))
        groups = [
            g for g in response.data['reports']
            if g['kind'] == 'requirement' and g['object_id'] == requirement.pk
        ]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['preview'], 'basic algebra')

        response = self.client.post(
            reverse(
                'moderation-report-action',
                kwargs={'kind': 'requirement', 'pk': requirement.pk, 'decision': 'remove'},
            ),
            {}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        requirement.refresh_from_db()
        self.assertTrue(requirement.is_removed)

        # A removed requirement disappears from the material's own serialized requirements list.
        detail = self.client.get(reverse('material-detail', kwargs={'pk': material.pk}))
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertNotIn('basic algebra', [r['label'] for r in detail.data['requirements']])

    def test_a_non_moderator_cannot_act_on_a_reported_material(self):
        material = make_material(self.branch, 'tmr-material-3')
        self._report_as_new_users('material', material.pk, 'mat3')

        self.client.force_authenticate(make_user('tmr-not-a-mod'))
        response = self.client.post(
            reverse('moderation-report-action', kwargs={'kind': 'material', 'pk': material.pk, 'decision': 'remove'}),
            {}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        material.refresh_from_db()
        self.assertTrue(material.published)  # untouched


class ServiceReviewReportTests(APITestCase):
    """Reporting a tutor's own review (ServiceReview, `kind='service_review'`) — a genuinely
    different backend model from `review` (community.Review, an Exercise review) sharing the same
    frontend ReviewList component (ReviewList.svelte's own new `kind` prop). No viewer-pool concept
    (same as `service`/`tag`/`material`/`requirement`), so it queues immediately, no auto-hide."""

    def setUp(self):
        from services.models import Service, ServiceReview

        self.moderator = make_user('svcrev-mod', is_staff=True)
        provider = make_user('svcrev-provider')
        self.service = Service.objects.create(provider=provider, title='Tutoring for Calc II')
        author = make_user('svcrev-author')
        self.review = ServiceReview.objects.create(
            service=self.service, author=author, rating=1, body='Rude and unhelpful.'
        )

    def _report_as_new_users(self, object_id, count=1):
        for i in range(count):
            reporter = make_user(f'svcrev-reporter-{i}')
            self.client.force_authenticate(reporter)
            response = _report(self.client, 'service_review', object_id)
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_reporting_a_tutor_review_queues_it_and_a_moderator_can_remove_it(self):
        self._report_as_new_users(self.review.pk)

        self.client.force_authenticate(self.moderator)
        response = self.client.get(reverse('moderation-queue'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        groups = [
            g for g in response.data['reports']
            if g['kind'] == 'service_review' and g['object_id'] == self.review.pk
        ]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['preview'], 'Rude and unhelpful.')
        self.assertFalse(groups[0]['is_auto_hidden'])
        self.assertIsNone(groups[0]['view_count'])

        response = self.client.post(
            reverse(
                'moderation-report-action',
                kwargs={'kind': 'service_review', 'pk': self.review.pk, 'decision': 'remove'},
            ),
            {}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.review.refresh_from_db()
        self.assertTrue(self.review.is_removed)

        # A removed review disappears from the tutor's own reviews list and rating aggregate.
        self.client.force_authenticate(None)
        reviews = self.client.get(reverse('service-reviews', kwargs={'pk': self.service.pk}))
        self.assertEqual(reviews.status_code, status.HTTP_200_OK)
        self.assertEqual(len(reviews.data), 0)
        detail = self.client.get(reverse('service-detail', kwargs={'pk': self.service.pk}))
        self.assertEqual(detail.data['review_count'], 0)
        self.assertIsNone(detail.data['average_rating'])

    def test_a_non_moderator_cannot_remove_a_reported_tutor_review(self):
        self._report_as_new_users(self.review.pk)

        self.client.force_authenticate(make_user('svcrev-not-a-mod'))
        response = self.client.post(
            reverse(
                'moderation-report-action',
                kwargs={'kind': 'service_review', 'pk': self.review.pk, 'decision': 'remove'},
            ),
            {}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.review.refresh_from_db()
        self.assertFalse(self.review.is_removed)  # untouched


def _grant(user, kind, node, granted_by=None):
    content_type = ContentType.objects.get_for_model(type(node))
    return NodeGovernor.objects.create(
        user=user, content_type=content_type, object_id=node.pk, granted_by=granted_by
    )


class NodeGovernorHelperTests(APITestCase):
    """Direct tests of `is_governor_of_course`/`governed_branch_ids` (moderation/services.py) — the
    "node governor" feature's own core scoping logic, exercised independently of any one HTTP view."""

    def setUp(self):
        self.course_a1 = make_course('gov-helper-a1', discipline_slug='matematyka')
        self.course_a2 = make_course('gov-helper-a2', discipline_slug='matematyka')
        self.course_b1 = make_course('gov-helper-b1', discipline_slug='fizyka')
        self.field_a = Discipline.objects.get(slug='matematyka')

    def test_global_staff_governs_every_course_and_is_unscoped(self):
        staff = make_user('helper-staff', is_staff=True)

        self.assertTrue(is_governor_of_course(staff, self.course_a1))
        self.assertTrue(is_governor_of_course(staff, self.course_b1))
        self.assertIsNone(governed_branch_ids(staff))

    def test_a_course_level_grant_is_scoped_to_just_that_course(self):
        governor = make_user('helper-branch-gov')
        _grant(governor, 'branch', self.course_a1)

        self.assertTrue(is_governor_of_course(governor, self.course_a1))
        self.assertFalse(is_governor_of_course(governor, self.course_a2))
        self.assertFalse(is_governor_of_course(governor, self.course_b1))
        self.assertEqual(governed_branch_ids(governor), {self.course_a1.pk})

    def test_a_field_level_grant_cascades_to_every_course_in_that_field(self):
        governor = make_user('helper-field-gov')
        _grant(governor, 'discipline', self.field_a)

        self.assertTrue(is_governor_of_course(governor, self.course_a1))
        self.assertTrue(is_governor_of_course(governor, self.course_a2))
        self.assertFalse(is_governor_of_course(governor, self.course_b1))
        self.assertEqual(governed_branch_ids(governor), {self.course_a1.pk, self.course_a2.pk})

    def test_a_user_with_no_grants_governs_nothing(self):
        plain = make_user('helper-plain')

        self.assertFalse(is_governor_of_course(plain, self.course_a1))
        self.assertEqual(governed_branch_ids(plain), set())

    def test_an_unresolvable_course_is_a_safe_default_deny_for_a_non_staff_user(self):
        governor = make_user('helper-branch-gov2')
        _grant(governor, 'branch', self.course_a1)

        self.assertFalse(is_governor_of_course(governor, None))


class ModerationActionScopingTests(APITestCase):
    """A node governor's OBJECT-level authority, exercised through the real
    ModerationActionView.post() endpoint — approving a submission outside their own governed
    course(s) must fail with a clean 403, never silently succeed."""

    def setUp(self):
        self.course_a = make_course('scope-branch-a', discipline_slug='matematyka')
        self.course_b = make_course('scope-branch-b', discipline_slug='matematyka')
        self.other_field_course = make_course('scope-branch-c', discipline_slug='fizyka')
        self.field = Discipline.objects.get(slug='matematyka')

    def _submission_for(self, branch):
        from moderation.models import ExerciseSubmission

        return ExerciseSubmission.objects.create(
            branch=branch,
            submitted_by=make_user(f'scope-student-{branch.slug}'),
            payload={'difficulty': 'easy', 'locale': 'pl', 'title': 'T', 'statement': 'S'},
        )

    def test_course_governor_can_approve_a_submission_in_their_own_course(self):
        governor = make_user('scope-branch-gov')
        _grant(governor, 'branch', self.course_a)
        submission = self._submission_for(self.course_a)
        self.client.force_authenticate(governor)

        response = self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'approve'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_course_governor_cannot_approve_a_submission_in_a_different_course(self):
        governor = make_user('scope-branch-gov2')
        _grant(governor, 'branch', self.course_a)
        submission = self._submission_for(self.course_b)
        self.client.force_authenticate(governor)

        response = self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'approve'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        submission.refresh_from_db()
        self.assertEqual(submission.status, 'pending')

    def test_field_governor_can_approve_items_in_any_course_under_their_field(self):
        governor = make_user('scope-field-gov')
        _grant(governor, 'discipline', self.field)
        submission = self._submission_for(self.course_b)
        self.client.force_authenticate(governor)

        response = self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'approve'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_field_governor_cannot_approve_items_outside_their_own_field(self):
        governor = make_user('scope-field-gov2')
        _grant(governor, 'discipline', self.field)
        submission = self._submission_for(self.other_field_course)
        self.client.force_authenticate(governor)

        response = self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'approve'},
            ),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        submission.refresh_from_db()
        self.assertEqual(submission.status, 'pending')


class ModerationQueueScopingTests(APITestCase):
    """The moderation queue itself (ModerationQueueView -> build_moderation_queue_payload) — a
    scoped governor should see only their own course(s); a real global moderator's own experience
    must stay completely unfiltered, unchanged."""

    def test_a_course_governor_only_sees_their_own_courses_pending_items(self):
        from moderation.models import ExerciseSubmission

        course_a = make_course('queue-scope-a')
        course_b = make_course('queue-scope-b')
        sub_a = ExerciseSubmission.objects.create(
            branch=course_a, submitted_by=make_user('queue-s1'), payload={'title': 'A'}
        )
        ExerciseSubmission.objects.create(
            branch=course_b, submitted_by=make_user('queue-s2'), payload={'title': 'B'}
        )
        governor = make_user('queue-gov')
        _grant(governor, 'branch', course_a)
        self.client.force_authenticate(governor)

        response = self.client.get(reverse('moderation-queue'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        submission_ids = {s['id'] for s in response.data['submissions']}
        self.assertEqual(submission_ids, {sub_a.pk})

    def test_global_staff_still_sees_every_pending_item_unfiltered(self):
        from moderation.models import ExerciseSubmission

        course_a = make_course('queue-scope-c')
        course_b = make_course('queue-scope-d')
        sub_a = ExerciseSubmission.objects.create(
            branch=course_a, submitted_by=make_user('queue-s3'), payload={'title': 'A'}
        )
        sub_b = ExerciseSubmission.objects.create(
            branch=course_b, submitted_by=make_user('queue-s4'), payload={'title': 'B'}
        )
        self.client.force_authenticate(make_user('queue-staff', is_staff=True))

        response = self.client.get(reverse('moderation-queue'))

        submission_ids = {s['id'] for s in response.data['submissions']}
        self.assertEqual(submission_ids, {sub_a.pk, sub_b.pk})


class IsModeratorGateTests(APITestCase):
    """The coarse VIEW-level gate — anyone with at least one real grant can reach the moderation
    surface at all; a plain authenticated user with none is forbidden, same as before this feature
    existed."""

    def test_a_node_governor_with_any_grant_can_reach_the_queue(self):
        branch = make_course('gate-branch')
        governor = make_user('gate-gov')
        _grant(governor, 'branch', branch)
        self.client.force_authenticate(governor)

        response = self.client.get(reverse('moderation-queue'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_a_user_with_no_grants_at_all_is_forbidden(self):
        self.client.force_authenticate(make_user('gate-no-grants'))

        response = self.client.get(reverse('moderation-queue'))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class NodeGovernorGrantApiTests(APITestCase):
    """The actual administration panel this feature is named for — granting/revoking a
    NodeGovernor row via `NodeGovernorViewSet` (moderation/views.py)."""

    def setUp(self):
        self.staff = make_user('grant-staff', is_staff=True)
        self.branch = make_course('grant-branch')

    def test_staff_can_grant_a_course_level_governor(self):
        target = make_user('future-branch-gov')
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            reverse('node-governor-list'),
            {'user': target.pk, 'kind': 'branch', 'node_slug': self.branch.slug},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(NodeGovernor.objects.filter(user=target).exists())
        self.assertEqual(response.data['node_type'], 'branch')
        self.assertEqual(response.data['node_id'], self.branch.slug)

    def test_staff_can_grant_a_field_level_governor(self):
        target = make_user('future-field-gov')
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            reverse('node-governor-list'),
            {'user': target.pk, 'kind': 'discipline', 'node_slug': 'matematyka'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['node_type'], 'discipline')

    def test_a_duplicate_grant_is_rejected(self):
        target = make_user('dup-gov')
        _grant(target, 'branch', self.branch, granted_by=self.staff)
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            reverse('node-governor-list'),
            {'user': target.pk, 'kind': 'branch', 'node_slug': self.branch.slug},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(NodeGovernor.objects.filter(user=target).count(), 1)

    def test_a_nonexistent_node_slug_is_rejected(self):
        target = make_user('bad-slug-gov')
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            reverse('node-governor-list'),
            {'user': target.pk, 'kind': 'branch', 'node_slug': 'does-not-exist'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_non_staff_user_cannot_grant_a_governor(self):
        target = make_user('another-target')
        self.client.force_authenticate(make_user('not-staff-either'))

        response = self.client.post(
            reverse('node-governor-list'),
            {'user': target.pk, 'kind': 'branch', 'node_slug': self.branch.slug},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_can_revoke_a_grant(self):
        target = make_user('revoke-me')
        grant = _grant(target, 'branch', self.branch, granted_by=self.staff)
        self.client.force_authenticate(self.staff)

        response = self.client.delete(reverse('node-governor-detail', kwargs={'pk': grant.pk}))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(NodeGovernor.objects.filter(pk=grant.pk).exists())

    def test_non_staff_user_only_sees_their_own_grants_in_the_list(self):
        user_a = make_user('list-user-a')
        user_b = make_user('list-user-b')
        _grant(user_a, 'branch', self.branch, granted_by=self.staff)
        _grant(user_b, 'branch', self.branch, granted_by=self.staff)
        self.client.force_authenticate(user_a)

        response = self.client.get(reverse('node-governor-list'))

        user_ids = {row['user'] for row in response.data}
        self.assertEqual(user_ids, {user_a.pk})

    def test_staff_sees_every_grant_in_the_list(self):
        user_a = make_user('list-user-c')
        user_b = make_user('list-user-d')
        _grant(user_a, 'branch', self.branch, granted_by=self.staff)
        _grant(user_b, 'branch', self.branch, granted_by=self.staff)
        self.client.force_authenticate(self.staff)

        response = self.client.get(reverse('node-governor-list'))

        user_ids = {row['user'] for row in response.data}
        self.assertEqual(user_ids, {user_a.pk, user_b.pk})


class FeatureFlagTests(APITestCase):
    """The 4 kill switches (moderation/models.py's FeatureFlag) — seeded by migration
    0009_seed_feature_flags, all enabled by default. `is_feature_enabled` itself (a plain helper,
    not an HTTP-shaped test) is covered directly here too, since it's the one place both the
    ViewSet's own read side and every `feature_gate`-protected endpoint elsewhere ultimately read
    from."""

    def setUp(self):
        self.staff = make_user('flag-staff', is_staff=True)
        self.plain_user = make_user('flag-plain')

    def test_is_feature_enabled_fails_open_for_a_missing_row(self):
        FeatureFlag.objects.filter(key='tutoring').delete()
        self.assertTrue(is_feature_enabled('tutoring'))

    def test_list_is_public_and_returns_all_seeded_flags(self):
        response = self.client.get(reverse('feature-flag-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        keys = {row['key'] for row in response.data}
        self.assertEqual(
            keys,
            {
                'tutoring',
                'courses',
                'messaging',
                'exercise_submissions',
                'material_submissions',
                'events',
                'material_uploads_verified_only',
            },
        )
        # The 6 plain kill switches are seeded on; `material_uploads_verified_only` is the one,
        # deliberately-inverted-semantics exception (0011's own seed migration) — its own
        # dedicated MaterialUploadVerifiedContributorGateTests covers its actual on/off behavior.
        by_key = {row['key']: row['is_enabled'] for row in response.data}
        self.assertTrue(
            all(
                by_key[k]
                for k in (
                    'tutoring',
                    'courses',
                    'messaging',
                    'exercise_submissions',
                    'material_submissions',
                    'events',
                )
            )
        )
        self.assertFalse(by_key['material_uploads_verified_only'])

    def test_non_staff_cannot_toggle_a_flag(self):
        self.client.force_authenticate(self.plain_user)

        response = self.client.patch(
            reverse('feature-flag-detail', kwargs={'key': 'tutoring'}), {'is_enabled': False}
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(FeatureFlag.objects.get(key='tutoring').is_enabled)

    def test_anonymous_cannot_toggle_a_flag(self):
        response = self.client.patch(
            reverse('feature-flag-detail', kwargs={'key': 'tutoring'}), {'is_enabled': False}
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_staff_can_toggle_a_flag_and_updated_by_is_recorded(self):
        self.client.force_authenticate(self.staff)

        response = self.client.patch(
            reverse('feature-flag-detail', kwargs={'key': 'tutoring'}), {'is_enabled': False}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        flag = FeatureFlag.objects.get(key='tutoring')
        self.assertFalse(flag.is_enabled)
        self.assertEqual(flag.updated_by, self.staff)

    def test_exercise_submissions_flag_off_blocks_non_staff(self):
        FeatureFlag.objects.filter(key='exercise_submissions').update(is_enabled=False)
        branch = make_course(slug='uw-flag-am2')
        self.client.force_authenticate(self.plain_user)

        response = self.client.get(reverse('exercise-submission-list'))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_exercise_submissions_flag_off_still_allows_staff(self):
        FeatureFlag.objects.filter(key='exercise_submissions').update(is_enabled=False)
        self.client.force_authenticate(self.staff)

        response = self.client.get(reverse('exercise-submission-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_material_submissions_flag_off_blocks_non_staff(self):
        FeatureFlag.objects.filter(key='material_submissions').update(is_enabled=False)
        self.client.force_authenticate(self.plain_user)

        response = self.client.get(reverse('material-submission-list'))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_flag_back_on_restores_access(self):
        FeatureFlag.objects.filter(key='exercise_submissions').update(is_enabled=False)
        self.client.force_authenticate(self.plain_user)
        self.assertEqual(
            self.client.get(reverse('exercise-submission-list')).status_code, status.HTTP_403_FORBIDDEN
        )

        FeatureFlag.objects.filter(key='exercise_submissions').update(is_enabled=True)

        self.assertEqual(
            self.client.get(reverse('exercise-submission-list')).status_code, status.HTTP_200_OK
        )


# --- a submitted material image is re-encoded, a document is not ----------------------------------
#
# Appended at the end so the whole change to this module is contiguous.


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


class MaterialSubmissionImageTests(_TempMediaRootMixin, APITestCase):
    """A material is published through a PUBLIC endpoint, so a phone photo submitted as one used to
    put the coordinates of the room it was taken in in front of the whole site.

    Every assertion is on the STORED file rather than on the response, because the response was
    always fine — the leak was in the bytes on disk.
    """

    def setUp(self):
        cache.clear()
        self.branch = make_course(slug='uw-material-image-branch')
        self.student = make_user('matimg_student')

    def _submit(self, filename, content, **overrides):
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.client.force_authenticate(self.student)
        data = {
            'branch': self.branch.slug,
            'type': 'practice_test',
            'title': 'A photographed page',
            'description': 'Real practice problems.',
            'locale': 'en',
            'file': SimpleUploadedFile(filename, content),
            **overrides,
        }
        return self.client.post('/api/material-submissions/', data, format='multipart')

    def _stored(self, response):
        from moderation.models import MaterialSubmission

        return MaterialSubmission.objects.get(pk=response.data['id']).file

    def test_a_photo_loses_its_exif_and_its_gps(self):
        from PIL import Image

        original = _material_image_bytes(exif=_phone_exif())
        self.assertIn(b'ACME Phone', original, 'the fixture must really carry what we strip')

        response = self._submit('board.jpg', original)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        with Image.open(self._stored(response).path) as stored:
            self.assertEqual(dict(stored.getexif()), {})
            self.assertEqual(dict(stored.getexif().get_ifd(0x8825)), {})

    def test_the_stored_bytes_are_not_the_uploaded_bytes(self):
        original = _material_image_bytes(exif=_phone_exif())

        response = self._submit('board.jpg', original)

        with open(self._stored(response).path, 'rb') as handle:
            self.assertNotEqual(handle.read(), original)

    def test_it_keeps_its_shape_rather_than_being_cropped_square(self):
        """A material image is a scan of a page: centre-cropping takes the ends off exactly the
        content that runs to the edges."""
        from PIL import Image

        response = self._submit('board.jpg', _material_image_bytes(3600, 1800))

        with Image.open(self._stored(response).path) as stored:
            self.assertEqual(stored.width, 2 * stored.height)

    def test_a_large_scan_is_bounded(self):
        from PIL import Image

        response = self._submit('board.jpg', _material_image_bytes(3600, 1800))

        with Image.open(self._stored(response).path) as stored:
            self.assertLessEqual(max(stored.size), 2400)

    def test_a_small_scan_is_not_blown_up(self):
        """Upscaling would add bytes and invent detail the source never had."""
        from PIL import Image

        response = self._submit('board.png', _material_image_bytes(800, 600, fmt='PNG'))

        with Image.open(self._stored(response).path) as stored:
            self.assertEqual(stored.size, (800, 600))

    def test_a_pdf_is_stored_byte_for_byte(self):
        """The half of the old promise that is kept: for a document the bytes ARE the thing, and
        rewriting them would corrupt the file while claiming to clean it."""
        original = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

        response = self._submit('paper.pdf', original)

        with open(self._stored(response).path, 'rb') as handle:
            self.assertEqual(handle.read(), original)

    def test_an_approved_material_carries_the_cleaned_file(self):
        """The strip happens at submission, and approval points the real Material at that same
        stored file — so the published one is clean without a second pass."""
        from PIL import Image

        from moderation.models import MaterialSubmission

        response = self._submit('board.jpg', _material_image_bytes(exif=_phone_exif()))
        submission = MaterialSubmission.objects.get(pk=response.data['id'])

        moderator = make_user('matimg_mod', is_staff=True)
        self.client.force_authenticate(moderator)
        decision = self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'},
            ),
            {},
            format='json',
        )
        self.assertEqual(decision.status_code, status.HTTP_200_OK, decision.data)

        submission.refresh_from_db()
        with Image.open(submission.resulting_material.file.path) as published:
            self.assertEqual(dict(published.getexif()), {})


class ModerationQueueCountTests(APITestCase):
    """`GET /api/moderation/queue/count/` — the number behind the navigation badge.

    Its own endpoint so a badge does not fetch and serialize the whole queue, which means the thing
    to pin is that it AGREES with the queue: a count that disagreed with the page it links to would
    be worse than no count.
    """

    def setUp(self):
        self.branch = make_course('count-branch')
        self.moderator = make_user('count-mod', is_staff=True)

    def count(self, user):
        self.client.force_authenticate(user)
        return self.client.get(reverse('moderation-queue-count'))

    def test_an_empty_queue_counts_zero(self):
        response = self.count(self.moderator)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total'], 0)

    def test_it_counts_a_pending_submission(self):
        from moderation.models import ExerciseSubmission

        ExerciseSubmission.objects.create(
            branch=self.branch, submitted_by=make_user('count-s1'), payload={'title': 'A'}
        )

        response = self.count(self.moderator)

        self.assertEqual(response.data['submissions'], 1)
        self.assertEqual(response.data['total'], 1)

    def test_a_decided_one_stops_counting(self):
        from moderation.models import ExerciseSubmission

        submission = ExerciseSubmission.objects.create(
            branch=self.branch, submitted_by=make_user('count-s2'), payload={'title': 'A'}
        )
        submission.status = 'approved'
        submission.save(update_fields=['status'])

        self.assertEqual(self.count(self.moderator).data['total'], 0)

    def test_several_reports_on_one_thing_count_as_one_decision(self):
        """The unit somebody acts on is the target, not the report row — three people objecting to
        one comment is one thing to decide. The queue groups them, so the count has to as well."""
        exercise = make_exercise(self.branch, 9100)
        content_type = ContentType.objects.get_for_model(Exercise)
        for i in range(3):
            Report.objects.create(
                content_type=content_type,
                object_id=exercise.pk,
                reported_by=make_user(f'count-r{i}'),
                reason='x',
            )

        response = self.count(self.moderator)

        self.assertEqual(response.data['reports'], 1)
        self.assertEqual(response.data['total'], 1)

    def test_it_agrees_with_the_queue_it_links_to(self):
        """The one property worth pinning, since the two are computed separately on purpose."""
        from moderation.models import EditSuggestion, ExerciseSubmission

        exercise = make_exercise(self.branch, 9101)
        ExerciseSubmission.objects.create(
            branch=self.branch, submitted_by=make_user('count-a1'), payload={'title': 'A'}
        )
        EditSuggestion.objects.create(
            exercise=exercise,
            locale='pl',
            field='hint',
            proposed_value='better',
            submitted_by=make_user('count-a2'),
        )

        self.client.force_authenticate(self.moderator)
        queue = self.client.get(reverse('moderation-queue')).data
        count = self.client.get(reverse('moderation-queue-count')).data

        from_queue = (
            len(queue['submissions'])
            + len(queue['material_submissions'])
            + len(queue['edit_suggestions'])
            + len(queue['translations'])
            + len(queue['reports'])
            + len(queue['taxonomy_proposals'])
        )
        self.assertEqual(count['total'], from_queue)

    def test_somebody_who_moderates_nothing_is_refused(self):
        response = self.count(make_user('count-nobody'))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_governor_counts_only_their_own_scope(self):
        """Scoped exactly as the queue is — a badge that counted the whole platform would send a
        governor to a page showing them a fraction of it."""
        from moderation.models import ExerciseSubmission

        mine = make_course('count-mine')
        theirs = make_course('count-theirs')
        ExerciseSubmission.objects.create(
            branch=mine, submitted_by=make_user('count-g1'), payload={'title': 'mine'}
        )
        ExerciseSubmission.objects.create(
            branch=theirs, submitted_by=make_user('count-g2'), payload={'title': 'theirs'}
        )
        governor = make_user('count-gov')
        _grant(governor, 'branch', mine)

        response = self.count(governor)

        self.assertEqual(response.data['submissions'], 1)
