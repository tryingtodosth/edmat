"""The activity feed (root CLAUDE.md §17AI) — weighted, like every suite here, at the boundaries
that fail silently: the public-by-construction rule (what NEVER produces a row), the forgetting
half (removal/auto-hide/tombstone taking rows out), the post anchor invariant, the kill switch,
and the Followed view's two signals.
"""

import io

from django.contrib.contenttypes.models import ContentType
from PIL import Image as PILImage
from rest_framework import status
from rest_framework.test import APITestCase

from community.models import Comment
from exercises.models import SolutionEntry, Tag, TagFollow
from moderation.models import FeatureFlag
from notifications.models import Notification
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_topic, make_user, make_viewer

from .models import ActivityEvent, Post
from .services import record_activity, remove_activity_for


class ActivityTestCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}


def png_bytes() -> bytes:
    buffer = io.BytesIO()
    PILImage.new('RGB', (640, 480), (200, 40, 40)).save(buffer, format='PNG')
    return buffer.getvalue()


class FeedWriteTests(ActivityTestCase):
    def setUp(self):
        self.branch = make_branch(slug='feed-write')
        self.exercise = make_exercise(self.branch, 1)
        self.user = make_user('feed-user')

    def test_a_published_solution_entry_lands_in_the_feed(self):
        self.client.force_authenticate(make_user('feed-vc', is_verified_contributor=True))
        self.client.post(
            f'/api/exercises/{self.exercise.pk}/entries/',
            {'kind': 'solution', 'locale': 'pl', 'body': '<p>x</p>'},
            format='json',
        )
        event = ActivityEvent.objects.get(kind='solution_entry')
        self.assertEqual(event.exercise, self.exercise)
        self.assertEqual(event.branch, self.branch)

    def test_a_pending_entry_never_produces_a_row(self):
        self.client.force_authenticate(self.user)
        self.client.post(
            f'/api/exercises/{self.exercise.pk}/entries/',
            {'kind': 'solution', 'locale': 'pl', 'body': '<p>x</p>'},
            format='json',
        )
        self.assertFalse(ActivityEvent.objects.filter(kind='solution_entry').exists())

    def test_accepting_that_entry_is_what_produces_it(self):
        self.client.force_authenticate(self.user)
        entry_id = self.client.post(
            f'/api/exercises/{self.exercise.pk}/entries/',
            {'kind': 'hint', 'locale': 'pl', 'body': '<p>x</p>'},
            format='json',
        ).data['id']
        self.client.force_authenticate(make_user('feed-rev', is_verified_contributor=True))
        self.client.post(
            f'/api/solution-entries/{entry_id}/review/', {'decision': 'approve'}, format='json'
        )
        event = ActivityEvent.objects.get(kind='solution_entry')
        self.assertEqual(event.entry_kind, 'hint')
        self.assertEqual(event.actor, self.user)

    def test_a_comment_on_an_exercise_lands_with_the_commenters_words(self):
        self.client.force_authenticate(self.user)
        self.client.post(
            f'/api/exercises/{self.exercise.pk}/comments/',
            {'body': 'Why does step 2 hold?'},
            format='json',
        )
        event = ActivityEvent.objects.get(kind='comment')
        self.assertIn('step 2', event.target_label)

    def test_a_comment_inside_a_course_thread_never_produces_a_row(self):
        # The allowlist at work: course threads can be private, so they are not in it at all.
        from courses.models import Course

        course = Course.objects.create(
            instructor=make_user('feed-instructor'), title='Private-ish', status='open'
        )
        content_type = ContentType.objects.get_for_model(Course)
        before = ActivityEvent.objects.filter(kind='comment').count()
        Comment.objects.create(
            content_type=content_type, object_id=course.pk, author=self.user, body='Inside.'
        )
        self.assertEqual(ActivityEvent.objects.filter(kind='comment').count(), before)

    def test_a_review_lands_and_its_removal_takes_the_row_back_out(self):
        from community.models import Review

        review = Review.objects.create(exercise=self.exercise, author=self.user, rating=5)
        self.assertTrue(ActivityEvent.objects.filter(kind='review').exists())
        review.is_removed = True
        review.save()
        self.assertFalse(ActivityEvent.objects.filter(kind='review').exists())


