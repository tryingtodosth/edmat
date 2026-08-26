"""The stored exercise counters (accounts/counters.py, exercises/signals.py) and what reads them.

The bug these exist for: the profile tile counted the activity feed's items, and the feed slices
every source at 50, so anybody past fifty exercises read as fifty. So the test that matters most
here is the one with more than fifty.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from exercises.models import Exercise
from telemetry.routers import all_log_shards
from testing.factories import make_course, make_exercise

from .models import Profile


class CounterTestCase(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.me = User.objects.create_user('ania', 'ania@x.example', 'pw12345!')
        self.other = User.objects.create_user('piotr', 'piotr@x.example', 'pw12345!')
        self.branch = make_course()
        self.next_number = 1

    def contribute(self, user, *, published=True):
        exercise = make_exercise(self.branch, self.next_number)
        self.next_number += 1
        exercise.submitted_by = user
        exercise.published = published
        exercise.save()
        return exercise

    def counts(self, user):
        profile = Profile.objects.get(user=user)
        return (profile.exercises_published_count, profile.exercises_private_count)

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client


class SignalTests(CounterTestCase):
    def test_a_new_profile_starts_at_zero(self):
        self.assertEqual(self.counts(self.me), (0, 0))

    def test_creating_publishing_unpublishing_and_deleting_all_move_the_counters(self):
        exercise = self.contribute(self.me)
        self.assertEqual(self.counts(self.me), (1, 0))

        exercise.published = False
        exercise.save()
        self.assertEqual(self.counts(self.me), (0, 1))

        exercise.published = True
        exercise.save()
        self.assertEqual(self.counts(self.me), (1, 0))

        exercise.delete()
        self.assertEqual(self.counts(self.me), (0, 0))

    def test_handing_an_exercise_to_another_submitter_recounts_both(self):
        exercise = self.contribute(self.me)
        exercise.submitted_by = self.other
        exercise.save()
        self.assertEqual(self.counts(self.me), (0, 0))
        self.assertEqual(self.counts(self.other), (1, 0))

    def test_an_exercise_with_no_submitter_counts_for_nobody(self):
        make_exercise(self.branch, 99)
        self.assertEqual(self.counts(self.me), (0, 0))
        self.assertEqual(self.counts(self.other), (0, 0))

    def test_a_queryset_update_is_caught_by_the_next_recount(self):
        # `.update()` fires no signal — the honest limitation of any signal-driven counter. What a
        # recount buys is that the next save by the same person puts it right, where an increment
        # would have been wrong forever.
        exercise = self.contribute(self.me)
        Exercise.objects.filter(pk=exercise.pk).update(published=False)
        self.assertEqual(self.counts(self.me), (1, 0))
        self.contribute(self.me)
        self.assertEqual(self.counts(self.me), (1, 1))


class FeedAndProfileTests(CounterTestCase):
    def test_the_tile_count_is_the_stored_total_not_the_feed_slice(self):
        for _ in range(60):
            self.contribute(self.me)
        res = APIClient().get(f'/api/users/{self.me.pk}/activity/')
        self.assertEqual(res.data['counts']['exercise'], 60)
        self.assertEqual(sum(1 for i in res.data['items'] if i['kind'] == 'exercise'), 50)

    def test_the_public_profile_carries_the_published_count_for_anyone(self):
        self.contribute(self.me)
        self.contribute(self.me, published=False)
        res = APIClient().get(f'/api/users/{self.me.pk}/')
        self.assertEqual(res.data['exercises_published_count'], 1)
        self.assertIsNone(res.data['exercises_private_count'])

    def test_only_the_owner_sees_their_unpublished_count(self):
        self.contribute(self.me, published=False)
        mine = self.as_(self.me).get(f'/api/users/{self.me.pk}/')
        self.assertEqual(mine.data['exercises_private_count'], 1)
        theirs = self.as_(self.other).get(f'/api/users/{self.me.pk}/')
        self.assertIsNone(theirs.data['exercises_private_count'])
        # A fresh instance: `force_authenticate` reuses this object as `request.user`, so a Profile
        # already cached on it would predate the recount. A real request loads its user fresh.
        me = self.as_(User.objects.get(pk=self.me.pk)).get('/api/auth/me/')
        self.assertEqual(me.data['exercises_private_count'], 1)
        self.assertEqual(me.data['exercises_published_count'], 0)

    def test_a_private_profile_still_reports_its_published_count(self):
        self.contribute(self.me)
        Profile.objects.filter(user=self.me).update(show_profile_publicly=False)
        res = APIClient().get(f'/api/users/{self.me.pk}/')
        self.assertEqual(res.data['exercises_published_count'], 1)


class UnpublishedListTests(CounterTestCase):
    def setUp(self):
        super().setUp()
        self.shown = self.contribute(self.me)
        self.hidden = self.contribute(self.me, published=False)

    def test_the_owner_lists_only_their_unpublished_exercises(self):
        res = self.as_(self.me).get(f'/api/exercises/?submitted_by={self.me.pk}&unpublished=1')
        self.assertEqual([e['id'] for e in res.data], [self.hidden.pk])

    def test_it_defaults_to_the_caller(self):
        res = self.as_(self.me).get('/api/exercises/?unpublished=1')
        self.assertEqual([e['id'] for e in res.data], [self.hidden.pk])

    def test_somebody_else_gets_nothing_not_the_published_list(self):
        res = self.as_(self.other).get(f'/api/exercises/?submitted_by={self.me.pk}&unpublished=1')
        self.assertEqual(res.data, [])
        anon = APIClient().get(f'/api/exercises/?submitted_by={self.me.pk}&unpublished=1')
        self.assertEqual(anon.data, [])

    def test_staff_may_look(self):
        staff = User.objects.create_user('mod', 'mod@x.example', 'pw12345!', is_staff=True)
        res = self.as_(staff).get(f'/api/exercises/?submitted_by={self.me.pk}&unpublished=1')
        self.assertEqual([e['id'] for e in res.data], [self.hidden.pk])

    def test_the_ordinary_list_is_untouched(self):
        res = APIClient().get(f'/api/exercises/?submitted_by={self.me.pk}')
        self.assertEqual([e['id'] for e in res.data], [self.shown.pk])


class MaterialCounterTests(CounterTestCase):
    """The material twin — same signals, same feed override, same owner-only private count."""

    def upload(self, user, *, published=True):
        from testing.factories import make_material

        material = make_material(self.branch, slug=f'm-{self.next_number}')
        self.next_number += 1
        material.submitted_by = user
        material.published = published
        material.save()
        return material

    def material_counts(self, user):
        profile = Profile.objects.get(user=user)
        return (profile.materials_published_count, profile.materials_private_count)

    def test_saving_unpublishing_and_deleting_move_the_counters(self):
        material = self.upload(self.me)
        self.assertEqual(self.material_counts(self.me), (1, 0))
        material.published = False
        material.save()
        self.assertEqual(self.material_counts(self.me), (0, 1))
        material.delete()
        self.assertEqual(self.material_counts(self.me), (0, 0))

    def test_the_tile_count_is_the_stored_total_not_the_feed_slice(self):
        for _ in range(55):
            self.upload(self.me)
        res = APIClient().get(f'/api/users/{self.me.pk}/activity/')
        self.assertEqual(res.data['counts']['material'], 55)
        self.assertEqual(sum(1 for i in res.data['items'] if i['kind'] == 'material'), 50)

    def test_only_the_owner_sees_the_private_count(self):
        self.upload(self.me, published=False)
        mine = self.as_(self.me).get(f'/api/users/{self.me.pk}/')
        self.assertEqual(mine.data['materials_private_count'], 1)
        self.assertEqual(mine.data['materials_published_count'], 0)
        theirs = APIClient().get(f'/api/users/{self.me.pk}/')
        self.assertIsNone(theirs.data['materials_private_count'])
