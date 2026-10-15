"""`exercises/tags.py` — the rule behind asking a question in a NEW tag (WP16, 2026-10-15), and the
admin's rename / remove / merge. The endpoint's side is `activity.tests.TagCreationTests`."""

from django.test import TestCase
from rest_framework.test import APITestCase

from activity.models import ActivityEvent, Post
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_material, make_user, make_viewer

from .models import Tag, TagFollow
from .tags import clean_name, create_tag_from, fold, listed_tags, matching_tag, merge_tag, name_refusal


class FoldTests(TestCase):
    def test_folds_the_way_the_corpus_slugs_already_are(self):
        self.assertEqual(fold('całka z 1-formy'), 'calka-z-1-formy')
        self.assertEqual(fold('Całka  Niewłaściwa'), 'calka-niewlasciwa')
        self.assertEqual(fold('ŁÓDŹ, żółć & co.'), 'lodz-zolc-co')
        self.assertEqual(fold('calka-podwojna'), 'calka-podwojna')

    def test_clean_name_trims_collapses_and_drops_the_hash(self):
        self.assertEqual(clean_name('  #całka \n  z\tformy '), 'całka z formy')

    def test_name_refusals(self):
        self.assertIsNone(name_refusal('Szereg Taylora'))
        self.assertIsNone(name_refusal('R^3: algebra'))  # a colon is not a scheme
        self.assertEqual(name_refusal(''), 'tag_name_empty')
        self.assertEqual(name_refusal('—'), 'tag_name_empty')
        self.assertEqual(name_refusal('ą'), 'tag_name_too_short')
        self.assertEqual(name_refusal('x' * 51), 'tag_name_too_long')
        for link in ('http://a', 'javascript:alert(1)', 'a/b', 'evil.example', 'www.x', '<i>', 'a&b'):
            self.assertEqual(name_refusal(link), 'tag_name_link_or_markup', link)


class MatchingTests(TestCase):
    def test_prefers_the_slug_that_already_is_the_fold_then_the_oldest(self):
        free_text = Tag.objects.create(slug='całka podwójna')
        ascii_tag = Tag.objects.create(slug='calka-podwojna')
        self.assertEqual(matching_tag('Całka Podwójna'), ascii_tag)
        ascii_tag.delete()
        self.assertEqual(matching_tag('Całka Podwójna'), free_text)

    def test_a_live_tag_beats_a_removed_one(self):
        Tag.objects.create(slug='ciag-zbiezny', is_removed=True)
        live = Tag.objects.create(slug='ciąg zbieżny')
        self.assertEqual(matching_tag('ciąg  zbieżny'), live)
        tag, created, refusal = create_tag_from('Ciąg zbieżny', make_viewer('m1'))
        self.assertEqual((tag, created, refusal), (live, False, None))

    def test_the_throttle_is_asked_only_when_something_is_made(self):
        Tag.objects.create(slug='istnieje')
        asked = []

        def never():
            asked.append(1)
            return False

        user = make_viewer('m2')
        self.assertEqual(create_tag_from('Istnieje', user, allow_create=never)[2], None)
        self.assertEqual(asked, [])
        self.assertEqual(create_tag_from('nowe', user, allow_create=never), (None, False, 'too_many_new_tags'))
        self.assertEqual(asked, [1])
        self.assertFalse(Tag.objects.filter(slug='nowe').exists())


class ListedTagsTests(TestCase):
    def test_a_minted_tag_needs_a_visible_use_a_corpus_tag_does_not(self):
        corpus = Tag.objects.create(slug='korpus')
        minted = Tag.objects.create(slug='nowy', from_question=True)
        removed = Tag.objects.create(slug='usuniety', is_removed=True)
        self.assertEqual(set(listed_tags()), {corpus})
        author = make_viewer('m3')
        post = Post.objects.create(author=author, body='?', tag=minted)
        self.assertEqual(set(listed_tags()), {corpus, minted})
        Post.objects.filter(pk=post.pk).update(is_removed=True)
        self.assertEqual(set(listed_tags()), {corpus})
        material = make_material(make_branch())
        material.tags.add(minted)
        self.assertEqual(set(listed_tags()), {corpus, minted})
        self.assertNotIn(removed, set(listed_tags()))


