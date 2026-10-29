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
from config.content_locale import HIDDEN_HEADER
from exercises.models import ExerciseTranslation, SolutionEntry, Tag, TagFollow
from materials.models import MaterialTranslation
from moderation.models import FeatureFlag
from notifications.models import Notification
from telemetry.routers import all_log_shards
from testing.factories import (
    make_branch,
    make_exercise,
    make_material,
    make_topic,
    make_user,
    make_viewer,
)

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


class FeedContentLocaleTests(ActivityTestCase):
    """AUDIENCE-BRIEF.md §5's own "Left open" note, closed: a feed row's language depends on its
    `kind` (activity/services.py's own `_content_locale_feed_filter`), so this exercises each of
    the three real shapes — a plain content link (exercise/material), a `post`'s own `language`
    column, and a `translation`/`solution_entry` row whose language is its SOURCE, which can
    genuinely differ from the exercise it links to."""

    def setUp(self):
        self.branch = make_branch(slug='feed-locale')
        # original_locale='pl' — a translation/entry submitted in 'en' against it must be judged
        # by ITS OWN locale, not the exercise's, or a reader asking for English would never see it.
        self.exercise = make_exercise(self.branch, 1, locale='pl')
        self.en_exercise = make_exercise(self.branch, 2, locale='en')
        self.material = make_material(self.branch, slug='feed-locale-material', locale='pl')

    def test_a_plain_exercise_or_material_row_is_narrowed_by_its_own_published_translations(self):
        record_activity('exercise', exercise=self.exercise, target_label='pl exercise')
        record_activity('exercise', exercise=self.en_exercise, target_label='en exercise')
        record_activity('material', material=self.material, target_label='pl material')
        pl_only = self.client.get('/api/activity/?content_locales=pl').data
        self.assertEqual({row['target_label'] for row in pl_only}, {'pl exercise', 'pl material'})
        en_only = self.client.get('/api/activity/?content_locales=en').data
        self.assertEqual({row['target_label'] for row in en_only}, {'en exercise'})

    def test_a_post_is_narrowed_by_its_own_language_not_its_anchor(self):
        author = make_user('locale-poster')
        post = Post.objects.create(author=author, body='po polsku', language='pl', branch=self.branch)
        record_activity('post', actor=author, target_label=post.body, post=post, branch=self.branch)
        self.assertEqual(self.client.get('/api/activity/?content_locales=en').data, [])
        shown = self.client.get('/api/activity/?content_locales=pl').data
        self.assertEqual({row['target_label'] for row in shown}, {'po polsku'})

    def test_a_translation_row_is_judged_by_the_translation_it_announces_not_the_exercise(self):
        # The exercise's own ORIGINAL is Polish; the newly-published translation this row
        # announces is English — the row must be found under 'en', not under 'pl'.
        translation = ExerciseTranslation.objects.create(
            exercise=self.exercise, locale='en', status='published', title='t', statement='s'
        )
        record_activity(
            'translation', exercise=self.exercise, target_label='the translation', source=translation
        )
        self.assertEqual(self.client.get('/api/activity/?content_locales=pl').data, [])
        shown = self.client.get('/api/activity/?content_locales=en').data
        self.assertEqual({row['target_label'] for row in shown}, {'the translation'})

    def test_a_solution_entry_row_is_judged_by_the_entry_not_the_exercise(self):
        entry = SolutionEntry.objects.create(
            exercise=self.exercise, kind='hint', locale='en', body='x', status='published'
        )
        record_activity(
            'solution_entry',
            exercise=self.exercise,
            target_label='the hint',
            source=entry,
            entry_kind='hint',
        )
        self.assertEqual(self.client.get('/api/activity/?content_locales=pl').data, [])
        shown = self.client.get('/api/activity/?content_locales=en').data
        self.assertEqual({row['target_label'] for row in shown}, {'the hint'})

    def test_the_hidden_count_rides_the_same_header_every_other_list_uses(self):
        record_activity('exercise', exercise=self.exercise, target_label='pl exercise')
        record_activity('exercise', exercise=self.en_exercise, target_label='en exercise')
        response = self.client.get('/api/activity/?content_locales=pl')
        self.assertEqual(response[HIDDEN_HEADER], '1')
        self.assertEqual(self.client.get('/api/activity/')[HIDDEN_HEADER], '0')


