"""The audience band (AUDIENCE-BRIEF.md §1, config/audience.py): one axis on every content model,
`?audience=` narrowing every browse list, `all` always passing, and the value surviving the
submission → approval path onto the real row."""

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from courses.models import Course
from events.models import Event
from materials.models import Material
from moderation.models import ExerciseSubmission, MaterialSubmission
from services.models import Service
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_material, make_user


def _ids(response):
    return {row['id'] for row in response.json()}


class AudienceListFilterTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch(slug='aud-branch')
        self.uni = make_exercise(self.branch, 1)
        self.primary = make_exercise(self.branch, 2)
        self.primary.audience = 'primary'
        self.primary.save()
        self.everyone = make_exercise(self.branch, 3)
        self.everyone.audience = 'all'
        self.everyone.save()

    def test_default_is_university_and_no_param_means_everything(self):
        self.assertEqual(self.uni.audience, 'university')
        response = self.client.get(reverse('exercise-list'))
        self.assertEqual(_ids(response), {self.uni.pk, self.primary.pk, self.everyone.pk})

    def test_narrowing_keeps_the_band_and_content_for_everyone(self):
        response = self.client.get(reverse('exercise-list'), {'audience': 'primary'})
        self.assertEqual(_ids(response), {self.primary.pk, self.everyone.pk})

    def test_several_bands_are_a_union(self):
        response = self.client.get(reverse('exercise-list'), {'audience': 'primary,university'})
        self.assertEqual(_ids(response), {self.uni.pk, self.primary.pk, self.everyone.pk})

    def test_unknown_value_and_all_mean_no_narrowing(self):
        for raw in ('toddler', 'all', 'primary,all', ''):
            response = self.client.get(reverse('exercise-list'), {'audience': raw})
            self.assertEqual(_ids(response), {self.uni.pk, self.primary.pk, self.everyone.pk}, raw)

    def test_serializer_carries_the_band(self):
        response = self.client.get(reverse('exercise-detail', args=[self.primary.pk]))
        self.assertEqual(response.json()['audience'], 'primary')

    def test_random_picker_respects_the_band(self):
        for _ in range(6):
            response = self.client.get(reverse('exercise-random'), {'audience': 'primary'})
            self.assertIn(response.json()['id'], {self.primary.pk, self.everyone.pk})

    def test_materials(self):
        m_uni = make_material(self.branch, 'aud-m-uni')
        m_sen = make_material(self.branch, 'aud-m-sen')
        Material.objects.filter(pk=m_sen.pk).update(audience='senior')
        response = self.client.get(reverse('material-list'), {'audience': 'senior'})
        self.assertEqual(_ids(response), {m_sen.pk})
        self.assertIn(m_uni.pk, _ids(self.client.get(reverse('material-list'))))

    def test_events(self):
        host = make_user('aud-host')
        common = dict(host=host, status='published', visibility='public',
                      starts_at=timezone.now() + timezone.timedelta(days=2), location_kind='online',
                      online_url='https://example.org/meet')
        e_uni = Event.objects.create(title='Uni talk', **common)
        e_kid = Event.objects.create(title='Kids workshop', audience='primary', **common)
        response = self.client.get(reverse('event-list'), {'audience': 'primary'})
        self.assertEqual(_ids(response), {e_kid.pk})
        self.assertEqual(_ids(self.client.get(reverse('event-list'))), {e_uni.pk, e_kid.pk})

    def test_services(self):
        provider = make_user('aud-tutor')
        s_uni = Service.objects.create(provider=provider, title='Analysis', is_active=True)
        s_adult = Service.objects.create(provider=provider, title='Back to maths', is_active=True, audience='adult')
        response = self.client.get(reverse('service-list'), {'audience': 'adult'})
        self.assertEqual(_ids(response), {s_adult.pk})
        self.assertEqual(_ids(self.client.get(reverse('service-list'))), {s_uni.pk, s_adult.pk})

    def test_taught_courses(self):
        instructor = make_user('aud-instructor')
        c_uni = Course.objects.create(instructor=instructor, title='Analiza', visibility='public', status='open')
        c_sec = Course.objects.create(instructor=instructor, title='Matura prep', visibility='public',
                                      status='open', audience='secondary')
        response = self.client.get(reverse('course-list'), {'audience': 'secondary'})
        self.assertEqual(_ids(response), {c_sec.pk})
        self.assertEqual(_ids(self.client.get(reverse('course-list'))), {c_uni.pk, c_sec.pk})


class AudienceProfilePreferenceTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def test_saved_and_validated(self):
        user = make_user('aud-pref')
        self.client.force_authenticate(user)
        response = self.client.patch('/api/auth/me/', {'audience_filter': ['senior', 'adult', 'senior']}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['audience_filter'], ['adult', 'senior'])
        bad = self.client.patch('/api/auth/me/', {'audience_filter': ['toddler']}, format='json')
        self.assertEqual(bad.status_code, 400)


class AudienceSubmissionTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch(slug='aud-sub-branch')
        self.student = make_user('aud-student')
        self.moderator = make_user('aud-mod', is_staff=True)
        self.client.force_authenticate(self.moderator)

    def _approve(self, kind, pk):
        return self.client.post(
            reverse('moderation-action', kwargs={'kind': kind, 'pk': pk, 'decision': 'approve'}),
            {}, format='json',
        )

    def test_exercise_submission_carries_its_band(self):
        submission = ExerciseSubmission.objects.create(
            branch=self.branch, submitted_by=self.student,
            payload={'title': 'Fractions', 'statement': 'Add 1/2 and 1/3.', 'locale': 'pl',
                     'difficulty': 'easy', 'audience': 'primary', 'topicIds': [], 'tags': []},
        )
        response = self._approve('submission', submission.pk)
        self.assertEqual(response.status_code, 200, response.content)
        submission.refresh_from_db()
        self.assertEqual(submission.resulting_exercise.audience, 'primary')

    def test_exercise_submission_without_a_band_defaults_to_university(self):
        submission = ExerciseSubmission.objects.create(
            branch=self.branch, submitted_by=self.student,
            payload={'title': 'Old shape', 'statement': 'x', 'locale': 'pl', 'difficulty': 'easy',
                     'audience': 'nonsense', 'topicIds': [], 'tags': []},
        )
        self._approve('submission', submission.pk)
        submission.refresh_from_db()
        self.assertEqual(submission.resulting_exercise.audience, 'university')

    def test_material_submission_carries_its_band(self):
        submission = MaterialSubmission.objects.create(
            branch=self.branch, submitted_by=self.student, type='script', title='Senior notes',
            url='https://example.org/notes', audience='senior',
        )
        response = self._approve('material', submission.pk)
        self.assertEqual(response.status_code, 200, response.content)
        submission.refresh_from_db()
        self.assertEqual(submission.resulting_material.audience, 'senior')
