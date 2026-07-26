"""Part of this project's automated test suite (CLAUDE.md Section 17L). Covers "My Set"'s
server-side persistence for registered users, and the server-side sharing feature CLAUDE.md
Section 17J added (retrieve is public; every other action stays owner-scoped)."""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from study.models import ExerciseSet, ExerciseSetItem
from testing.factories import make_course, make_exercise, make_user


class ExerciseSetCreationTests(APITestCase):
    def setUp(self):
        self.course = make_course()
        self.exercise_a = make_exercise(self.course, 1)
        self.exercise_b = make_exercise(self.course, 2)
        self.user = make_user('set-owner')
        self.client.force_authenticate(self.user)

    def test_creating_a_set_with_exercises_succeeds(self):
        response = self.client.post(
            reverse('exercise-set-list'),
            {'name': 'Kolokwium 2 review', 'exercise_ids': [self.exercise_a.pk, self.exercise_b.pk]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        exercise_set = ExerciseSet.objects.get(owner=self.user)
        self.assertEqual(exercise_set.name, 'Kolokwium 2 review')
        self.assertEqual(exercise_set.exercises.count(), 2)

    def test_anonymous_user_cannot_create_a_set(self):
        self.client.force_authenticate(None)

        response = self.client.post(
            reverse('exercise-set-list'), {'name': 'Anon set', 'exercise_ids': []}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(ExerciseSet.objects.filter(name='Anon set').exists())


class ExerciseSetOwnershipTests(APITestCase):
    def setUp(self):
        self.course = make_course()
        self.exercises = [make_exercise(self.course, n) for n in range(1, 4)]
        self.owner = make_user('owner')
        self.other_user = make_user('someone-else')
        self.my_set = ExerciseSet.objects.create(owner=self.owner, name='My exam prep')
        ExerciseSetItem.objects.create(exercise_set=self.my_set, exercise=self.exercises[0], order=0)
        self.other_set = ExerciseSet.objects.create(owner=self.other_user, name='Their set')

    def test_listing_only_shows_the_current_users_own_sets(self):
        self.client.force_authenticate(self.owner)

        response = self.client.get(reverse('exercise-set-list'))

        names = {row['name'] for row in response.data}
        self.assertEqual(names, {'My exam prep'})

    def test_owner_can_update_their_own_set_and_order_is_preserved(self):
        self.client.force_authenticate(self.owner)

        response = self.client.patch(
            reverse('exercise-set-detail', kwargs={'pk': self.my_set.pk}),
            {'exercise_ids': [self.exercises[2].pk, self.exercises[1].pk, self.exercises[0].pk]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        items = list(
            ExerciseSetItem.objects.filter(exercise_set=self.my_set).order_by('order')
        )
        self.assertEqual([item.exercise_id for item in items], [self.exercises[2].pk, self.exercises[1].pk, self.exercises[0].pk])

    def test_non_owner_cannot_delete_someone_elses_set(self):
        self.client.force_authenticate(self.other_user)

        response = self.client.delete(reverse('exercise-set-detail', kwargs={'pk': self.my_set.pk}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(ExerciseSet.objects.filter(pk=self.my_set.pk).exists())


class ExerciseSetSharingTests(APITestCase):
    """CLAUDE.md Section 17J — retrieve is the one deliberate exception, publicly readable with no
    authentication at all, so a set's own numeric id can act as a real share link."""

    def setUp(self):
        self.course = make_course()
        self.exercise = make_exercise(self.course, 1)
        self.owner = make_user('sharer')
        self.owner.profile.display_name = 'Kasia Wiśniewska'
        self.owner.profile.save(update_fields=['display_name'])
        self.shared_set = ExerciseSet.objects.create(owner=self.owner, name='My exam prep')
        ExerciseSetItem.objects.create(exercise_set=self.shared_set, exercise=self.exercise, order=0)

    def test_anonymous_user_can_retrieve_a_shared_set(self):
        response = self.client.get(reverse('exercise-set-detail', kwargs={'pk': self.shared_set.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'My exam prep')
        self.assertEqual(response.data['owner_display_name'], 'Kasia Wiśniewska')
        self.assertEqual(len(response.data['items']), 1)

    def test_a_different_logged_in_user_can_also_retrieve_it(self):
        self.client.force_authenticate(make_user('a-visitor'))

        response = self.client.get(reverse('exercise-set-detail', kwargs={'pk': self.shared_set.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_a_nonexistent_set_404s(self):
        response = self.client.get(reverse('exercise-set-detail', kwargs={'pk': 999999}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