class PostTagListTests(ActivityTestCase):
    """`GET /api/posts/?tag=` — the tag page's list (WP15, "ask a question in a tag"). Read from
    the Post table, not the self-trimming feed, so an old question never falls off its tag."""

    def setUp(self):
        self.tag = Tag.objects.create(slug='ask-list')
        self.other = Tag.objects.create(slug='ask-other')
        self.user = make_user('ask-user')
        self.client.force_authenticate(self.user)

    def _ask(self, body='Why does this converge?', tag=None, **extra):
        return self.client.post(
            '/api/posts/',
            {'body': body, 'tag': (tag or self.tag).slug, 'language': 'pl', **extra},
            format='json',
        )

    def test_lists_only_that_tags_visible_posts_newest_first_with_reply_counts(self):
        first = self._ask('First question').data['id']
        second = self._ask('Second question').data['id']
        self._ask('Elsewhere', tag=self.other)
        removed = self._ask('Withdrawn').data['id']
        self.client.delete(f'/api/posts/{removed}/')
        hidden = self._ask('Hidden by reports').data['id']
        Post.objects.filter(pk=hidden).update(auto_hidden_at='2026-10-15T10:00:00Z')
        self.client.post(f'/api/posts/{first}/comments/', {'body': 'An answer.'}, format='json')

        self.client.force_authenticate(None)
        response = self.client.get(f'/api/posts/?tag={self.tag.slug}')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row['id'] for row in response.data], [second, first])
        self.assertEqual(response.data[1]['comment_count'], 1)
        self.assertEqual(response.data[0]['comment_count'], 0)

    def test_it_outlives_the_feed_trim(self):
        # The reason this endpoint exists rather than `/api/activity/?tag=&kind=post`.
        post_id = self._ask().data['id']
        ActivityEvent.objects.all().delete()
        listed = self.client.get(f'/api/posts/?tag={self.tag.slug}').data
        self.assertEqual([row['id'] for row in listed], [post_id])

    def test_the_tag_is_required_and_the_page_is_bounded(self):
        self.assertEqual(self.client.get('/api/posts/').status_code, status.HTTP_400_BAD_REQUEST)
        ids = [self._ask(f'Question {n}').data['id'] for n in range(3)]
        page = self.client.get(f'/api/posts/?tag={self.tag.slug}&limit=2').data
        self.assertEqual([row['id'] for row in page], [ids[2], ids[1]])
        rest = self.client.get(f'/api/posts/?tag={self.tag.slug}&before={ids[1]}').data
        self.assertEqual([row['id'] for row in rest], [ids[0]])

    def test_a_removed_tag_lists_nothing_and_cannot_be_asked_in(self):
        self._ask()
        Tag.objects.filter(pk=self.tag.pk).update(is_removed=True)
        self.assertEqual(self.client.get(f'/api/posts/?tag={self.tag.slug}').data, [])
        self.assertEqual(self._ask().status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_unknown_slug_is_refused_a_new_tag_comes_by_name(self):
        # The contract moved with the owner's "tag creation is a must" (WP16, 2026-10-15). `tag` is
        # still an EXISTING slug and an unknown one is still a 400 that mints nothing — a new tag
        # arrives only as `tag_name`, through exercises/tags.py, with the post it anchors.
        response = self.client.post(
            '/api/posts/', {'body': 'New tag?', 'tag': 'no-such-tag-yet'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Tag.objects.filter(slug='no-such-tag-yet').exists())
        response = self.client.post(
            '/api/posts/', {'body': 'New tag?', 'tag_name': 'No such tag yet'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['tag'], 'no-such-tag-yet')
        self.assertTrue(response.data['tag_created'])

    def test_a_minors_question_is_held_and_not_listed(self):
        self.user.profile.is_minor = True
        self.user.profile.save(update_fields=['is_minor'])
        response = self._ask('Held until a moderator looks')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNotNone(response.data['auto_hidden_at'])
        self.assertEqual(self.client.get(f'/api/posts/?tag={self.tag.slug}').data, [])
        self.assertFalse(ActivityEvent.objects.filter(kind='post').exists())

    def test_the_content_language_rule_narrows_and_says_how_many(self):
        self._ask('Po polsku')
        english = self._ask('In English', language='en').data['id']
        response = self.client.get(f'/api/posts/?tag={self.tag.slug}&content_locales=en')
        self.assertEqual([row['id'] for row in response.data], [english])
        self.assertEqual(response[HIDDEN_HEADER], '1')

    def test_the_kill_switch_closes_the_list_for_a_non_staff_reader(self):
        self._ask()
        FeatureFlag.objects.filter(key='posts').update(is_enabled=False)
        try:
            self.assertEqual(
                self.client.get(f'/api/posts/?tag={self.tag.slug}').status_code,
                status.HTTP_403_FORBIDDEN,
            )
            # A guest is refused too — as 401, DRF's answer to an unauthenticated caller a
            # permission turns away when a token scheme is configured. Refused is the point.
            self.client.force_authenticate(None)
            self.assertEqual(
                self.client.get(f'/api/posts/?tag={self.tag.slug}').status_code,
                status.HTTP_401_UNAUTHORIZED,
            )
        finally:
            FeatureFlag.objects.filter(key='posts').update(is_enabled=True)


class TagCreationTests(ActivityTestCase):
    """Asking a question in a NEW tag (WP16, 2026-10-15 — the owner's "tag creation is a must").
    Every rule is `exercises/tags.py`'s; these pin it through the one endpoint that uses it."""

    def setUp(self):
        from django.core.cache import cache

        # Throttle counters live in the process-wide cache and outlive a test's rollback.
        cache.clear()
        self.user = make_user('tag-maker')
        self.client.force_authenticate(self.user)

    def _ask(self, tag_name, body='Is this a new topic?', **extra):
        return self.client.post(
            '/api/posts/', {'body': body, 'tag_name': tag_name, 'language': 'pl', **extra}, format='json'
        )

    def test_a_new_name_makes_a_tag_and_the_post_together(self):
        response = self._ask('  Całka   z 2-formy  ')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['tag'], 'calka-z-2-formy')
        self.assertTrue(response.data['tag_created'])
        tag = Tag.objects.get(slug='calka-z-2-formy')
        self.assertTrue(tag.from_question)
        self.assertEqual(tag.created_by, self.user)
        self.assertIsNotNone(tag.created_at)
        self.assertEqual(Post.objects.get(pk=response.data['id']).tag, tag)
        # Listed, and its page answers, because a visible question uses it.
        self.assertIn('calka-z-2-formy', [row['slug'] for row in self.client.get('/api/tags/').data])
        self.assertEqual(self.client.get('/api/tags/calka-z-2-formy/').status_code, status.HTTP_200_OK)

    def test_a_name_that_folds_to_an_existing_tag_reuses_it(self):
        legacy = Tag.objects.create(slug='całka z 1-formy')  # a free-text corpus tag
        ascii_tag = Tag.objects.create(slug='calka-gaussa')
        before = Tag.objects.count()
        for typed, expected in (
            ('CAŁKA Z 1-FORMY', legacy),
            ('calka z 1 formy', legacy),
            ('#Całka Gaussa', ascii_tag),
            ('całka-gaussa', ascii_tag),
        ):
            response = self._ask(typed)
            self.assertEqual(response.status_code, status.HTTP_201_CREATED, typed)
            self.assertEqual(response.data['tag'], expected.slug, typed)
            self.assertFalse(response.data['tag_created'], typed)
        self.assertEqual(Tag.objects.count(), before)

    def test_every_name_refusal_carries_its_word_and_makes_nothing(self):
        before = Tag.objects.count()
        for typed, word in (
            ('   ', None),  # blank is no anchor at all — the serializer's "pick one" refusal
            ('!!!', 'tag_name_empty'),
            ('x', 'tag_name_too_short'),
            ('a' * 51, 'tag_name_too_long'),
            ('https://example.com', 'tag_name_link_or_markup'),
            ('www.example', 'tag_name_link_or_markup'),
            ('spam.example', 'tag_name_link_or_markup'),
            ('<b>bold</b>', 'tag_name_link_or_markup'),
            ('me@example', 'tag_name_link_or_markup'),
        ):
            response = self._ask(typed)
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, typed)
            if word:
                self.assertEqual(response.data['tag_name'], [word], typed)
        self.assertEqual(Tag.objects.count(), before)
        self.assertFalse(Post.objects.exists())

    def test_a_removed_tag_cannot_be_made_again_by_spelling_it_differently(self):
        Tag.objects.create(slug='zly-tag', is_removed=True)
        response = self._ask('Zły   TAG')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['tag_name'], ['tag_removed'])
        self.assertEqual(Tag.objects.filter(slug='zly-tag').count(), 1)

    def test_a_slug_and_a_name_together_is_two_anchors(self):
        Tag.objects.create(slug='istniejacy')
        response = self._ask('nowy', tag='istniejacy')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('anchor', response.data)

    def test_a_guest_cannot(self):
        self.client.force_authenticate(None)
        self.assertEqual(self._ask('gosc').status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertFalse(Tag.objects.filter(slug='gosc').exists())

    def test_a_minor_may_reuse_a_tag_but_not_make_one(self):
        Tag.objects.create(slug='indukcja')
        self.user.profile.is_minor = True
        self.user.profile.save(update_fields=['is_minor'])
        refused = self._ask('Zupełnie nowy temat')
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(refused.data['tag_name'], ['minor_cannot_create_tag'])
        self.assertFalse(Tag.objects.filter(slug='zupelnie-nowy-temat').exists())
        self.assertFalse(Post.objects.exists())
        # An existing tag, typed in another case, is still fine — and the question is held.
        reused = self._ask('INDUKCJA')
        self.assertEqual(reused.status_code, status.HTTP_201_CREATED)
        self.assertEqual(reused.data['tag'], 'indukcja')
        self.assertIsNotNone(reused.data['auto_hidden_at'])

    def test_the_throttle_counts_only_new_tags(self):
        from rest_framework.settings import api_settings

        limit = int(api_settings.DEFAULT_THROTTLE_RATES['tag_create'].split('/')[0])
        for n in range(limit):
            self.assertEqual(self._ask(f'temat numer {n}').status_code, status.HTTP_201_CREATED)
        refused = self._ask('jeden za duzo')
        self.assertEqual(refused.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(refused.data['tag_name'], ['too_many_new_tags'])
        self.assertFalse(Tag.objects.filter(slug='jeden-za-duzo').exists())
        # Reusing a tag spends nothing, so it still works past the bound.
        self.assertEqual(self._ask('Temat numer 0').status_code, status.HTTP_201_CREATED)

    def test_the_posts_switch_closes_tag_creation_too(self):
        FeatureFlag.objects.filter(key='posts').update(is_enabled=False)
        try:
            self.assertEqual(self._ask('wylaczone').status_code, status.HTTP_403_FORBIDDEN)
        finally:
            FeatureFlag.objects.filter(key='posts').update(is_enabled=True)
        self.assertFalse(Tag.objects.filter(slug='wylaczone').exists())

    def test_a_withdrawn_question_takes_its_new_tag_off_the_site(self):
        post_id = self._ask('Słowo do wycofania').data['id']
        self.assertEqual(self.client.get('/api/tags/slowo-do-wycofania/').status_code, 200)
        self.client.delete(f'/api/posts/{post_id}/')
        # Not listed, no page, nothing to follow — and the tombstone does not say the name.
        self.assertNotIn('slowo-do-wycofania', [row['slug'] for row in self.client.get('/api/tags/').data])
        self.assertEqual(self.client.get('/api/tags/slowo-do-wycofania/').status_code, 404)
        self.assertEqual(
            self.client.post('/api/tags/slowo-do-wycofania/follow/').status_code, status.HTTP_404_NOT_FOUND
        )
        tombstone = self.client.get(f'/api/posts/{post_id}/').data
        self.assertIsNone(tombstone['tag'])
        self.assertEqual(tombstone['anchor_label'], '')
        # A moderator still sees what the post was anchored on.
        staff = make_user('tag-staff', is_staff=True)
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.get(f'/api/posts/{post_id}/').data['tag'], 'slowo-do-wycofania')
        # Not removed, though: an author's withdrawal is no judgement on the name.
        self.assertFalse(Tag.objects.get(slug='slowo-do-wycofania').is_removed)

    def test_an_auto_hidden_question_hides_its_tag_and_another_use_keeps_it(self):
        post_id = self._ask('Ukryty temat').data['id']
        Post.objects.filter(pk=post_id).update(auto_hidden_at='2026-10-15T10:00:00Z')
        self.assertEqual(self.client.get('/api/tags/ukryty-temat/').status_code, 404)
        # A second, visible question in the same tag brings it back — something visible uses it.
        again = self._ask('ukryty temat', body='Asking again, properly.')
        self.assertFalse(again.data['tag_created'])
        self.assertEqual(self.client.get('/api/tags/ukryty-temat/').status_code, 200)

    def test_an_exercise_using_it_keeps_it_listed(self):
        post_id = self._ask('Uzywany temat').data['id']
        exercise = make_exercise(make_branch(), 1)
        exercise.tags.add(Tag.objects.get(slug='uzywany-temat'))
        self.client.delete(f'/api/posts/{post_id}/')
        self.assertEqual(self.client.get('/api/tags/uzywany-temat/').status_code, 200)

    def test_corpus_tags_are_listed_whatever_uses_them(self):
        Tag.objects.create(slug='nieuzywany-korpus')
        self.assertIn('nieuzywany-korpus', [row['slug'] for row in self.client.get('/api/tags/').data])

    def test_an_edit_cannot_mint_a_tag(self):
        Tag.objects.create(slug='stary')
        picked = self.client.post('/api/posts/', {'body': 'x', 'tag': 'stary'}, format='json')
        # A tag picked by slug says nothing about creation — the key is only for a typed name.
        self.assertNotIn('tag_created', picked.data)
        post_id = picked.data['id']
        response = self.client.patch(f'/api/posts/{post_id}/', {'tag_name': 'nowy z edycji'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # Refused by the edit guard itself — the post already having a tag would also be a 400, for
        # "two anchors", which is not the rule this names.
        self.assertIn('tag_name', response.data)
        self.assertFalse(Tag.objects.filter(slug='nowy-z-edycji').exists())


class PostCourseBoardTests(ActivityTestCase):
    """`GET /api/posts/?course=` — the course BOARD (2026-10-21): every post about a course or one
    under it, the way the course page's Board tab reads it."""

    def setUp(self):
        from courses.models import Course

        self.tag = Tag.objects.create(slug='board-tag')
        self.teacher = make_user('board-teacher')
        self.user = make_user('board-user')
        self.root = Course.objects.create(
            instructor=self.teacher, title='Analiza', visibility='public', status='open'
        )
        self.part = Course.objects.create(
            instructor=self.teacher, title='Analiza 1', visibility='public', status='open',
            parent=self.root,
        )
        self.hidden = Course.objects.create(
            instructor=self.teacher, title='Secret', visibility='only_you', status='open'
        )
        self.client.force_authenticate(self.user)

    def _post(self, body, course):
        return self.client.post(
            '/api/posts/',
            {'body': body, 'tag': self.tag.slug, 'language': 'pl', 'ref_course': course.pk},
            format='json',
        )

    def test_the_board_lists_the_course_and_its_subcourses_newest_first(self):
        on_root = self._post('About the whole thing', self.root).data['id']
        on_part = self._post('About part one', self.part).data['id']
        removed = self._post('Withdrawn', self.root).data['id']
        self.client.delete(f'/api/posts/{removed}/')
        self.client.force_authenticate(None)
        res = self.client.get(f'/api/posts/?course={self.root.pk}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual([row['id'] for row in res.data], [on_part, on_root])
        self.assertEqual(res.data[0]['ref_course_title'], 'Analiza 1')
        self.assertEqual(res.data[0]['attachment_count'], 0)
        # The part's own board holds only its own.
        part = self.client.get(f'/api/posts/?course={self.part.pk}')
        self.assertEqual([row['id'] for row in part.data], [on_part])

    def test_a_course_the_reader_cannot_see_is_not_found(self):
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(f'/api/posts/?course={self.hidden.pk}').status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(self.client.get('/api/posts/?course=x').status_code, status.HTTP_404_NOT_FOUND)

    def test_a_tag_and_a_course_combine(self):
        other = Tag.objects.create(slug='board-other')
        on_root = self._post('In the tag', self.root).data['id']
        self.client.post(
            '/api/posts/',
            {'body': 'Other tag', 'tag': other.slug, 'language': 'pl', 'ref_course': self.root.pk},
            format='json',
        )
        res = self.client.get(f'/api/posts/?course={self.root.pk}&tag={self.tag.slug}')
        self.assertEqual([row['id'] for row in res.data], [on_root])
