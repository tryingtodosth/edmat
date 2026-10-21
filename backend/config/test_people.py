"""`GET /api/people/suggestions/` — the neutral home of "prefilling with current users"
(`contests/people.py`), reachable with the `contests` flag off."""

from django.contrib.auth.models import User
from rest_framework.test import APIClient, APITestCase

from courses.models import Course, CourseStaff
from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards


class PeopleSuggestionsTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.teacher = User.objects.create_user('t', 't@x.example', 'pw12345!')
        self.helper = User.objects.create_user('h', 'h@x.example', 'pw12345!')
        self.stranger = User.objects.create_user('s', 's@x.example', 'pw12345!')
        course = Course.objects.create(instructor=self.teacher, title='Analiza', visibility='public')
        CourseStaff.objects.create(course=course, user=self.helper, role='assistant', added_by=self.teacher)

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def test_lists_the_people_on_the_callers_rosters_and_nobody_else(self):
        res = self.as_(self.teacher).get('/api/people/suggestions/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual([row['id'] for row in res.data['people']], [self.helper.pk])
        self.assertTrue(res.data['people'][0]['via'][0].startswith('course:'))
        self.assertEqual(self.as_(self.stranger).get('/api/people/suggestions/').data['people'], [])

    def test_needs_an_account_and_ignores_the_contests_switch(self):
        self.assertEqual(APIClient().get('/api/people/suggestions/').status_code, 401)
        FeatureFlag.objects.update_or_create(key='contests', defaults={'is_enabled': False})
        res = self.as_(self.teacher).get('/api/people/suggestions/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['people']), 1)
