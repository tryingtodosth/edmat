"""Part of this project's automated test suite (CLAUDE.md Section 17L). Review/Comment have no
views.py of their own — both are reached through ExerciseViewSet's `reviews`/`comments` actions
(exercises/views.py), so these tests exercise that real HTTP surface rather than the models alone."""

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import Comment, Review, SavedComment
from telemetry.routers import all_log_shards
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


class ReviewReplyTests(APITestCase):
    """Replying to a review. A reply is an ordinary Comment whose generic target is the Review, so
    what is worth pinning here is the part that is genuinely new: who hears about it, and that a
    reply cannot be smuggled onto a thread it does not belong to."""

    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        self.reviewer = make_user('reviewer')
        self.replier = make_user('replier')
        self.review = Review.objects.create(
            exercise=self.exercise, author=self.reviewer, rating=4, body='Good but terse.'
        )

    def test_anyone_can_read_the_thread_under_a_review(self):
        response = self.client.get(reverse('review-comments', kwargs={'pk': self.review.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json(), [])

    def test_anonymous_user_cannot_reply(self):
        response = self.client.post(
            reverse('review-comments', kwargs={'pk': self.review.pk}),
            {'body': 'Me too.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(Comment.objects.count(), 0)

    def test_replying_notifies_the_review_author(self):
        """The one thing `notify_comment_reply` could not do before: a top-level comment under a
        review has no parent comment, so without `root_recipient` the reviewer — the person
        actually being replied to — would never be told."""
        from notifications.models import Notification

        self.client.force_authenticate(self.replier)
        response = self.client.post(
            reverse('review-comments', kwargs={'pk': self.review.pk}),
            {'body': 'I read it differently.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        notification = Notification.objects.get(recipient=self.reviewer)
        self.assertEqual(notification.type, 'comment_reply')
        self.assertEqual(notification.actor, self.replier)
        self.assertEqual(notification.exercise, self.exercise)

    def test_replying_to_your_own_review_notifies_nobody(self):
        from notifications.models import Notification

        self.client.force_authenticate(self.reviewer)
        self.client.post(
            reverse('review-comments', kwargs={'pk': self.review.pk}),
            {'body': 'Adding a thought.'},
            format='json',
        )

        self.assertEqual(Notification.objects.count(), 0)

    def test_a_nested_reply_notifies_the_person_being_answered_not_the_reviewer(self):
        from notifications.models import Notification

        third = make_user('third')
        self.client.force_authenticate(self.replier)
        root = self.client.post(
            reverse('review-comments', kwargs={'pk': self.review.pk}),
            {'body': 'I read it differently.'},
            format='json',
        ).json()
        Notification.objects.all().delete()

        self.client.force_authenticate(third)
        self.client.post(
            reverse('review-comments', kwargs={'pk': self.review.pk}),
            {'body': 'Why?', 'parent': root['id']},
            format='json',
        )

        recipients = list(Notification.objects.values_list('recipient', flat=True))
        self.assertEqual(recipients, [self.replier.pk])

    def test_a_parent_from_another_reviews_thread_is_rejected(self):
        other_review = Review.objects.create(
            exercise=self.exercise, author=self.replier, rating=2, body='Disagree.'
        )
        self.client.force_authenticate(self.replier)
        elsewhere = self.client.post(
            reverse('review-comments', kwargs={'pk': other_review.pk}),
            {'body': 'On the other review.'},
            format='json',
        ).json()

        response = self.client.post(
            reverse('review-comments', kwargs={'pk': self.review.pk}),
            {'body': 'Misattached.', 'parent': elsewhere['id']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Comment.objects.filter(body='Misattached.').count(), 0)

    def test_a_hidden_review_has_no_reachable_thread(self):
        """A review a moderator removed is not shown, so the conversation under it should not be
        reachable either — the queryset excludes it rather than the action checking after the fact."""
        self.review.is_removed = True
        self.review.save(update_fields=['is_removed'])

        response = self.client.get(reverse('review-comments', kwargs={'pk': self.review.pk}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class CommentEditDeleteTests(APITestCase):
    """What the author of a comment can do to it afterwards. Both were unreachable before — the
    model had `is_removed` but only a moderator could ever set it."""

    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        self.author = make_user('author')
        self.other = make_user('other')
        self.client.force_authenticate(self.author)
        self.comment = Comment.objects.get_or_create(
            content_type=ContentType.objects.get_for_model(self.exercise),
            object_id=self.exercise.pk,
            author=self.author,
            body='Original wording.',
        )[0]

    def test_the_author_can_edit_their_own_comment(self):
        response = self.client.patch(
            reverse('comment-detail', kwargs={'pk': self.comment.pk}),
            {'body': 'Reworded.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.comment.refresh_from_db()
        self.assertEqual(self.comment.body, 'Reworded.')

    def test_an_edit_is_recorded_rather_than_silent(self):
        """A comment can already have replies answering what it USED to say, so an edit that left
        no trace would let somebody rewrite the question after the answer exists."""
        self.assertIsNone(self.comment.edited_at)

        response = self.client.patch(
            reverse('comment-detail', kwargs={'pk': self.comment.pk}),
            {'body': 'Reworded.'},
            format='json',
        )

        self.assertTrue(response.json()['is_edited'])
        self.comment.refresh_from_db()
        self.assertIsNotNone(self.comment.edited_at)

    def test_editing_somebody_elses_comment_is_refused(self):
        self.client.force_authenticate(self.other)

        response = self.client.patch(
            reverse('comment-detail', kwargs={'pk': self.comment.pk}),
            {'body': 'Not mine to change.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.comment.refresh_from_db()
        self.assertEqual(self.comment.body, 'Original wording.')

    def test_an_edit_cannot_blank_the_body(self):
        response = self.client.patch(
            reverse('comment-detail', kwargs={'pk': self.comment.pk}),
            {'body': '   '},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.comment.refresh_from_db()
        self.assertEqual(self.comment.body, 'Original wording.')

    def test_deleting_is_a_tombstone_that_keeps_the_replies_in_place(self):
        reply = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(self.exercise),
            object_id=self.exercise.pk,
            parent=self.comment,
            author=self.other,
            body='Answering the original.',
        )

        response = self.client.delete(reverse('comment-detail', kwargs={'pk': self.comment.pk}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.comment.refresh_from_db()
        self.assertTrue(self.comment.is_removed)
        self.assertTrue(Comment.objects.filter(pk=reply.pk).exists())

    def test_an_author_deletion_is_distinguishable_from_a_moderator_removal(self):
        """Both end up `is_removed`, and the reader is told which — otherwise somebody's own
        deletion is reported to everyone as a moderator having removed it."""
        self.client.delete(reverse('comment-detail', kwargs={'pk': self.comment.pk}))

        self.comment.refresh_from_db()
        self.assertTrue(self.comment.removed_by_author)

    def test_deleting_somebody_elses_comment_is_refused(self):
        self.client.force_authenticate(self.other)

        response = self.client.delete(reverse('comment-detail', kwargs={'pk': self.comment.pk}))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.comment.refresh_from_db()
        self.assertFalse(self.comment.is_removed)

    def test_a_moderator_cannot_quietly_delete_through_this_endpoint(self):
        """Staff removing somebody's words is a moderation act with a record behind it (a Report, a
        decision, a note) and keeps its own path. A second, unrecorded route here would make that
        record incomplete rather than make moderation easier."""
        staff = make_user('staff')
        staff.is_staff = True
        staff.save(update_fields=['is_staff'])
        self.client.force_authenticate(staff)

        response = self.client.delete(reverse('comment-detail', kwargs={'pk': self.comment.pk}))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.comment.refresh_from_db()
        self.assertFalse(self.comment.is_removed)

    def test_an_already_removed_comment_cannot_be_edited(self):
        self.client.delete(reverse('comment-detail', kwargs={'pk': self.comment.pk}))

        response = self.client.patch(
            reverse('comment-detail', kwargs={'pk': self.comment.pk}),
            {'body': 'Back from the dead.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)


class SavedCommentTests(APITestCase):
    """Keeping a comment for yourself — the private half of the "⋯" menu on a comment.

    The properties worth pinning are all about it being PRIVATE and about it being one row: nobody
    else's list is reachable, saving twice does not make two, and a comment nobody can read any more
    is not something to bookmark.
    """

    # The request-logging middleware writes to its own shards on every request these make; without
    # this, Django's cross-database guard raises inside the middleware, which swallows it and prints
    # a traceback under a run that otherwise passes — noise that reads exactly like a failure.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        self.author = make_user('author')
        self.keeper = make_user('keeper')
        self.stranger = make_user('stranger')
        self.comment = Comment.objects.create(
            content_type=ContentType.objects.get_for_model(self.exercise),
            object_id=self.exercise.pk,
            author=self.author,
            body='The trick is that the norm is complete.',
        )

    def save_url(self, comment=None):
        return reverse('comment-save-for-me', kwargs={'pk': (comment or self.comment).pk})

    def test_saving_keeps_it_and_says_where_it_lives(self):
        """The target is the whole reason this is more than a row of ids: a comment has no page of
        its own, so without it the settings list could show the words and link nowhere."""
        self.client.force_authenticate(self.keeper)
        response = self.client.post(self.save_url(), {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['target_type'], 'exercise')
        self.assertEqual(response.data['target_id'], str(self.exercise.pk))
        self.assertEqual(response.data['comment']['id'], self.comment.pk)

    def test_saving_twice_is_the_same_statement_not_two_rows(self):
        self.client.force_authenticate(self.keeper)
        self.client.post(self.save_url(), {}, format='json')
        again = self.client.post(self.save_url(), {'note': 'for Tuesday'}, format='json')

        self.assertEqual(again.status_code, status.HTTP_200_OK)
        self.assertEqual(SavedComment.objects.filter(user=self.keeper).count(), 1)
        # The later note replaces the earlier one — it is what the person just typed.
        self.assertEqual(SavedComment.objects.get(user=self.keeper).note, 'for Tuesday')

    def test_a_comment_that_is_gone_is_not_worth_bookmarking(self):
        self.comment.is_removed = True
        self.comment.save(update_fields=['is_removed'])
        self.client.force_authenticate(self.keeper)

        response = self.client.post(self.save_url(), {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_the_list_is_only_ever_your_own(self):
        self.client.force_authenticate(self.keeper)
        self.client.post(self.save_url(), {}, format='json')

        self.client.force_authenticate(self.stranger)
        response = self.client.get(reverse('comment-saved'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_unsaving_removes_it(self):
        self.client.force_authenticate(self.keeper)
        self.client.post(self.save_url(), {}, format='json')
        response = self.client.delete(self.save_url())

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(SavedComment.objects.filter(user=self.keeper).exists())

    def test_unsaving_something_you_never_saved_is_not_an_error(self):
        """There is one row and it either exists or does not — a client holding a stale flag must
        not be able to produce a failure by pressing the wrong one of the two."""
        self.client.force_authenticate(self.keeper)
        self.assertEqual(self.client.delete(self.save_url()).status_code, status.HTTP_204_NO_CONTENT)

    def test_saving_requires_an_account(self):
        response = self.client.post(self.save_url(), {}, format='json')
        self.assertIn(
            response.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)
        )

    def test_you_may_keep_your_own_words(self):
        """Offered on your own comment as much as on anybody else's — there is nothing odd about
        keeping your own explanation of something."""
        self.client.force_authenticate(self.author)
        self.assertEqual(
            self.client.post(self.save_url(), {}, format='json').status_code,
            status.HTTP_201_CREATED,
        )
