"""Exercise ↔ material links — the API surface (`ExerciseMaterialLink`, exercises/models.py).

Covers the four things that can go wrong here and each cost somebody a real bug elsewhere in this
codebase already: an unpublished row leaking into a public list, a duplicate producing a 500 rather
than a 409, a single-object action that a queryset filter never ran for, and a governor who can
see a row but not act on it. The submission half (a link created when a drafted exercise is
approved) lives in `moderation/test_submission_material_links.py`, next to the flow it belongs to.
"""

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import ExerciseMaterialLink
from testing.factories import make_course, make_exercise, make_material, make_user


class MaterialExerciseListTests(APITestCase):
    def setUp(self):
        self.branch = make_course(slug='links-branch')
        self.material = make_material(self.branch, slug='links-script', title='Linked script')
        self.first = make_exercise(self.branch, 1, title='In the script')
        self.second = make_exercise(self.branch, 2, title='Practises the script')
        self.user = make_user('links-lister')
        ExerciseMaterialLink.objects.create(
            exercise=self.second, material=self.material, role='practice', added_by=self.user
        )
        ExerciseMaterialLink.objects.create(
            exercise=self.first,
            material=self.material,
            role='source',
            locator='p. 34, ex. 3.2',
            added_by=self.user,
        )

    def _url(self):
        return reverse('material-exercises', kwargs={'pk': self.material.pk})

    def test_anonymous_reader_gets_the_links_with_the_exercise_card_shape(self):
        response = self.client.get(self._url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        row = response.data[0]
        self.assertEqual(row['exercise']['title'], 'In the script')
        # The card shape's annotated fields must actually be there — a plain FK fetch would make
        # the serializer raise on `average_rating` instead.
        self.assertIn('average_rating', row['exercise'])
        self.assertIn('review_count', row['exercise'])
        self.assertEqual(row['locator'], 'p. 34, ex. 3.2')
        self.assertEqual(row['added_by_id'], self.user.pk)
        self.assertEqual(row['added_by_display_name'], self.user.username)

    def test_source_links_come_before_practice_links(self):
        """The practice link was created FIRST, so plain creation order (or alphabetical order on
        `role`) would put it first — the page reads "what is in this" before "what practises it"."""
        response = self.client.get(self._url())
        self.assertEqual([row['role'] for row in response.data], ['source', 'practice'])

    def test_an_unpublished_exercise_is_hidden_from_an_ordinary_reader(self):
        self.first.published = False
        self.first.save(update_fields=['published'])
        response = self.client.get(self._url())
        self.assertEqual([row['role'] for row in response.data], ['practice'])

    def test_staff_still_see_the_unpublished_one(self):
        self.first.published = False
        self.first.save(update_fields=['published'])
        self.client.force_authenticate(make_user('links-staff', is_staff=True))
        response = self.client.get(self._url())
        self.assertEqual([row['role'] for row in response.data], ['source', 'practice'])

    def test_the_exercise_list_can_be_filtered_to_one_material(self):
        other = make_exercise(self.branch, 3, title='Unrelated')
        response = self.client.get(reverse('exercise-list'), {'material': self.material.pk})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row['id'] for row in response.data}
        self.assertEqual(ids, {self.first.pk, self.second.pk})
        self.assertNotIn(other.pk, ids)

    def test_a_junk_material_filter_returns_nothing_rather_than_500ing(self):
        response = self.client.get(reverse('exercise-list'), {'material': 'not-a-number'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])


