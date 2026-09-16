"""Comment edit history (CommentRevision) — see community/models.py's own docstring for the two
hide tiers. Exercises the real HTTP surface (partial_update, the new `revisions`/`hide`/`seal`
actions), not the model alone, matching this app's own test discipline (tests.py's own note)."""

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import Comment, CommentRevision
from telemetry.routers import all_log_shards
from testing.factories import make_course, make_exercise, make_user


class CommentRevisionCreationTests(APITestCase):
    # Authenticated requests through the client go through telemetry's own per-user-shard request
    # logging — see community/tests.py's own identical note.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        self.author = make_user('author')
        self.other = make_user('other')
        self.client.force_authenticate(self.author)
        content_type = ContentType.objects.get_for_model(self.exercise)
        self.comment = Comment.objects.create(
            content_type=content_type, object_id=self.exercise.pk, author=self.author,
            body='Original wording.',
        )

    def test_editing_a_comment_snapshots_the_previous_body(self):
        response = self.client.patch(
            reverse('comment-detail', kwargs={'pk': self.comment.pk}),
            {'body': 'Edited wording.'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(CommentRevision.objects.filter(comment=self.comment).count(), 1)
        revision = CommentRevision.objects.get(comment=self.comment)
        self.assertEqual(revision.body, 'Original wording.')
        self.assertEqual(revision.edited_by, self.author)
        self.comment.refresh_from_db()
        self.assertEqual(self.comment.body, 'Edited wording.')

    def test_a_second_edit_creates_a_second_revision_not_a_replacement(self):
        self.client.patch(
            reverse('comment-detail', kwargs={'pk': self.comment.pk}),
            {'body': 'Second wording.'}, format='json',
        )
        self.client.patch(
            reverse('comment-detail', kwargs={'pk': self.comment.pk}),
            {'body': 'Third wording.'}, format='json',
        )

        bodies = list(
            CommentRevision.objects.filter(comment=self.comment).order_by('created_at')
            .values_list('body', flat=True)
        )
        self.assertEqual(bodies, ['Original wording.', 'Second wording.'])

    def test_a_never_edited_comment_has_no_revisions(self):
        """The honest baseline "previous version not available" case — no snapshot was ever taken,
        not a placeholder standing in for a missing one."""
        self.assertEqual(CommentRevision.objects.filter(comment=self.comment).count(), 0)

    def test_tombstoning_a_comment_creates_no_revision(self):
        self.client.delete(reverse('comment-detail', kwargs={'pk': self.comment.pk}))

        self.assertEqual(CommentRevision.objects.filter(comment=self.comment).count(), 0)

    def test_voting_creates_no_revision(self):
        self.client.force_authenticate(self.other)
        self.client.post(reverse('comment-vote', kwargs={'pk': self.comment.pk}), {'value': 1}, format='json')

        self.assertEqual(CommentRevision.objects.filter(comment=self.comment).count(), 0)


class CommentRevisionListTests(APITestCase):
    # Anonymous GETs through the client go through telemetry's own anonymous-request logging,
    # which writes to a separate DB alias — see community/tests.py's own identical note.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_course()
        self.exercise = make_exercise(self.branch, 1)
        self.author = make_user('author2')
        self.reader = make_user('reader')
        self.staff = make_user('staffer', is_staff=True)
        self.root = make_user('root', is_superuser=True)
        content_type = ContentType.objects.get_for_model(self.exercise)
        self.comment = Comment.objects.create(
            content_type=content_type, object_id=self.exercise.pk, author=self.author,
            body='First.',
        )
        self.client.force_authenticate(self.author)
        self.client.patch(
            reverse('comment-detail', kwargs={'pk': self.comment.pk}), {'body': 'Second.'}, format='json'
        )
        self.revision = CommentRevision.objects.get(comment=self.comment)

    def _revisions_as(self, user):
        self.client.force_authenticate(user)
        response = self.client.get(reverse('comment-revisions', kwargs={'pk': self.comment.pk}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_an_ordinary_revision_is_readable_by_anybody(self):
        for user in (None, self.reader, self.author, self.staff, self.root):
            self.client.force_authenticate(user)
            response = self.client.get(reverse('comment-revisions', kwargs={'pk': self.comment.pk}))
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.data[0]['body'], 'First.')

    def test_revisions_survive_the_comment_being_tombstoned(self):
        """History is a narrower question than the tombstone — deleting a comment must not also
        erase the trail of what it used to say."""
        self.client.delete(reverse('comment-detail', kwargs={'pk': self.comment.pk}))

        rows = self._revisions_as(self.reader)
        self.assertEqual(rows[0]['body'], 'First.')

    def test_moderator_hide_masks_the_body_for_ordinary_readers_including_the_author(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            reverse('comment-revision-hide', kwargs={'pk': self.revision.pk}),
            {'note': 'a slur, otherwise fine'}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        for user in (None, self.reader, self.author):
            rows = self._revisions_as(user)
            self.assertIsNone(rows[0]['body'])
            self.assertTrue(rows[0]['is_hidden_by_moderator'])

        rows = self._revisions_as(self.staff)
        self.assertEqual(rows[0]['body'], 'First.')

    def test_only_staff_may_hide(self):
        self.client.force_authenticate(self.reader)
        response = self.client.post(
            reverse('comment-revision-hide', kwargs={'pk': self.revision.pk}), {}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.revision.refresh_from_db()
        self.assertIsNone(self.revision.hidden_by_moderator_at)

    def test_sealing_masks_the_body_from_everyone_including_staff(self):
        self.client.force_authenticate(self.root)
        response = self.client.post(
            reverse('comment-revision-seal', kwargs={'pk': self.revision.pk}),
            {'note': 'compromised account, illegal content'}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        for user in (None, self.reader, self.author, self.staff, self.root):
            rows = self._revisions_as(user)
            self.assertIsNone(rows[0]['body'])
            self.assertTrue(rows[0]['is_sealed'])

        # The body genuinely never leaves the database — it is preserved for the offline export
        # path (manage.py export_sealed_revision), never deleted.
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.body, 'First.')

    def test_only_a_superuser_may_seal_not_plain_staff(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            reverse('comment-revision-seal', kwargs={'pk': self.revision.pk}), {}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.revision.refresh_from_db()
        self.assertIsNone(self.revision.sealed_at)

    def test_hiding_an_already_sealed_revision_is_refused(self):
        self.client.force_authenticate(self.root)
        self.client.post(reverse('comment-revision-seal', kwargs={'pk': self.revision.pk}), {}, format='json')

        self.client.force_authenticate(self.staff)
        response = self.client.post(
            reverse('comment-revision-hide', kwargs={'pk': self.revision.pk}), {}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
