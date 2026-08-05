"""What these cover, and why each one is here rather than assumed.

The sign-in providers are drafts, so the thing worth testing about them is that they *stay* drafts
and describe themselves truthfully — a draft that quietly signed somebody in would be far worse than
no button at all.

The USOS ground is not a draft: the models, the consent gates, the import path, the course matching
and the standing calculation are all real, and the mock connector exists precisely so they are
genuinely exercised against the same interface a real client will implement, instead of being
plausible-looking code nobody has run.
"""

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from taxonomy.models import Course, CourseTranslation, Field
from telemetry.routers import all_log_shards

from .models import CourseGrade, EducationProfile, School, StudentStatus, Verification
from .standing import ceiling_for, public_view
from . import usos

USOS_MOCK = override_settings(EDMAT_USOS_MOCK=True)


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
        for flag in ('share_school', 'share_diploma', 'share_grades'):
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
        field = Field.objects.create(slug='matematyka')
        course = Course.objects.create(slug='analiza-2', field=field, university='UW')
        CourseTranslation.objects.create(
            course=course, locale='pl', name='Analiza matematyczna II'
        )
        self.course = course
        self.client.patch('/api/education/me/', {'school': 'uw'}, format='json')
        self.client.post(
            '/api/education/usos/connect/', {'include_grades': True}, format='json'
        )
        self.client.post('/api/education/usos/import/', {'kind': 'grades'}, format='json')

    def test_a_registry_course_matches_a_real_course_on_this_site(self):
        matched = CourseGrade.objects.filter(matched_course=self.course)
        self.assertTrue(matched.exists())

    def test_unmatched_results_are_kept_but_never_placed(self):
        """An unmatched course is still a real result — inventing a placement would be worse."""
        self.assertTrue(CourseGrade.objects.filter(matched_course__isnull=True).exists())
        seeds = self.client.get('/api/education/me/').data['standing']['skill_seeds']
        self.assertTrue(all(s['course_slug'] == 'analiza-2' for s in seeds))

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
