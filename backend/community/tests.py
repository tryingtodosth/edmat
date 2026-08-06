"""Part of this project's automated test suite (CLAUDE.md Section 17L). Review/Comment have no
views.py of their own — both are reached through ExerciseViewSet's `reviews`/`comments` actions
(exercises/views.py), so these tests exercise that real HTTP surface rather than the models alone."""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import Comment, Review
from testing.factories import make_course, make_exercise, make_material, make_topic, make_user


class ReviewTests(APITestCase):
    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        self.user = make_user('reviewer')
        self.client.force_authenticate(self.user)

    def test_creating_a_review_succeeds(self):
        response = self.client.post(
            reverse('exercise-reviews', kwargs={'pk': self.exercise.pk}),
            {'rating': 5, 'body': 'Great exercise.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        review = Review.objects.get(exercise=self.exercise, author=self.user)
        self.assertEqual(review.rating, 5)

    def test_submitting_a_second_review_updates_the_existing_one_instead_of_duplicating(self):
        """Review.exercise+author is unique_together — the view's own `existing`/`partial` logic
        is what makes a resubmission an update, not a 400 IntegrityError."""
        self.client.post(
            reverse('exercise-reviews', kwargs={'pk': self.exercise.pk}),
            {'rating': 3, 'body': 'First impression.'},
            format='json',
        )

        response = self.client.post(
            reverse('exercise-reviews', kwargs={'pk': self.exercise.pk}),
            {'rating': 5, 'body': 'Changed my mind.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Review.objects.filter(exercise=self.exercise, author=self.user).count(), 1)
        review = Review.objects.get(exercise=self.exercise, author=self.user)
        self.assertEqual(review.rating, 5)
        self.assertEqual(review.body, 'Changed my mind.')

    def test_anonymous_user_cannot_review(self):
        self.client.force_authenticate(None)

        response = self.client.post(
            reverse('exercise-reviews', kwargs={'pk': self.exercise.pk}),
            {'rating': 4},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(Review.objects.filter(exercise=self.exercise).exists())

    def test_a_removed_review_is_excluded_from_the_list(self):
        review = Review.objects.create(exercise=self.exercise, author=self.user, rating=1, body='spam')
        review.is_removed = True
        review.save(update_fields=['is_removed'])

        response = self.client.get(reverse('exercise-reviews', kwargs={'pk': self.exercise.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 0)


class CommentTests(APITestCase):
    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        self.user = make_user('commenter')
        self.client.force_authenticate(self.user)

    def test_posting_a_root_comment_succeeds(self):
        response = self.client.post(
            reverse('exercise-comments', kwargs={'pk': self.exercise.pk}),
            {'body': "I don't follow step 3."},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        comment = Comment.objects.get(pk=response.data['id'])
        self.assertEqual(comment.body, "I don't follow step 3.")
        self.assertIsNone(comment.parent)

    def test_replying_to_a_comment_sets_its_parent(self):
        root_response = self.client.post(
            reverse('exercise-comments', kwargs={'pk': self.exercise.pk}),
            {'body': 'Root comment.'},
            format='json',
        )
        root_id = root_response.data['id']

        reply_response = self.client.post(
            reverse('exercise-comments', kwargs={'pk': self.exercise.pk}),
            {'body': 'A reply.', 'parent': root_id},
            format='json',
        )

        self.assertEqual(reply_response.status_code, status.HTTP_201_CREATED)
        reply = Comment.objects.get(pk=reply_response.data['id'])
        self.assertEqual(reply.parent_id, root_id)

    def test_anonymous_user_cannot_comment(self):
        self.client.force_authenticate(None)

        response = self.client.post(
            reverse('exercise-comments', kwargs={'pk': self.exercise.pk}),
            {'body': 'Trying to comment anonymously.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(Comment.objects.exists())

    def test_a_parent_from_an_unrelated_exercises_own_thread_is_rejected(self):
        """The same cross-target check materials/views.py's MaterialCoverageViewSet.comments now
        applies (Section 17O) — a client-supplied `parent` genuinely threads, but nothing used to
        stop it from naming a comment belonging to an entirely different Exercise's own thread."""
        other_exercise = make_exercise(self.branch, 2)
        foreign_root = self.client.post(
            reverse('exercise-comments', kwargs={'pk': other_exercise.pk}),
            {'body': 'A comment on a different exercise entirely.'},
            format='json',
        )
        self.assertEqual(foreign_root.status_code, status.HTTP_201_CREATED)

        response = self.client.post(
            reverse('exercise-comments', kwargs={'pk': self.exercise.pk}),
            {'body': 'Trying to reply across exercises', 'parent': foreign_root.data['id']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('parent', response.data)
        self.assertEqual(Comment.objects.filter(body='Trying to reply across exercises').count(), 0)

    def test_a_parent_from_a_material_coverage_thread_is_also_rejected(self):
        """The identical cross-target check, the other direction — a parent id resolving to a real
        Comment, just one attached to a different content type (a MaterialCoverage claim)."""
        branch = make_course(slug='uw-comment-cross-target-branch')
        material = make_material(branch, 'skrypt')
        topic = make_topic(branch)
        from materials.models import MaterialCoverage

        coverage = MaterialCoverage.objects.create(
            material=material, topic=topic, level=50, proposed_by=self.user
        )
        coverage_comment = self.client.post(
            reverse('material-coverage-comments', kwargs={'pk': coverage.pk}),
            {'body': 'A comment on a coverage claim.'},
            format='json',
        )
        self.assertEqual(coverage_comment.status_code, status.HTTP_201_CREATED)

        response = self.client.post(
            reverse('exercise-comments', kwargs={'pk': self.exercise.pk}),
            {'body': 'Trying to reply to a coverage comment', 'parent': coverage_comment.data['id']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_removed_comments_body_and_author_are_blanked_in_the_response(self):
        """community/serializers.py's CommentSerializer.to_representation blanks `body` (and
        `author_display_name`) for a removed comment — the tombstone behavior CLAUDE.md Section 9
        describes ("is_removed, not hard-delete — preserves thread structure")."""
        response = self.client.post(
            reverse('exercise-comments', kwargs={'pk': self.exercise.pk}),
            {'body': 'A comment that will be removed.'},
            format='json',
        )
        comment = Comment.objects.get(pk=response.data['id'])
        comment.is_removed = True
        comment.save(update_fields=['is_removed'])

        list_response = self.client.get(reverse('exercise-comments', kwargs={'pk': self.exercise.pk}))

        removed_row = next(row for row in list_response.data if row['id'] == comment.pk)
        self.assertEqual(removed_row['body'], '')
        self.assertEqual(removed_row['author_display_name'], '')
        self.assertTrue(removed_row['is_removed'])
