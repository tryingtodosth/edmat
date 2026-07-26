"""This project's first real automated test suite (CLAUDE.md Section 17I's own "Left open" note —
`manage.py test` used to report `Found 0 test(s)` everywhere). Moderation gets the first and largest
share of coverage on purpose: it's where this project's own history of found-and-fixed real bugs
concentrates (the submission number-collision race, Section 17I; the translation-publish race and
the more severe, non-concurrent bug found alongside it, Section 17K) — exactly the kind of thing a
regression suite exists to lock in place, not just a convenient place to start.

Uses Django's own `TestCase` + DRF's `APIClient`, both already dependencies — no new package added,
matching this project's own "every runtime dependency is a flagged decision" discipline.
"""

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import Comment
from exercises.models import Exercise, ExerciseTranslation
from moderation.models import ContentView, NodeGovernor, Report
from moderation.services import governed_course_ids, is_governor_of_course
from taxonomy.models import Field
from testing.factories import make_course, make_exercise, make_user, make_viewer


class TranslationApprovalTests(APITestCase):
    """Regression tests for CLAUDE.md Section 17K's fix. Each one mirrors a scenario that was
    reproduced LIVE (against a real, running server, or a direct ORM call) before this suite existed
    — see that section for the full story of why each one used to fail deterministically, not just
    under concurrency."""

    def setUp(self):
        self.moderator = make_user('mod', is_staff=True)
        self.course = make_course()
        self.exercise = make_exercise(self.course, 1)
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
        self.course = make_course(slug='uw-submission-course')
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
            course=self.course, submitted_by=self.student, payload=payload
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
        self.assertEqual(exercise.course, self.course)
        translation = exercise.translations.get(locale='pl')
        self.assertEqual(translation.title, 'A submitted exercise')
        self.assertEqual(translation.status, 'published')

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
        self.assertEqual(Exercise.objects.filter(course=self.course).count(), 0)

    def test_double_decision_on_the_same_submission_returns_conflict(self):
        submission = self._submit()
        url = reverse(
            'moderation-action', kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'approve'}
        )

        first = self.client.post(url, {}, format='json')
        second = self.client.post(url, {}, format='json')

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(Exercise.objects.filter(course=self.course).count(), 1)

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


