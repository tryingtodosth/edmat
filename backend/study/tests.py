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

    def test_creating_a_set_with_per_exercise_item_options_applies_them(self):
        response = self.client.post(
            reverse('exercise-set-list'),
            {
                'name': 'With extras',
                'exercise_ids': [self.exercise_a.pk, self.exercise_b.pk],
                'item_options': [
                    {'exercise': self.exercise_a.pk, 'include_hint': True, 'include_solution': True},
                    {'exercise': self.exercise_b.pk, 'include_answer': True},
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        exercise_set = ExerciseSet.objects.get(owner=self.user)
        item_a = ExerciseSetItem.objects.get(exercise_set=exercise_set, exercise=self.exercise_a)
        item_b = ExerciseSetItem.objects.get(exercise_set=exercise_set, exercise=self.exercise_b)
        self.assertTrue(item_a.include_hint)
        self.assertTrue(item_a.include_solution)
        self.assertFalse(item_a.include_answer)
        self.assertTrue(item_b.include_answer)
        self.assertFalse(item_b.include_hint)

    def test_updating_item_options_alone_does_not_touch_set_membership(self):
        self.client.post(
            reverse('exercise-set-list'),
            {'name': 'Base set', 'exercise_ids': [self.exercise_a.pk, self.exercise_b.pk]},
            format='json',
        )
        exercise_set = ExerciseSet.objects.get(owner=self.user, name='Base set')

        response = self.client.patch(
            reverse('exercise-set-detail', kwargs={'slug': exercise_set.slug}),
            {'item_options': [{'exercise': self.exercise_a.pk, 'include_hint': True}]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        exercise_set.refresh_from_db()
        self.assertEqual(exercise_set.exercises.count(), 2)
        item_a = ExerciseSetItem.objects.get(exercise_set=exercise_set, exercise=self.exercise_a)
        self.assertTrue(item_a.include_hint)

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
            reverse('exercise-set-detail', kwargs={'slug': self.my_set.slug}),
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

        response = self.client.delete(reverse('exercise-set-detail', kwargs={'slug': self.my_set.slug}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(ExerciseSet.objects.filter(pk=self.my_set.pk).exists())

    def test_two_sets_get_distinct_slugs(self):
        self.assertNotEqual(self.my_set.slug, self.other_set.slug)
        self.assertTrue(self.my_set.slug)


class ExerciseSetSharingTests(APITestCase):
    """CLAUDE.md Section 17J's original design (an unconditionally public `retrieve`) has since
    been narrowed: a set is now PRIVATE by default, `is_public` is a real, owner-togglable
    "unshare," and the share link itself is an unguessable slug (study/models.py's
    `_generate_set_slug`), not a raw sequential pk — resolving that section's own "Left open" note
    that no revoke mechanism existed."""

    def setUp(self):
        self.course = make_course()
        self.exercise = make_exercise(self.course, 1)
        self.owner = make_user('sharer')
        self.owner.profile.display_name = 'Kasia Wiśniewska'
        self.owner.profile.save(update_fields=['display_name'])
        self.private_set = ExerciseSet.objects.create(owner=self.owner, name='My private prep')
        ExerciseSetItem.objects.create(exercise_set=self.private_set, exercise=self.exercise, order=0)
        self.public_set = ExerciseSet.objects.create(
            owner=self.owner, name='My shared prep', is_public=True
        )
        ExerciseSetItem.objects.create(exercise_set=self.public_set, exercise=self.exercise, order=0)

    def _url(self, exercise_set):
        return reverse('exercise-set-detail', kwargs={'slug': exercise_set.slug})

    def test_a_set_is_private_by_default(self):
        self.assertFalse(self.private_set.is_public)

    def test_anonymous_user_can_retrieve_a_public_set(self):
        response = self.client.get(self._url(self.public_set))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'My shared prep')
        self.assertEqual(response.data['owner_display_name'], 'Kasia Wiśniewska')
        self.assertEqual(len(response.data['items']), 1)

    def test_a_different_logged_in_user_can_also_retrieve_a_public_set(self):
        self.client.force_authenticate(make_user('a-visitor'))

        response = self.client.get(self._url(self.public_set))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_anonymous_user_cannot_retrieve_a_private_set(self):
        response = self.client.get(self._url(self.private_set))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_different_logged_in_user_cannot_retrieve_a_private_set(self):
        self.client.force_authenticate(make_user('a-visitor'))

        response = self.client.get(self._url(self.private_set))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_owner_can_always_preview_their_own_private_set(self):
        self.client.force_authenticate(self.owner)

        response = self.client.get(self._url(self.private_set))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_owner_can_toggle_is_public_on(self):
        self.client.force_authenticate(self.owner)

        response = self.client.patch(self._url(self.private_set), {'is_public': True}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.private_set.refresh_from_db()
        self.assertTrue(self.private_set.is_public)
        # And it's genuinely reachable by a stranger now, not just flagged in the DB.
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self._url(self.private_set)).status_code, status.HTTP_200_OK)

    def test_owner_can_revoke_by_toggling_is_public_off(self):
        self.client.force_authenticate(self.owner)

        response = self.client.patch(self._url(self.public_set), {'is_public': False}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(self._url(self.public_set)).status_code, status.HTTP_404_NOT_FOUND
        )

    def test_a_nonexistent_slug_404s(self):
        response = self.client.get(reverse('exercise-set-detail', kwargs={'slug': 'does-not-exist'}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
