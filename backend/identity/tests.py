"""What these cover, and why each one is here rather than assumed.

The sign-in providers are drafts, so the thing worth testing about them is that they *stay* drafts
and describe themselves truthfully — a draft that quietly signed somebody in would be far worse than
no button at all.

The USOS ground is not a draft: the models, the consent gates, the import path, the course matching
and the standing calculation are all real, and the mock connector exists precisely so they are
genuinely exercised against the same interface a real client will implement, instead of being
plausible-looking code nobody has run.
"""

from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from courses.models import Chapter, Course, Lesson, LessonProgress
from moderation.models import FeatureFlag
from study.models import ExerciseSet, ExerciseSetItem
from taxonomy.models import Branch, BranchTranslation, Discipline
from telemetry.routers import all_log_shards
from testing.factories import make_exercise

from .models import (
    CourseGrade,
    EducationProfile,
    School,
    StudentStatus,
    Verification,
    academic_year_of,
    grades_by_year,
)
from .record import ACTIVITY_PROVIDERS, register_activity_provider, sets_by_branch
from .standing import ceiling_for, public_view
from . import usos

USOS_MOCK = override_settings(EDMAT_USOS_MOCK=True)


def make_exercise_set(owner, name, exercises):
    """A study set with its items, for `record.sets_by_branch`.

    Local to this module rather than added to `testing/factories.py`: one suite needs it, and this
    project's own three-strikes convention says a shared helper is earned by a third caller."""
    exercise_set = ExerciseSet.objects.create(owner=owner, name=name)
    for order, exercise in enumerate(exercises):
        ExerciseSetItem.objects.create(exercise_set=exercise_set, exercise=exercise, order=order)
    return exercise_set


def make_course_with_lessons(instructor, branch, titles):
    """A course, one chapter, and a lesson per title — the Chapter -> Lesson path
    `record.lessons_done_by_branch` walks. `branch=None` builds the real state of a course with no
    taxonomy link at all."""
    course = Course.objects.create(title=f'Kurs {titles[0]}', instructor=instructor)
    if branch is not None:
        course.subjects.add(branch)
    chapter = Chapter.objects.create(course=course, title='Program')
    return [
        Lesson.objects.create(chapter=chapter, title=title, order=order)
        for order, title in enumerate(titles)
    ]


class ApiTestCase(TestCase):
    """Every test here that makes a real request needs the log shards declared.

    The request-logging middleware (telemetry) writes to a separate database per shard, so a view
    test that does not name them fails on Django's own cross-database isolation guard rather than on
    anything to do with the code under test.
    """

    databases = set(all_log_shards()) | {'default'}


