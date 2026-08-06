from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from testing.factories import make_branch, make_topic

from taxonomy.models import (
    Branch,
    BranchTranslation,
    Discipline,
    DisciplineTranslation,
    Topic,
)


class DisciplineListTests(APITestCase):
    def test_only_published_disciplines_are_listed(self):
        published = Discipline.objects.create(slug='matematyka', published=True)
        DisciplineTranslation.objects.create(
            discipline=published, locale='pl', name='Matematyka'
        )
        Discipline.objects.create(slug='chemia', published=False)

        response = self.client.get(reverse('discipline-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'matematyka'})

    def test_discipline_branches_lists_only_published_branches_in_that_discipline(self):
        discipline = Discipline.objects.create(slug='matematyka', published=True)
        DisciplineTranslation.objects.create(
            discipline=discipline, locale='pl', name='Matematyka'
        )
        published = Branch.objects.create(
            slug='published-branch', discipline=discipline, published=True
        )
        BranchTranslation.objects.create(branch=published, locale='pl', name='Published')
        Branch.objects.create(slug='unpublished-branch', discipline=discipline, published=False)

        response = self.client.get(
            reverse('discipline-branches', kwargs={'slug': discipline.slug})
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = {row['slug'] for row in response.data}
        self.assertEqual(slugs, {'published-branch'})


class BranchDetailTests(APITestCase):
    def test_branch_detail_includes_its_own_topics(self):
        branch = make_branch()
        make_topic(branch, slug='topic-a')
        make_topic(branch, slug='topic-b')

        response = self.client.get(reverse('branch-detail', kwargs={'slug': branch.slug}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        topic_slugs = {t['slug'] for t in response.data['topics']}
        self.assertEqual(topic_slugs, {'topic-a', 'topic-b'})

    def test_an_unpublished_branch_404s(self):
        discipline = Discipline.objects.create(slug='matematyka', published=True)
        Branch.objects.create(slug='draft-branch', discipline=discipline, published=False)

        response = self.client.get(reverse('branch-detail', kwargs={'slug': 'draft-branch'}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class BranchLocaleTests(APITestCase):
    """The reason `?lang=` exists at all: a branch's name must follow the reader's language, and a
    missing translation must fall back to the original rather than to whatever locale happens to
    sort first. Before the taxonomy service started sending `lang`, the backend defaulted to 'en'
    and a single English row made every reader see English."""

    def setUp(self):
        self.discipline = Discipline.objects.create(slug='matematyka', published=True)
        DisciplineTranslation.objects.create(
            discipline=self.discipline, locale='pl', name='Matematyka'
        )
        DisciplineTranslation.objects.create(
            discipline=self.discipline, locale='en', name='Mathematics'
        )

    def test_the_requested_locale_wins(self):
        response = self.client.get(reverse('discipline-list'), {'lang': 'en'})
        self.assertEqual(response.data[0]['name'], 'Mathematics')

        response = self.client.get(reverse('discipline-list'), {'lang': 'pl'})
        self.assertEqual(response.data[0]['name'], 'Matematyka')

    def test_an_unknown_locale_falls_back_to_the_original_not_to_english(self):
        response = self.client.get(reverse('discipline-list'), {'lang': 'de'})
        self.assertEqual(response.data[0]['name'], 'Matematyka')

    def test_no_lang_at_all_falls_back_to_the_original_not_to_english(self):
        response = self.client.get(reverse('discipline-list'))
        self.assertEqual(response.data[0]['name'], 'Matematyka')


class ProposeTaxonomyTests(APITestCase):
    """Anybody signed in may suggest a discipline, branch or topic.

    The two properties that matter: a moderator's own proposal is live immediately, and everybody
    else's is live but marked pending — real and referenceable rather than parked in a side table,
    because a word you cannot use until somebody wakes up is no use to the person who needed it.
    """

    def setUp(self):
        self.user = User.objects.create_user('student', password='pw')
        self.moderator = User.objects.create_user('mod', password='pw', is_staff=True)
        self.discipline = Discipline.objects.create(slug='matematyka')
        DisciplineTranslation.objects.create(
            discipline=self.discipline, locale='pl', name='Matematyka'
        )
        self.branch = Branch.objects.create(slug='analiza', discipline=self.discipline)

    def _propose(self, who, payload):
        client = APIClient()
        client.force_authenticate(who)
        return client.post(reverse('taxonomy-propose'), payload, format='json')

    def test_an_ordinary_user_proposal_is_pending_but_already_real(self):
        res = self._propose(
            self.user, {'kind': 'topic', 'name': 'Teoria miary', 'parent': self.branch.slug}
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['status'], 'pending')

        topic = Topic.objects.get(slug='teoria-miary')
        self.assertEqual(topic.branch, self.branch, 'it exists and is filable against right away')
        self.assertEqual(topic.proposed_by, self.user)

    def test_a_moderators_own_proposal_is_approved_on_the_spot(self):
        res = self._propose(
            self.moderator, {'kind': 'topic', 'name': 'Miara Haara', 'parent': self.branch.slug}
        )
        self.assertEqual(res.data['status'], 'approved')

    def test_the_name_is_stored_as_a_translation_not_a_bare_field(self):
        """Otherwise it would be the one node in the taxonomy nobody could ever translate."""
        self._propose(self.user, {'kind': 'discipline', 'name': 'Chemia'})
        node = Discipline.objects.get(slug='chemia')
        self.assertEqual(node.translations.get(locale='pl').name, 'Chemia')

    def test_a_duplicate_is_refused_rather_than_raising(self):
        res = self._propose(self.user, {'kind': 'discipline', 'name': 'Matematyka'})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_unknown_parent_is_refused(self):
        res = self._propose(self.user, {'kind': 'topic', 'name': 'x', 'parent': 'nope'})
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_proposing_needs_an_account(self):
        res = APIClient().post(
            reverse('taxonomy-propose'), {'kind': 'discipline', 'name': 'x'}, format='json'
        )
        self.assertIn(res.status_code, (401, 403))

    def test_the_status_is_on_the_wire_so_the_ui_can_group_pending_ones(self):
        self._propose(self.user, {'kind': 'discipline', 'name': 'Chemia'})
        rows = self.client.get(reverse('discipline-list')).data
        by_slug = {r['slug']: r['status'] for r in rows}
        self.assertEqual(by_slug['chemia'], 'pending')
        self.assertEqual(by_slug['matematyka'], 'approved')


class TaxonomyModerationTests(APITestCase):
    """Deciding on a proposal, from /moderation."""

    def setUp(self):
        self.user = User.objects.create_user('student', password='pw')
        self.moderator = User.objects.create_user('mod', password='pw', is_staff=True)
        self.discipline = Discipline.objects.create(slug='matematyka')
        DisciplineTranslation.objects.create(
            discipline=self.discipline, locale='pl', name='Matematyka'
        )
        self.pending = Discipline.objects.create(
            slug='chemia', status='pending', proposed_by=self.user
        )
        DisciplineTranslation.objects.create(
            discipline=self.pending, locale='pl', name='Chemia'
        )

    def _as(self, who):
        client = APIClient()
        client.force_authenticate(who)
        return client

    def _act(self, decision, who=None):
        return self._as(who or self.moderator).post(
            reverse(
                'moderation-taxonomy-action',
                kwargs={'kind': 'discipline', 'pk': self.pending.pk},
            ),
            {'decision': decision},
            format='json',
        )

    def test_the_queue_lists_pending_nodes_with_their_name_and_place(self):
        payload = self._as(self.moderator).get(reverse('moderation-queue')).data
        rows = payload['taxonomy_proposals']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['kind'], 'discipline')
        self.assertEqual(rows[0]['name'], 'Chemia')
        self.assertEqual(rows[0]['proposed_by'], self.user.pk)

    def test_approving_flips_the_status_and_moves_nothing(self):
        self.assertEqual(self._act('approve').status_code, 200)
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, 'approved')

    def test_rejecting_deletes_it(self):
        self.assertEqual(self._act('reject').status_code, 200)
        self.assertFalse(Discipline.objects.filter(slug='chemia').exists())

    def test_an_ordinary_user_cannot_decide(self):
        res = self._act('approve', who=self.user)
        self.assertIn(res.status_code, (403, 404))
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, 'pending')

    def test_an_already_decided_node_is_not_actionable_again(self):
        self._act('approve')
        self.assertEqual(self._act('approve').status_code, 404)

    def test_a_nonsense_decision_is_refused(self):
        self.assertEqual(self._act('maybe').status_code, 400)
