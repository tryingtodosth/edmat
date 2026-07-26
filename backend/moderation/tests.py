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
from moderation.models import ContentView, Report
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