class ProviderStateTests(ApiTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_every_provider_is_offered_and_declares_itself_a_draft(self):
        res = self.client.get('/api/auth/providers/')
        self.assertEqual(res.status_code, 200)
        by_id = {p['id']: p for p in res.data['providers']}
        self.assertEqual(set(by_id), {'school', 'google', 'apple', 'github'})
        for provider in by_id.values():
            self.assertEqual(provider['status'], 'draft')
            self.assertTrue(provider['blockers'], provider['id'])

    def test_the_state_is_computed_from_settings_not_hardcoded(self):
        """Configuring a real client is what flips the status — no copy to edit anywhere."""
        with override_settings(
            EDMAT_OAUTH_CLIENTS={'google': {'client_id': 'x', 'client_secret': 'y'}},
            EDMAT_OAUTH_REDIRECT_BASE='https://edmat.example',
        ):
            res = self.client.get('/api/auth/providers/')
            by_id = {p['id']: p for p in res.data['providers']}
            self.assertEqual(by_id['google']['status'], 'configured')
            # Everything else is untouched by one provider being configured.
            self.assertEqual(by_id['github']['status'], 'draft')

    def test_per_provider_quirks_are_real_and_specific(self):
        by_id = {p['id']: p for p in self.client.get('/api/auth/providers/').data['providers']}
        self.assertIn('POST', by_id['apple']['quirk'])
        self.assertEqual(by_id['apple']['response_mode'], 'form_post')
        self.assertIn('/user/emails', by_id['github']['quirk'])
        self.assertIn('id_token', by_id['google']['quirk'])
        self.assertEqual(by_id['school']['protocol'], 'saml')

    def test_oidc_providers_demand_token_verification_in_the_callback(self):
        by_id = {p['id']: p for p in self.client.get('/api/auth/providers/').data['providers']}
        google = ' '.join(by_id['google']['callback_requirements'])
        self.assertIn('nonce', google)
        self.assertIn('state', google)
        # And the OAuth2 one carries the account-takeover warning the OIDC ones do not need.
        github = ' '.join(by_id['github']['callback_requirements'])
        self.assertIn('unverified email', github)

    def test_no_provider_endpoint_can_authenticate_anybody(self):
        """The drafts are read-only. There is no handshake to POST to."""
        self.assertEqual(self.client.post('/api/auth/providers/', {}).status_code, 405)

    def test_the_modal_gets_a_repository_link(self):
        res = self.client.get('/api/auth/providers/')
        self.assertIn('github.com', res.data['repository_url'])


class SchoolTests(TestCase):
    def test_the_seed_migration_populated_the_picker(self):
        self.assertGreaterEqual(School.objects.count(), 20)
        self.assertTrue(School.objects.filter(slug='uw').exists())

    def test_email_domain_matching_is_strict(self):
        uw = School.objects.get(slug='uw')
        self.assertTrue(uw.matches_email('jan@uw.edu.pl'))
        # A faculty subdomain is still the institution.
        self.assertTrue(uw.matches_email('jan@wne.uw.edu.pl'))
        # A hostname anybody could register must never verify.
        self.assertFalse(uw.matches_email('jan@uw.edu.pl.example.com'))
        self.assertFalse(uw.matches_email('jan@notuw.edu.pl'))
        self.assertFalse(uw.matches_email('nonsense'))

    def test_schools_without_a_usos_installation_say_so(self):
        self.assertFalse(School.objects.get(slug='asp-warszawa').runs_usos)
        self.assertTrue(School.objects.get(slug='uw').runs_usos)


class UsosStateTests(ApiTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_usos_is_unconfigured_and_names_the_real_blocker(self):
        res = self.client.get('/api/education/usos/?school=uw')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data['is_mock'])
        self.assertEqual(res.data['configured_schools'], [])
        blockers = ' '.join(res.data['blockers'])
        self.assertIn('per institution', blockers)
        self.assertIn('OAuth 1.0a', res.data['protocol'])

    def test_grades_are_not_in_the_default_scope(self):
        res = self.client.get('/api/education/usos/')
        self.assertNotIn('grades', res.data['base_scopes'])
        self.assertEqual(res.data['grades_scope'], 'grades')

    def test_the_unconfigured_connector_verifies_nobody(self):
        uw = School.objects.get(slug='uw')
        connector = usos.active_connector()
        self.assertIsNone(connector.connect(uw, ('studies',), None))
        self.assertEqual(connector.fetch_grades(None), [])


class EducationClaimTests(ApiTestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user('ola', 'ola@example.com', 'pw12345!')
        self.client.force_authenticate(self.user)

    def test_declaring_a_school_is_worth_a_step_and_no_more(self):
        res = self.client.patch('/api/education/me/', {'school': 'uw'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['education']['verification'], 'self_declared')
        self.assertEqual(res.data['standing']['tier'], 'D')
        self.assertIsNone(res.data['standing']['usos_tier'])

    def test_an_institutional_address_alone_does_not_verify_anything(self):
        """Because EdMat cannot confirm an address yet, so this would be earned by typing."""
        self.user.email = 'ola@uw.edu.pl'
        self.user.save()
        res = self.client.patch('/api/education/me/', {'school': 'uw'}, format='json')
        self.assertTrue(res.data['school_email_eligible'])
        self.assertEqual(res.data['education']['verification'], 'self_declared')
        self.assertEqual(res.data['standing']['tier'], 'D')

    def test_a_school_not_on_the_list_is_a_real_answer(self):
        res = self.client.patch(
            '/api/education/me/', {'other_school_name': 'XIV LO'}, format='json'
        )
        self.assertEqual(res.data['education']['school_label'], 'XIV LO')
        self.assertIsNone(res.data['education']['school'])

    def test_consents_all_start_off(self):
        res = self.client.get('/api/education/me/')
        # `share_activity` (identity/record.py) is the fourth, and it starts off for the same reason
        # the other three do: nothing about having an account publishes anything about it.
        for flag in ('share_school', 'share_diploma', 'share_grades', 'share_activity'):
            self.assertFalse(res.data['education'][flag], flag)

    def test_usos_is_refused_when_unconfigured_and_explains_why(self):
        self.client.patch('/api/education/me/', {'school': 'uw'}, format='json')
        res = self.client.post('/api/education/usos/connect/', {}, format='json')
        self.assertEqual(res.status_code, 503)
        self.assertIn('blockers', res.data)


@USOS_MOCK
class UsosConnectedTests(ApiTestCase):
    """The ground, genuinely exercised — against the same interface a real client implements."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user('michal', 'michal@example.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.client.patch('/api/education/me/', {'school': 'uw'}, format='json')

    def connect(self, include_grades=False):
        return self.client.post(
            '/api/education/usos/connect/', {'include_grades': include_grades}, format='json'
        )

    def test_connecting_verifies_enrolment_and_lifts_the_ceiling_to_S(self):
        res = self.connect()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['education']['verification'], 'usos')
        self.assertEqual(res.data['education']['status'], StudentStatus.STUDENT)
        self.assertTrue(res.data['education']['usos_student_number'])
        self.assertEqual(res.data['standing']['tier'], 'S')
        self.assertEqual(res.data['standing']['usos_tier'], 'S')

    def test_the_ceiling_is_itemised_not_a_bare_number(self):
        self.connect()
        res = self.client.get('/api/education/me/')
        codes = [r['code'] for r in res.data['standing']['reasons']]
        self.assertIn('usos_verified', codes)
        detail = ' '.join(r['detail'] for r in res.data['standing']['reasons'])
        self.assertIn('registry', detail)

    def test_connecting_grants_no_authority_over_other_people(self):
        self.connect()
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_staff)
        grants = ' '.join(self.client.get('/api/education/usos/?school=uw').data['grants'])
        self.assertIn('none', grants.lower())

    def test_grades_need_their_own_authorization(self):
        """Connecting normally must not quietly pull a transcript."""
        self.connect(include_grades=False)
        res = self.client.post('/api/education/usos/import/', {'kind': 'grades'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data['needs_scope'], 'grades')
        self.assertEqual(CourseGrade.objects.count(), 0)

    def test_transferring_a_diploma_and_a_transcript_when_asked(self):
        self.connect(include_grades=True)
        diploma = self.client.post(
            '/api/education/usos/import/', {'kind': 'diploma'}, format='json'
        )
        self.assertEqual(diploma.status_code, 200)
        self.assertGreaterEqual(diploma.data['imported'], 1)

        grades = self.client.post('/api/education/usos/import/', {'kind': 'grades'}, format='json')
        self.assertGreaterEqual(grades.data['imported'], 1)
        self.assertTrue(grades.data['education']['grades'])

    def test_importing_publishes_nothing(self):
        """The whole point of separating transfer from consent."""
        self.connect(include_grades=True)
        self.client.post('/api/education/usos/import/', {'kind': 'diploma'}, format='json')
        res = self.client.post('/api/education/usos/import/', {'kind': 'grades'}, format='json')
        for flag in ('share_school', 'share_diploma', 'share_grades'):
            self.assertFalse(res.data['education'][flag], flag)
        public = APIClient().get(f'/api/users/{self.user.pk}/')
        self.assertIsNone(public.data['education'])

    def test_consent_is_granted_one_field_at_a_time(self):
        self.connect(include_grades=True)
        self.client.post('/api/education/usos/import/', {'kind': 'diploma'}, format='json')
        self.client.post('/api/education/usos/import/', {'kind': 'grades'}, format='json')
        anon = APIClient()

        self.client.patch('/api/education/me/', {'share_school': True}, format='json')
        public = anon.get(f'/api/users/{self.user.pk}/').data['education']
        self.assertEqual(public['verification'], 'usos')
        self.assertEqual(public['diplomas'], [])
        self.assertEqual(public['grades'], [])

        self.client.patch('/api/education/me/', {'share_diploma': True}, format='json')
        public = anon.get(f'/api/users/{self.user.pk}/').data['education']
        self.assertTrue(public['diplomas'])
        self.assertEqual(public['grades'], [])

        self.client.patch('/api/education/me/', {'share_grades': True}, format='json')
        public = anon.get(f'/api/users/{self.user.pk}/').data['education']
        self.assertTrue(public['grades'])
        self.assertIsNotNone(public['average'])

    def test_publishing_does_not_change_what_you_may_do(self):
        """Capability must never be for sale in exchange for a transcript."""
        self.connect(include_grades=True)
        self.client.post('/api/education/usos/import/', {'kind': 'grades'}, format='json')
        before = self.client.get('/api/education/me/').data['standing']['tier']
        self.client.patch(
            '/api/education/me/',
            {'share_school': True, 'share_diploma': True, 'share_grades': True},
            format='json',
        )
        after = self.client.get('/api/education/me/').data['standing']['tier']
        self.assertEqual(before, after)

    def test_removing_a_transcript_removes_it_from_the_profile_too(self):
        self.connect(include_grades=True)
        self.client.post('/api/education/usos/import/', {'kind': 'grades'}, format='json')
        self.client.patch(
            '/api/education/me/', {'share_school': True, 'share_grades': True}, format='json'
        )
        res = self.client.delete('/api/education/grades/')
        self.assertEqual(res.data['education']['grades'], [])
        public = APIClient().get(f'/api/users/{self.user.pk}/').data['education']
        self.assertEqual(public['grades'], [])

    def test_disconnecting_falls_back_rather_than_to_nothing_when_earned(self):
        self.connect()
        profile = EducationProfile.objects.get(user=self.user)
        profile.verified_via = 'school'
        profile.save()
        res = self.client.delete('/api/education/usos/connect/')
        self.assertEqual(res.data['education']['verification'], Verification.SCHOOL_EMAIL)
        self.assertFalse(res.data['education']['usos_connected'])

    def test_changing_school_drops_every_claim_the_old_one_backed(self):
        self.connect(include_grades=True)
        self.client.post('/api/education/usos/import/', {'kind': 'grades'}, format='json')
        res = self.client.patch('/api/education/me/', {'school': 'uj'}, format='json')
        self.assertEqual(res.data['education']['verification'], 'self_declared')
        self.assertFalse(res.data['education']['usos_connected'])
        self.assertEqual(res.data['education']['grades'], [])

    def test_an_institution_without_usos_is_genuinely_unsupported(self):
        self.client.patch('/api/education/me/', {'school': 'asp-warszawa'}, format='json')
        res = self.connect()
        self.assertEqual(res.status_code, 503)
        state = self.client.get('/api/education/usos/?school=asp-warszawa').data
        self.assertFalse(state['school_runs_usos'])
        self.assertFalse(state['capabilities']['identity'])

    def test_the_mock_declares_itself_wherever_it_is_on(self):
        state = self.client.get('/api/education/usos/?school=uw').data
        self.assertTrue(state['is_mock'])
        self.assertIn('talks to no university', ' '.join(state['blockers']))


@USOS_MOCK
class SkillSeedTests(ApiTestCase):
    """§3a's "seeded SKILL from real enrolment" — the reason a transcript is worth more than a badge."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user('kasia', 'kasia@example.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        field = Discipline.objects.create(slug='matematyka')
        branch = Branch.objects.create(slug='analiza-2', discipline=field)
        BranchTranslation.objects.create(
            branch=branch, locale='pl', name='Analiza matematyczna II'
        )
        self.branch = branch
        self.client.patch('/api/education/me/', {'school': 'uw'}, format='json')
        self.client.post(
            '/api/education/usos/connect/', {'include_grades': True}, format='json'
        )
        self.client.post('/api/education/usos/import/', {'kind': 'grades'}, format='json')

    def test_a_registry_course_matches_a_real_course_on_this_site(self):
        matched = CourseGrade.objects.filter(matched_course=self.branch)
        self.assertTrue(matched.exists())

    def test_unmatched_results_are_kept_but_never_placed(self):
        """An unmatched branch is still a real result — inventing a placement would be worse."""
        self.assertTrue(CourseGrade.objects.filter(matched_course__isnull=True).exists())
        seeds = self.client.get('/api/education/me/').data['standing']['skill_seeds']
        self.assertTrue(all(s['branch_slug'] == 'analiza-2' for s in seeds))

    def test_seeds_do_not_require_publishing_the_transcript(self):
        profile = EducationProfile.objects.get(user=self.user)
        self.assertFalse(profile.share_grades)
        self.assertTrue(ceiling_for(profile, self.user)['skill_seeds'])


class WeightedAverageTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('bartek', 'b@example.com', 'pw12345!')
        self.profile = EducationProfile.objects.create(user=self.user)

    def add(self, value, ects, scale='polish_2_5'):
        CourseGrade.objects.create(
            profile=self.profile, name=f'C{value}{ects}', value=value, ects=ects, scale=scale
        )

    def test_it_is_weighted_by_credits_not_a_flat_mean(self):
        self.add('3.0', 30)
        self.add('5.0', 3)
        from .models import weighted_average

        average = weighted_average(list(self.profile.grades.all()))
        self.assertAlmostEqual(average, 3.18, places=2)  # a flat mean would say 4.0

    def test_mixed_scales_have_no_single_number(self):
        self.add('4.0', 6)
        self.add('B', 6, scale='ects_letter')
        from .models import weighted_average

        self.assertIsNone(weighted_average(list(self.profile.grades.all())))

    def test_nothing_is_public_without_consent(self):
        self.add('4.0', 6)
        self.assertIsNone(public_view(self.profile))


class AcademicYearTests(TestCase):
    """Reading a year out of a term id, and grouping a transcript by it."""

    def test_the_semester_suffix_is_split_from_the_right(self):
        """The year half is the part whose shape this code does not know: USOS's own term ids are
        `<year>-<semester>` everywhere the consortium documents, but a left-split would silently
        truncate a year at an installation that deviates."""
        self.assertEqual(academic_year_of('2024/25-Z'), '2024/25')
        self.assertEqual(academic_year_of('2024-2025-L'), '2024-2025')

    def test_a_term_with_no_suffix_is_its_own_year(self):
        """A registry reporting annual rather than semestral results is reporting something real."""
        self.assertEqual(academic_year_of('2024/25'), '2024/25')

    def test_a_blank_term_is_blank_rather_than_a_guess(self):
        self.assertEqual(academic_year_of(''), '')
        self.assertEqual(academic_year_of(None), '')


class GradeYearGroupingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('zofia', 'z@example.com', 'pw12345!')
        self.profile = EducationProfile.objects.create(user=self.user)

    def add(self, term, value, ects, scale='polish_2_5'):
        CourseGrade.objects.create(
            profile=self.profile,
            name=f'{term}-{value}-{ects}',
            term=term,
            value=value,
            ects=ects,
            scale=scale,
        )

    def test_both_semesters_of_a_year_land_in_one_row(self):
        self.add('2023/24-Z', '4.0', 6)
        self.add('2023/24-L', '5.0', 6)
        rows = grades_by_year(list(self.profile.grades.all()))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['terms'], ['2023/24-L', '2023/24-Z'])
        self.assertEqual(rows[0]['count'], 2)
        self.assertEqual(rows[0]['ects'], 12)

    def test_years_are_newest_first(self):
        self.add('2022/23-Z', '3.0', 5)
        self.add('2024/25-Z', '5.0', 5)
        self.add('2023/24-Z', '4.0', 5)
        self.assertEqual(
            [row['year'] for row in grades_by_year(list(self.profile.grades.all()))],
            ['2024/25', '2023/24', '2022/23'],
        )

    def test_each_year_gets_its_own_credit_weighted_average(self):
        """Weighted per year, not a flat mean of that year's marks — a 30-credit thesis and a
        2-credit elective are not equal halves of anything."""
        self.add('2023/24-Z', '3.0', 30)
        self.add('2023/24-L', '5.0', 3)
        rows = grades_by_year(list(self.profile.grades.all()))
        self.assertAlmostEqual(rows[0]['average'], 3.18, places=2)

    def test_one_year_of_letter_grades_does_not_blank_the_others(self):
        """`weighted_average` refuses a mixed-scale record outright, which is right for the whole
        transcript and would be wrong per year: two Polish-scale years have a real number even when a
        third does not, and reporting `None` for all three would lose it."""
        self.add('2023/24-Z', '4.0', 6)
        self.add('2022/23-Z', 'B', 6, scale='ects_letter')
        rows = {row['year']: row['average'] for row in grades_by_year(list(self.profile.grades.all()))}
        self.assertEqual(rows['2023/24'], 4.0)
        self.assertIsNone(rows['2022/23'])

    def test_an_unreadable_year_sorts_last_rather_than_oldest(self):
        """It is not the earliest year — it is unknown, and inventing one would be worse."""
        self.add('', '4.0', 6)
        self.add('2019/20-Z', '4.0', 6)
        rows = grades_by_year(list(self.profile.grades.all()))
        self.assertEqual(rows[-1]['year'], '')


@USOS_MOCK
class MultiYearTranscriptTests(ApiTestCase):
    """Transferring a transcript that spans several academic years, and pruning it a year at a time."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user('marta', 'marta@example.com', 'pw12345!')
        self.client.force_authenticate(self.user)
        self.client.patch('/api/education/me/', {'school': 'uw'}, format='json')
        self.client.post('/api/education/usos/connect/', {'include_grades': True}, format='json')

    def import_grades(self, **body):
        return self.client.post(
            '/api/education/usos/import/', {'kind': 'grades', **body}, format='json'
        )

    def test_the_registry_reports_more_than_one_year(self):
        """Without this the per-year view has nothing to show, and every test below it is vacuous."""
        res = self.import_grades()
        years = [row['year'] for row in res.data['education']['grade_years']]
        self.assertGreaterEqual(len(years), 3)
        self.assertEqual(years, sorted(years, reverse=True))

    def test_each_year_carries_its_own_average_and_credit_total(self):
        for row in self.import_grades().data['education']['grade_years']:
            self.assertGreater(row['count'], 0)
            self.assertGreater(row['ects'], 0)
            self.assertIsNotNone(row['average'])

    def test_naming_years_transfers_only_those(self):
        all_years = [r['year'] for r in self.import_grades().data['education']['grade_years']]
        self.client.delete('/api/education/grades/')

        res = self.import_grades(years=[all_years[0]])
        self.assertEqual([r['year'] for r in res.data['education']['grade_years']], [all_years[0]])

    def test_a_second_narrower_transfer_adds_to_the_first_rather_than_replacing_it(self):
        """"Transfer these years" says nothing about the others, so neither does the write — wiping
        them would silently discard a transfer the person made earlier and did not ask to undo."""
        all_years = [r['year'] for r in self.import_grades().data['education']['grade_years']]
        self.client.delete('/api/education/grades/')

        self.import_grades(years=[all_years[0]])
        res = self.import_grades(years=[all_years[1]])
        self.assertEqual(
            sorted(r['year'] for r in res.data['education']['grade_years']),
            sorted(all_years[:2]),
        )

    def test_re_transferring_a_year_does_not_duplicate_it(self):
        all_years = [r['year'] for r in self.import_grades().data['education']['grade_years']]
        before = CourseGrade.objects.count()
        self.import_grades(years=[all_years[0]])
        self.assertEqual(CourseGrade.objects.count(), before)

    def test_transferring_with_no_years_named_replaces_the_whole_record(self):
        all_years = [r['year'] for r in self.import_grades().data['education']['grade_years']]
        self.client.delete('/api/education/grades/')
        self.import_grades(years=[all_years[0]])

        res = self.import_grades()
        self.assertEqual(len(res.data['education']['grade_years']), len(all_years))

    def test_a_registry_that_answers_with_nothing_never_deletes_a_transcript(self):
        """The dangerous half of "a full transfer replaces the stored copy".

        An unreachable installation, an expired authorization and a deployment running the
        unconfigured connector all return an empty list, and taking that as "you have no results any
        more" loses something the account holder deliberately transferred. Reproduced by running into
        it rather than by reasoning about it.
        """
        before = self.import_grades().data['education']['grades']
        self.assertTrue(before)

        with patch.object(usos.MockUsosConnector, 'fetch_grades', return_value=[]):
            res = self.import_grades()

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['imported'], 0)
        self.assertEqual(len(res.data['education']['grades']), len(before))

    def test_years_must_be_a_list_of_strings(self):
        self.assertEqual(self.import_grades(years='2023/24').status_code, 400)
        self.assertEqual(self.import_grades(years=[2023]).status_code, 400)

    def test_removing_one_year_keeps_the_rest_and_keeps_them_published(self):
        """Pruning one year is not a statement about the years kept, so the consent that publishes
        them is deliberately untouched — un-publishing them would be the app overruling a decision
        made separately."""
        all_years = [r['year'] for r in self.import_grades().data['education']['grade_years']]
        self.client.patch('/api/education/me/', {'share_grades': True}, format='json')

        res = self.client.delete(f'/api/education/grades/?year={all_years[-1]}')
        self.assertEqual(res.status_code, 200)
        self.assertGreater(res.data['removed'], 0)
        self.assertNotIn(all_years[-1], [r['year'] for r in res.data['education']['grade_years']])
        self.assertTrue(res.data['education']['share_grades'])

    def test_removing_everything_also_withdraws_the_consent(self):
        """Nothing left to share, so a consent left switched on would be a promise about data that no
        longer exists."""
        self.import_grades()
        self.client.patch('/api/education/me/', {'share_grades': True}, format='json')

        res = self.client.delete('/api/education/grades/')
        self.assertEqual(res.data['education']['grades'], [])
        self.assertFalse(res.data['education']['share_grades'])

    def test_removing_a_year_that_was_never_imported_is_a_404(self):
        """Not a cheerful no-op: the caller is a UI that would otherwise tell somebody a year has been
        deleted when it has not."""
        self.import_grades()
        self.assertEqual(
            self.client.delete('/api/education/grades/?year=1999/2000').status_code, 404
        )

    def test_a_published_transcript_is_grouped_for_the_public_too(self):
        self.import_grades()
        self.client.patch(
            '/api/education/me/', {'share_school': True, 'share_grades': True}, format='json'
        )
        public = APIClient().get(f'/api/users/{self.user.pk}/').data['education']
        self.assertGreaterEqual(len(public['grade_years']), 3)

    def test_grouping_stays_private_until_the_grades_themselves_are_shared(self):
        self.import_grades()
        self.client.patch('/api/education/me/', {'share_school': True}, format='json')
        public = APIClient().get(f'/api/users/{self.user.pk}/').data['education']
        self.assertEqual(public['grade_years'], [])


class LearningRecordTests(ApiTestCase):
    """The learning record (`identity/record.py`, prompts/03-learning-record.md).

    What is worth pinning here is almost entirely about what the record does NOT say: nothing
    without consent, nothing for a minor whatever the consents say, nothing about an unmatched
    result, and never an EdMat count folded into a grade. The counts themselves are the easy half.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user('record-owner', 'rec@example.com', 'pw12345!')
        self.stranger = APIClient()

        self.discipline, _ = Discipline.objects.get_or_create(slug='matematyka')
        self.analysis = self._branch('analiza', 'Analiza matematyczna')
        self.probability = self._branch('prawdopodobienstwo', 'Rachunek prawdopodobieństwa')

        self.profile, _ = EducationProfile.objects.get_or_create(user=self.user)
        self.profile.school = School.objects.get(slug='uw')
        self.profile.save()

    def _branch(self, slug, name):
        branch, _ = Branch.objects.get_or_create(slug=slug, defaults={'discipline': self.discipline})
        BranchTranslation.objects.get_or_create(branch=branch, locale='pl', defaults={'name': name})
        return branch

    def _grade(self, name, value, ects, branch, *, term='2023Z'):
        return CourseGrade.objects.create(
            profile=self.profile,
            name=name,
            term=term,
            ects=ects,
            value=value,
            scale='polish_2_5',
            matched_course=branch,
        )

    def _share(self, **flags):
        for key, value in flags.items():
            setattr(self.profile, key, value)
        self.profile.save()

    def url(self, user=None):
        return f'/api/users/{(user or self.user).pk}/learning-record/'

    # -- nothing shared -----------------------------------------------------------------------

    def test_an_unshared_record_is_null_and_not_a_404(self):
        """The profile exists; it is the record that is withheld, and those are different answers."""
        self._grade('Analiza I', '4.0', 10, self.analysis)
        res = self.stranger.get(self.url())
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data)

    def test_an_id_that_is_nobody_is_a_404(self):
        self.assertEqual(self.stranger.get('/api/users/999999/learning-record/').status_code, 404)

    def test_an_account_with_no_education_row_answers_null(self):
        other = User.objects.create_user('no-education')
        self.assertIsNone(self.stranger.get(self.url(other)).data)

    # -- the grades block ---------------------------------------------------------------------

    def test_grades_are_grouped_per_branch_with_their_own_weighted_average(self):
        self._grade('Analiza I', '3.0', 10, self.analysis)
        self._grade('Analiza II', '5.0', 10, self.analysis)
        self._grade('Rachunek', '4.0', 5, self.probability)
        self._share(share_school=True, share_grades=True)

        rows = self.stranger.get(self.url()).data['grades']
        by_slug = {row['branch']['slug']: row for row in rows}
        self.assertEqual(set(by_slug), {'analiza', 'prawdopodobienstwo'})
        self.assertEqual(by_slug['analiza']['average'], 4.0)
        self.assertEqual(by_slug['analiza']['count'], 2)
        self.assertEqual(by_slug['analiza']['branch']['title'], 'Analiza matematyczna')
        self.assertEqual(by_slug['prawdopodobienstwo']['count'], 1)

    def test_a_result_the_site_could_not_place_is_left_out_rather_than_guessed(self):
        """The same conservative rule `skill_seeds_for` follows: unmatched is real, just not placeable."""
        self._grade('Analiza I', '4.0', 10, self.analysis)
        self._grade('Wstęp do programowania', '5.0', 6, None)
        self._share(share_school=True, share_grades=True)

        rows = self.stranger.get(self.url()).data['grades']
        self.assertEqual([row['branch']['slug'] for row in rows], ['analiza'])

    def test_grades_need_the_school_consent_too(self):
        """A mark with no institution attached is not a claim about anything."""
        self._grade('Analiza I', '4.0', 10, self.analysis)
        self._share(share_grades=True)
        self.assertIsNone(self.stranger.get(self.url()).data)

    def test_a_branch_mixing_grade_scales_reports_no_average_rather_than_inventing_one(self):
        self._grade('Analiza I', '4.0', 10, self.analysis)
        CourseGrade.objects.create(
            profile=self.profile,
            name='Analysis (exchange)',
            ects=6,
            value='B',
            scale='ects_letter',
            matched_course=self.analysis,
        )
        self._share(share_school=True, share_grades=True)
        row = self.stranger.get(self.url()).data['grades'][0]
        self.assertIsNone(row['average'])
        self.assertEqual(row['count'], 2)

    # -- the activity block -------------------------------------------------------------------

    def test_activity_is_withheld_until_its_own_consent_is_given(self):
        make_exercise_set(self.user, 'Powtórka', [make_exercise(self.analysis, 9001)])
        self._share(share_school=True, share_grades=True)
        self.assertIsNone(self.stranger.get(self.url()).data['activity'])

    def test_activity_counts_sets_per_branch_and_fills_every_metric(self):
        a1 = make_exercise(self.analysis, 9101)
        a2 = make_exercise(self.analysis, 9102)
        p1 = make_exercise(self.probability, 9103)
        make_exercise_set(self.user, 'Jeden', [a1, a2])
        make_exercise_set(self.user, 'Dwa', [a1, p1])
        self._share(share_activity=True)

        rows = self.stranger.get(self.url()).data['activity']
        by_slug = {row['branch']['slug']: row for row in rows}
        # Two sets touch analysis, one touches probability — a set spanning two branches counts in
        # both and never as two sets in one.
        self.assertEqual(by_slug['analiza']['sets'], 2)
        self.assertEqual(by_slug['prawdopodobienstwo']['sets'], 1)
        # Every metric this cycle declares is present as a zero rather than absent, so the table has
        # one set of columns.
        for row in rows:
            self.assertEqual(row['lessons_done'], 0)
            self.assertEqual(row['cards_reviewed'], 0)

    def test_a_set_with_many_exercises_in_one_branch_is_still_one_set(self):
        """A real bug: `ExerciseSetItem.Meta.ordering` is pulled into a `distinct()`'s SELECT, so the
        first version counted one set once per item and read 21 sets for an account with five."""
        exercises = [make_exercise(self.analysis, 9200 + n) for n in range(6)]
        make_exercise_set(self.user, 'Sześć zadań', exercises)
        self._share(share_activity=True)
        self.assertEqual(self.stranger.get(self.url()).data['activity'][0]['sets'], 1)

    def test_only_lessons_somebody_said_they_finished_are_counted(self):
        done, stuck = make_course_with_lessons(self.user, self.probability, ['Jedna', 'Druga'])
        LessonProgress.objects.create(lesson=done, participant=self.user, status='done')
        LessonProgress.objects.create(lesson=stuck, participant=self.user, status='stuck')
        self._share(share_activity=True)

        rows = self.stranger.get(self.url()).data['activity']
        self.assertEqual(rows[0]['branch']['slug'], 'prawdopodobienstwo')
        self.assertEqual(rows[0]['lessons_done'], 1)

    def test_a_lesson_in_a_course_with_no_subject_is_filed_under_no_branch(self):
        done, _ = make_course_with_lessons(self.user, None, ['Jedna', 'Druga'])
        LessonProgress.objects.create(lesson=done, participant=self.user, status='done')
        self._share(share_activity=True)
        self.assertEqual(self.stranger.get(self.url()).data['activity'], [])

    def test_a_registered_provider_contributes_its_own_metric(self):
        """What `flashcards` will do at integration, exercised here against a fake one."""
        branch_id = self.analysis.pk

        def provider(_user):
            return {branch_id: {'cards_reviewed': 41, 'own_metric': 2}}

        register_activity_provider(provider)
        try:
            self._share(share_activity=True)
            row = self.stranger.get(self.url()).data['activity'][0]
            self.assertEqual(row['cards_reviewed'], 41)
            self.assertEqual(row['own_metric'], 2)
            self.assertEqual(row['sets'], 0)
        finally:
            ACTIVITY_PROVIDERS.remove(provider)

    def test_registering_the_same_provider_twice_does_not_double_its_counts(self):
        before = len(ACTIVITY_PROVIDERS)
        register_activity_provider(sets_by_branch)
        self.assertEqual(len(ACTIVITY_PROVIDERS), before)

    # -- the two blocks never mix -------------------------------------------------------------

    def test_the_two_blocks_are_separate_lists_and_neither_carries_the_other_s_keys(self):
        """prompts/00-DESIGN.md §1 rule 3: an EdMat count is never drawn beside a grade as if it
        were one. At this layer that means the shapes have nothing in common but the branch."""
        self._grade('Analiza I', '4.0', 10, self.analysis)
        make_exercise_set(self.user, 'Powtórka', [make_exercise(self.analysis, 9301)])
        self._share(share_school=True, share_grades=True, share_activity=True)

        data = self.stranger.get(self.url()).data
        self.assertEqual(set(data['grades'][0]) - {'branch'}, {'average', 'count'})
        self.assertNotIn('average', data['activity'][0])
        self.assertNotIn('sets', data['grades'][0])

    # -- the viewer ---------------------------------------------------------------------------

    def test_the_owner_gets_the_record_back_even_when_nothing_is_shared(self):
        """So the one person who needs to know their consents are off is not shown nothing at all."""
        self.client.force_authenticate(self.user)
        data = self.client.get(self.url()).data
        self.assertTrue(data['is_owner'])
        self.assertIsNone(data['grades'])
        self.assertIsNone(data['activity'])

    def test_the_viewer_never_widens_what_is_shown(self):
        self._grade('Analiza I', '4.0', 10, self.analysis)
        make_exercise_set(self.user, 'Powtórka', [make_exercise(self.analysis, 9401)])
        self.client.force_authenticate(self.user)
        owner = self.client.get(self.url()).data
        self.assertIsNone(owner['grades'])
        self.assertIsNone(owner['activity'])

    def test_another_signed_in_account_is_not_the_owner(self):
        other = APIClient()
        other.force_authenticate(User.objects.create_user('nosy'))
        self.assertIsNone(other.get(self.url()).data)

    # -- minors -------------------------------------------------------------------------------

    def test_a_minor_s_record_is_never_public_whatever_the_consents_say(self):
        self._grade('Analiza I', '4.0', 10, self.analysis)
        self._share(share_school=True, share_grades=True, share_activity=True)
        self.user.profile.is_minor = True
        self.user.profile.save(update_fields=['is_minor'])

        self.assertIsNone(self.stranger.get(self.url()).data)

    def test_a_minor_reading_their_own_record_is_told_why_it_is_empty(self):
        self._share(share_school=True, share_grades=True)
        self.user.profile.is_minor = True
        self.user.profile.save(update_fields=['is_minor'])

        self.client.force_authenticate(self.user)
        data = self.client.get(self.url()).data
        self.assertEqual(data['withheld_reason'], 'minor')
        self.assertIsNone(data['grades'])

    def test_withholding_a_minor_s_record_does_not_rewrite_their_consents(self):
        """A guardian may have set them, and un-ticking somebody's consent behind their back would
        be its own small dishonesty."""
        self._share(share_school=True, share_grades=True)
        self.user.profile.is_minor = True
        self.user.profile.save(update_fields=['is_minor'])

        self.stranger.get(self.url())
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.share_grades)

    # -- the kill switch ----------------------------------------------------------------------

    def test_the_kill_switch_closes_the_endpoint_to_an_ordinary_caller(self):
        self._grade('Analiza I', '4.0', 10, self.analysis)
        self._share(share_school=True, share_grades=True)
        FeatureFlag.objects.update_or_create(key='learning_record', defaults={'is_enabled': False})

        # 403 is the refusal a real reader with an account sees, and the one worth pinning. An
        # ANONYMOUS caller gets 401 from the same gate — `TokenAuthentication` supplies a
        # `WWW-Authenticate` header, so DRF reads the refusal as "you did not say who you are" —
        # which `concepts.tests` already records for the same reason. Either way it is closed.
        self.assertEqual(self.stranger.get(self.url()).status_code, 401)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_a_moderator_keeps_their_own_tools_with_the_switch_off(self):
        self._grade('Analiza I', '4.0', 10, self.analysis)
        self._share(share_school=True, share_grades=True)
        FeatureFlag.objects.update_or_create(key='learning_record', defaults={'is_enabled': False})

        staff = APIClient()
        staff.force_authenticate(User.objects.create_user('mod', 'mod@example.com', 'pw', is_staff=True))
        self.assertEqual(staff.get(self.url()).status_code, 200)

    def test_the_neighbouring_profile_endpoint_keeps_working_with_the_switch_off(self):
        """House rule 3: a killed feature stops answering for itself and takes nothing else down."""
        FeatureFlag.objects.update_or_create(key='learning_record', defaults={'is_enabled': False})
        self.assertEqual(self.stranger.get(f'/api/users/{self.user.pk}/').status_code, 200)

    # -- the consent flag itself --------------------------------------------------------------

    def test_the_fourth_consent_is_settable_through_the_existing_endpoint(self):
        self.client.force_authenticate(self.user)
        res = self.client.patch('/api/education/me/', {'share_activity': True}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['education']['share_activity'])
        self.profile.refresh_from_db()
        self.assertTrue(self.profile.share_activity)

    def test_the_locale_the_reader_asked_for_names_the_branch(self):
        BranchTranslation.objects.create(branch=self.analysis, locale='en', name='Real analysis')
        self._grade('Analiza I', '4.0', 10, self.analysis)
        self._share(share_school=True, share_grades=True)

        self.assertEqual(
            self.stranger.get(self.url() + '?lang=en').data['grades'][0]['branch']['title'],
            'Real analysis',
        )
        self.assertEqual(
            self.stranger.get(self.url()).data['grades'][0]['branch']['title'],
            'Analiza matematyczna',
        )
