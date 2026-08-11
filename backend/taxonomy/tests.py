from django.contrib.auth.models import User
from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from exercises.models import Exercise
from notifications.models import Notification
from testing.factories import make_branch, make_topic

from taxonomy.models import (
    Branch,
    BranchTranslation,
    Discipline,
    DisciplineTranslation,
    Topic,
)


class DisciplineListTests(APITestCase):
    def setUp(self):
        # `/api/disciplines/` sits behind the anonymous-read response cache
        # (config/cachemw.py), which — unlike the database — is NOT rolled back between tests
        # (config/settings.py's own comment on why LocMemCache is used under the test runner
        # explains the per-process sharing this exploits). Without this, a GET here that happens
        # to be this process's Nth hit on the exact same URL is served bytes cached by an earlier,
        # already-rolled-back test's data, same trap moderation/tests.py and
        # accounts/test_throttling.py already guard against for the throttle counters that live in
        # the same cache.
        cache.clear()

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
    def setUp(self):
        # See DisciplineListTests.setUp — same anonymous-read cache, same cross-test leak.
        cache.clear()

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
        # See DisciplineListTests.setUp — same anonymous-read cache, same cross-test leak.
        cache.clear()
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
        # See DisciplineListTests.setUp — same anonymous-read cache, same cross-test leak.
        cache.clear()
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


