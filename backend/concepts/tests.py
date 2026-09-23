"""Concepts (CONCEPTS-BRIEF.md §8) — weighted at the refusals and at the resolution order.

The two things most likely to be wrong here, and therefore the two tested for their own sake rather
than as side effects of a happy path:

* **Visibility.** An article whose only revision is waiting must not exist for a stranger, and the
  queryset half and the object-level half must agree about that (house rule 4). `AccessAgreementTests`
  pins the two against each other rather than trusting they were written on the same day.
* **Resolution.** A reader asking for a band and a language they have no article in must be given
  something, told that it is not what they asked for, and never 404'd — `ResolutionTests` walks the
  whole fallback ladder and checks the two exactness flags at every rung.

Everything writes an `AuditEvent` into its own SQLite shard, so `databases` covers them.
"""

from __future__ import annotations

import io
import shutil
import tempfile

from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from activity.models import ActivityEvent
from chem.models import ChemDrawing
from concepts.blocks import clean_blocks, expand_blocks, mentioned_slugs, plain_text
from concepts.models import Concept, ConceptArticle, ConceptAsset, ConceptLink, ConceptRevision
from concepts.services import publish_revision
from moderation.models import FeatureFlag, NodeGovernor, Report
from notifications.models import Notification
from taxonomy.models import Branch
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_material, make_user


def png_bytes(width=40, height=30) -> bytes:
    buffer = io.BytesIO()
    Image.new('RGB', (width, height), (10, 90, 160)).save(buffer, format='PNG')
    return buffer.getvalue()


def pdf_bytes() -> bytes:
    return b'%PDF-1.4\n' + b'0' * 400


def md(body: str) -> dict:
    return {'kind': 'markdown', 'body': body}


class ConceptBase(APITestCase):
    """Real files are written by the asset tests, so every class writes into a temporary
    `MEDIA_ROOT` — the same per-class override `galleries/tests.py` records having added after the
    first version of that file left 85 stray WebPs in a developer's own `media/`."""

    databases = set(all_log_shards()) | {'default'}

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-concepts-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        # Throttle counters live in Django's cache, which persists for the WHOLE test process rather
        # than per test (`config/settings.py`'s own note on the trap; `events/tests.py` and
        # `booking/tests.py` clear it for the same reason). This suite creates a concept in almost
        # every test as the same handful of accounts, and the `concept_revision` scope is 30/hour —
        # without this, the thirty-first test anywhere in the file gets a 429 from `setUp` and
        # forty-odd tests fail on something that has nothing to do with what they are about. The
        # signature is the familiar "passes alone, fails in a full run".
        cache.clear()
        self.branch = make_branch('analiza')
        self.other_branch = make_branch('chemia')
        self.author = make_user('c-author')
        self.stranger = make_user('c-stranger')
        self.verified = make_user('c-verified', is_verified_contributor=True)
        self.staff = make_user('c-staff', is_staff=True)

    # --- helpers ---------------------------------------------------------------------------------

    def as_(self, user):
        self.client.force_authenticate(user)
        return self.client

    def create_concept(self, user, **overrides):
        payload = {
            'title': 'Pochodna',
            'summary': 'Tempo zmiany.',
            'blocks': [md('Pochodna mierzy tempo zmiany.')],
            'audience': 'university',
            'locale': 'pl',
            'branches': [self.branch.slug],
            'submit': True,
        }
        payload.update(overrides)
        return self.as_(user).post(reverse('concept-list'), payload, format='json')

    def published_concept(self, *, user=None, **overrides):
        """A concept with one published article — the ordinary starting point."""
        response = self.create_concept(user or self.verified, **overrides)
        assert response.status_code == status.HTTP_201_CREATED, response.data
        return Concept.objects.get(slug=response.data['slug'])

    def article_of(self, concept, **filters):
        return concept.articles.filter(**filters).first()

    def head_of(self, article):
        return article.revisions.filter(status='published').first()


# --- visibility ------------------------------------------------------------------------------------