class FeedForgettingTests(ActivityTestCase):
    def setUp(self):
        self.branch = make_branch(slug='feed-forget')
        self.exercise = make_exercise(self.branch, 1)

    def test_auto_hiding_an_exercise_removes_every_row_about_it(self):
        from moderation.models import ContentView

        entry = SolutionEntry.objects.create(
            exercise=self.exercise, kind='solution', locale='pl', body='x', status='published'
        )
        record_activity('exercise', exercise=self.exercise, target_label='t')
        record_activity(
            'solution_entry', exercise=self.exercise, source=entry, target_label='t'
        )
        for i in range(10):
            ContentView.objects.create(user=make_viewer(f'ff-view-{i}'), exercise=self.exercise)
        for i in range(3):
            self.client.force_authenticate(make_user(f'ff-rep-{i}'))
            self.client.post(
                '/api/reports/',
                {'kind': 'exercise', 'object_id': self.exercise.pk, 'reason': 'wrong'},
                format='json',
            )
        self.exercise.refresh_from_db()
        self.assertFalse(self.exercise.published)
        self.assertFalse(ActivityEvent.objects.filter(exercise=self.exercise).exists())

    def test_remove_activity_for_deletes_by_source_and_by_destination(self):
        entry = SolutionEntry.objects.create(
            exercise=self.exercise, kind='hint', locale='pl', body='x', status='published'
        )
        record_activity('solution_entry', exercise=self.exercise, source=entry, target_label='t')
        remove_activity_for(entry)
        self.assertEqual(ActivityEvent.objects.count(), 0)


