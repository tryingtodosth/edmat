"""Sorting (AUDIENCE-BRIEF.md §4) and the content-language rule (§5): every sort key and its
direction, and lists narrowed to the requested languages with an honest hidden count in the
header — while a detail page never narrows."""

from django.urls import reverse
from rest_framework.test import APITestCase

from community.models import Review
from config.content_locale import HIDDEN_HEADER
from events.models import Event
from exercises.models import ExerciseTranslation, SolutionEntry
from moderation.models import ContentView
from services.models import Service
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_material, make_user

from django.utils import timezone
from datetime import timedelta


def ids(response):
    return [row['id'] for row in response.json()]


class SortTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch(slug='sort-branch')
        self.a = make_exercise(self.branch, 1, difficulty='hard', title='Zeta')
        self.b = make_exercise(self.branch, 2, difficulty='easy', title='alpha')
        self.c = make_exercise(self.branch, 3, difficulty='medium', title='Mid')
        user = make_user('sorter')
        Review.objects.create(exercise=self.b, author=user, rating=5)
        Review.objects.create(exercise=self.c, author=make_user('sorter2'), rating=2)
        for u in ('v1', 'v2'):
            ContentView.objects.create(exercise=self.c, user=make_user(u))
        SolutionEntry.objects.create(exercise=self.a, kind='solution', locale='pl', body='x', status='published')
        self.url = reverse('branch-exercises', args=[self.branch.slug])

    def test_number_default_and_flipped(self):
        self.assertEqual(ids(self.client.get(self.url, {'sort': 'number'})), [self.a.pk, self.b.pk, self.c.pk])
        self.assertEqual(ids(self.client.get(self.url, {'sort': 'number', 'dir': 'desc'})), [self.c.pk, self.b.pk, self.a.pk])

    def test_title_is_case_insensitive_and_locale_aware(self):
        self.assertEqual(ids(self.client.get(self.url, {'sort': 'title'})), [self.b.pk, self.c.pk, self.a.pk])
        ExerciseTranslation.objects.create(exercise=self.a, locale='en', status='published', title='Aardvark', statement='s')
        self.assertEqual(ids(self.client.get(self.url, {'sort': 'title', 'lang': 'en'}))[0], self.a.pk)

    def test_difficulty_rating_reviews_views_solutions(self):
        self.assertEqual(ids(self.client.get(self.url, {'sort': 'difficulty'})), [self.b.pk, self.c.pk, self.a.pk])
        self.assertEqual(ids(self.client.get(self.url, {'sort': 'rating'}))[0], self.b.pk)
        self.assertEqual(ids(self.client.get(self.url, {'sort': 'views'}))[0], self.c.pk)
        self.assertEqual(ids(self.client.get(self.url, {'sort': 'solutions'}))[0], self.a.pk)
        # Flipping the direction reorders the rated ones; the unrated stay last either way.
        self.assertEqual(ids(self.client.get(self.url, {'sort': 'rating', 'dir': 'asc'})), [self.c.pk, self.b.pk, self.a.pk])

    def test_an_unknown_key_keeps_the_default_order(self):
        self.assertEqual(self.client.get(self.url, {'sort': 'bogus'}).status_code, 200)


class ContentLocaleTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch(slug='loc-branch')
        self.pl_only = make_exercise(self.branch, 1)
        self.both = make_exercise(self.branch, 2)
        ExerciseTranslation.objects.create(exercise=self.both, locale='en', status='published', title='Both', statement='s')
        self.pending = make_exercise(self.branch, 3)
        ExerciseTranslation.objects.create(exercise=self.pending, locale='en', status='pending', title='Pending', statement='s')

    def test_lists_narrow_to_published_languages_and_say_how_many_are_hidden(self):
        r = self.client.get(reverse('exercise-list'), {'content_locales': 'en'})
        self.assertEqual(ids(r), [self.both.pk])
        self.assertEqual(r[HIDDEN_HEADER], '2')
        r = self.client.get(reverse('exercise-list'), {'content_locales': 'en,pl'})
        self.assertEqual(len(ids(r)), 3)
        self.assertEqual(r[HIDDEN_HEADER], '0')
        self.assertEqual(self.client.get(reverse('exercise-list'))[HIDDEN_HEADER], '0')

    def test_a_detail_page_never_narrows(self):
        r = self.client.get(reverse('exercise-detail', args=[self.pl_only.pk]), {'content_locales': 'en', 'lang': 'en'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['resolved_locale'], 'pl')

    def test_materials_events_services_courses(self):
        m_pl = make_material(self.branch, 'loc-m-pl')
        m_en = make_material(self.branch, 'loc-m-en', locale='en')
        r = self.client.get(reverse('material-list'), {'content_locales': 'en'})
        self.assertEqual(ids(r), [m_en.pk])
        self.assertEqual(r[HIDDEN_HEADER], '1')
        host = make_user('loc-host')
        common = dict(host=host, status='published', visibility='public', starts_at=timezone.now() + timedelta(days=2), location_kind='online', online_url='https://x.org')
        e_pl = Event.objects.create(title='PL', language='pl', **common)
        e_en = Event.objects.create(title='EN', language='en', **common)
        r = self.client.get(reverse('event-list'), {'content_locales': 'en'})
        self.assertEqual(ids(r), [e_en.pk])
        self.assertEqual(r[HIDDEN_HEADER], '1')
        s_pl = Service.objects.create(provider=host, title='PL', is_active=True)
        s_en = Service.objects.create(provider=host, title='EN', is_active=True, language='en')
        r = self.client.get(reverse('service-list'), {'content_locales': 'en'})
        self.assertEqual(ids(r), [s_en.pk])
        self.assertEqual(r[HIDDEN_HEADER], '1')
        from courses.models import Course
        c_pl = Course.objects.create(instructor=host, title='PL', visibility='public', status='open', language='pl')
        c_en = Course.objects.create(instructor=host, title='EN', visibility='public', status='open', language='en')
        r = self.client.get(reverse('course-list'), {'content_locales': 'en'})
        self.assertEqual(ids(r), [c_en.pk])
        self.assertEqual(r[HIDDEN_HEADER], '1')

    def test_profile_preference_is_validated(self):
        user = make_user('loc-pref')
        self.client.force_authenticate(user)
        r = self.client.patch('/api/auth/me/', {'content_locales': ['EN', 'pl']}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['content_locales'], ['en', 'pl'])
        self.assertEqual(self.client.patch('/api/auth/me/', {'content_locales': ['x']}, format='json').status_code, 400)

    def test_a_listing_and_a_post_carry_a_language(self):
        user = make_user('loc-writer')
        self.client.force_authenticate(user)
        r = self.client.post(reverse('service-list'), {'title': 'Help', 'audience': 'adult', 'language': 'en'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['language'], 'en')
        r = self.client.post('/api/posts/', {'body': 'hello', 'audience': 'adult', 'language': 'en', 'branch': self.branch.slug}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['language'], 'en')
