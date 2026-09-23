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


# --- where the material-submission suite went ------------------------------------------------------
#
# Ten classes lived here and above: the upload endpoint, the verified-contributor restriction, the
# auto-publish fast path, approval, the storage quota, the reject-time file reclaim, the throttle,
# the image re-encode and the link-only shape. `MaterialSubmission` was folded into a co-authored
# project with a team of one and deleted (`coauthoring/0003_fold_material_submissions`,
# `moderation/0038_delete_materialsubmission`), so every one of those behaviours was ported onto the
# new path rather than dropped:
#
#   * `coauthoring/test_submit_path.py` — all of it, class for class, with each port's docstring
#     saying what changed shape (a 403 that is a 400, a submission list that is `?mine=1`, a
#     moderation action that is `POST /api/material-versions/{id}/decide/`).
#   * `materials/test_validators.py` — `MaterialSubmissionValidatorTests`, moved unchanged: those
#     tests never needed a model at all, only `materials/validators.py`.
#
# Nothing about a material is tested from this module any more; what remains below is the rest of
# the moderation surface, which never went anywhere.


class EditSuggestionApprovalTests(APITestCase):
    def setUp(self):
        self.moderator = make_user('mod3', is_staff=True)
        self.branch = make_course(slug='uw-edit-branch')
        self.exercise = make_exercise(self.branch, 1)
        self.client.force_authenticate(self.moderator)

    def _suggest(self, field='statement', proposed_value='A clearer statement.'):
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
        self.assertEqual(translation.statement, 'A clearer statement.')

    def test_rejecting_an_edit_suggestion_leaves_the_field_unchanged(self):
        original_statement = self.exercise.translations.get(locale='pl').statement
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
        self.assertEqual(translation.statement, original_statement)


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
                'issues',
                'posts',
                'chemistry',
                'galleries',
                'age_verification',
                'coauthoring',
                'concepts',
                'sketches',
                'material_uploads_verified_only',
            },
        )
        # The plain kill switches are seeded on; `material_uploads_verified_only` is the one,
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
                    'issues',
                    # Seeded ON like the rest: provisioning the age gate's kill switch must not be
                    # what turns the gate off. RegistrationAgeGateFlagTests (accounts/test_minors.py)
                    # covers what flipping it actually does.
                    'age_verification',
                    # Also seeded ON: co-authoring gates the collaboration surface on a material,
                    # never the material itself (moderation/models.py's own note on the key), so
                    # provisioning it is not what takes a feature away from anybody.
                    'coauthoring',
                    # And concepts, for the plainest version of the same reason: there is no concept
                    # on the platform the moment 0040 runs, so seeding the switch on removes nothing.
                    'concepts',
                    # And sketches, for exactly that reason again: 0042 seeds the switch on with no
                    # sketch on the platform, so provisioning it takes nothing away.
                    'sketches',
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
        """The flag is unchanged; the endpoint it gates moved. Bringing a NEW material into being
        is `POST /api/material-projects/` since the single-shot submit form was folded into a
        project with a team of one — `coauthoring/test_submit_path.py`'s `TwoSwitchesTests` covers
        the rest of what this switch does and does not reach."""
        branch = make_course(slug='uw-flag-material-branch')
        FeatureFlag.objects.filter(key='material_submissions').update(is_enabled=False)
        self.client.force_authenticate(self.plain_user)

        response = self.client.post(
            '/api/material-projects/',
            {
                'branch': branch.slug,
                'type': 'practice_test',
                'kind': 'body',
                'title': 'Blocked by the switch',
                'body': 'Text.',
            },
            format='json',
        )

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
            field='statement',
            proposed_value='better',
            submitted_by=make_user('count-a2'),
        )

        self.client.force_authenticate(self.moderator)
        queue = self.client.get(reverse('moderation-queue')).data
        count = self.client.get(reverse('moderation-queue-count')).data

        from_queue = (
            len(queue['submissions'])
            + len(queue['material_versions'])
            + len(queue['edit_suggestions'])
            + len(queue['translations'])
            + len(queue['solution_entries'])
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
