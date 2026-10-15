"""The contests API: the creation gate, the stranger's 404s, the problems that do not exist before
a stage opens, the separate publish-name consent, and the compliance panel.

Every class here reaches an endpoint, so the log-shard declaration is made ONCE on the base class
below (`backend/CLAUDE.md`, "Testing") — the request-log middleware writes to one of nine SQLite
shards on every request and a class that did not declare them kills `--parallel` outright.
"""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from contests import rules
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
from moderation.models import FeatureFlag
from taxonomy.models import Branch, Discipline
from telemetry.routers import all_log_shards
from testing.factories import make_user


def _flag(key, enabled):
    FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': enabled})


class ContestApiTestCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        _flag('contests', True)
        # The creation gate is seeded ON (`creation_requires_verification`), so a founder is a
        # verified contributor — which is the real configuration, not a convenience.
        self.organiser = make_user('api-organiser', is_verified_contributor=True)
        self.juror = make_user('api-juror')
        self.secretary = make_user('api-secretary')
        self.entrant = make_user('api-entrant')
        self.stranger = make_user('api-stranger')
        self.moderator = make_user('api-moderator', is_staff=True)
        discipline = Discipline.objects.create(slug='api-disc')
        self.branch = Branch.objects.create(discipline=discipline, slug='api-branch')
        self.now = timezone.now()

    # ---- helpers ---------------------------------------------------------------------------
    def _exercise(self, number):
        exercise = Exercise.objects.create(
            branch=self.branch, number=number, difficulty='easy', original_locale='pl'
        )
        ExerciseTranslation.objects.create(
            exercise=exercise, locale='pl', title=f'Zadanie {number}',
            statement='Oblicz \\( \\lim a_n \\).', answer='42', status='published',
        )
        return exercise

    def _contest(self, **overrides):
        values = {
            'title': 'Konkurs API',
            'organiser': self.organiser,
            'preset_key': 'school',
            'allows_minors': True,
            'merit_criteria': 'Po 5 punktów za zadanie.',
            'data_controller_name': 'Szkoła',
            'data_controller_contact': 'szkola@example.org',
            'starts_at': self.now,
            'ends_at': self.now + timedelta(days=20),
        }
        values.update(overrides)
        contest = Contest.objects.create(**values)
        ContestStaff.objects.create(contest=contest, user=self.juror, role='jury')
        ContestStaff.objects.create(contest=contest, user=self.secretary, role='secretary')
        ContestRulesSection.objects.create(contest=contest, key='organiser', body='Organizator.')
        rules.publish_rules(contest, actor=self.organiser)
        contest.refresh_from_db()
        return contest

    def _stage(self, contest, **overrides):
        values = {
            'contest': contest, 'order': 0, 'key': 'round', 'title': 'Etap I',
            'advancement': 'final',
            'opens_at': self.now, 'closes_at': self.now + timedelta(days=7),
        }
        values.update(overrides)
        return ContestStage.objects.create(**values)

    def _open_for_registration(self, contest):
        rules.transition(contest, 'announced', actor=self.organiser)
        rules.transition(contest, 'registration_open', actor=self.organiser)
        contest.refresh_from_db()
        return contest

    def _url(self, name, **kwargs):
        return reverse(name, kwargs=kwargs)


