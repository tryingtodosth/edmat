"""`contests/rules.py` — every refusal word, with the refusals first and the happy path last
(CONTESTS-BRIEF.md §3.A, "What finished means").

These classes reach no endpoint, so they stay on plain `TestCase` and the log-shard declaration is
not theirs to make (`backend/CLAUDE.md`, "Testing": leaving a class that reaches no endpoint on the
plain base is what keeps `testing/check_databases_declared.py` meaningful).
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from contests import access, rules
from contests.models import (
    Contest,
    ContestProblem,
    ContestRegistration,
    ContestRulesSection,
    ContestScore,
    ContestStaff,
    ContestStage,
    ContestSubmission,
)
from exercises.models import Exercise, ExerciseTranslation
from taxonomy.models import Branch, Discipline
from testing.factories import make_user, make_viewer


def _exercise(branch, number):
    exercise = Exercise.objects.create(
        branch=branch, number=number, difficulty='easy', original_locale='pl'
    )
    ExerciseTranslation.objects.create(
        exercise=exercise, locale='pl', title=f'Zadanie {number}',
        statement='Oblicz granicę \\( a_n \\).', status='published',
    )
    return exercise


class ContestRulesTestCase(TestCase):
    """One announceable contest, built field by field so each refusal can be provoked by removing
    exactly one thing."""

    def setUp(self):
        self.organiser = make_user('rules-organiser')
        self.juror = make_user('rules-juror')
        self.second_juror = make_user('rules-juror-2')
        self.entrant = make_user('rules-entrant')
        self.other = make_user('rules-other')
        self.stranger = make_viewer('rules-stranger')
        discipline = Discipline.objects.create(slug='r-disc')
        self.branch = Branch.objects.create(discipline=discipline, slug='r-branch')
        now = timezone.now()
        self.contest = Contest.objects.create(
            title='Konkurs testowy',
            organiser=self.organiser,
            preset_key='school',
            allows_minors=True,
            has_prize=True,
            prize_claim_deadline=now + timedelta(days=30),
            merit_criteria='Zadania 0–5 punktów za poprawność i uzasadnienie.',
            data_controller_name='Szkoła',
            data_controller_contact='szkola@example.org',
            starts_at=now,
            ends_at=now + timedelta(days=30),
        )
        ContestStaff.objects.create(contest=self.contest, user=self.juror, role='jury')
        self.stage = ContestStage.objects.create(
            contest=self.contest, order=0, key='round', title='Etap I', advancement='final'
        )
        ContestRulesSection.objects.create(contest=self.contest, key='organiser', body='Organizator.')
        rules.publish_rules(self.contest, actor=self.organiser)
        self.contest.refresh_from_db()


class AnnounceRefusalTests(ContestRulesTestCase):
    def test_claim_deadline_missing_is_the_first_word_when_a_prize_exists(self):
        self.contest.prize_claim_deadline = None
        self.contest.save()
        self.assertEqual(rules.announce_block_reason(self.contest), rules.CLAIM_DEADLINE_MISSING)

    def test_a_challenge_with_no_prize_never_reaches_the_claim_deadline(self):
        self.contest.has_prize = False
        self.contest.prize_claim_deadline = None
        self.contest.save()
        self.assertIsNone(rules.announce_block_reason(self.contest))

    def test_jury_missing_below_the_presets_minimum(self):
        # `school` wants one, and the organiser counts (KC art. 921 §2) — so provoke it with a
        # preset that wants three.
        self.contest.preset_key = 'open_online'
        self.contest.save()
        self.assertEqual(rules.announce_block_reason(self.contest), rules.JURY_MISSING)
        ContestStaff.objects.create(contest=self.contest, user=self.second_juror, role='jury')
        self.assertIsNone(rules.announce_block_reason(self.contest))

    def test_criteria_missing(self):
        self.contest.merit_criteria = ''
        self.contest.save()
        self.assertEqual(rules.announce_block_reason(self.contest), rules.CRITERIA_MISSING)

    def test_controller_missing(self):
        self.contest.data_controller_contact = ''
        self.contest.save()
        self.assertEqual(rules.announce_block_reason(self.contest), rules.CONTROLLER_MISSING)

    def test_no_stages(self):
        self.stage.delete()
        self.assertEqual(rules.announce_block_reason(self.contest), rules.NO_STAGES)

    def test_chance_element_in_a_stage_description(self):
        self.stage.description = 'O awansie decyduje losowanie wśród najlepszych.'
        self.stage.save()
        self.assertEqual(rules.announce_block_reason(self.contest), rules.CHANCE_ELEMENT)

    def test_chance_element_without_the_diacritic_and_in_the_criteria(self):
        self.stage.description = 'Remisy rozstrzyga sie losowaniem.'
        self.stage.save()
        self.assertEqual(rules.announce_block_reason(self.contest), rules.CHANCE_ELEMENT)
        self.stage.description = ''
        self.stage.save()
        self.contest.merit_criteria = 'Zwycięzcę wskazuje loteria.'
        self.contest.save()
        self.assertEqual(rules.announce_block_reason(self.contest), rules.CHANCE_ELEMENT)

    def test_external_reference_missing_only_for_the_staff_only_presets(self):
        self.contest.preset_key = 'kuratorium'
        self.contest.save()
        ContestStaff.objects.create(contest=self.contest, user=self.second_juror, role='jury')
        self.assertEqual(
            rules.announce_block_reason(self.contest), rules.EXTERNAL_REFERENCE_MISSING
        )
        self.contest.external_reference_url = 'https://kuratorium.example/konkurs'
        self.contest.save()
        self.assertIsNone(rules.announce_block_reason(self.contest))

    def test_rules_missing_until_a_version_is_published(self):
        self.contest.rules_versions.all().delete()
        self.assertEqual(rules.announce_block_reason(self.contest), rules.RULES_MISSING)

    def test_the_happy_path_announces_and_goes_public(self):
        self.assertIsNone(rules.announce_block_reason(self.contest))
        rules.transition(self.contest, 'announced', actor=self.organiser)
        self.contest.refresh_from_db()
        self.assertEqual(self.contest.status, 'announced')
        self.assertIsNotNone(self.contest.announced_at)
        self.assertEqual(self.contest.visibility, 'public')
        self.assertTrue(access.can_view(self.stranger, self.contest))


class TransitionTests(ContestRulesTestCase):
    def test_illegal_transition_backwards_and_to_itself(self):
        rules.transition(self.contest, 'announced', actor=self.organiser)
        self.assertEqual(
            rules.transition_block_reason(self.contest, 'draft'), rules.ILLEGAL_TRANSITION
        )
        self.assertEqual(
            rules.transition_block_reason(self.contest, 'announced'), rules.ILLEGAL_TRANSITION
        )

    def test_closed_is_final(self):
        self.contest.status = 'closed'
        self.contest.save()
        self.assertEqual(rules.transition_block_reason(self.contest, 'announced'), rules.CLOSED)

    def test_cancelled_is_reachable_from_everything_but_closed(self):
        for status in ('draft', 'announced', 'registration_open', 'running', 'judging'):
            self.contest.status = status
            self.contest.save()
            self.assertIsNone(rules.transition_block_reason(self.contest, 'cancelled'), status)
        self.contest.status = 'closed'
        self.contest.save()
        self.assertEqual(rules.transition_block_reason(self.contest, 'cancelled'), rules.CLOSED)


class RegisterRefusalTests(ContestRulesTestCase):
    def setUp(self):
        super().setUp()
        rules.transition(self.contest, 'announced', actor=self.organiser)
        rules.transition(self.contest, 'registration_open', actor=self.organiser)

    def test_anonymous(self):
        self.assertEqual(rules.register_block_reason(None, self.contest), rules.ANONYMOUS)

    def test_not_open(self):
        rules.transition(self.contest, 'running', actor=self.organiser)
        self.assertEqual(
            rules.register_block_reason(self.entrant, self.contest), rules.NOT_OPEN
        )

    def test_own_staff(self):
        self.assertEqual(rules.register_block_reason(self.juror, self.contest), rules.OWN_STAFF)
        self.assertEqual(
            rules.register_block_reason(self.organiser, self.contest), rules.OWN_STAFF
        )

    def test_minor_when_the_preset_does_not_allow_minors(self):
        self.entrant.profile.is_minor = True
        self.entrant.profile.save()
        self.contest.allows_minors = False
        self.contest.save()
        self.assertEqual(rules.register_block_reason(self.entrant, self.contest), rules.MINOR)

    def test_guardian_consent_required_is_a_different_word_from_minor(self):
        self.entrant.profile.is_minor = True
        self.entrant.profile.save()
        self.assertEqual(
            rules.register_block_reason(self.entrant, self.contest, {}),
            rules.GUARDIAN_CONSENT_REQUIRED,
        )
        self.assertEqual(
            rules.register_block_reason(
                self.entrant, self.contest, {'guardian_consent': True, 'guardian_name': ''}
            ),
            rules.GUARDIAN_CONSENT_REQUIRED,
        )
        self.assertIsNone(
            rules.register_block_reason(
                self.entrant, self.contest,
                {'guardian_consent': True, 'guardian_name': 'Anna Nowak'},
            )
        )

    def test_already_registered(self):
        ContestRegistration.objects.create(
            contest=self.contest, user=self.entrant, status='accepted'
        )
        self.assertEqual(
            rules.register_block_reason(self.entrant, self.contest), rules.ALREADY_REGISTERED
        )

    def test_a_withdrawn_row_does_not_hold_a_place_and_may_register_again(self):
        ContestRegistration.objects.create(
            contest=self.contest, user=self.entrant, status='withdrawn'
        )
        self.assertIsNone(rules.register_block_reason(self.entrant, self.contest))

    def test_full(self):
        self.contest.capacity = 1
        self.contest.save()
        ContestRegistration.objects.create(
            contest=self.contest, user=self.other, status='accepted'
        )
        self.assertEqual(rules.register_block_reason(self.entrant, self.contest), rules.FULL)

    def test_team_required(self):
        self.contest.team = True
        self.contest.save()
        self.assertEqual(
            rules.register_block_reason(self.entrant, self.contest, {}), rules.TEAM_REQUIRED
        )
        self.assertIsNone(
            rules.register_block_reason(self.entrant, self.contest, {'team_name': 'Delta'})
        )

    def test_the_happy_path(self):
        self.assertIsNone(rules.register_block_reason(self.entrant, self.contest, {}))


class SubmitAndScoreTests(ContestRulesTestCase):
    def setUp(self):
        super().setUp()
        rules.transition(self.contest, 'announced', actor=self.organiser)
        rules.transition(self.contest, 'registration_open', actor=self.organiser)
        self.registration = ContestRegistration.objects.create(
            contest=self.contest, user=self.entrant, status='accepted'
        )
        self.problem = ContestProblem.objects.create(
            stage=self.stage, exercise=_exercise(self.branch, 1), order=0, points=5
        )

    def test_stage_not_open(self):
        self.assertEqual(
            rules.submit_block_reason(self.entrant, self.stage), rules.STAGE_NOT_OPEN
        )

    def test_not_accepted(self):
        self.stage.status = 'open'
        self.stage.save()
        self.assertEqual(rules.submit_block_reason(self.other, self.stage), rules.NOT_ACCEPTED)
        self.registration.status = 'disqualified'
        self.registration.save()
        self.assertEqual(rules.submit_block_reason(self.entrant, self.stage), rules.NOT_ACCEPTED)

    def test_already_submitted(self):
        self.stage.status = 'open'
        self.stage.save()
        ContestSubmission.objects.create(
            stage=self.stage, registration=self.registration, status='submitted'
        )
        self.assertEqual(
            rules.submit_block_reason(self.entrant, self.stage), rules.ALREADY_SUBMITTED
        )

    def test_not_advanced_from_the_previous_stage(self):
        second = ContestStage.objects.create(
            contest=self.contest, order=1, key='final', title='Finał', status='open'
        )
        self.assertEqual(
            rules.submit_block_reason(self.entrant, second), rules.NOT_ADVANCED
        )
        ContestSubmission.objects.create(
            stage=self.stage, registration=self.registration, status='scored', advanced=True
        )
        self.assertIsNone(rules.submit_block_reason(self.entrant, second))

    def test_score_refusals(self):
        self.stage.status = 'open'
        self.stage.save()
        submission = ContestSubmission.objects.create(
            stage=self.stage, registration=self.registration, status='submitted'
        )
        self.assertEqual(rules.score_block_reason(self.other, submission), rules.NOT_JUROR)
        # A secretary is staff and still may not score.
        ContestStaff.objects.create(contest=self.contest, user=self.other, role='secretary')
        self.assertEqual(rules.score_block_reason(self.other, submission), rules.NOT_JUROR)
        self.assertEqual(rules.score_block_reason(self.juror, submission), rules.STAGE_OPEN)
        self.stage.status = 'closed'
        self.stage.save()
        submission.refresh_from_db()
        self.assertIsNone(rules.score_block_reason(self.juror, submission))
        own = ContestSubmission.objects.create(
            stage=self.stage,
            registration=ContestRegistration.objects.create(
                contest=self.contest, user=self.juror, status='accepted'
            ),
            status='submitted',
        )
        self.assertEqual(rules.score_block_reason(self.juror, own), rules.OWN_SUBMISSION)

    def test_points_are_the_mean_over_jurors_summed_over_problems_and_never_stored(self):
        second_problem = ContestProblem.objects.create(
            stage=self.stage, exercise=_exercise(self.branch, 2), order=1, points=5
        )
        self.stage.status = 'closed'
        self.stage.save()
        submission = ContestSubmission.objects.create(
            stage=self.stage, registration=self.registration, status='submitted'
        )
        ContestStaff.objects.create(contest=self.contest, user=self.second_juror, role='jury')
        ContestScore.objects.create(
            submission=submission, problem=self.problem, juror=self.juror, points=4
        )
        ContestScore.objects.create(
            submission=submission, problem=self.problem, juror=self.second_juror, points=2
        )
        ContestScore.objects.create(
            submission=submission, problem=second_problem, juror=self.juror, points=5
        )
        # 3 (the mean of 4 and 2) + 5 (one juror) = 8, and nothing is stored anywhere.
        self.assertEqual(rules.submission_points(submission), 8)
        self.assertEqual(rules.scored_problem_count(submission), 2)
        self.assertFalse(hasattr(submission, 'total_points'))
        # A juror changing their mind changes the answer immediately.
        rules.set_scores(self.second_juror, submission, [{'problem': self.problem.pk, 'points': 4}])
        self.assertEqual(rules.submission_points(submission), 9)

    def test_set_scores_clamps_to_the_problems_own_points(self):
        self.stage.status = 'closed'
        self.stage.save()
        submission = ContestSubmission.objects.create(
            stage=self.stage, registration=self.registration, status='submitted'
        )
        rules.set_scores(self.juror, submission, [{'problem': self.problem.pk, 'points': 99}])
        self.assertEqual(rules.submission_points(submission), 5)
        rules.set_scores(self.juror, submission, [{'problem': self.problem.pk, 'points': -3}])
        self.assertEqual(rules.submission_points(submission), 0)


class AdvanceTests(ContestRulesTestCase):
    def setUp(self):
        super().setUp()
        self.stage.advancement = 'top_n'
        self.stage.advance_count = 2
        self.stage.status = 'closed'
        self.stage.save()
        self.problem = ContestProblem.objects.create(
            stage=self.stage, exercise=_exercise(self.branch, 1), order=0, points=10
        )
        self.people = [make_user(f'advance-{i}') for i in range(4)]
        self.submissions = []
        for index, person in enumerate(self.people):
            registration = ContestRegistration.objects.create(
                contest=self.contest, user=person, status='accepted'
            )
            submission = ContestSubmission.objects.create(
                stage=self.stage, registration=registration, status='submitted'
            )
            ContestScore.objects.create(
                submission=submission, problem=self.problem, juror=self.juror,
                points=10 - index * 2,
            )
            self.submissions.append(submission)

    def test_advance_is_refused_while_a_stage_is_unscored(self):
        extra = ContestSubmission.objects.create(
            stage=self.stage,
            registration=ContestRegistration.objects.create(
                contest=self.contest, user=self.entrant, status='accepted'
            ),
            status='submitted',
        )
        self.assertEqual(rules.advance_block_reason(self.stage), rules.STAGE_UNSCORED)
        ContestScore.objects.create(
            submission=extra, problem=self.problem, juror=self.juror, points=1
        )
        self.assertIsNone(rules.advance_block_reason(self.stage))

    def test_top_n_takes_everybody_tied_at_the_cut_off(self):
        # Make second and third tie on 8: the cut-off takes three, because the alternative is
        # breaking the tie by lot and that is the one thing this module makes impossible.
        ContestScore.objects.filter(submission=self.submissions[2]).update(points=8)
        chosen = rules.advance(self.stage)
        self.assertEqual(len(chosen), 3)
        self.stage.refresh_from_db()
        self.assertEqual(self.stage.status, 'scored')
        self.assertIsNotNone(self.stage.advanced_at)

    def test_final_advances_nobody_and_all_advances_everybody(self):
        self.stage.advancement = 'final'
        self.stage.save()
        self.assertEqual(rules.advance(self.stage), [])
        self.stage.status = 'closed'
        self.stage.advancement = 'all'
        self.stage.save()
        self.assertEqual(len(rules.advance(self.stage)), 4)

    def test_threshold(self):
        self.stage.advancement = 'threshold'
        self.stage.advance_threshold = 7
        self.stage.save()
        self.assertEqual(len(rules.advance(self.stage)), 2)

    def test_advance_is_idempotent(self):
        first = {s.pk for s in rules.advance(self.stage)}
        self.stage.status = 'closed'
        self.stage.save()
        second = {s.pk for s in rules.advance(self.stage)}
        self.assertEqual(first, second)

    def test_ranking_ties_share_a_rank_and_the_next_rank_skips(self):
        ContestScore.objects.filter(submission=self.submissions[1]).update(points=10)
        rows = rules.ranking(self.contest)
        self.assertEqual([row['rank'] for row in rows], [1, 1, 3, 4])

    def test_titles_need_a_maximum_to_mean_anything(self):
        self.contest.laureate_min_pct = 90
        self.contest.finalist_min_pct = 60
        self.contest.distinction_count = 1
        self.contest.save()
        rows = rules.titles_for(rules.ranking(self.contest), self.contest)
        self.assertEqual(
            [row['title'] for row in rows],
            ['laureate', 'finalist', 'finalist', 'distinction'],
        )
        # A contest with no points at all awards nobody anything, rather than inventing a result.
        self.problem.delete()
        rows = rules.titles_for(rules.ranking(self.contest), self.contest)
        self.assertEqual({row['title'] for row in rows}, {'participant'})


class PublishAndComplainTests(ContestRulesTestCase):
    def setUp(self):
        super().setUp()
        self.stage.status = 'closed'
        self.stage.save()
        self.problem = ContestProblem.objects.create(
            stage=self.stage, exercise=_exercise(self.branch, 1), order=0, points=10
        )
        self.registration = ContestRegistration.objects.create(
            contest=self.contest, user=self.entrant, status='accepted'
        )
        self.submission = ContestSubmission.objects.create(
            stage=self.stage, registration=self.registration, status='submitted'
        )
        self.contest.status = 'judging'
        self.contest.save()

    def test_stage_unscored(self):
        self.assertEqual(
            rules.publish_results_block_reason(self.contest), rules.STAGE_UNSCORED
        )

    def test_already_published(self):
        ContestScore.objects.create(
            submission=self.submission, problem=self.problem, juror=self.juror, points=9
        )
        rules.publish_results(self.contest, actor=self.organiser)
        self.contest.refresh_from_db()
        self.assertEqual(
            rules.publish_results_block_reason(self.contest), rules.ALREADY_PUBLISHED
        )

    def test_result_rows_exist_only_between_publish_and_unpublish(self):
        ContestScore.objects.create(
            submission=self.submission, problem=self.problem, juror=self.juror, points=9
        )
        self.assertEqual(self.contest.results.count(), 0)
        rules.publish_results(self.contest, actor=self.organiser)
        self.contest.refresh_from_db()
        self.assertEqual(self.contest.results.count(), 1)
        self.assertIsNone(rules.unpublish_block_reason(self.contest))
        rules.unpublish_results(self.contest, actor=self.organiser)
        self.contest.refresh_from_db()
        self.assertEqual(self.contest.results.count(), 0)
        self.assertEqual(self.contest.status, 'judging')

    def test_unpublish_is_refused_once_the_window_has_closed(self):
        ContestScore.objects.create(
            submission=self.submission, problem=self.problem, juror=self.juror, points=9
        )
        rules.publish_results(self.contest, actor=self.organiser)
        self.contest.refresh_from_db()
        self.contest.results_published_at = timezone.now() - timedelta(days=20)
        self.contest.save()
        self.assertEqual(rules.unpublish_block_reason(self.contest), rules.WINDOW_CLOSED)

    def test_complaint_refusals(self):
        self.assertEqual(
            rules.complain_block_reason(self.entrant, self.contest), rules.NOT_PUBLISHED
        )
        ContestScore.objects.create(
            submission=self.submission, problem=self.problem, juror=self.juror, points=9
        )
        rules.publish_results(self.contest, actor=self.organiser)
        self.contest.refresh_from_db()
        self.assertEqual(
            rules.complain_block_reason(self.other, self.contest), rules.NOT_PARTICIPANT
        )
        self.assertIsNone(rules.complain_block_reason(self.entrant, self.contest))
        from contests.models import ContestComplaint

        ContestComplaint.objects.create(
            contest=self.contest, registration=self.registration, text='Za nisko.'
        )
        self.assertEqual(
            rules.complain_block_reason(self.entrant, self.contest), rules.ALREADY_OPEN
        )

    def test_a_minor_does_not_lodge_a_complaint_themself(self):
        ContestScore.objects.create(
            submission=self.submission, problem=self.problem, juror=self.juror, points=9
        )
        rules.publish_results(self.contest, actor=self.organiser)
        self.contest.refresh_from_db()
        self.entrant.profile.is_minor = True
        self.entrant.profile.save()
        self.assertEqual(rules.complain_block_reason(self.entrant, self.contest), rules.MINOR)

    def test_the_window_closes_when_it_says_it_does(self):
        ContestScore.objects.create(
            submission=self.submission, problem=self.problem, juror=self.juror, points=9
        )
        rules.publish_results(self.contest, actor=self.organiser)
        self.contest.refresh_from_db()
        expected = self.contest.results_published_at + timedelta(
            days=self.contest.complaint_window_days
        )
        self.assertEqual(self.contest.complaints_close_at, expected)
        self.contest.results_published_at = timezone.now() - timedelta(days=15)
        self.contest.save()
        self.assertEqual(
            rules.complain_block_reason(self.entrant, self.contest), rules.WINDOW_CLOSED
        )


class MembershipTests(ContestRulesTestCase):
    """`access._registered`, which step A replaced — and the one invariant that matters: the
    queryset filter and the object-level check must agree (house rule 4)."""

    def test_an_accepted_registration_makes_a_member_and_a_draft_still_404s_a_stranger(self):
        self.assertFalse(access.is_member(self.entrant, self.contest))
        registration = ContestRegistration.objects.create(
            contest=self.contest, user=self.entrant, status='accepted'
        )
        self.assertTrue(access.is_member(self.entrant, self.contest))
        self.assertFalse(access.can_view(self.stranger, self.contest))
        self.assertNotIn(self.contest, access.visible_contests(self.stranger))
        # A participant of a PRIVATE contest sees it because they are in it.
        self.assertTrue(access.can_view(self.entrant, self.contest))
        self.assertIn(self.contest, access.visible_contests(self.entrant))
        # And stops the moment they are removed.
        registration.status = 'disqualified'
        registration.save()
        self.assertFalse(access.is_member(self.entrant, self.contest))
        self.assertFalse(access.can_view(self.entrant, self.contest))
        self.assertNotIn(self.contest, access.visible_contests(self.entrant))

    def test_a_requested_registration_already_holds_a_place(self):
        ContestRegistration.objects.create(
            contest=self.contest, user=self.entrant, status='requested'
        )
        self.assertTrue(access.is_member(self.entrant, self.contest))

    def test_the_filter_and_the_object_check_agree_for_every_registration_status(self):
        registration = ContestRegistration.objects.create(
            contest=self.contest, user=self.entrant, status='requested'
        )
        for status in ('requested', 'accepted', 'declined', 'withdrawn', 'disqualified'):
            registration.status = status
            registration.save()
            by_object = access.can_view(self.entrant, self.contest)
            by_filter = self.contest in access.visible_contests(self.entrant)
            self.assertEqual(by_object, by_filter, status)