class PostTests(ActivityTestCase):
    def setUp(self):
        self.branch = make_branch(slug='feed-posts')
        self.user = make_user('post-user')
        self.client.force_authenticate(self.user)

    def _create(self, **overrides):
        data = {'body': 'A thought worth sharing.', 'branch': self.branch.slug, **overrides}
        return self.client.post('/api/posts/', data, format='json')

    def test_a_post_publishes_and_lands_in_the_feed(self):
        response = self._create()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ActivityEvent.objects.filter(kind='post').count(), 1)

    def test_the_anchor_is_required(self):
        response = self.client.post('/api/posts/', {'body': 'No anchor.'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_two_anchors_are_refused(self):
        tag = Tag.objects.create(slug='post-two-anchors')
        response = self._create(tag=tag.slug)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


    def test_a_topic_is_the_fourth_anchor(self):
        # The claim-chip ask (root CLAUDE.md 17AK): a covers/requires chip names a TOPIC, so
        # topics must be anchorable or the chip has nowhere to send anyone. Anchored by pk; the
        # feed's ?topic= matches BOTH the anchored post and content events whose exercise carries
        # the topic.
        topic = make_topic(self.branch, slug='post-topic-anchor')
        exercise = make_exercise(self.branch, 41)
        exercise.topics.add(topic)
        response = self._create(branch=None, topic=topic.pk)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['topic'], topic.pk)
        # The anchor label resolves to the topic's own name, not a bare slug/pk.
        self.assertTrue(response.data['anchor_label'])
        # And a topic + branch together is two anchors — refused.
        double = self._create(topic=topic.pk)
        self.assertEqual(double.status_code, status.HTTP_400_BAD_REQUEST)

        from .services import record_activity

        record_activity('exercise', exercise=exercise, target_label='carries the topic')
        listed = self.client.get(f'/api/activity/?topic={topic.pk}').data
        kinds = {item['kind'] for item in listed}
        self.assertEqual(kinds, {'post', 'exercise'})

    def test_at_most_one_reference(self):
        exercise = make_exercise(self.branch, 1)
        make_exercise(self.branch, 2)
        from materials.models import Material

        material = Material.objects.create(branch=self.branch, slug='post-ref', type='other')
        response = self._create(ref_exercise=exercise.pk, ref_material=material.pk)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_anonymous_cannot_post(self):
        self.client.force_authenticate(None)
        self.assertEqual(self._create().status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_tag_anchored_post_reaches_that_tags_followers_followed_view(self):
        tag = Tag.objects.create(slug='post-follow')
        follower = make_user('post-follower')
        TagFollow.objects.create(user=follower, tag=tag)
        self._create(branch=None, tag=tag.slug)
        self.client.force_authenticate(follower)
        followed = self.client.get('/api/activity/?followed=1').data
        self.assertTrue(any(item['kind'] == 'post' for item in followed))
        # And somebody following nothing sees an empty Followed view, not everything.
        self.client.force_authenticate(make_user('post-nofollow'))
        self.assertEqual(self.client.get('/api/activity/?followed=1').data, [])

    def test_deleting_tombstones_and_forgets(self):
        post_id = self._create().data['id']
        response = self.client.delete(f'/api/posts/{post_id}/')
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        post = Post.objects.get(pk=post_id)
        self.assertTrue(post.is_removed)
        self.assertEqual(ActivityEvent.objects.filter(post=post).count(), 0)
        # The tombstoned read blanks the words but keeps the row addressable.
        read = self.client.get(f'/api/posts/{post_id}/')
        self.assertEqual(read.status_code, status.HTTP_200_OK)
        self.assertEqual(read.data['body'], '')

    def test_a_stranger_cannot_delete_or_edit(self):
        post_id = self._create().data['id']
        self.client.force_authenticate(make_user('post-stranger'))
        self.assertEqual(
            self.client.delete(f'/api/posts/{post_id}/').status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(
            self.client.patch(
                f'/api/posts/{post_id}/', {'body': 'Mine now.'}, format='json'
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_the_image_is_reencoded_never_stored_as_uploaded(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile('photo.png', png_bytes(), content_type='image/png')
        response = self.client.post(
            '/api/posts/',
            {'body': 'With a picture.', 'branch': self.branch.slug, 'image': upload},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        post = Post.objects.get(pk=response.data['id'])
        self.assertTrue(post.image.name.endswith('.webp'))
        with post.image.open('rb') as stored:
            self.assertNotEqual(stored.read(), png_bytes())
        post.image.delete(save=False)

    def test_a_comment_on_a_post_notifies_the_author_and_lands_in_the_feed(self):
        post_id = self._create().data['id']
        commenter = make_user('post-commenter')
        self.client.force_authenticate(commenter)
        response = self.client.post(
            f'/api/posts/{post_id}/comments/', {'body': 'Great point.'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        notification = Notification.objects.get(recipient=self.user, type='comment_reply')
        self.assertEqual(notification.post_id, int(post_id))
        self.assertTrue(
            ActivityEvent.objects.filter(kind='comment', post_id=post_id).exists()
        )

    def test_the_kill_switch_takes_posting_the_pages_and_the_feed_rows(self):
        post_id = self._create().data['id']
        FeatureFlag.objects.filter(key='posts').update(is_enabled=False)
        try:
            # No new posts, no reading the page…
            self.assertEqual(self._create().status_code, status.HTTP_403_FORBIDDEN)
            self.assertEqual(
                self.client.get(f'/api/posts/{post_id}/').status_code, status.HTTP_403_FORBIDDEN
            )
            # …and the feed keeps its system events while every post row leaves.
            self.client.force_authenticate(None)
            kinds = {item['kind'] for item in self.client.get('/api/activity/').data}
            self.assertNotIn('post', kinds)
        finally:
            FeatureFlag.objects.filter(key='posts').update(is_enabled=True)


class FeedReadTests(ActivityTestCase):
    def setUp(self):
        self.branch = make_branch(slug='feed-read')
        self.exercise = make_exercise(self.branch, 1)

    def test_filters_and_cursor(self):
        for i in range(5):
            record_activity('exercise', exercise=self.exercise, target_label=f'ex {i}')
        record_activity('material', target_label='mat', branch=self.branch)
        listed = self.client.get('/api/activity/?kind=exercise').data
        self.assertEqual({item['kind'] for item in listed}, {'exercise'})
        # Cursor: rows strictly older than `before`.
        first_page = self.client.get('/api/activity/?kind=exercise&limit=2').data
        second_page = self.client.get(
            f"/api/activity/?kind=exercise&limit=2&before={first_page[-1]['id']}"
        ).data
        self.assertTrue(int(second_page[0]['id']) < int(first_page[-1]['id']))

    def test_the_discipline_filter_reaches_branch_scoped_rows(self):
        record_activity('exercise', exercise=self.exercise, target_label='t')
        listed = self.client.get('/api/activity/?discipline=matematyka').data
        self.assertTrue(len(listed) >= 1)
        self.assertEqual(self.client.get('/api/activity/?discipline=nonexistent').data, [])
