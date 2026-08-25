"""Covers/requires claims on an exercise — the same rows a material and a course carry, pinned at
the boundaries: topics come from the exercise's own branch, a claim on an unpublished exercise is
a 404, both votes tally separately, the thread is the claim's own."""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from testing.factories import make_course as make_branch, make_exercise, make_topic, make_user

from .models import ExerciseClaim


class ExerciseClaimTests(APITestCase):
    def setUp(self):
        self.branch = make_branch()
        self.other_branch = make_branch(slug='uw-other-branch')
        self.topic = make_topic(self.branch)
        self.foreign_topic = make_topic(self.other_branch, slug='foreign')
        self.exercise = make_exercise(self.branch, 1)
        self.user = make_user('exclaim-user')
        self.client.force_authenticate(self.user)

    def _propose(self, **body):
        return self.client.post(
            reverse('exercise-claims', kwargs={'pk': self.exercise.pk}),
            {'topic': self.topic.pk, 'level': 60, **body},
            format='json',
        )

    def test_both_kinds_coexist_and_a_same_kind_duplicate_is_refused(self):
        self.assertEqual(self._propose().status_code, status.HTTP_201_CREATED)
        response = self._propose(kind='requires', level=25)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['exercise'], self.exercise.pk)
        self.assertEqual(self._propose(kind='requires').status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(ExerciseClaim.objects.filter(exercise=self.exercise).count(), 2)

    def test_a_topic_from_another_branch_is_refused(self):
        self.assertEqual(self._propose(topic=self.foreign_topic.pk).status_code, status.HTTP_400_BAD_REQUEST)

    def test_anonymous_can_read_but_not_propose(self):
        self._propose()
        self.client.force_authenticate(None)
        listing = self.client.get(reverse('exercise-claims', kwargs={'pk': self.exercise.pk}))
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertEqual(len(listing.data), 1)
        self.assertEqual(self._propose(level=10).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_claim_on_an_unpublished_exercise_is_a_404(self):
        hidden = make_exercise(self.branch, 2)
        hidden.published = False
        hidden.save(update_fields=['published'])
        claim = ExerciseClaim.objects.create(exercise=hidden, topic=self.topic, level=50)
        response = self.client.post(
            reverse('exercise-claim-vote', kwargs={'pk': claim.pk}), {'value': 1}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_votes_and_thread(self):
        claim = ExerciseClaim.objects.create(exercise=self.exercise, topic=self.topic, level=50)
        accuracy = self.client.post(
            reverse('exercise-claim-vote', kwargs={'pk': claim.pk}), {'value': -1}, format='json'
        )
        self.assertEqual(accuracy.data['vote_summary']['disagree_count'], 1)
        importance = self.client.post(
            reverse('exercise-claim-importance', kwargs={'pk': claim.pk}), {'value': 1}, format='json'
        )
        self.assertEqual(importance.data['importance_summary']['net_weight'], 1)
        self.assertEqual(importance.data['vote_summary']['disagree_count'], 1)
        url = reverse('exercise-claim-comments', kwargs={'pk': claim.pk})
        self.assertEqual(self.client.post(url, {'body': 'Really 50?'}, format='json').status_code, 201)
        self.assertEqual(len(self.client.get(url).data), 1)
        listing = self.client.get(reverse('exercise-claims', kwargs={'pk': self.exercise.pk}))
        self.assertEqual(listing.data[0]['comment_count'], 1)