class MaterialSubmissionApiTests(APITestCase):
    """`POST /api/material-submissions/` — the real, multipart upload endpoint itself (as opposed
    to the validators it calls, covered above)."""

    def setUp(self):
        self.course = make_course(slug='uw-material-submission-course')
        self.student = make_user('matsub_student')
        self.other_student = make_user('matsub_other_student')

    def _upload(self, client, **overrides):
        from django.core.files.uploadedfile import SimpleUploadedFile

        data = {
            'course': self.course.slug,
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


class MaterialSubmissionApprovalTests(APITestCase):
    """Approve/reject via the shared ModerationActionView, the same real endpoint every other kind
    (submission/edit/translation) already goes through — `_apply_material_submission`'s own real
    behavior (a new, published Material + MaterialTranslation) is what's under test here, not the
    upload endpoint itself (MaterialSubmissionApiTests, above)."""

    def setUp(self):
        self.moderator = make_user('matsub_approve_mod', is_staff=True)
        self.student = make_user('matsub_approve_student')
        self.course = make_course(slug='uw-material-approval-course')
        self.client.force_authenticate(self.moderator)

    def _submit(self, **overrides):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from moderation.models import MaterialSubmission

        defaults = {
            'course': self.course,
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
        self.assertEqual(material.course, self.course)
        self.assertTrue(material.published)
        self.assertEqual(material.type, 'exam_collection')
        translation = material.translations.get(locale='en')
        self.assertEqual(translation.title, 'A submitted exam collection')
        # The SAME already-uploaded file, not a re-saved copy under a new path.
        self.assertEqual(material.file.name, submission.file.name)

    def test_rejecting_a_material_submission_never_creates_a_material(self):
        submission = self._submit()

        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'reject'}),
            {'review_note': 'Wrong course.'},
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
        from taxonomy.models import Course

        other_course = make_course(slug='uw-material-approval-other-course')
        governor = make_user('matsub_approve_governor')
        NodeGovernor.objects.create(user=governor, content_type=ContentType.objects.get_for_model(Course), object_id=other_course.pk)
        submission = self._submit()

        self.client.force_authenticate(governor)
        response = self.client.post(
            reverse('moderation-action', kwargs={'kind': 'material', 'pk': submission.pk, 'decision': 'approve'}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class EditSuggestionApprovalTests(APITestCase):
    def setUp(self):
        self.moderator = make_user('mod3', is_staff=True)
        self.course = make_course(slug='uw-edit-course')
        self.exercise = make_exercise(self.course, 1)
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
        self.course = make_course()
        self.exercise = make_exercise(self.course, 1)

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


class ReportActionViewTests(APITestCase):
    def setUp(self):
        self.moderator = make_user('report-mod', is_staff=True)
        self.course = make_course()
        self.exercise = make_exercise(self.course, 1)
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

    def _hidden_exercise_in(self, course):
        exercise = make_exercise(course, 1)
        _record_views(exercise, 10)
        for i in range(3):
            reporter = make_user(f'rep-scope-{course.slug}-{i}')
            self.client.force_authenticate(reporter)
            _report(self.client, 'exercise', exercise.pk)
        exercise.refresh_from_db()
        assert exercise.auto_hidden_at is not None
        return exercise

    def test_a_course_governor_can_restore_an_auto_hidden_exercise_in_their_own_course(self):
        course = make_course('report-scope-a')
        exercise = self._hidden_exercise_in(course)
        governor = make_user('report-scope-gov')
        _grant(governor, 'course', course)
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
        _grant(governor, 'course', governed_course)
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
        _grant(governor, 'course', governed_course)
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
        course = make_course()
        exercise = make_exercise(course, 1)
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


def _grant(user, kind, node, granted_by=None):
    content_type = ContentType.objects.get_for_model(type(node))
    return NodeGovernor.objects.create(
        user=user, content_type=content_type, object_id=node.pk, granted_by=granted_by
    )


class NodeGovernorHelperTests(APITestCase):
    """Direct tests of `is_governor_of_course`/`governed_course_ids` (moderation/services.py) — the
    "node governor" feature's own core scoping logic, exercised independently of any one HTTP view."""

    def setUp(self):
        self.course_a1 = make_course('gov-helper-a1', field_slug='matematyka')
        self.course_a2 = make_course('gov-helper-a2', field_slug='matematyka')
        self.course_b1 = make_course('gov-helper-b1', field_slug='fizyka')
        self.field_a = Field.objects.get(slug='matematyka')

    def test_global_staff_governs_every_course_and_is_unscoped(self):
        staff = make_user('helper-staff', is_staff=True)

        self.assertTrue(is_governor_of_course(staff, self.course_a1))
        self.assertTrue(is_governor_of_course(staff, self.course_b1))
        self.assertIsNone(governed_course_ids(staff))

    def test_a_course_level_grant_is_scoped_to_just_that_course(self):
        governor = make_user('helper-course-gov')
        _grant(governor, 'course', self.course_a1)

        self.assertTrue(is_governor_of_course(governor, self.course_a1))
        self.assertFalse(is_governor_of_course(governor, self.course_a2))
        self.assertFalse(is_governor_of_course(governor, self.course_b1))
        self.assertEqual(governed_course_ids(governor), {self.course_a1.pk})

    def test_a_field_level_grant_cascades_to_every_course_in_that_field(self):
        governor = make_user('helper-field-gov')
        _grant(governor, 'field', self.field_a)

        self.assertTrue(is_governor_of_course(governor, self.course_a1))
        self.assertTrue(is_governor_of_course(governor, self.course_a2))
        self.assertFalse(is_governor_of_course(governor, self.course_b1))
        self.assertEqual(governed_course_ids(governor), {self.course_a1.pk, self.course_a2.pk})

    def test_a_user_with_no_grants_governs_nothing(self):
        plain = make_user('helper-plain')

        self.assertFalse(is_governor_of_course(plain, self.course_a1))
        self.assertEqual(governed_course_ids(plain), set())

    def test_an_unresolvable_course_is_a_safe_default_deny_for_a_non_staff_user(self):
        governor = make_user('helper-course-gov2')
        _grant(governor, 'course', self.course_a1)

        self.assertFalse(is_governor_of_course(governor, None))


class ModerationActionScopingTests(APITestCase):
    """A node governor's OBJECT-level authority, exercised through the real
    ModerationActionView.post() endpoint — approving a submission outside their own governed
    course(s) must fail with a clean 403, never silently succeed."""

    def setUp(self):
        self.course_a = make_course('scope-course-a', field_slug='matematyka')
        self.course_b = make_course('scope-course-b', field_slug='matematyka')
        self.other_field_course = make_course('scope-course-c', field_slug='fizyka')
        self.field = Field.objects.get(slug='matematyka')

    def _submission_for(self, course):
        from moderation.models import ExerciseSubmission

        return ExerciseSubmission.objects.create(
            course=course,
            submitted_by=make_user(f'scope-student-{course.slug}'),
            payload={'difficulty': 'easy', 'locale': 'pl', 'title': 'T', 'statement': 'S'},
        )

    def test_course_governor_can_approve_a_submission_in_their_own_course(self):
        governor = make_user('scope-course-gov')
        _grant(governor, 'course', self.course_a)
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
        governor = make_user('scope-course-gov2')
        _grant(governor, 'course', self.course_a)
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
        _grant(governor, 'field', self.field)
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
        _grant(governor, 'field', self.field)
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
            course=course_a, submitted_by=make_user('queue-s1'), payload={'title': 'A'}
        )
        ExerciseSubmission.objects.create(
            course=course_b, submitted_by=make_user('queue-s2'), payload={'title': 'B'}
        )
        governor = make_user('queue-gov')
        _grant(governor, 'course', course_a)
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
            course=course_a, submitted_by=make_user('queue-s3'), payload={'title': 'A'}
        )
        sub_b = ExerciseSubmission.objects.create(
            course=course_b, submitted_by=make_user('queue-s4'), payload={'title': 'B'}
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
        course = make_course('gate-course')
        governor = make_user('gate-gov')
        _grant(governor, 'course', course)
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
        self.course = make_course('grant-course')

    def test_staff_can_grant_a_course_level_governor(self):
        target = make_user('future-course-gov')
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            reverse('node-governor-list'),
            {'user': target.pk, 'kind': 'course', 'node_slug': self.course.slug},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(NodeGovernor.objects.filter(user=target).exists())
        self.assertEqual(response.data['node_type'], 'course')
        self.assertEqual(response.data['node_id'], self.course.slug)

    def test_staff_can_grant_a_field_level_governor(self):
        target = make_user('future-field-gov')
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            reverse('node-governor-list'),
            {'user': target.pk, 'kind': 'field', 'node_slug': 'matematyka'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['node_type'], 'field')

    def test_a_duplicate_grant_is_rejected(self):
        target = make_user('dup-gov')
        _grant(target, 'course', self.course, granted_by=self.staff)
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            reverse('node-governor-list'),
            {'user': target.pk, 'kind': 'course', 'node_slug': self.course.slug},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(NodeGovernor.objects.filter(user=target).count(), 1)

    def test_a_nonexistent_node_slug_is_rejected(self):
        target = make_user('bad-slug-gov')
        self.client.force_authenticate(self.staff)

        response = self.client.post(
            reverse('node-governor-list'),
            {'user': target.pk, 'kind': 'course', 'node_slug': 'does-not-exist'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_non_staff_user_cannot_grant_a_governor(self):
        target = make_user('another-target')
        self.client.force_authenticate(make_user('not-staff-either'))

        response = self.client.post(
            reverse('node-governor-list'),
            {'user': target.pk, 'kind': 'course', 'node_slug': self.course.slug},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_can_revoke_a_grant(self):
        target = make_user('revoke-me')
        grant = _grant(target, 'course', self.course, granted_by=self.staff)
        self.client.force_authenticate(self.staff)

        response = self.client.delete(reverse('node-governor-detail', kwargs={'pk': grant.pk}))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(NodeGovernor.objects.filter(pk=grant.pk).exists())

    def test_non_staff_user_only_sees_their_own_grants_in_the_list(self):
        user_a = make_user('list-user-a')
        user_b = make_user('list-user-b')
        _grant(user_a, 'course', self.course, granted_by=self.staff)
        _grant(user_b, 'course', self.course, granted_by=self.staff)
        self.client.force_authenticate(user_a)

        response = self.client.get(reverse('node-governor-list'))

        user_ids = {row['user'] for row in response.data}
        self.assertEqual(user_ids, {user_a.pk})

    def test_staff_sees_every_grant_in_the_list(self):
        user_a = make_user('list-user-c')
        user_b = make_user('list-user-d')
        _grant(user_a, 'course', self.course, granted_by=self.staff)
        _grant(user_b, 'course', self.course, granted_by=self.staff)
        self.client.force_authenticate(self.staff)

        response = self.client.get(reverse('node-governor-list'))

        user_ids = {row['user'] for row in response.data}
        self.assertEqual(user_ids, {user_a.pk, user_b.pk})