class LinkAnExistingExerciseTests(APITestCase):
    def setUp(self):
        self.branch = make_course(slug='link-post-branch')
        self.material = make_material(self.branch, slug='link-post-script')
        self.exercise = make_exercise(self.branch, 1)
        self.user = make_user('link-poster')

    def _url(self):
        return reverse('material-exercises', kwargs={'pk': self.material.pk})

    def test_a_signed_in_user_can_link_an_existing_exercise(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(
            self._url(),
            {'exercise_id': self.exercise.pk, 'role': 'practice', 'locator': 'ch. 2'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['role'], 'practice')
        self.assertEqual(response.data['locator'], 'ch. 2')
        self.assertEqual(response.data['exercise']['id'], self.exercise.pk)
        link = ExerciseMaterialLink.objects.get(exercise=self.exercise, material=self.material)
        self.assertEqual(link.added_by, self.user)

    def test_the_role_defaults_to_source(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(self._url(), {'exercise_id': self.exercise.pk}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['role'], 'source')

    def test_an_anonymous_caller_is_refused(self):
        response = self.client.post(self._url(), {'exercise_id': self.exercise.pk}, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(ExerciseMaterialLink.objects.exists())

    def test_linking_the_same_pair_twice_is_a_409_not_a_500(self):
        self.client.force_authenticate(self.user)
        self.client.post(self._url(), {'exercise_id': self.exercise.pk}, format='json')
        response = self.client.post(self._url(), {'exercise_id': self.exercise.pk}, format='json')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], 'already_linked')
        self.assertEqual(ExerciseMaterialLink.objects.count(), 1)

    def test_an_unpublished_exercise_is_a_404(self):
        self.exercise.published = False
        self.exercise.save(update_fields=['published'])
        self.client.force_authenticate(self.user)
        response = self.client.post(self._url(), {'exercise_id': self.exercise.pk}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_exercise_that_does_not_exist_is_a_404(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(self._url(), {'exercise_id': 999999}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_junk_exercise_id_is_a_404_rather_than_a_crash(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(self._url(), {'exercise_id': 'abc'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_unknown_role_is_a_400(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(
            self._url(), {'exercise_id': self.exercise.pk, 'role': 'vibes'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_over_long_locator_is_a_400(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(
            self._url(),
            {'exercise_id': self.exercise.pk, 'locator': 'x' * 121},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ExerciseMaterialsListTests(APITestCase):
    """The reverse reading — "From material …" on the exercise page."""

    def setUp(self):
        self.branch = make_course(slug='reverse-branch')
        self.exercise = make_exercise(self.branch, 1)
        self.published = make_material(self.branch, slug='reverse-published', title='Published one')
        self.hidden = make_material(self.branch, slug='reverse-hidden', title='Hidden one')
        self.hidden.published = False
        self.hidden.save(update_fields=['published'])
        ExerciseMaterialLink.objects.create(
            exercise=self.exercise, material=self.published, role='source', locator='p. 7'
        )
        ExerciseMaterialLink.objects.create(exercise=self.exercise, material=self.hidden)

    def test_lists_published_materials_only(self):
        response = self.client.get(reverse('exercise-materials', kwargs={'pk': self.exercise.pk}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        row = response.data[0]
        self.assertEqual(row['material']['title'], 'Published one')
        self.assertEqual(row['role'], 'source')
        self.assertEqual(row['locator'], 'p. 7')

    def test_staff_do_not_see_the_unpublished_material_either(self):
        """Deliberately unlike the material page's own list — an unpublished material has no page
        to link to, so showing one would be a dead end rather than a moderation affordance."""
        self.client.force_authenticate(make_user('reverse-staff', is_staff=True))
        response = self.client.get(reverse('exercise-materials', kwargs={'pk': self.exercise.pk}))
        self.assertEqual(len(response.data), 1)


class LinkManagementScopeTests(APITestCase):
    """PATCH/DELETE on one link — who may, and what everybody else sees (a 404, never a 403)."""

    def setUp(self):
        self.branch = make_course(slug='scope-branch')
        self.submitter = make_user('scope-submitter')
        self.material = make_material(self.branch, slug='scope-script')
        self.material.submitted_by = self.submitter
        self.material.save(update_fields=['submitted_by'])
        self.exercise = make_exercise(self.branch, 1)
        self.creator = make_user('scope-creator')
        self.link = ExerciseMaterialLink.objects.create(
            exercise=self.exercise, material=self.material, added_by=self.creator
        )
        self.url = reverse('exercise-material-link-detail', kwargs={'pk': self.link.pk})

    def test_the_creator_can_edit_the_role_and_locator(self):
        self.client.force_authenticate(self.creator)
        response = self.client.patch(
            self.url, {'role': 'practice', 'locator': 'ch. 4'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.link.refresh_from_db()
        self.assertEqual(self.link.role, 'practice')
        self.assertEqual(self.link.locator, 'ch. 4')

    def test_the_creator_can_delete_it_for_real(self):
        self.client.force_authenticate(self.creator)
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ExerciseMaterialLink.objects.filter(pk=self.link.pk).exists())

    def test_a_stranger_gets_404_not_403(self):
        self.client.force_authenticate(make_user('scope-stranger'))
        self.assertEqual(
            self.client.patch(self.url, {'role': 'practice'}, format='json').status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(ExerciseMaterialLink.objects.filter(pk=self.link.pk).exists())

    def test_an_anonymous_caller_is_refused(self):
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_the_materials_own_submitter_may_manage_it(self):
        self.client.force_authenticate(self.submitter)
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_204_NO_CONTENT)

    def test_staff_may_manage_it(self):
        self.client.force_authenticate(make_user('scope-staff', is_staff=True))
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_204_NO_CONTENT)

    def test_a_governor_of_the_material_may_manage_it(self):
        from moderation.models import NodeGovernor

        governor = make_user('scope-material-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(self.material),
            object_id=self.material.pk,
        )
        self.client.force_authenticate(governor)
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_204_NO_CONTENT)

    def test_a_governor_of_the_branch_above_it_may_manage_it_too(self):
        """`is_governor_of_material` cascades material → branch → discipline; the queryset filter
        that produces the 404 for everybody else has to cascade identically, or a branch governor
        would see the link on the page and get a 404 trying to remove it."""
        from moderation.models import NodeGovernor

        governor = make_user('scope-branch-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(self.branch),
            object_id=self.branch.pk,
        )
        self.client.force_authenticate(governor)
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_204_NO_CONTENT)

    def test_the_linked_exercises_own_submitter_is_deliberately_not_in_the_circle(self):
        author = make_user('scope-exercise-author')
        self.exercise.submitted_by = author
        self.exercise.save(update_fields=['submitted_by'])
        self.client.force_authenticate(author)
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_404_NOT_FOUND)