class VisibilityTests(ConceptBase):
    def test_a_concept_whose_only_revision_is_waiting_does_not_exist_for_a_stranger(self):
        concept = self.published_concept(user=self.author)  # plain user → pending
        self.assertEqual(
            ConceptRevision.objects.get(article__concept=concept).status, 'pending'
        )

        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(reverse('concept-detail', args=[concept.slug])).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.as_(self.stranger)
        self.assertEqual(
            self.client.get(reverse('concept-detail', args=[concept.slug])).status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_its_own_author_can_still_reach_it(self):
        concept = self.published_concept(user=self.author)
        response = self.as_(self.author).get(reverse('concept-detail', args=[concept.slug]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['slug'], concept.slug)

    def test_a_waiting_concept_is_not_in_the_list(self):
        self.published_concept(user=self.author)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse('concept-list')).data, [])

    def test_a_published_one_is_public(self):
        concept = self.published_concept()
        self.client.force_authenticate(None)
        response = self.client.get(reverse('concept-detail', args=[concept.slug]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['page']['article']['head']['status'], 'published')


class AccessAgreementTests(ConceptBase):
    def test_the_queryset_filter_and_the_object_check_agree(self):
        """House rule 4's two halves must give the same answer for the same row — pinned against
        each other rather than trusted to have been written on the same day."""
        from concepts.access import can_view, visible_concepts

        self.published_concept(user=self.author)  # pending
        self.published_concept(user=self.verified, title='Granica')  # published

        for user in (None, self.stranger, self.author, self.staff):
            with self.subTest(user=getattr(user, 'username', 'anonymous')):
                by_filter = set(visible_concepts(user).values_list('pk', flat=True))
                by_check = {
                    concept.pk for concept in Concept.objects.all() if can_view(concept, user)
                }
                self.assertEqual(by_filter, by_check)


# --- the trust model ---------------------------------------------------------------------------------


class PublishingTests(ConceptBase):
    def test_a_verified_contributors_first_revision_is_published(self):
        response = self.create_concept(self.verified)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ConceptRevision.objects.get().status, 'published')

    def test_a_plain_users_first_revision_waits(self):
        response = self.create_concept(self.author)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ConceptRevision.objects.get().status, 'pending')

    def test_a_governor_of_the_branch_publishes_without_waiting(self):
        governor = make_user('c-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.branch.pk,
        )
        self.create_concept(governor)
        self.assertEqual(ConceptRevision.objects.get().status, 'published')

    def test_a_minor_verified_contributor_still_queues(self):
        """A rule about a person always reading what goes live, not a judgement about the work."""
        child = make_user('c-child', is_verified_contributor=True)
        child.profile.is_minor = True
        child.profile.save(update_fields=['is_minor'])

        self.create_concept(child)
        self.assertEqual(ConceptRevision.objects.get().status, 'pending')

    def test_exactly_one_published_revision_survives_two_accepts(self):
        concept = self.published_concept()
        article = self.article_of(concept)
        head = self.head_of(article)

        for index in range(2):
            response = self.as_(self.stranger).post(
                reverse('concept-article-revisions', args=[article.pk]),
                {
                    'title': f'Pochodna {index}',
                    'blocks': [md(f'Wersja {index}.')],
                    'based_on': head.pk,
                    'submit': False,
                },
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
            revision_id = response.data['id']
            self.as_(self.stranger).post(
                reverse('concept-revision-submit', args=[revision_id])
            )
            accept = self.as_(self.staff).post(
                reverse('concept-revision-decide', args=[revision_id]),
                {'decision': 'accept'},
                format='json',
            )
            self.assertEqual(accept.status_code, status.HTTP_200_OK, accept.data)
            head = self.head_of(article)
            # A second revision has to be written against the NEW head, which is the whole point.
            self.client.force_authenticate(None)

        self.assertEqual(
            ConceptRevision.objects.filter(article=article, status='published').count(), 1
        )
        self.assertEqual(
            ConceptRevision.objects.filter(article=article, status='superseded').count(), 2
        )


class ReviewCircleTests(ConceptBase):
    def setUp(self):
        super().setUp()
        self.concept = self.published_concept()
        self.article = self.article_of(self.concept)
        self.revision = self._propose(self.stranger)

    def _propose(self, user, **overrides):
        head = self.head_of(self.article)
        payload = {
            'title': 'Pochodna — poprawka',
            'blocks': [md('Poprawiona treść.')],
            'based_on': head.pk if head else None,
            'submit': True,
        }
        payload.update(overrides)
        response = self.as_(user).post(
            reverse('concept-article-revisions', args=[self.article.pk]), payload, format='json'
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        return ConceptRevision.objects.get(pk=response.data['id'])

    def test_the_articles_own_author_can_decide_a_strangers_revision(self):
        response = self.as_(self.verified).post(
            reverse('concept-revision-decide', args=[self.revision.pk]),
            {'decision': 'accept'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.status, 'published')

    def test_a_stranger_cannot(self):
        """404 rather than 403, and deliberately: a pending revision is visible to its author and
        to whoever may decide it and to nobody else (`access.can_view_revision`), so for an
        unrelated account it does not exist. House rule 4 — that is the honest answer as well as
        the safe one."""
        other = make_user('c-nobody')
        response = self.as_(other).post(
            reverse('concept-revision-decide', args=[self.revision.pk]),
            {'decision': 'accept'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_second_decision_is_a_conflict(self):
        self.as_(self.staff).post(
            reverse('concept-revision-decide', args=[self.revision.pk]),
            {'decision': 'accept'},
            format='json',
        )
        again = self.as_(self.staff).post(
            reverse('concept-revision-decide', args=[self.revision.pk]),
            {'decision': 'accept'},
            format='json',
        )
        self.assertEqual(again.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(again.data['detail'], 'already_decided')

    def test_a_rejection_needs_a_reason(self):
        bare = self.as_(self.staff).post(
            reverse('concept-revision-decide', args=[self.revision.pk]),
            {'decision': 'reject'},
            format='json',
        )
        self.assertEqual(bare.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(bare.data['detail'], 'note_required')

        with_note = self.as_(self.staff).post(
            reverse('concept-revision-decide', args=[self.revision.pk]),
            {'decision': 'reject', 'note': 'To jest już w innym akapicie.'},
            format='json',
        )
        self.assertEqual(with_note.status_code, status.HTTP_200_OK)
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.status, 'rejected')
        self.assertEqual(self.revision.review_note, 'To jest już w innym akapicie.')

    def test_the_author_takes_their_own_proposal_back(self):
        response = self.as_(self.stranger).post(
            reverse('concept-revision-withdraw', args=[self.revision.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.status, 'withdrawn')

    def test_nobody_else_can_withdraw_it(self):
        response = self.as_(self.staff).post(
            reverse('concept-revision-withdraw', args=[self.revision.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'not_yours')


class StaleAndDraftTests(ConceptBase):
    def setUp(self):
        super().setUp()
        self.concept = self.published_concept()
        self.article = self.article_of(self.concept)

    def _draft(self, user, based_on, **overrides):
        payload = {
            'title': 'Zmiana',
            'blocks': [md('Nowa treść.')],
            'based_on': based_on,
            'submit': False,
        }
        payload.update(overrides)
        return self.as_(user).post(
            reverse('concept-article-revisions', args=[self.article.pk]), payload, format='json'
        )

    def test_a_submit_against_an_old_head_is_refused_and_carries_the_new_one(self):
        old_head = self.head_of(self.article)
        stale = self._draft(self.stranger, old_head.pk)
        self.assertEqual(stale.status_code, status.HTTP_201_CREATED)

        # Somebody else's change lands first.
        other = self._draft(self.verified, old_head.pk)
        self.as_(self.verified).post(reverse('concept-revision-submit', args=[other.data['id']]))
        new_head = self.head_of(self.article)
        self.assertNotEqual(new_head.pk, old_head.pk)

        refused = self.as_(self.stranger).post(
            reverse('concept-revision-submit', args=[stale.data['id']])
        )
        self.assertEqual(refused.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(refused.data['detail'], 'stale')
        self.assertEqual(refused.data['head']['id'], new_head.pk)

    def test_a_second_open_draft_is_refused_and_hands_back_the_first(self):
        head = self.head_of(self.article)
        first = self._draft(self.stranger, head.pk)
        second = self._draft(self.stranger, head.pk)
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.data['detail'], 'draft_exists')
        self.assertEqual(second.data['draft']['id'], first.data['id'])

    def test_only_the_author_edits_or_deletes_a_draft(self):
        head = self.head_of(self.article)
        draft = self._draft(self.stranger, head.pk)
        url = reverse('concept-revision-detail', args=[draft.data['id']])

        self.assertEqual(
            self.as_(self.verified).patch(url, {'title': 'Cudza'}, format='json').status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.as_(self.stranger).patch(url, {'title': 'Moja'}, format='json').status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.as_(self.stranger).delete(url).status_code, status.HTTP_204_NO_CONTENT
        )
        self.assertFalse(ConceptRevision.objects.filter(pk=draft.data['id']).exists())

    def test_a_published_revision_cannot_be_edited_as_a_draft(self):
        head = self.head_of(self.article)
        response = self.as_(self.staff).patch(
            reverse('concept-revision-detail', args=[head.pk]), {'title': 'X'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], 'not_draft')


# --- pages, pools and resolution ------------------------------------------------------------------


class PoolTests(ConceptBase):
    def setUp(self):
        super().setUp()
        self.concept = self.published_concept(audience='secondary')
        self.first = self.article_of(self.concept, audience='secondary')
        self.second_author = make_user('c-second', is_verified_contributor=True)
        response = self.as_(self.second_author).post(
            reverse('concept-articles', args=[self.concept.slug]),
            {
                'audience': 'secondary',
                'locale': 'pl',
                'title': 'Pochodna inaczej',
                'blocks': [md('Inne ujęcie.')],
                'submit': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.second = ConceptArticle.objects.get(pk=response.data['id'])

    def _page(self, **params):
        self.client.force_authenticate(None)
        return self.client.get(
            reverse('concept-detail', args=[self.concept.slug]),
            {'audience': 'secondary', 'lang': 'pl', **params},
        ).data['page']

    def test_two_articles_share_one_page_and_the_newest_head_leads(self):
        page = self._page()
        self.assertEqual(len(page['articles']), 2)
        self.assertEqual(page['articles'][0]['id'], self.second.pk)
        self.assertEqual(page['article']['id'], self.second.pk)

    def test_a_pinned_article_leads_whatever_its_date(self):
        self.as_(self.staff).patch(
            reverse('concept-article-detail', args=[self.first.pk]),
            {'pinned': True},
            format='json',
        )
        page = self._page()
        self.assertEqual(page['articles'][0]['id'], self.first.pk)
        self.assertEqual(page['article']['id'], self.first.pk)

    def test_the_article_parameter_picks_the_other_one(self):
        page = self._page(article=self.first.pk)
        self.assertEqual(page['article']['id'], self.first.pk)

    def test_only_staff_and_governors_pin(self):
        response = self.as_(self.second_author).patch(
            reverse('concept-article-detail', args=[self.first.pk]),
            {'pinned': True},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class ResolutionTests(ConceptBase):
    """The fallback ladder (`resolve.resolve_page`) and the two flags that say how far down it we
    got — the pair that stops a reader being handed somebody else's page in silence."""

    def setUp(self):
        super().setUp()
        self.concept = self.published_concept(audience='university', locale='pl')
        self._add('secondary', 'en', 'Derivative for schools')

    def _add(self, audience, locale, title):
        response = self.as_(self.verified).post(
            reverse('concept-articles', args=[self.concept.slug]),
            {
                'audience': audience,
                'locale': locale,
                'title': title,
                'blocks': [md(title)],
                'submit': True,
            },
            format='json',
        )
        assert response.status_code == status.HTTP_201_CREATED, response.data
        return response

    def _resolve(self, **params):
        self.client.force_authenticate(None)
        return self.client.get(
            reverse('concept-detail', args=[self.concept.slug]), params
        ).data['page']

    def test_an_exact_band_and_language_is_exact(self):
        page = self._resolve(audience='university', lang='pl')
        self.assertEqual((page['audience'], page['locale']), ('university', 'pl'))
        self.assertTrue(page['audience_exact'])
        self.assertTrue(page['locale_exact'])

    def test_an_article_for_everyone_counts_as_exact(self):
        self._add('all', 'pl', 'Pochodna dla każdego')
        page = self._resolve(audience='early_years', lang='pl')
        self.assertEqual(page['audience'], 'all')
        self.assertTrue(page['audience_exact'])

    def test_the_nearest_band_in_the_right_language_beats_the_right_band_in_another(self):
        page = self._resolve(audience='secondary', lang='pl')
        self.assertEqual((page['audience'], page['locale']), ('university', 'pl'))
        self.assertFalse(page['audience_exact'])
        self.assertTrue(page['locale_exact'])

    def test_a_language_nobody_has_written_in_still_resolves(self):
        page = self._resolve(audience='university', lang='de')
        self.assertIsNotNone(page)
        self.assertFalse(page['locale_exact'])

    def test_a_detail_never_narrows_away_to_nothing(self):
        self.client.force_authenticate(None)
        response = self.client.get(
            reverse('concept-detail', args=[self.concept.slug]),
            {'audience': 'senior', 'content_locales': 'de'},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(response.data['page'])

    def test_every_page_is_listed_for_the_switcher(self):
        self.client.force_authenticate(None)
        pages = self.client.get(reverse('concept-detail', args=[self.concept.slug])).data['pages']
        self.assertEqual(
            {(p['audience'], p['locale']) for p in pages},
            {('university', 'pl'), ('secondary', 'en')},
        )


class ListTests(ConceptBase):
    def setUp(self):
        super().setUp()
        self.polish = self.published_concept(title='Pochodna', locale='pl')
        self.english = self.published_concept(title='Recursion', locale='en')

    def test_a_list_narrows_by_language_and_says_how_much_it_hid(self):
        self.client.force_authenticate(None)
        response = self.client.get(reverse('concept-list'), {'content_locales': 'pl'})
        self.assertEqual([row['slug'] for row in response.data], ['pochodna'])
        self.assertEqual(response['X-EdMat-Hidden-Languages'], '1')

    def test_without_a_language_filter_nothing_is_hidden(self):
        self.client.force_authenticate(None)
        response = self.client.get(reverse('concept-list'))
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response['X-EdMat-Hidden-Languages'], '0')

    def test_an_audience_filter_admits_an_article_for_everyone(self):
        self.as_(self.verified).post(
            reverse('concept-articles', args=[self.polish.slug]),
            {'audience': 'all', 'locale': 'pl', 'title': 'Dla każdego', 'blocks': [md('x')], 'submit': True},
            format='json',
        )
        self.client.force_authenticate(None)
        slugs = [
            row['slug']
            for row in self.client.get(reverse('concept-list'), {'audience': 'primary'}).data
        ]
        self.assertIn('pochodna', slugs)
        self.assertNotIn('recursion', slugs)

    def test_asking_for_everyone_is_not_a_filter(self):
        """`?audience=all` must widen, never narrow — a picker that must not be scoped to the
        reader's own band sends it, and `config/audience.py` already takes that posture for every
        other list."""
        self.client.force_authenticate(None)
        rows = self.client.get(reverse('concept-list'), {'audience': 'all'}).data
        self.assertEqual({row['slug'] for row in rows}, {'pochodna', 'recursion'})

    def test_a_search_finds_words_inside_a_markdown_block(self):
        self.as_(self.verified).post(
            reverse('concept-articles', args=[self.polish.slug]),
            {
                'audience': 'adult',
                'locale': 'pl',
                'title': 'Pochodna',
                'blocks': [md('Iloraz różnicowy jest tu kluczowy.')],
                'submit': True,
            },
            format='json',
        )
        self.client.force_authenticate(None)
        found = self.client.get(reverse('concept-list'), {'q': 'iloraz'}).data
        self.assertEqual([row['slug'] for row in found], ['pochodna'])

    def test_a_search_finds_a_formula_too(self):
        self.as_(self.verified).post(
            reverse('concept-articles', args=[self.polish.slug]),
            {
                'audience': 'adult',
                'locale': 'pl',
                'title': 'Pochodna',
                'blocks': [{'kind': 'latex', 'source': '\\nabla \\cdot F'}],
                'submit': True,
            },
            format='json',
        )
        self.client.force_authenticate(None)
        found = self.client.get(reverse('concept-list'), {'q': 'nabla'}).data
        self.assertEqual([row['slug'] for row in found], ['pochodna'])


# --- blocks ---------------------------------------------------------------------------------------


class BlockTests(ConceptBase):
    def test_an_unknown_kind_is_refused(self):
        with self.assertRaises(Exception) as caught:
            clean_blocks([{'kind': 'video', 'src': 'x'}])
        self.assertIn('blocks', str(caught.exception))

    def test_an_over_long_paragraph_is_refused(self):
        from django.core.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            clean_blocks([md('x' * 100_001)])

    def test_a_script_in_a_paragraph_does_not_survive(self):
        cleaned = clean_blocks([md('Hello <script>alert(1)</script> world')])
        self.assertNotIn('<script', cleaned[0]['body'])
        self.assertIn('Hello', cleaned[0]['body'])

    def test_a_missing_asset_is_refused(self):
        from django.core.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            clean_blocks([{'kind': 'image', 'asset_id': 999999, 'alt': 'x'}])

    def test_an_image_asset_in_a_pdf_block_is_refused(self):
        from django.core.exceptions import ValidationError

        asset = ConceptAsset.objects.create(
            uploaded_by=self.author, kind='image', file='concept-assets/x.webp', size_bytes=10
        )
        with self.assertRaises(ValidationError):
            clean_blocks([{'kind': 'pdf', 'asset_id': asset.pk}])

    def test_unknown_keys_are_dropped(self):
        cleaned = clean_blocks([{'kind': 'markdown', 'body': 'hi', 'evil': '<x>'}])
        self.assertEqual(cleaned, [{'kind': 'markdown', 'body': 'hi'}])

    def test_plain_text_gathers_bodies_formulas_and_captions(self):
        text = plain_text(
            [md('<p>Tekst</p>'), {'kind': 'latex', 'source': 'x^2'}, {'kind': 'image', 'asset_id': 1, 'alt': 'Rysunek'}]
        )
        self.assertIn('Tekst', text)
        self.assertIn('x^2', text)
        self.assertIn('Rysunek', text)
        self.assertNotIn('<p>', text)

    def test_mentions_are_read_from_paragraphs_only(self):
        self.assertEqual(
            mentioned_slugs([md('see [[granica]] and [[calka|całki]]'), {'kind': 'latex', 'source': '[[nope]]'}]),
            {'granica', 'calka'},
        )

    def test_expanding_any_number_of_blocks_costs_two_queries(self):
        drawing = ChemDrawing.objects.create(
            author=self.author,
            source_format='ket',
            source='{}',
            image='chem/x.svg',
            image_kind='svg',
            width=10,
            height=10,
        )
        asset = ConceptAsset.objects.create(
            uploaded_by=self.author, kind='image', file='concept-assets/x.webp', size_bytes=10
        )
        blocks = []
        for _ in range(20):
            blocks.append({'kind': 'chem', 'drawing_id': drawing.pk, 'caption': ''})
            blocks.append({'kind': 'image', 'asset_id': asset.pk, 'alt': '', 'caption': ''})

        with self.assertNumQueries(2):
            expanded = expand_blocks(blocks)
        self.assertEqual(expanded[0]['drawing']['id'], drawing.pk)
        self.assertEqual(expanded[1]['asset']['id'], asset.pk)

    def test_a_reference_that_no_longer_resolves_becomes_none_rather_than_disappearing(self):
        expanded = expand_blocks([{'kind': 'image', 'asset_id': 424242, 'alt': '', 'caption': ''}])
        self.assertEqual(len(expanded), 1)
        self.assertIsNone(expanded[0]['asset'])


class AssetTests(ConceptBase):
    def test_a_png_is_re_encoded_to_webp(self):
        response = self.as_(self.author).post(
            reverse('concept-asset-list'),
            {'file': SimpleUploadedFile('a.png', png_bytes(), content_type='image/png')},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['kind'], 'image')
        self.assertTrue(response.data['url'].endswith('.webp'))
        asset = ConceptAsset.objects.get()
        asset.file.open('rb')
        self.assertEqual(asset.file.read(4)[:4], b'RIFF')
        asset.file.close()

    def test_a_windows_executable_called_a_pdf_is_refused(self):
        payload = b'MZ\x90\x00' + b'\x00' * 500
        response = self.as_(self.author).post(
            reverse('concept-asset-list'),
            {'file': SimpleUploadedFile('x.pdf', payload, content_type='application/pdf')},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(ConceptAsset.objects.exists())

    def test_a_real_pdf_is_accepted(self):
        response = self.as_(self.author).post(
            reverse('concept-asset-list'),
            {'file': SimpleUploadedFile('n.pdf', pdf_bytes(), content_type='application/pdf')},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['kind'], 'pdf')

    def test_an_asset_counts_against_the_shared_upload_allowance(self):
        from community.attachments import used_upload_bytes

        before = used_upload_bytes(self.author)
        self.as_(self.author).post(
            reverse('concept-asset-list'),
            {'file': SimpleUploadedFile('a.png', png_bytes(), content_type='image/png')},
            format='multipart',
        )
        after = used_upload_bytes(self.author)
        self.assertGreater(after, before)
        self.assertEqual(after - before, ConceptAsset.objects.get().size_bytes)

    def test_an_upload_past_the_allowance_is_refused(self):
        profile = self.author.profile
        profile.material_upload_quota_bytes = 10
        profile.save(update_fields=['material_upload_quota_bytes'])
        response = self.as_(self.author).post(
            reverse('concept-asset-list'),
            {'file': SimpleUploadedFile('a.png', png_bytes(400, 400), content_type='image/png')},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'quota')


# --- links ---------------------------------------------------------------------------------------


class LinkTests(ConceptBase):
    def setUp(self):
        super().setUp()
        self.concept = self.published_concept()
        self.other = self.published_concept(title='Granica')
        self.exercise = make_exercise(self.branch, 1)
        self.exercise.published = True
        self.exercise.save(update_fields=['published'])
        self.material = make_material(self.branch)
        self.material.published = True
        self.material.save(update_fields=['published'])

    def _add(self, user, **payload):
        return self.as_(user).post(
            reverse('concept-links', args=[self.concept.slug]), payload, format='json'
        )

    def test_anybody_signed_in_can_link_an_exercise(self):
        response = self._add(self.stranger, target_type='exercise', target_id=self.exercise.pk)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data['target_type'], 'exercise')
        self.assertEqual(response.data['origin'], 'manual')

    def test_a_guest_cannot(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            reverse('concept-links', args=[self.concept.slug]),
            {'target_type': 'exercise', 'target_id': self.exercise.pk},
            format='json',
        )
        self.assertIn(
            response.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)
        )

    def test_a_minor_cannot(self):
        child = make_user('c-minor')
        child.profile.is_minor = True
        child.profile.save(update_fields=['is_minor'])
        response = self._add(child, target_type='exercise', target_id=self.exercise.pk)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'minor')

    def test_a_concept_cannot_link_to_itself(self):
        response = self._add(self.stranger, target_type='concept', target_id=self.concept.pk)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'self')

    def test_only_a_concept_can_be_a_prerequisite(self):
        response = self._add(
            self.stranger,
            target_type='exercise',
            target_id=self.exercise.pk,
            relation='prerequisite',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'relation')

        good = self._add(
            self.stranger, target_type='concept', target_id=self.other.pk, relation='prerequisite'
        )
        self.assertEqual(good.status_code, status.HTTP_201_CREATED)

    def test_a_duplicate_is_a_conflict(self):
        self._add(self.stranger, target_type='exercise', target_id=self.exercise.pk)
        again = self._add(self.verified, target_type='exercise', target_id=self.exercise.pk)
        self.assertEqual(again.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(again.data['detail'], 'already_linked')

    def test_an_unknown_target_is_not_found(self):
        self.assertEqual(
            self._add(self.stranger, target_type='unicorn', target_id=1).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self._add(self.stranger, target_type='exercise', target_id=999999).status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_the_adder_staff_and_a_governor_can_unlink_and_a_stranger_cannot(self):
        link_id = self._add(
            self.stranger, target_type='exercise', target_id=self.exercise.pk
        ).data['id']
        url = reverse('concept-link-detail', args=[link_id])

        nobody = make_user('c-outsider')
        self.assertEqual(self.as_(nobody).delete(url).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.as_(self.stranger).delete(url).status_code, status.HTTP_204_NO_CONTENT)

        second = self._add(self.stranger, target_type='material', target_id=self.material.pk)
        self.assertEqual(
            self.as_(self.staff).delete(
                reverse('concept-link-detail', args=[second.data['id']])
            ).status_code,
            status.HTTP_204_NO_CONTENT,
        )

        governor = make_user('c-link-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.branch.pk,
        )
        third = self._add(self.stranger, target_type='exercise', target_id=self.exercise.pk)
        self.assertEqual(
            self.as_(governor).delete(
                reverse('concept-link-detail', args=[third.data['id']])
            ).status_code,
            status.HTTP_204_NO_CONTENT,
        )

    def test_the_chip_row_for_an_exercise_lists_only_visible_concepts(self):
        self._add(self.stranger, target_type='exercise', target_id=self.exercise.pk)
        waiting = self.published_concept(user=self.author, title='Niewidoczne')
        ConceptLink.objects.create(
            concept=waiting,
            content_type=ContentType.objects.get_for_model(type(self.exercise)),
            object_id=self.exercise.pk,
        )

        self.client.force_authenticate(None)
        rows = self.client.get(
            reverse('concept-link-list'), {'target_type': 'exercise', 'target_id': self.exercise.pk}
        ).data
        self.assertEqual([row['slug'] for row in rows], [self.concept.slug])


class BodyLinkTests(ConceptBase):
    def setUp(self):
        super().setUp()
        self.target = self.published_concept(title='Granica')
        self.concept = self.published_concept(
            title='Pochodna', blocks=[md('Zobacz [[granica]].')]
        )

    def test_a_mention_becomes_a_link_on_publish(self):
        link = ConceptLink.objects.get(concept=self.concept)
        self.assertEqual(link.origin, 'body')
        self.assertEqual(link.target, self.target)

    def test_it_shows_as_a_backlink_on_the_concept_it_points_at(self):
        self.client.force_authenticate(None)
        backlinks = self.client.get(
            reverse('concept-detail', args=[self.target.slug])
        ).data['backlinks']
        self.assertEqual([row['slug'] for row in backlinks], [self.concept.slug])

    def test_removing_the_mention_removes_the_link(self):
        article = self.article_of(self.concept)
        head = self.head_of(article)
        response = self.as_(self.verified).post(
            reverse('concept-article-revisions', args=[article.pk]),
            {
                'title': 'Pochodna',
                'blocks': [md('Bez odnośnika.')],
                'based_on': head.pk,
                'submit': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertFalse(ConceptLink.objects.filter(concept=self.concept, origin='body').exists())

    def test_a_manual_link_is_untouched_by_the_harvest(self):
        exercise = make_exercise(self.branch, 7)
        exercise.published = True
        exercise.save(update_fields=['published'])
        self.as_(self.stranger).post(
            reverse('concept-links', args=[self.concept.slug]),
            {'target_type': 'exercise', 'target_id': exercise.pk},
            format='json',
        )
        article = self.article_of(self.concept)
        head = self.head_of(article)
        self.as_(self.verified).post(
            reverse('concept-article-revisions', args=[article.pk]),
            {'title': 'Pochodna', 'blocks': [md('Bez odnośnika.')], 'based_on': head.pk, 'submit': True},
            format='json',
        )
        self.assertTrue(
            ConceptLink.objects.filter(concept=self.concept, origin='manual').exists()
        )

    def test_a_body_link_cannot_be_removed_by_hand(self):
        link = ConceptLink.objects.get(concept=self.concept, origin='body')
        response = self.as_(self.staff).delete(reverse('concept-link-detail', args=[link.pk]))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'body_origin')

    def test_a_mention_of_a_concept_nobody_can_see_yet_is_not_harvested(self):
        self.published_concept(user=self.author, title='Nieopublikowane')
        article = self.article_of(self.concept)
        head = self.head_of(article)
        self.as_(self.verified).post(
            reverse('concept-article-revisions', args=[article.pk]),
            {
                'title': 'Pochodna',
                'blocks': [md('Zobacz [[nieopublikowane]].')],
                'based_on': head.pk,
                'submit': True,
            },
            format='json',
        )
        self.assertFalse(ConceptLink.objects.filter(concept=self.concept, origin='body').exists())


# --- the queue, notifications, the feed, reports and the kill switch --------------------------------


class QueueTests(ConceptBase):
    def setUp(self):
        super().setUp()
        self.concept = self.published_concept(user=self.author)  # pending revision 1
        self.branchless = Concept.objects.create(slug='bez-galezi', created_by=self.author)
        article = ConceptArticle.objects.create(
            concept=self.branchless, audience='university', locale='pl', created_by=self.author
        )
        ConceptRevision.objects.create(
            article=article, number=1, status='pending', title='Sierota', created_by=self.author
        )

    def test_staff_see_every_pending_revision(self):
        from moderation.services import build_moderation_queue_payload, count_pending_moderation

        payload = build_moderation_queue_payload(user=self.staff)
        self.assertEqual(len(payload['concept_revisions']), 2)
        self.assertEqual(count_pending_moderation(user=self.staff)['concept_revisions'], 2)

    def test_a_governor_sees_only_their_own_branch_and_never_a_branchless_concept(self):
        from moderation.services import build_moderation_queue_payload, count_pending_moderation

        governor = make_user('c-queue-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.branch.pk,
        )
        payload = build_moderation_queue_payload(user=governor)
        self.assertEqual(
            [row['slug'] for row in payload['concept_revisions']], [self.concept.slug]
        )
        self.assertEqual(count_pending_moderation(user=governor)['concept_revisions'], 1)

    def test_a_governor_of_another_branch_sees_none_of_it(self):
        from moderation.services import build_moderation_queue_payload

        governor = make_user('c-other-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.other_branch.pk,
        )
        self.assertEqual(
            build_moderation_queue_payload(user=governor)['concept_revisions'], []
        )

    def test_a_queue_row_says_what_it_is_and_what_it_would_replace(self):
        from moderation.services import build_moderation_queue_payload

        row = next(
            r
            for r in build_moderation_queue_payload(user=self.staff)['concept_revisions']
            if r['slug'] == self.concept.slug
        )
        self.assertTrue(row['is_new_concept'])
        self.assertTrue(row['is_new_article'])
        self.assertIsNone(row['current'])
        self.assertEqual(row['branch_ids'], [self.branch.slug])


class NotificationTests(ConceptBase):
    def test_the_articles_author_is_told_a_revision_arrived(self):
        concept = self.published_concept()
        article = self.article_of(concept)
        head = self.head_of(article)
        Notification.objects.all().delete()

        self.as_(self.stranger).post(
            reverse('concept-article-revisions', args=[article.pk]),
            {'title': 'Poprawka', 'blocks': [md('x')], 'based_on': head.pk, 'submit': True},
            format='json',
        )
        row = Notification.objects.get(type='concept_revision_pending')
        self.assertEqual(row.recipient, self.verified)
        self.assertEqual(row.concept, concept)

        # The SLUG rides on the serialized row, because `/concepts/[slug]` is the route and a
        # numeric pk cannot be turned into one client-side.
        inbox = self.as_(self.verified).get(reverse('notification-list')).data
        pending = next(r for r in inbox if r['type'] == 'concept_revision_pending')
        self.assertEqual(pending['concept_slug'], concept.slug)

    def test_the_author_of_a_revision_is_told_the_decision(self):
        concept = self.published_concept()
        article = self.article_of(concept)
        head = self.head_of(article)
        revision_id = self.as_(self.stranger).post(
            reverse('concept-article-revisions', args=[article.pk]),
            {'title': 'Poprawka', 'blocks': [md('x')], 'based_on': head.pk, 'submit': True},
            format='json',
        ).data['id']
        Notification.objects.all().delete()

        self.as_(self.staff).post(
            reverse('concept-revision-decide', args=[revision_id]),
            {'decision': 'reject', 'note': 'Nie tym razem.'},
            format='json',
        )
        row = Notification.objects.get(type='concept_revision_decided')
        self.assertEqual(row.recipient, self.stranger)
        self.assertEqual(row.note, 'Nie tym razem.')

    def test_a_muted_category_means_no_row_is_created_at_all(self):
        profile = self.verified.profile
        profile.notify_on_content_action = False
        profile.save(update_fields=['notify_on_content_action'])

        concept = self.published_concept()
        article = self.article_of(concept)
        head = self.head_of(article)
        Notification.objects.all().delete()
        self.as_(self.stranger).post(
            reverse('concept-article-revisions', args=[article.pk]),
            {'title': 'Poprawka', 'blocks': [md('x')], 'based_on': head.pk, 'submit': True},
            format='json',
        )
        self.assertFalse(Notification.objects.filter(type='concept_revision_pending').exists())

    def test_everybody_who_wrote_part_of_an_article_hears_it_was_republished(self):
        concept = self.published_concept()
        article = self.article_of(concept)
        head = self.head_of(article)
        Notification.objects.all().delete()

        self.as_(self.staff).post(
            reverse('concept-article-revisions', args=[article.pk]),
            {'title': 'Nowa', 'blocks': [md('x')], 'based_on': head.pk, 'submit': True},
            format='json',
        )
        rows = Notification.objects.filter(type='concept_revision_published')
        self.assertEqual([row.recipient for row in rows], [self.verified])


class FeedTests(ConceptBase):
    def test_the_first_publication_announces_the_concept_and_a_later_one_the_revision(self):
        ActivityEvent.objects.all().delete()
        concept = self.published_concept()
        self.assertEqual(
            list(ActivityEvent.objects.values_list('kind', flat=True)), ['concept']
        )

        article = self.article_of(concept)
        head = self.head_of(article)
        self.as_(self.verified).post(
            reverse('concept-article-revisions', args=[article.pk]),
            {'title': 'Nowa', 'blocks': [md('x')], 'based_on': head.pk, 'submit': True},
            format='json',
        )
        self.assertEqual(
            set(ActivityEvent.objects.values_list('kind', flat=True)),
            {'concept', 'concept_revision'},
        )
        self.assertEqual(ActivityEvent.objects.filter(kind='concept_revision').first().concept, concept)

        self.client.force_authenticate(None)
        feed = self.client.get(reverse('activity-feed')).data
        rows = feed['events'] if isinstance(feed, dict) else feed
        concept_rows = [row for row in rows if row['kind'] in ('concept', 'concept_revision')]
        self.assertTrue(concept_rows)
        self.assertTrue(all(row['concept_slug'] == concept.slug for row in concept_rows))

    def test_a_second_article_of_the_same_concept_does_not_re_announce_the_concept(self):
        concept = self.published_concept()
        ActivityEvent.objects.all().delete()
        self.as_(self.verified).post(
            reverse('concept-articles', args=[concept.slug]),
            {'audience': 'primary', 'locale': 'pl', 'title': 'Dla dzieci', 'blocks': [md('x')], 'submit': True},
            format='json',
        )
        self.assertEqual(
            list(ActivityEvent.objects.values_list('kind', flat=True)), ['concept_revision']
        )

    def test_a_draft_produces_no_feed_row(self):
        ActivityEvent.objects.all().delete()
        self.create_concept(self.verified, submit=False)
        self.assertFalse(ActivityEvent.objects.exists())

    def test_a_queued_revision_produces_no_feed_row(self):
        ActivityEvent.objects.all().delete()
        self.create_concept(self.author, submit=True)
        self.assertFalse(ActivityEvent.objects.exists())


class ReportTests(ConceptBase):
    def test_removing_the_only_article_takes_the_concept_and_its_backlinks_with_it(self):
        from moderation.services import resolve_report_decision

        target = self.published_concept(title='Granica')
        concept = self.published_concept(title='Pochodna', blocks=[md('Zobacz [[granica]].')])
        self.assertTrue(ConceptLink.objects.filter(concept=concept, origin='body').exists())

        article = self.article_of(concept)
        resolve_report_decision(
            ConceptArticle, article.pk, 'remove', resolved_by=self.staff, note='Nie na temat.'
        )
        article.refresh_from_db()
        self.assertTrue(article.is_removed)

        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(reverse('concept-detail', args=[concept.slug])).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        backlinks = self.client.get(
            reverse('concept-detail', args=[target.slug])
        ).data['backlinks']
        self.assertEqual(backlinks, [])

    def test_a_report_can_be_filed_against_an_article(self):
        concept = self.published_concept()
        article = self.article_of(concept)
        response = self.as_(self.stranger).post(
            reverse('report-list'),
            {'kind': 'concept_article', 'object_id': article.pk, 'reason': 'Nieprawda.'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(Report.objects.count(), 1)

    def test_the_queue_describes_a_reported_article_by_its_real_title(self):
        from moderation.services import build_report_queue

        concept = self.published_concept()
        article = self.article_of(concept)
        self.as_(self.stranger).post(
            reverse('report-list'),
            {'kind': 'concept_article', 'object_id': article.pk, 'reason': 'x'},
            format='json',
        )
        row = build_report_queue()[0]
        self.assertEqual(row['kind'], 'concept_article')
        self.assertIn('Pochodna', row['preview'])
        self.assertIsNone(row['view_count'])


class TaggingTests(ConceptBase):
    def test_a_tag_can_be_applied_to_a_concept(self):
        concept = self.published_concept()
        from exercises.models import Tag

        tag = Tag.objects.create(slug='analiza')
        response = self.as_(self.stranger).post(
            reverse('tag-apply', args=[tag.slug]),
            {'kind': 'concept', 'object_id': concept.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual([t.slug for t in concept.tags.all()], ['analiza'])

    def test_a_concept_nobody_can_see_is_not_taggable(self):
        concept = self.published_concept(user=self.author)
        from exercises.models import Tag

        tag = Tag.objects.create(slug='analiza')
        response = self.as_(self.stranger).post(
            reverse('tag-apply', args=[tag.slug]),
            {'kind': 'concept', 'object_id': concept.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class KillSwitchTests(ConceptBase):
    def setUp(self):
        super().setUp()
        self.concept = self.published_concept()
        self.exercise = make_exercise(self.branch, 1)
        self.exercise.published = True
        self.exercise.save(update_fields=['published'])
        self.as_(self.stranger).post(
            reverse('concept-links', args=[self.concept.slug]),
            {'target_type': 'exercise', 'target_id': self.exercise.pk},
            format='json',
        )
        FeatureFlag.objects.update_or_create(key='concepts', defaults={'is_enabled': False})

    def test_the_whole_surface_closes(self):
        # A signed-in ordinary account, because that is the answer the gate itself gives: an
        # ANONYMOUS caller refused by any permission gets 401 rather than 403, since
        # `TokenAuthentication` supplies a `WWW-Authenticate` header and DRF then reads the refusal
        # as "you did not say who you are". Either way the surface is closed; 403 is the one worth
        # pinning, because it is the refusal a real reader with an account sees.
        self.as_(self.stranger)
        self.assertEqual(
            self.client.get(reverse('concept-list')).status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(
            self.client.get(reverse('concept-detail', args=[self.concept.slug])).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.client.force_authenticate(None)
        self.assertEqual(
            self.client.get(reverse('concept-list')).status_code, status.HTTP_401_UNAUTHORIZED
        )

    def test_the_chip_row_answers_with_nothing_rather_than_a_refusal(self):
        """House rule 3's other half: a neighbouring page must keep working while returning nothing
        for the killed feature, instead of failing somewhere less useful."""
        self.client.force_authenticate(None)
        response = self.client.get(
            reverse('concept-link-list'), {'target_type': 'exercise', 'target_id': self.exercise.pk}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_a_moderator_still_gets_through(self):
        self.assertEqual(
            self.as_(self.staff).get(reverse('concept-list')).status_code, status.HTTP_200_OK
        )


class MetadataTests(ConceptBase):
    def test_the_creator_may_move_branches_only_while_nothing_is_published(self):
        response = self.create_concept(self.author)  # pending
        concept = Concept.objects.get(slug=response.data['slug'])
        url = reverse('concept-detail', args=[concept.slug])

        ok = self.as_(self.author).patch(url, {'branches': [self.other_branch.slug]}, format='json')
        self.assertEqual(ok.status_code, status.HTTP_200_OK)
        self.assertEqual([b.slug for b in concept.branches.all()], [self.other_branch.slug])

        revision = ConceptRevision.objects.get(article__concept=concept)
        publish_revision(revision, self.staff)
        refused = self.as_(self.author).patch(url, {'branches': [self.branch.slug]}, format='json')
        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_may_always(self):
        concept = self.published_concept()
        response = self.as_(self.staff).patch(
            reverse('concept-detail', args=[concept.slug]),
            {'branches': [self.other_branch.slug]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class CommentTests(ConceptBase):
    def test_an_article_carries_its_own_public_thread(self):
        concept = self.published_concept()
        article = self.article_of(concept)
        url = reverse('concept-article-comments', args=[article.pk])

        posted = self.as_(self.stranger).post(url, {'body': 'Świetny artykuł.'}, format='json')
        self.assertEqual(posted.status_code, status.HTTP_201_CREATED, posted.data)

        self.client.force_authenticate(None)
        thread = self.client.get(url)
        self.assertEqual(len(thread.data), 1)

    def test_the_target_type_is_the_one_both_halves_know(self):
        from community.targets import PRIVATE_TARGET_TYPES, TARGET_TYPE_BY_MODEL

        self.assertEqual(
            TARGET_TYPE_BY_MODEL[('concepts', 'conceptarticle')], 'conceptArticle'
        )
        self.assertNotIn('conceptArticle', PRIVATE_TARGET_TYPES)


class SeedCommandTests(ConceptBase):
    def test_seeding_twice_changes_nothing_the_second_time(self):
        from django.core.management import call_command

        exercise = make_exercise(self.branch, 1)
        exercise.published = True
        exercise.save(update_fields=['published'])
        material = make_material(self.branch)
        material.published = True
        material.save(update_fields=['published'])

        call_command('seed_concepts', verbosity=0)
        first = Concept.objects.count()
        self.assertGreater(first, 0)

        call_command('seed_concepts', verbosity=0)
        self.assertEqual(Concept.objects.count(), first)

    def test_the_seed_uses_every_block_kind(self):
        from django.core.management import call_command

        call_command('seed_concepts', verbosity=0)
        kinds = set()
        for revision in ConceptRevision.objects.filter(status='published'):
            kinds |= {block['kind'] for block in revision.blocks}
        self.assertEqual(kinds, {'markdown', 'latex', 'chem', 'pdf', 'image'})