class CreationGateTests(ContestApiTestCase):
    def test_an_unverified_account_is_refused_with_the_gates_own_word(self):
        self.client.force_authenticate(make_user('api-unverified'))
        response = self.client.post('/api/contests/', {'title': 'Nowy konkurs'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], 'verification_required')
        self.assertEqual(Contest.objects.count(), 0)

    def test_a_minor_is_refused_with_the_older_narrower_word(self):
        minor = make_user('api-minor', is_verified_contributor=True)
        minor.profile.is_minor = True
        minor.profile.save()
        self.client.force_authenticate(minor)
        response = self.client.post('/api/contests/', {'title': 'Nowy konkurs'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], 'minor')

    def test_a_non_staff_founder_cannot_pick_a_staff_only_preset(self):
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            '/api/contests/', {'title': 'Kuratoryjny', 'preset_key': 'kuratorium'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('preset_not_available', str(response.data['preset_key']))

    def test_a_moderator_can(self):
        self.client.force_authenticate(self.moderator)
        response = self.client.post(
            '/api/contests/', {'title': 'Kuratoryjny', 'preset_key': 'kuratorium'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_lays_out_the_preset_and_answers_with_the_personalisation_report(self):
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            '/api/contests/',
            {'title': 'Szkolny', 'preset_key': 'school', 'starts_at': self.now.isoformat()},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # The report is shown honestly: on step A's branch `apply_preset` is a stub and says so.
        self.assertIn('personalisation', response.data)
        self.assertIn('skipped', response.data['personalisation'])
        contest = Contest.objects.get(pk=response.data['id'])
        # The preset's own answers, which the wizard does not ask for.
        self.assertEqual(contest.complaint_window_days, 14)
        self.assertEqual(contest.publication_default, 'initials')
        self.assertTrue(contest.allows_minors)
        # The regulamin's skeleton, and the stage ladder from the preset's offsets.
        self.assertEqual(contest.rules_sections.count(), 12)
        self.assertEqual(contest.stages.count(), 1)
        self.assertEqual(contest.stages.first().advancement, 'final')

    def test_the_kill_switch_closes_the_whole_surface(self):
        contest = self._contest()
        self._open_for_registration(contest)
        _flag('contests', False)
        self.client.force_authenticate(self.entrant)
        self.assertEqual(self.client.get('/api/contests/').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.get(f'/api/contests/{contest.pk}/').status_code, status.HTTP_403_FORBIDDEN
        )
        # Staff bypass, as every other flag has.
        self.client.force_authenticate(self.moderator)
        self.assertEqual(self.client.get('/api/contests/').status_code, status.HTTP_200_OK)


class VisibilityTests(ContestApiTestCase):
    def test_a_draft_is_404_for_a_stranger_and_200_for_its_staff(self):
        contest = self._contest()
        self.client.force_authenticate(self.stranger)
        self.assertEqual(
            self.client.get(f'/api/contests/{contest.pk}/').status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertEqual(self.client.get('/api/contests/').data, [])
        self.client.force_authenticate(self.juror)
        self.assertEqual(
            self.client.get(f'/api/contests/{contest.pk}/').status_code, status.HTTP_200_OK
        )

    def test_a_participant_of_a_private_contest_sees_it_because_they_are_in_it(self):
        contest = self._contest()
        ContestRegistration.objects.create(
            contest=contest, user=self.entrant, status='accepted'
        )
        self.client.force_authenticate(self.entrant)
        response = self.client.get(f'/api/contests/{contest.pk}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['is_member'])
        self.assertEqual(len(self.client.get('/api/contests/').data), 1)

    def test_the_roster_is_the_contests_inside(self):
        contest = self._contest()
        self._open_for_registration(contest)
        ContestRegistration.objects.create(
            contest=contest, user=self.entrant, status='accepted'
        )
        self.client.force_authenticate(self.entrant)
        response = self.client.get(f'/api/contests/{contest.pk}/registrations/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], rules.NOT_STAFF)
        self.client.force_authenticate(self.secretary)
        self.assertEqual(
            self.client.get(f'/api/contests/{contest.pk}/registrations/').status_code,
            status.HTTP_200_OK,
        )

    def test_mine_narrows_to_organised_staffed_or_entered(self):
        mine = self._contest()
        theirs = Contest.objects.create(
            title='Czyjś', organiser=self.stranger, status='announced', visibility='public'
        )
        self.client.force_authenticate(self.juror)
        ids = {row['id'] for row in self.client.get('/api/contests/?mine=1').data}
        self.assertEqual(ids, {mine.pk})
        self.assertIn(theirs.pk, {row['id'] for row in self.client.get('/api/contests/').data})

    def test_an_undefined_id_is_404_not_500(self):
        self.client.force_authenticate(self.organiser)
        self.assertEqual(
            self.client.get('/api/contests/undefined/').status_code, status.HTTP_404_NOT_FOUND
        )
        contest = self._contest()
        self.assertEqual(
            self.client.get(f'/api/contests/{contest.pk}/certificate/undefined/').status_code,
            status.HTTP_404_NOT_FOUND,
        )


class AnnounceTests(ContestApiTestCase):
    def test_announce_is_refused_409_with_the_word_and_then_accepted(self):
        contest = self._contest(has_prize=True, prize_total_value_pln=150)
        self.client.force_authenticate(self.organiser)
        self._stage(contest)
        response = self.client.post(f'/api/contests/{contest.pk}/announce/')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], rules.CLAIM_DEADLINE_MISSING)
        self.client.patch(
            f'/api/contests/{contest.pk}/',
            {'prize_claim_deadline': (self.now + timedelta(days=40)).isoformat()},
            format='json',
        )
        response = self.client.post(f'/api/contests/{contest.pk}/announce/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'announced')

    def test_a_challenge_announces_with_no_prize_block_at_all(self):
        contest = self._contest(preset_key='challenge', has_prize=False)
        self._stage(contest)
        self.client.force_authenticate(self.organiser)
        response = self.client.post(f'/api/contests/{contest.pk}/announce/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        contest.refresh_from_db()
        self.assertIsNone(contest.prize_claim_deadline)
        self.assertEqual(contest.prize_regime, 'none')

    def test_a_stage_description_that_reads_like_a_draw_is_refused_as_it_is_typed(self):
        contest = self._contest()
        self.client.force_authenticate(self.organiser)
        response = self.client.post(
            f'/api/contests/{contest.pk}/stages/',
            {'title': 'Etap I', 'description': 'Awans przez losowanie.', 'advancement': 'final'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(rules.CHANCE_ELEMENT, str(response.data['description']))

    def test_a_juror_may_not_announce(self):
        contest = self._contest()
        self._stage(contest)
        self.client.force_authenticate(self.juror)
        response = self.client.post(f'/api/contests/{contest.pk}/announce/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], rules.NOT_MANAGER)

    def test_the_olympiads_stages_are_locked(self):
        self.client.force_authenticate(self.moderator)
        created = self.client.post(
            '/api/contests/', {'title': 'Olimpiada', 'preset_key': 'olympiad'}, format='json'
        )
        contest_id = created.data['id']
        response = self.client.post(
            f'/api/contests/{contest_id}/stages/', {'title': 'Czwarty etap'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], 'stages_locked')


class RegistrationTests(ContestApiTestCase):
    def setUp(self):
        super().setUp()
        self.contest = self._open_for_registration(self._contest())

    def test_a_minor_registers_only_with_a_guardians_name_and_consent(self):
        self.entrant.profile.is_minor = True
        self.entrant.profile.save()
        self.client.force_authenticate(self.entrant)
        response = self.client.post(
            f'/api/contests/{self.contest.pk}/registrations/', {}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], rules.GUARDIAN_CONSENT_REQUIRED)
        response = self.client.post(
            f'/api/contests/{self.contest.pk}/registrations/',
            {'guardian_consent': True, 'guardian_name': 'Anna Nowak'}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['has_guardian_consent'])
        self.assertEqual(response.data['guardian_name'], 'Anna Nowak')

    def test_a_minor_is_refused_outright_where_the_preset_does_not_allow_minors(self):
        self.contest.allows_minors = False
        self.contest.save()
        self.entrant.profile.is_minor = True
        self.entrant.profile.save()
        self.client.force_authenticate(self.entrant)
        response = self.client.post(
            f'/api/contests/{self.contest.pk}/registrations/',
            {'guardian_consent': True, 'guardian_name': 'Anna Nowak'}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], rules.MINOR)

    def test_publish_name_defaults_false_and_is_its_own_revocable_patch(self):
        self.client.force_authenticate(self.entrant)
        created = self.client.post(
            f'/api/contests/{self.contest.pk}/registrations/', {}, format='json'
        )
        self.assertFalse(created.data['publish_name'])
        registration_id = created.data['id']
        response = self.client.patch(
            f'/api/contest-registrations/{registration_id}/publish-name/',
            {'publish_name': True}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['publish_name'])
        # Revocable, and only by the participant — not by the organiser, who is the party it is
        # given to.
        self.client.force_authenticate(self.organiser)
        refused = self.client.patch(
            f'/api/contest-registrations/{registration_id}/publish-name/',
            {'publish_name': False}, format='json',
        )
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.entrant)
        self.client.patch(
            f'/api/contest-registrations/{registration_id}/publish-name/',
            {'publish_name': False}, format='json',
        )
        self.assertFalse(ContestRegistration.objects.get(pk=registration_id).publish_name)

    def test_registering_stores_the_rules_version_it_accepted(self):
        self.client.force_authenticate(self.entrant)
        created = self.client.post(
            f'/api/contests/{self.contest.pk}/registrations/', {}, format='json'
        )
        self.assertEqual(created.data['accepted_rules_version'], 1)
        rules.publish_rules(self.contest, actor=self.organiser)
        self.assertEqual(
            ContestRegistration.objects.get(pk=created.data['id']).accepted_rules_version, 1
        )

    def test_decide_is_one_where_anchored_claim(self):
        self.client.force_authenticate(self.entrant)
        created = self.client.post(
            f'/api/contests/{self.contest.pk}/registrations/', {}, format='json'
        )
        registration_id = created.data['id']
        self.client.force_authenticate(self.organiser)
        first = self.client.post(
            f'/api/contest-registrations/{registration_id}/decide/',
            {'decision': 'accepted'}, format='json',
        )
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        second = self.client.post(
            f'/api/contest-registrations/{registration_id}/decide/',
            {'decision': 'declined'}, format='json',
        )
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)


class StageProblemTests(ContestApiTestCase):
    def setUp(self):
        super().setUp()
        self.contest = self._open_for_registration(self._contest())
        self.stage = self._stage(self.contest)
        self.problem = ContestProblem.objects.create(
            stage=self.stage, exercise=self._exercise(1), order=0, points=5
        )
        self.registration = ContestRegistration.objects.create(
            contest=self.contest, user=self.entrant, status='accepted'
        )

    def test_problems_are_404_before_the_stage_opens_and_200_after(self):
        self.client.force_authenticate(self.entrant)
        self.assertEqual(
            self.client.get(f'/api/contest-stages/{self.stage.pk}/problems/').status_code,
            status.HTTP_404_NOT_FOUND,
        )
        # Staff see them all along — that is how they are chosen.
        self.client.force_authenticate(self.organiser)
        self.assertEqual(
            self.client.get(f'/api/contest-stages/{self.stage.pk}/problems/').status_code,
            status.HTTP_200_OK,
        )
        self.client.post(f'/api/contest-stages/{self.stage.pk}/open/')
        self.client.force_authenticate(self.entrant)
        response = self.client.get(f'/api/contest-stages/{self.stage.pk}/problems/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)

    def test_the_stage_payload_carries_the_statement_and_no_hint_or_solution(self):
        self.client.force_authenticate(self.organiser)
        self.client.post(f'/api/contest-stages/{self.stage.pk}/open/')
        self.client.force_authenticate(self.entrant)
        row = self.client.get(f'/api/contest-stages/{self.stage.pk}/problems/').data[0]
        self.assertIn('Oblicz', row['statement'])
        self.assertNotIn('answer', row)
        self.assertNotIn('entries', row)
        self.assertNotIn('hint', row)
        self.assertNotIn('solution', row)

    def test_opening_a_stage_moves_the_contest_to_running(self):
        self.client.force_authenticate(self.organiser)
        self.client.post(f'/api/contest-stages/{self.stage.pk}/open/')
        self.contest.refresh_from_db()
        self.assertEqual(self.contest.status, 'running')

    def test_an_online_stage_with_no_problems_cannot_open(self):
        empty = self._stage(self.contest, order=1, key='second', title='Etap II')
        self.client.force_authenticate(self.organiser)
        response = self.client.post(f'/api/contest-stages/{empty.pk}/open/')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], 'no_problems')

    def test_answer_submit_score_and_the_jurys_anonymised_view(self):
        self.client.force_authenticate(self.organiser)
        self.client.post(f'/api/contest-stages/{self.stage.pk}/open/')

        self.client.force_authenticate(self.entrant)
        saved = self.client.put(
            f'/api/contest-stages/{self.stage.pk}/submission/',
            {'answers': [{'problem_id': self.problem.pk, 'text': 'Z definicji granicy.'}]},
            format='json',
        )
        self.assertEqual(saved.status_code, status.HTTP_200_OK)
        self.assertEqual(saved.data['status'], 'draft')
        handed_in = self.client.post(f'/api/contest-stages/{self.stage.pk}/submit/')
        self.assertEqual(handed_in.status_code, status.HTTP_200_OK)
        self.assertEqual(handed_in.data['status'], 'submitted')
        again = self.client.post(f'/api/contest-stages/{self.stage.pk}/submit/')
        self.assertEqual(again.status_code, status.HTTP_409_CONFLICT)

        # The jury cannot see a thing while the stage is open.
        self.client.force_authenticate(self.juror)
        self.assertEqual(
            self.client.get(f'/api/contest-stages/{self.stage.pk}/submissions/').status_code,
            status.HTTP_409_CONFLICT,
        )
        self.client.force_authenticate(self.organiser)
        self.client.post(f'/api/contest-stages/{self.stage.pk}/close/')

        self.client.force_authenticate(self.juror)
        view = self.client.get(f'/api/contest-stages/{self.stage.pk}/submissions/')
        self.assertEqual(view.status_code, status.HTTP_200_OK)
        row = view.data['submissions'][0]
        # Anonymised: a number, not a name.
        self.assertEqual(row['registration']['number'], 1)
        self.assertNotIn('user', row['registration'])
        scored = self.client.post(
            f'/api/contest-submissions/{row["id"]}/scores/',
            {'scores': [{'problem': self.problem.pk, 'points': 4, 'note': 'Dobrze.'}]},
            format='json',
        )
        self.assertEqual(scored.status_code, status.HTTP_200_OK)
        self.assertEqual(scored.data['points'], 4)

        # A secretary may not score.
        self.client.force_authenticate(self.secretary)
        refused = self.client.post(
            f'/api/contest-submissions/{row["id"]}/scores/',
            {'scores': [{'problem': self.problem.pk, 'points': 5}]}, format='json',
        )
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(refused.data['detail'], rules.NOT_JUROR)

    def test_a_manager_sees_the_name_beside_the_number(self):
        self.client.force_authenticate(self.organiser)
        self.client.post(f'/api/contest-stages/{self.stage.pk}/open/')
        ContestSubmission.objects.create(
            stage=self.stage, registration=self.registration, status='submitted'
        )
        self.client.post(f'/api/contest-stages/{self.stage.pk}/close/')
        view = self.client.get(f'/api/contest-stages/{self.stage.pk}/submissions/')
        self.assertIn('user', view.data['submissions'][0]['registration'])


class ResultsAndComplaintsTests(ContestApiTestCase):
    def setUp(self):
        super().setUp()
        self.contest = self._open_for_registration(
            self._contest(publication_default='full_name_opt_in')
        )
        self.stage = self._stage(self.contest)
        self.problem = ContestProblem.objects.create(
            stage=self.stage, exercise=self._exercise(1), order=0, points=10
        )
        self.registration = ContestRegistration.objects.create(
            contest=self.contest, user=self.entrant, status='accepted'
        )
        self.submission = ContestSubmission.objects.create(
            stage=self.stage, registration=self.registration, status='submitted'
        )
        ContestScore.objects.create(
            submission=self.submission, problem=self.problem, juror=self.juror, points=10
        )
        self.stage.status = 'closed'
        self.stage.save()
        self.contest.status = 'judging'
        self.contest.save()

    def test_the_live_ranking_is_staff_only_before_results(self):
        self.client.force_authenticate(self.entrant)
        response = self.client.get(f'/api/contests/{self.contest.pk}/ranking/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.juror)
        self.assertEqual(
            self.client.get(f'/api/contests/{self.contest.pk}/ranking/').status_code,
            status.HTTP_200_OK,
        )

    def test_publish_then_the_name_obeys_publish_name(self):
        self.client.force_authenticate(self.organiser)
        response = self.client.post(f'/api/contests/{self.contest.pk}/publish-results/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.client.logout()
        rows = self.client.get(f'/api/contests/{self.contest.pk}/results/').data['results']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['title'], 'laureate')
        # Initials by default, even on a `full_name_opt_in` contest.
        self.assertNotIn('api-entrant', rows[0]['display_name'])
        self.registration.publish_name = True
        self.registration.save()
        rows = self.client.get(f'/api/contests/{self.contest.pk}/results/').data['results']
        self.assertEqual(rows[0]['display_name'], 'api-entrant')

    def test_unpublish_only_while_the_window_is_open(self):
        self.client.force_authenticate(self.organiser)
        self.client.post(f'/api/contests/{self.contest.pk}/publish-results/')
        self.contest.refresh_from_db()
        self.contest.results_published_at = timezone.now() - timedelta(days=30)
        self.contest.save()
        response = self.client.post(f'/api/contests/{self.contest.pk}/unpublish-results/')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], rules.WINDOW_CLOSED)

    def test_a_complaint_is_lodged_and_answered_with_reasons(self):
        self.client.force_authenticate(self.organiser)
        self.client.post(f'/api/contests/{self.contest.pk}/publish-results/')
        self.client.force_authenticate(self.stranger)
        refused = self.client.post(
            f'/api/contests/{self.contest.pk}/complaints/', {'text': 'Nie zgadzam się.'},
            format='json',
        )
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(refused.data['detail'], rules.NOT_PARTICIPANT)
        self.client.force_authenticate(self.entrant)
        lodged = self.client.post(
            f'/api/contests/{self.contest.pk}/complaints/', {'text': 'Zadanie 1 za nisko.'},
            format='json',
        )
        self.assertEqual(lodged.status_code, status.HTTP_201_CREATED)
        again = self.client.post(
            f'/api/contests/{self.contest.pk}/complaints/', {'text': 'Jeszcze raz.'}, format='json'
        )
        self.assertEqual(again.status_code, status.HTTP_409_CONFLICT)
        # The secretary answers it — the preset's own checklist gives them the item.
        self.client.force_authenticate(self.secretary)
        answered = self.client.post(
            f'/api/contest-complaints/{lodged.data["id"]}/answer/',
            {'answer': 'Komisja ponownie przeczytała pracę. Ocena bez zmian, zgodnie z §6.'},
            format='json',
        )
        self.assertEqual(answered.status_code, status.HTTP_200_OK)
        self.assertEqual(answered.data['status'], 'answered')
        # A juror may not.
        self.client.force_authenticate(self.juror)
        self.assertEqual(
            self.client.post(
                f'/api/contest-complaints/{lodged.data["id"]}/answer/', {'answer': 'x'},
                format='json',
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_a_participant_sees_only_their_own_complaints(self):
        self.client.force_authenticate(self.organiser)
        self.client.post(f'/api/contests/{self.contest.pk}/publish-results/')
        other = ContestRegistration.objects.create(
            contest=self.contest, user=self.stranger, status='accepted'
        )
        from contests.models import ContestComplaint

        ContestComplaint.objects.create(contest=self.contest, registration=other, text='Ich.')
        mine = ContestComplaint.objects.create(
            contest=self.contest, registration=self.registration, text='Moja.'
        )
        self.client.force_authenticate(self.entrant)
        rows = self.client.get(f'/api/contests/{self.contest.pk}/complaints/').data
        self.assertEqual([row['id'] for row in rows], [mine.pk])
        self.client.force_authenticate(self.secretary)
        self.assertEqual(
            len(self.client.get(f'/api/contests/{self.contest.pk}/complaints/').data), 2
        )

    def test_the_certificate_is_for_the_person_it_names_and_for_staff(self):
        self.client.force_authenticate(self.organiser)
        self.client.post(f'/api/contests/{self.contest.pk}/publish-results/')
        result = self.contest.results.get()
        self.client.force_authenticate(self.stranger)
        self.assertEqual(
            self.client.get(
                f'/api/contests/{self.contest.pk}/certificate/{result.pk}/'
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.client.force_authenticate(self.entrant)
        response = self.client.get(f'/api/contests/{self.contest.pk}/certificate/{result.pk}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['result']['title'], 'laureate')
        self.assertEqual(response.data['organiser']['display_name'], 'Szkoła')

    def test_a_mere_participant_has_no_certificate(self):
        self.contest.laureate_min_pct = 100
        self.contest.finalist_min_pct = 100
        self.contest.distinction_count = 0
        self.contest.save()
        ContestScore.objects.filter(submission=self.submission).update(points=1)
        self.client.force_authenticate(self.organiser)
        self.client.post(f'/api/contests/{self.contest.pk}/publish-results/')
        result = self.contest.results.get()
        self.assertEqual(result.title, 'participant')
        self.client.force_authenticate(self.entrant)
        self.assertEqual(
            self.client.get(
                f'/api/contests/{self.contest.pk}/certificate/{result.pk}/'
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )


class RulesAndComplianceTests(ContestApiTestCase):
    def test_the_regulamin_is_written_whole_versioned_and_readable_by_version(self):
        contest = self._contest()
        self.client.force_authenticate(self.organiser)
        response = self.client.put(
            f'/api/contests/{contest.pk}/rules/',
            {'sections': [
                {'key': 'organiser', 'order': 0, 'body': 'Organizator: szkoła.'},
                {'key': 'dates', 'order': 1, 'body': 'Termin ubiegania się o nagrodę: 30 dni.'},
            ]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        bodies = {row['key']: row['body'] for row in response.data['sections']}
        self.assertIn('szkoła', bodies['organiser'])
        # Every section carries its guidance and its law keys, which is what the editor draws.
        row = next(r for r in response.data['sections'] if r['key'] == 'dates')
        self.assertIn('kc_921_1', row['law'])
        self.assertTrue(row['guidance']['pl'])
        published = self.client.post(f'/api/contests/{contest.pk}/rules/publish/')
        self.assertEqual(published.status_code, status.HTTP_201_CREATED)
        self.assertEqual(published.data['number'], 2)
        old = self.client.get(f'/api/contests/{contest.pk}/rules/versions/1/')
        self.assertEqual(old.status_code, status.HTTP_200_OK)
        self.assertEqual(old.data['number'], 1)

    def test_an_unknown_section_key_is_400(self):
        contest = self._contest()
        self.client.force_authenticate(self.organiser)
        response = self.client.put(
            f'/api/contests/{contest.pk}/rules/',
            {'sections': [{'key': 'nonsense', 'body': 'x'}]}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'unknown_section')

    def test_the_regulamin_is_sanitized_on_write(self):
        contest = self._contest()
        self.client.force_authenticate(self.organiser)
        self.client.put(
            f'/api/contests/{contest.pk}/rules/',
            {'sections': [{'key': 'organiser', 'body': '<p>ok</p><script>alert(1)</script>'}]},
            format='json',
        )
        body = ContestRulesSection.objects.get(contest=contest, key='organiser').body
        self.assertNotIn('<script', body)
        self.assertIn('ok', body)

    def test_compliance_is_staff_only_and_says_it_is_not_legal_advice(self):
        contest = self._contest(has_prize=True, prize_total_value_pln=5000)
        self.client.force_authenticate(self.entrant)
        self.assertEqual(
            self.client.get(f'/api/contests/{contest.pk}/compliance/').status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.client.force_authenticate(self.juror)
        response = self.client.get(f'/api/contests/{contest.pk}/compliance/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['not_legal_advice'])
        keys = {item['key']: item for item in response.data['items']}
        self.assertEqual(keys['claim_deadline']['state'], 'missing')
        self.assertIn('kc_921_1', keys['claim_deadline']['law'])
        # The tax block shows the science limb and the gross-up, and never the mass-media one.
        self.assertTrue(response.data['tax']['above_threshold'])
        self.assertEqual(response.data['tax']['threshold_pln'], 2000)
        self.assertAlmostEqual(response.data['tax']['gross_up_pln'], 5555.56, places=2)

    def test_every_law_key_the_panel_cites_exists_in_the_presets_law_table(self):
        from contests import presets

        contest = self._contest(has_prize=True, prize_total_value_pln=100)
        self.client.force_authenticate(self.organiser)
        report = self.client.get(f'/api/contests/{contest.pk}/compliance/').data
        cited = {key for item in report['items'] for key in item['law']}
        cited |= set(report['tax']['law'])
        self.assertTrue(cited)
        self.assertEqual(cited - set(presets.LAW), set())
        # And every marker is one the frontend has a label for.
        for key in cited:
            self.assertIn(presets.LAW[key][1], presets.LAW_MARKERS)


class StaffAndPeopleTests(ContestApiTestCase):
    def test_a_person_is_added_by_account_id_and_the_founder_cannot_be_removed(self):
        contest = self._contest()
        self.client.force_authenticate(self.organiser)
        added = self.client.post(
            f'/api/contests/{contest.pk}/staff/',
            {'user_id': self.stranger.pk, 'role': 'jury'}, format='json',
        )
        self.assertEqual(added.status_code, status.HTTP_201_CREATED)
        twice = self.client.post(
            f'/api/contests/{contest.pk}/staff/',
            {'user_id': self.stranger.pk, 'role': 'proctor'}, format='json',
        )
        self.assertEqual(twice.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(twice.data['detail'], 'already_staff')
        removed = self.client.delete(f'/api/contest-staff/{added.data["id"]}/')
        self.assertEqual(removed.status_code, status.HTTP_204_NO_CONTENT)
        own = ContestStaff.objects.create(
            contest=contest, user=self.organiser, role='organiser'
        )
        refused = self.client.delete(f'/api/contest-staff/{own.pk}/')
        self.assertEqual(refused.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(refused.data['detail'], rules.LAST_ORGANISER)

    def test_people_suggestions_carry_the_via_line_and_never_the_caller(self):
        from courses.models import Course, CourseStaff

        course = Course.objects.create(title='Analiza I', instructor=self.organiser)
        CourseStaff.objects.create(course=course, user=self.juror, role='assistant')
        self.client.force_authenticate(self.organiser)
        response = self.client.get('/api/contests/people-suggestions/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = {row['id']: row for row in response.data['people']}
        self.assertIn(self.juror.pk, rows)
        self.assertNotIn(self.organiser.pk, rows)
        self.assertIn('course:Analiza I', rows[self.juror.pk]['via'])

    def test_people_suggestions_read_every_roster_without_assuming_a_title(self):
        """The four rosters are four other apps' models and they do NOT share a field name — a
        course and an organisation have `title`/`name`, a `MaterialProject` has neither (it is a
        `OneToOne` on a material, whose name lives in that material's translations). The first run
        of this module against the dev database raised `AttributeError: 'MaterialProject' object has
        no attribute 'title'`, so each arm is exercised here rather than only the easy one."""
        from coauthoring.models import MaterialProject, ProjectMember
        from organizations.models import Organization, OrganizationMember

        from contests import people

        branch = Branch.objects.create(
            discipline=Discipline.objects.create(slug='sugg-disc'), slug='sugg-branch'
        )
        project = MaterialProject.objects.create(
            branch=branch, created_by=self.organiser, type='script'
        )
        # The owner's own `ProjectMember` row already exists — `coauthoring` creates it with the
        # project, and `one_owner_per_project` is a partial unique index that refuses a second one.
        # (Writing it by hand here was this test's first version, and the database said no.)
        ProjectMember.objects.get_or_create(
            project=project, user=self.organiser, defaults={'role': 'owner'}
        )
        ProjectMember.objects.create(project=project, user=self.entrant, role='coauthor')
        organization = Organization.objects.create(name='Koło Naukowe', slug='kolo-sugg')
        OrganizationMember.objects.create(
            organization=organization, user=self.organiser, role='owner'
        )
        OrganizationMember.objects.create(
            organization=organization, user=self.stranger, role='member'
        )

        rows = {row['id']: row for row in people.suggested_people(self.organiser)}
        self.assertIn(self.entrant.pk, rows)
        self.assertIn(self.stranger.pk, rows)
        self.assertTrue(any(v.startswith('project:') for v in rows[self.entrant.pk]['via']))
        self.assertIn('organization:Koło Naukowe', rows[self.stranger.pk]['via'])

    def test_people_suggestions_need_an_account(self):
        response = self.client.get('/api/contests/people-suggestions/')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class WorkAndRecordTests(ContestApiTestCase):
    """`work.py` and `record.py` — written here, registered by step B, so these are direct calls."""

    def test_work_items_has_a_row_for_each_of_the_four_kinds(self):
        from contests import work

        contest = self._open_for_registration(self._contest())
        stage = self._stage(contest)
        ContestProblem.objects.create(stage=stage, exercise=self._exercise(1), order=0, points=5)
        registration = ContestRegistration.objects.create(
            contest=contest, user=self.entrant, status='accepted'
        )
        stage.status = 'open'
        stage.save()
        kinds = {row['kind'] for row in work.work_items(self.entrant)}
        self.assertEqual(kinds, {'contest_registration', 'contest_stage'})
        ContestSubmission.objects.create(
            stage=stage, registration=registration, status='submitted'
        )
        stage.status = 'closed'
        stage.save()
        rows = work.work_items(self.juror)
        self.assertEqual({row['kind'] for row in rows}, {'contest_judging'})
        # A code and a number, never the English sentence `'1 waiting'` (house rule 1).
        self.assertEqual((rows[0]['status'], rows[0]['count']), ('waiting', 1))
        from contests.models import ContestComplaint

        contest.results_published_at = timezone.now()
        contest.status = 'results_published'
        contest.save()
        ContestComplaint.objects.create(
            contest=contest, registration=registration, text='Uwaga.'
        )
        kinds = {row['kind'] for row in work.work_items(self.secretary)}
        self.assertEqual(kinds, {'contest_complaint'})

    def test_every_work_item_has_exactly_the_registered_keys(self):
        from work.providers import ITEM_KEYS

        from contests import work

        contest = self._open_for_registration(self._contest())
        ContestRegistration.objects.create(
            contest=contest, user=self.entrant, status='accepted'
        )
        rows = work.work_items(self.entrant)
        self.assertTrue(rows)
        for row in rows:
            self.assertEqual(set(row), set(ITEM_KEYS))

    def test_placements_come_only_from_published_results(self):
        from contests import record

        contest = self._open_for_registration(self._contest())
        stage = self._stage(contest)
        problem = ContestProblem.objects.create(
            stage=stage, exercise=self._exercise(1), order=0, points=10
        )
        registration = ContestRegistration.objects.create(
            contest=contest, user=self.entrant, status='accepted'
        )
        submission = ContestSubmission.objects.create(
            stage=stage, registration=registration, status='submitted'
        )
        ContestScore.objects.create(
            submission=submission, problem=problem, juror=self.juror, points=10
        )
        stage.status = 'closed'
        stage.save()
        contest.status = 'judging'
        contest.save()
        self.assertEqual(record.placements_for(self.entrant), [])
        rules.publish_results(contest, actor=self.organiser)
        rows = record.placements_for(self.entrant)
        self.assertEqual(len(rows), 1)
        self.assertEqual(set(rows[0]), {'contest_id', 'title', 'result_title', 'published_at'})
        self.assertEqual(rows[0]['result_title'], 'laureate')
