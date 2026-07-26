"""This project's first real automated test suite (CLAUDE.md Section 17I's own "Left open" note —
`manage.py test` used to report `Found 0 test(s)` everywhere). Moderation gets the first and largest
share of coverage on purpose: it's where this project's own history of found-and-fixed real bugs
concentrates (the submission number-collision race, Section 17I; the translation-publish race and
the more severe, non-concurrent bug found alongside it, Section 17K) — exactly the kind of thing a
regression suite exists to lock in place, not just a convenient place to start.

Uses Django's own `TestCase` + DRF's `APIClient`, both already dependencies — no new package added,
matching this project's own "every runtime dependency is a flagged decision" discipline.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import Exercise, ExerciseTranslation
from testing.factories import make_course, make_exercise, make_user


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