class TaxonomyDecisionTests(APITestCase):
    """Deciding on a proposal: approve, merge, move, reject.

    The one that matters most is reject, because it is the only destructive action and
    `Exercise.branch`/`Material.branch` both cascade — so a bare delete on a proposed branch with
    exercises filed under it destroys those exercises. It used to.
    """

    def setUp(self):
        self.user = User.objects.create_user('student', password='pw')
        self.moderator = User.objects.create_user('mod', password='pw', is_staff=True)
        self.discipline = Discipline.objects.create(slug='matematyka')
        DisciplineTranslation.objects.create(
            discipline=self.discipline, locale='pl', name='Matematyka'
        )
        self.established = Branch.objects.create(slug='analiza', discipline=self.discipline)
        self.proposed = Branch.objects.create(
            slug='analiza-mat', discipline=self.discipline, status='pending', proposed_by=self.user
        )

    def _as_mod(self):
        client = APIClient()
        client.force_authenticate(self.moderator)
        return client

    def _decide(self, payload, kind='branch', pk=None):
        return self._as_mod().post(
            reverse(
                'moderation-taxonomy-action',
                kwargs={'kind': kind, 'pk': pk or self.proposed.pk},
            ),
            payload,
            format='json',
        )

    def test_approve_flips_status(self):
        self.assertEqual(self._decide({'decision': 'approve'}).status_code, 200)
        self.proposed.refresh_from_db()
        self.assertEqual(self.proposed.status, 'approved')

    def test_rejecting_a_node_with_content_is_refused_rather_than_destroying_it(self):
        """The bug this shape exists to prevent. Five exercises must not vanish because somebody
        clicked Reject on the branch they were filed under."""
        for number in range(1, 6):
            Exercise.objects.create(
                branch=self.proposed, number=number, difficulty='easy', original_locale='pl'
            )
        res = self._decide({'decision': 'reject'})
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data['detail'], 'has_attached_content')
        self.assertEqual(res.data['attached']['exercises'], 5)
        self.assertEqual(Exercise.objects.filter(branch=self.proposed).count(), 5)
        self.assertTrue(Branch.objects.filter(pk=self.proposed.pk).exists())

    def test_an_empty_proposal_can_still_be_rejected(self):
        res = self._decide({'decision': 'reject', 'note': 'not a branch of anything'})
        self.assertEqual(res.status_code, 200)
        self.assertFalse(Branch.objects.filter(pk=self.proposed.pk).exists())

    def test_merge_moves_the_content_and_removes_the_duplicate(self):
        """A duplicate is a correction, not a refusal: the exercises end up where they belong."""
        Exercise.objects.create(
            branch=self.established, number=1, difficulty='easy', original_locale='pl'
        )
        Exercise.objects.create(
            branch=self.proposed, number=1, difficulty='easy', original_locale='pl'
        )
        res = self._decide({'decision': 'merge', 'target': 'analiza'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'merged')
        self.assertFalse(Branch.objects.filter(pk=self.proposed.pk).exists())
        # Both exercises survive, the incoming one renumbered past the end rather than colliding on
        # the unique (branch, number).
        self.assertEqual(
            sorted(self.established.exercises.values_list('number', flat=True)), [1, 2]
        )

    def test_merge_needs_a_target(self):
        self.assertEqual(self._decide({'decision': 'merge'}).status_code, 400)

    def test_move_reparents_and_approves_keeping_content(self):
        other = Discipline.objects.create(slug='fizyka')
        Exercise.objects.create(
            branch=self.proposed, number=1, difficulty='easy', original_locale='pl'
        )
        res = self._decide({'decision': 'move', 'target': 'fizyka'})
        self.assertEqual(res.status_code, 200)
        self.proposed.refresh_from_db()
        self.assertEqual(self.proposed.discipline, other)
        self.assertEqual(self.proposed.status, 'approved')
        self.assertEqual(self.proposed.exercises.count(), 1, 'content follows the node')

    def test_a_discipline_has_nothing_to_move_under(self):
        pending = Discipline.objects.create(slug='chemia', status='pending')
        res = self._decide({'decision': 'move', 'target': 'matematyka'}, kind='discipline', pk=pending.pk)
        self.assertEqual(res.status_code, 400)

    def test_an_ordinary_user_cannot_decide(self):
        client = APIClient()
        client.force_authenticate(self.user)
        res = client.post(
            reverse(
                'moderation-taxonomy-action',
                kwargs={'kind': 'branch', 'pk': self.proposed.pk},
            ),
            {'decision': 'approve'},
            format='json',
        )
        self.assertIn(res.status_code, (403, 404))

    def test_a_nonsense_decision_is_refused(self):
        self.assertEqual(self._decide({'decision': 'maybe'}).status_code, 400)


class TaxonomyDecisionReplyTests(APITestCase):
    """Every decision answers the person who proposed it.

    Without this, proposing a word is shouting into a hole: the node quietly changes status, or
    quietly stops existing, and the one person who wanted to know is the one nobody told. Merge and
    move carry where the content went, which is the only part of any of this that is actionable.
    """

    def setUp(self):
        self.user = User.objects.create_user('student', password='pw')
        self.moderator = User.objects.create_user('mod', password='pw', is_staff=True)
        self.discipline = Discipline.objects.create(slug='matematyka')
        self.established = Branch.objects.create(slug='analiza', discipline=self.discipline)
        self.proposed = Branch.objects.create(
            slug='analiza-mat', discipline=self.discipline, status='pending', proposed_by=self.user
        )

    def _decide(self, payload, kind='branch', pk=None):
        client = APIClient()
        client.force_authenticate(self.moderator)
        return client.post(
            reverse(
                'moderation-taxonomy-action',
                kwargs={'kind': kind, 'pk': pk or self.proposed.pk},
            ),
            payload,
            format='json',
        )

    def _notifications(self):
        return list(Notification.objects.filter(recipient=self.user).order_by('id'))

    def test_approving_tells_the_proposer(self):
        self._decide({'decision': 'approve'})
        [n] = self._notifications()
        self.assertEqual(n.type, 'taxonomy_approved')
        self.assertEqual(n.target_label, 'analiza-mat')
        self.assertEqual(n.actor, self.moderator)

    def test_merging_names_the_node_and_where_its_content_went(self):
        """The label has to be read before the merge, because the merge deletes the node it names."""
        BranchTranslation.objects.create(branch=self.established, locale='pl', name='Analiza')
        self._decide({'decision': 'merge', 'target': 'analiza'})
        [n] = self._notifications()
        self.assertEqual(n.type, 'taxonomy_merged')
        self.assertEqual(n.target_label, 'analiza-mat', 'the deleted node is still named')
        self.assertEqual(n.note, 'Analiza', 'and so is the one it went into')

    def test_moving_names_the_new_parent(self):
        Discipline.objects.create(slug='fizyka')
        self._decide({'decision': 'move', 'target': 'fizyka'})
        [n] = self._notifications()
        self.assertEqual(n.type, 'taxonomy_moved')
        self.assertEqual(n.note, 'fizyka')

    def test_rejecting_carries_the_moderators_reason(self):
        self._decide({'decision': 'reject', 'note': 'that is a topic, not a branch'})
        [n] = self._notifications()
        self.assertEqual(n.type, 'taxonomy_rejected')
        self.assertEqual(n.target_label, 'analiza-mat')
        self.assertEqual(n.note, 'that is a topic, not a branch')

    def test_a_correction_keeps_both_the_target_and_the_note(self):
        """One must not overwrite the other: where it went and why are different facts."""
        self._decide({'decision': 'merge', 'target': 'analiza', 'note': 'same thing'})
        [n] = self._notifications()
        self.assertEqual(n.note, 'analiza — same thing')

    def test_a_refused_reject_notifies_nobody(self):
        """Nothing happened, so there is nothing to report."""
        Exercise.objects.create(
            branch=self.proposed, number=1, difficulty='easy', original_locale='pl'
        )
        self.assertEqual(self._decide({'decision': 'reject'}).status_code, 409)
        self.assertEqual(self._notifications(), [])

    def test_a_node_nobody_proposed_notifies_nobody(self):
        """Seeded and imported taxonomy has no `proposed_by`, and `notify` no-ops on a null
        recipient — pinned here because this is the common case in the real corpus, not an edge."""
        orphan = Branch.objects.create(
            slug='orphan', discipline=self.discipline, status='pending'
        )
        self.assertEqual(self._decide({'decision': 'approve'}, pk=orphan.pk).status_code, 200)
        self.assertEqual(Notification.objects.count(), 0)

    def test_muting_moderation_decisions_silences_it(self):
        """It rides on the existing category rather than a new switch, so the existing switch has to
        actually govern it."""
        profile = self.user.profile
        profile.notify_on_moderation_decision = False
        profile.save(update_fields=['notify_on_moderation_decision'])
        self._decide({'decision': 'approve'})
        self.assertEqual(self._notifications(), [])