class MergeTests(TestCase):
    def test_everything_moves_and_the_source_is_removed_not_deleted(self):
        source = Tag.objects.create(slug='calka-oznaczona')
        target = Tag.objects.create(slug='całka oznaczona')
        branch = make_branch()
        exercise = make_exercise(branch, 1)
        both = make_exercise(branch, 2)
        exercise.tags.add(source)
        both.tags.add(source, target)
        author = make_viewer('m4')
        post = Post.objects.create(author=author, body='?', tag=source)
        event = ActivityEvent.objects.create(kind='post', actor=author, post=post)
        event.tags.add(source)
        only_source = make_viewer('m5')
        TagFollow.objects.create(user=only_source, tag=source)
        TagFollow.objects.create(user=author, tag=source)
        TagFollow.objects.create(user=author, tag=target, notify=False)

        merge_tag(source, target)

        self.assertEqual(list(exercise.tags.all()), [target])
        self.assertEqual(list(both.tags.all()), [target])
        self.assertEqual(Post.objects.get(pk=post.pk).tag, target)
        self.assertEqual(list(event.tags.all()), [target])
        self.assertTrue(TagFollow.objects.filter(user=only_source, tag=target).exists())
        self.assertFalse(TagFollow.objects.get(user=author, tag=target).notify)  # the target's kept
        self.assertFalse(TagFollow.objects.filter(tag=source).exists())
        source.refresh_from_db()
        self.assertTrue(source.is_removed)


class TagAdminTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.admin = make_user('tag-admin', is_staff=True, is_superuser=True)
        self.client.force_login(self.admin)

    def _post(self, tag, **data):
        form = {'slug': tag.slug, 'merge_into': '', **data}
        if data.get('is_removed'):
            form['is_removed'] = 'on'
        return self.client.post(f'/admin/exercises/tag/{tag.pk}/change/', form)

    def test_the_changelist_and_a_free_text_tag_open_and_save(self):
        tag = Tag.objects.create(slug='całka z 1-formy')
        self.assertEqual(self.client.get('/admin/exercises/tag/').status_code, 200)
        self.assertEqual(self.client.get(f'/admin/exercises/tag/{tag.pk}/change/').status_code, 200)
        # Removing a free-text corpus tag must not trip over the SlugField validator.
        self.assertEqual(self._post(tag, is_removed=True).status_code, 302)
        tag.refresh_from_db()
        self.assertTrue(tag.is_removed)
        self.assertEqual(tag.slug, 'całka z 1-formy')

    def test_a_rename_is_folded_and_refused_onto_another_name(self):
        tag = Tag.objects.create(slug='zly-slug', from_question=True)
        Tag.objects.create(slug='zajety')
        self.assertEqual(self._post(tag, slug='Dobry Slug').status_code, 302)
        tag.refresh_from_db()
        self.assertEqual(tag.slug, 'dobry-slug')
        self.assertTrue(tag.from_question)  # read-only: the form cannot reach it
        self.assertEqual(self._post(tag, slug='Zajęty').status_code, 200)  # the form, with its error
        self.assertEqual(self._post(tag, slug='http://x').status_code, 200)
        tag.refresh_from_db()
        self.assertEqual(tag.slug, 'dobry-slug')

    def test_merge_into(self):
        source = Tag.objects.create(slug='duplikat')
        target = Tag.objects.create(slug='oryginal')
        exercise = make_exercise(make_branch(), 1)
        exercise.tags.add(source)
        self.assertEqual(self._post(source, merge_into='oryginal').status_code, 302)
        self.assertEqual(list(exercise.tags.all()), [target])
        source.refresh_from_db()
        self.assertTrue(source.is_removed)
