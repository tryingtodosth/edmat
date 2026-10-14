"""Tests for `flashcards` (prompts/02-flashcards.md, `test.md` §5's shape).

**The schedule first, because it is the only part that is pure arithmetic** — a table of grade
sequences against expected intervals, with no database and no clock, which is exactly the shape
`flashcards/scheduling.py` was written as a pure function to make possible.

**Then refusals, before any happy path**, because almost everything this app has to get right is a
refusal. The thing that would fail silently here is not "somebody graded a card" — it is a stranger
reading somebody's private deck, a participant renaming the deck their lecturer placed, a curator
pinning somebody else's deck on a course, or a grade written against another person's schedule. So
`can_study` / `can_edit` / `place_block_reason` / the kill switch each get a test before the review
loop does.

The node under test is a **course**, because its roster has the three-way split this app needs:
staff who may place a deck, a participant who may study a placed one, and an outsider who is
neither. One test uses an **event** instead, to prove `config/nodes.py` really is doing the
dispatching rather than `courses` being special-cased anywhere in `rules.py`.
"""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from concepts.models import Concept, ConceptArticle, ConceptRevision
from courses.models import Course, Enrollment
from events.models import Event
from moderation.models import FeatureFlag
from study.models import ExerciseSet, ExerciseSetItem
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user

from . import record, rules, scheduling, work
from .models import (
    MAX_EASE,
    MIN_EASE,
    NAME_MAX_LENGTH,
    Card,
    Deck,
    DeckPlacement,
    ReviewLog,
    ReviewState,
)


class SchedulingTests(APITestCase):
    """`scheduling.review` as a table. No database, no clock, no models — which is the whole reason
    it is a pure function (`flashcards/scheduling.py`'s own docstring)."""

    #: The sequence of grades, then the interval in days expected after each one.
    TABLE = [
        # Four "good" presses: the two learning steps, then × ease (2.5 throughout).
        ([3, 3, 3, 3], [1, 6, 15, 38]),
        # "Easy" has its own, longer steps and then × ease × 1.3. The ease is raised BEFORE the
        # interval is computed, so the third press multiplies by (2.5 + 3×0.15) × 1.3 = 3.835.
        ([4, 4, 4], [2, 8, 31]),
        # "Hard" is not a lapse: it grows, barely.
        ([2, 2, 2], [1, 3, 4]),
        # A lapse is due NOW (interval 0), and the ladder restarts from the bottom.
        ([3, 3, 1, 3], [1, 6, 0, 1]),
        # Mixed: good, good, hard — the third press multiplies by 1.2, not by ease.
        ([3, 3, 2], [1, 6, 7]),
    ]

    def test_interval_table(self):
        now = timezone.now()
        for grades, expected in self.TABLE:
            with self.subTest(grades=grades):
                state = None
                got = []
                for grade in grades:
                    state = scheduling.review(state, grade, now)
                    got.append(state['interval_days'])
                self.assertEqual(got, expected)

    def test_due_at_follows_the_interval_and_a_lapse_is_due_now(self):
        now = timezone.now()
        good = scheduling.review(None, 3, now)
        self.assertEqual(good['due_at'], now + timedelta(days=1))
        lapsed = scheduling.review(good, 1, now)
        self.assertEqual(lapsed['due_at'], now)
        self.assertEqual(lapsed['lapses'], 1)
        self.assertEqual(lapsed['repetitions'], 0)

    def test_ease_is_clamped_both_ways(self):
        now = timezone.now()
        state = None
        for _ in range(20):
            state = scheduling.review(state, 1, now)
        self.assertEqual(state['ease'], MIN_EASE)
        state = None
        for _ in range(20):
            state = scheduling.review(state, 4, now)
        self.assertEqual(state['ease'], MAX_EASE)

    def test_interval_is_capped(self):
        now = timezone.now()
        state = None
        for _ in range(40):
            state = scheduling.review(state, 4, now)
        self.assertEqual(state['interval_days'], scheduling.MAX_INTERVAL_DAYS)

    def test_a_bad_grade_is_a_programming_error(self):
        with self.assertRaises(ValueError):
            scheduling.review(None, 0, timezone.now())
        with self.assertRaises(ValueError):
            scheduling.review(None, 5, timezone.now())


class FlashcardsTestCase(APITestCase):
    #: The telemetry log shards, like every other API test case here: a 404 walks through the
    #: request-logging middleware, which writes to them, and a test that does not declare them
    #: fails with `DatabaseOperationForbidden` rather than with anything about flashcards.
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.owner = make_user('deck-owner')
        self.participant = make_user('deck-participant')
        self.outsider = make_user('deck-outsider')
        self.staff = make_user('deck-staff', is_staff=True)

        self.branch = make_branch('flash-branch')
        self.one = make_exercise(self.branch, 9001)
        self.two = make_exercise(self.branch, 9002)
        self.pulled = make_exercise(self.branch, 9003)
        self.pulled.published = False
        self.pulled.save(update_fields=['published'])

        self.course = Course.objects.create(
            instructor=self.owner,
            title='Analiza dla wszystkich',
            status='open',
            # `only_you` is the default (creating a course never publishes it), and a deck placed
            # on an invisible course would make every placement test vacuous.
            visibility='public',
        )
        Enrollment.objects.create(
            course=self.course, participant=self.participant, status='active'
        )

        self.deck = Deck.objects.create(owner=self.owner, name='Week 3')
        self.card_one = Card.objects.create(deck=self.deck, order=0, exercise=self.one)
        self.card_two = Card.objects.create(deck=self.deck, order=1, exercise=self.two)

    # -- small helpers ---------------------------------------------------------------------------

    def deck_url(self, deck=None):
        return reverse('deck-detail', args=[(deck or self.deck).pk])

    def place_on_course(self):
        return rules.place(self.owner, self.deck, self.course)


# ---- refusals ----------------------------------------------------------------------------------


class VisibilityTests(FlashcardsTestCase):
    def test_a_stranger_gets_404_not_403(self):
        """House rule 4: for them it does not exist — the honest answer as well as the safe one."""
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.deck_url()).status_code, status.HTTP_404_NOT_FOUND)

    def test_an_anonymous_caller_gets_404_on_a_private_deck(self):
        self.assertEqual(self.client.get(self.deck_url()).status_code, status.HTTP_404_NOT_FOUND)

    def test_the_owner_sees_their_own(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get(self.deck_url())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['card_count'], 2)
        self.assertTrue(response.data['can_edit'])

    def test_my_decks_lists_only_mine(self):
        Deck.objects.create(owner=self.outsider, name="Somebody else's")
        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse('deck-list'))
        self.assertEqual([row['name'] for row in response.data], ['Week 3'])

    def test_a_placed_deck_is_studyable_by_the_courses_participant(self):
        """The one deviation from 00-DESIGN.md §4.1, decided at launch (prompts/README.md §9):
        placement is this cycle's sharing mechanism, or "make a deck from this lesson" would make a
        deck only its maker could ever open."""
        self.place_on_course()
        self.client.force_authenticate(self.participant)
        self.assertEqual(self.client.get(self.deck_url()).status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.client.get(reverse('deck-cards', args=[self.deck.pk])).status_code,
            status.HTTP_200_OK,
        )

    def test_a_placed_deck_is_still_hidden_from_somebody_who_cannot_see_the_course(self):
        self.course.visibility = 'only_you'
        self.course.save(update_fields=['visibility'])
        self.place_on_course()
        self.client.force_authenticate(self.outsider)
        self.assertEqual(self.client.get(self.deck_url()).status_code, status.HTTP_404_NOT_FOUND)

    def test_an_event_placement_dispatches_through_the_node_seam(self):
        """A course is not special-cased anywhere in `rules.py` — the same code path answers for an
        event, which is what `config/nodes.py` exists to guarantee."""
        event = Event.objects.create(
            host=self.outsider,
            title='Open day',
            starts_at=timezone.now() + timedelta(days=5),
            status='published',
            visibility='public',
        )
        rules.place(self.staff, self.deck, event)
        self.client.force_authenticate(self.participant)
        self.assertEqual(self.client.get(self.deck_url()).status_code, status.HTTP_200_OK)


class AuthorityTests(FlashcardsTestCase):
    def test_a_participant_who_may_study_may_not_rename(self):
        """`can_study` is wider than `can_edit`, and the gap is exactly this request."""
        self.place_on_course()
        self.client.force_authenticate(self.participant)
        response = self.client.patch(self.deck_url(), {'name': 'Mine now'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.deck.refresh_from_db()
        self.assertEqual(self.deck.name, 'Week 3')

    def test_PUT_is_checked_too_not_just_PATCH(self):
        """`UpdateModelMixin` binds both verbs; overriding only `partial_update` once left PUT
        running DRF's own, which asks the queryset (visibility) and never the authority check —
        a real hole that shipped in `needs` (§17BI.H)."""
        self.place_on_course()
        self.client.force_authenticate(self.participant)
        response = self.client.put(
            self.deck_url(), {'name': 'Mine now', 'audience': 'university'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_participant_may_not_delete_a_placed_deck(self):
        self.place_on_course()
        self.client.force_authenticate(self.participant)
        self.assertEqual(
            self.client.delete(self.deck_url()).status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertTrue(Deck.objects.filter(pk=self.deck.pk).exists())

    def test_a_participant_may_not_edit_a_card_of_a_placed_deck(self):
        self.place_on_course()
        self.client.force_authenticate(self.participant)
        response = self.client.patch(
            reverse('card-detail', args=[self.card_one.pk]), {'order': 5}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_owner_may_edit_a_free_text_card(self):
        card = Card.objects.create(deck=self.deck, order=2, front='Co to jest?', back='To.')
        self.client.force_authenticate(self.owner)
        response = self.client.patch(
            reverse('card-detail', args=[card.pk]), {'back': 'Owszem.'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['back'], 'Owszem.')


class PlacementRefusalTests(FlashcardsTestCase):
    def test_not_owner(self):
        """Placing somebody else's deck is not yours to do, even on a course you run."""
        other = Deck.objects.create(owner=self.outsider, name='Theirs')
        self.assertEqual(
            rules.place_block_reason(self.owner, other, self.course), rules.NOT_OWNER
        )

    def test_cannot_manage(self):
        course = Course.objects.create(
            instructor=self.outsider, title="Somebody else's", status='open', visibility='public'
        )
        self.assertEqual(
            rules.place_block_reason(self.owner, self.deck, course), rules.CANNOT_MANAGE
        )

    def test_kind_for_a_node_this_app_does_not_place_on(self):
        """`PLACEABLE_NODE_KINDS` is deliberately shorter than `config.nodes.NODE_KINDS`."""
        self.assertEqual(rules.place_block_reason(self.owner, self.deck, None), rules.BAD_KIND)

    def test_already_placed_is_409_not_403(self):
        """The world moved, which is not the same refusal as "who are you" (root `CLAUDE.md`)."""
        self.place_on_course()
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-placements', args=[self.deck.pk]),
            {'kind': 'course', 'id': self.course.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], rules.ALREADY_PLACED)

    def test_cannot_manage_is_403_and_carries_the_word(self):
        course = Course.objects.create(
            instructor=self.outsider, title='Not mine', status='open', visibility='public'
        )
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-placements', args=[self.deck.pk]),
            {'kind': 'course', 'id': course.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], rules.CANNOT_MANAGE)

    def test_placing_works_and_shows_up_on_the_node(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-placements', args=[self.deck.pk]),
            {'kind': 'course', 'id': self.course.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.client.force_authenticate(self.participant)
        listed = self.client.get(reverse('node-decks', args=['course', self.course.pk]))
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual(len(listed.data), 1)
        self.assertEqual(listed.data[0]['deck']['name'], 'Week 3')

    def test_node_decks_404s_for_somebody_who_cannot_see_the_node(self):
        self.course.visibility = 'only_you'
        self.course.save(update_fields=['visibility'])
        self.place_on_course()
        self.client.force_authenticate(self.outsider)
        self.assertEqual(
            self.client.get(reverse('node-decks', args=['course', self.course.pk])).status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_unplacing_is_for_the_placer_the_owner_or_the_manager(self):
        placement = self.place_on_course()
        self.client.force_authenticate(self.participant)
        self.assertEqual(
            self.client.delete(reverse('deck-placement-detail', args=[placement.pk])).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.client.force_authenticate(self.owner)
        self.assertEqual(
            self.client.delete(reverse('deck-placement-detail', args=[placement.pk])).status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.assertFalse(DeckPlacement.objects.filter(pk=placement.pk).exists())

    def test_a_private_node_is_not_named_in_the_deck_read_shape(self):
        """A deck on a private course and a public one must not tell a stranger the private one
        exists — house rule 4 one level down."""
        private = Course.objects.create(
            instructor=self.owner, title='Secret seminar', visibility='only_you'
        )
        rules.place(self.owner, self.deck, private)
        self.place_on_course()
        self.client.force_authenticate(self.participant)
        response = self.client.get(self.deck_url())
        titles = [row['node']['title'] for row in response.data['placements']]
        self.assertEqual(titles, ['Analiza dla wszystkich'])


class MinorTests(FlashcardsTestCase):
    def test_a_minor_may_not_make_a_deck_world_readable(self):
        child = make_user('deck-child')
        child.profile.is_minor = True
        child.profile.save(update_fields=['is_minor'])
        deck = Deck.objects.create(owner=child, name='Moje fiszki')
        self.assertEqual(rules.public_block_reason(child, deck), rules.MINOR)
        self.client.force_authenticate(child)
        response = self.client.patch(
            reverse('deck-detail', args=[deck.pk]), {'is_public': True}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        deck.refresh_from_db()
        self.assertFalse(deck.is_public)

    def test_an_adult_may(self):
        self.client.force_authenticate(self.owner)
        response = self.client.patch(self.deck_url(), {'is_public': True}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.deck.refresh_from_db()
        self.assertTrue(self.deck.is_public)


class KillSwitchTests(FlashcardsTestCase):
    """A staff-bypassed check proves nothing about a FeatureFlag (`frontend/e2e/CLAUDE.md` trap
    10), so every assertion here is made as a non-staff caller — and the staff bypass gets one of
    its own."""

    def setUp(self):
        super().setUp()
        FeatureFlag.objects.update_or_create(key='flashcards', defaults={'is_enabled': False})

    def test_every_endpoint_403s_a_non_staff_caller(self):
        self.client.force_authenticate(self.owner)
        for url, method in [
            (reverse('deck-list'), 'get'),
            (self.deck_url(), 'get'),
            (reverse('deck-cards', args=[self.deck.pk]), 'get'),
            (reverse('deck-review', args=[self.deck.pk]), 'get'),
            (reverse('flashcards-due'), 'get'),
            (reverse('node-decks', args=['course', self.course.pk]), 'get'),
        ]:
            with self.subTest(url=url):
                response = getattr(self.client, method)(url)
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_staff_still_reach_their_own_tools(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get(reverse('deck-list')).status_code, status.HTTP_200_OK)

    def test_a_neighbouring_endpoint_keeps_working(self):
        """House rule 3: neighbouring endpoints must keep working while returning nothing for the
        killed feature. The course page itself is the neighbour that matters here."""
        self.client.force_authenticate(self.participant)
        response = self.client.get(reverse('course-detail', args=[self.course.pk]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)


# ---- the happy paths -----------------------------------------------------------------------------


class DeckCreationTests(FlashcardsTestCase):
    def setUp(self):
        super().setUp()
        self.set = ExerciseSet.objects.create(owner=self.owner, name='Kolokwium 2')
        for order, exercise in enumerate([self.two, self.one]):
            ExerciseSetItem.objects.create(
                exercise_set=self.set, exercise=exercise, order=order
            )

    def test_cards_are_created_in_the_order_the_ids_arrived(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-list'),
            {
                'name': 'From my set',
                'exercise_ids': [self.two.pk, self.one.pk],
                'source': {'kind': 'set', 'id': self.set.slug},
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['card_count'], 2)
        self.assertEqual(response.data['source_kind'], 'set')
        self.assertEqual(response.data['skipped'], 0)
        deck = Deck.objects.get(pk=response.data['id'])
        self.assertEqual(deck.source_set, self.set)
        self.assertEqual(
            [card.exercise_id for card in deck.cards.all()], [self.two.pk, self.one.pk]
        )

    def test_ids_the_caller_may_not_see_are_skipped_and_counted(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-list'),
            {'name': 'Mixed', 'exercise_ids': [self.one.pk, self.pulled.pk, 999999]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['card_count'], 1)
        self.assertEqual(response.data['skipped'], 2)

    def test_a_repeated_id_becomes_one_card(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-list'),
            {'name': 'Dupes', 'exercise_ids': [self.one.pk, self.one.pk]},
            format='json',
        )
        self.assertEqual(response.data['card_count'], 1)
        self.assertEqual(response.data['skipped'], 1)

    def test_a_placement_in_the_same_request(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-list'),
            {
                'name': 'Week 4',
                'exercise_ids': [self.one.pk],
                'placement': {'kind': 'course', 'id': self.course.pk},
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(response.data['placements']), 1)

    def test_a_refused_placement_still_leaves_the_deck(self):
        """The brief is explicit: the deck is still created. A round trip that silently did nothing
        is worse than one that half worked and said so."""
        course = Course.objects.create(
            instructor=self.outsider, title='Not mine', status='open', visibility='public'
        )
        self.client.force_authenticate(self.owner)
        before = Deck.objects.count()
        response = self.client.post(
            reverse('deck-list'),
            {'name': 'Week 5', 'placement': {'kind': 'course', 'id': course.pk}},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['detail'], rules.CANNOT_MANAGE)
        self.assertEqual(response.data['deck']['name'], 'Week 5')
        self.assertEqual(Deck.objects.count(), before + 1)

    def test_a_private_set_belonging_to_somebody_else_is_not_recorded_as_the_source(self):
        theirs = ExerciseSet.objects.create(owner=self.outsider, name='Theirs', is_public=False)
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-list'),
            {'name': 'Nope', 'source': {'kind': 'set', 'id': theirs.slug}},
            format='json',
        )
        deck = Deck.objects.get(pk=response.data['id'])
        self.assertEqual(deck.source_kind, 'set')
        self.assertIsNone(deck.source_set)
        self.assertIsNone(deck.source_id)

    def test_an_empty_name_is_400(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(reverse('deck-list'), {'name': '   '}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_generated_name_past_the_cap_is_truncated_rather_than_refused(self):
        """The three "make a deck" buttons do not ask anybody for the name: they build it from a
        lesson, session or concept title, every one of which is `max_length=200` in its own app.
        Refusing the request would hand the person a 400 and the sentence "the deck could not be
        made" with nothing they could do about it, so the name is cut to fit — which is what
        `DeckSerializer.validate_name` has always done on the edit path. Found against the real
        endpoint by `frontend/e2e/make-a-deck.mjs` (HISTORY §17BU.D)."""
        self.client.force_authenticate(self.owner)
        generated = f'{"Całkowanie przez podstawienie " * 7}— fiszki'
        self.assertGreater(len(generated), NAME_MAX_LENGTH)
        response = self.client.post(
            reverse('deck-list'),
            {
                'name': generated,
                'exercise_ids': [self.one.pk],
                'source': {'kind': 'lesson', 'id': '41'},
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['name'], generated[:NAME_MAX_LENGTH])
        self.assertEqual(response.data['card_count'], 1)


class CardTests(FlashcardsTestCase):
    def test_exactly_one_face_is_refused_at_400_not_500(self):
        """DRF derives uniqueness validators from `unique_together` but NOT from
        `Meta.constraints` (`backend/CLAUDE.md`, Testing), so the check constraint needs its
        serializer counterpart or a malformed request becomes an `IntegrityError`."""
        self.client.force_authenticate(self.owner)
        url = reverse('deck-cards', args=[self.deck.pk])
        for payload in [
            {},
            {'exercise': self.one.pk, 'front': 'Both'},
            {'front': '   '},
        ]:
            with self.subTest(payload=payload):
                response = self.client.post(url, payload, format='json')
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_free_text_card(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-cards', args=[self.deck.pk]),
            {'front': 'Co to jest \\(e\\)?', 'back': 'Podstawa logarytmu naturalnego.'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['kind'], 'text')
        self.assertIn('\\(e\\)', response.data['front'])

    def test_the_faces_are_sanitized_on_write(self):
        """House rule 8 — on write as well as on read, because the API is a second entry point."""
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-cards', args=[self.deck.pk]),
            {'front': 'Hello <script>alert(1)</script>', 'back': '<b>ok</b>'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertNotIn('<script>', response.data['front'])
        self.assertIn('<b>ok</b>', response.data['back'])

    def test_an_unavailable_exercise_is_400_on_the_deck_not_404(self):
        """"Your deck is gone" and "that exercise is not available" are completely different
        sentences (house rule 6)."""
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-cards', args=[self.deck.pk]),
            {'exercise': self.pulled.pk},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['detail'], 'exercise_not_available')

    def test_a_concept_card_carries_the_resolved_title_and_summary(self):
        concept = Concept.objects.create(slug='pochodna', created_by=self.owner)
        article = ConceptArticle.objects.create(
            concept=concept, audience='university', locale='pl', created_by=self.owner
        )
        ConceptRevision.objects.create(
            article=article,
            number=1,
            status='published',
            title='Pochodna',
            summary='Tempo zmiany funkcji.',
            created_by=self.owner,
        )
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('deck-cards', args=[self.deck.pk]), {'concept': 'pochodna'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['kind'], 'concept')
        self.assertEqual(response.data['concept']['title'], 'Pochodna')
        self.assertEqual(response.data['concept']['summary'], 'Tempo zmiany funkcji.')

    def test_an_exercise_card_does_not_inline_the_statement(self):
        """The review screen loads them through `/api/exercises/bulk/`; a 50-card response must not
        carry fifty statements for a screen that shows one."""
        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse('deck-cards', args=[self.deck.pk]))
        self.assertEqual(set(response.data[0]['exercise']), {
            'id', 'title', 'branch_slug', 'number', 'difficulty', 'published'
        })

    def test_a_pulled_exercise_is_skipped_for_a_reader_but_not_for_the_owner(self):
        """`courses.LessonExerciseSet.visible_exercises`'s rule, for the same reason: a curator who
        cannot see the gap cannot fill it."""
        Card.objects.create(deck=self.deck, order=2, exercise=self.pulled)
        self.place_on_course()
        self.client.force_authenticate(self.participant)
        self.assertEqual(len(self.client.get(reverse('deck-cards', args=[self.deck.pk])).data), 2)
        self.client.force_authenticate(self.owner)
        self.assertEqual(len(self.client.get(reverse('deck-cards', args=[self.deck.pk])).data), 3)

    def test_deleting_a_card(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(
            self.client.delete(reverse('card-detail', args=[self.card_two.pk])).status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.assertEqual(self.deck.cards.count(), 1)


class ReviewTests(FlashcardsTestCase):
    def test_a_fresh_deck_is_all_new_and_all_due(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse('deck-review', args=[self.deck.pk]))
        self.assertEqual(response.data['counts'], {'due': 0, 'new': 2, 'learned': 0, 'total': 2})
        self.assertEqual(len(response.data['cards']), 2)
        detail = self.client.get(self.deck_url())
        self.assertEqual(detail.data['due_count'], 2)

    def test_grading_moves_a_card_out_of_the_queue_and_the_due_count_down(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            reverse('card-grade', args=[self.card_one.pk]), {'grade': 3}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['interval_days'], 1)
        self.assertEqual(response.data['repetitions'], 1)
        queue = self.client.get(reverse('deck-review', args=[self.deck.pk]))
        self.assertEqual(queue.data['counts'], {'due': 0, 'new': 1, 'learned': 1, 'total': 2})
        self.assertEqual(self.client.get(self.deck_url()).data['due_count'], 1)

    def test_again_keeps_the_card_due(self):
        self.client.force_authenticate(self.owner)
        self.client.post(
            reverse('card-grade', args=[self.card_one.pk]), {'grade': 1}, format='json'
        )
        queue = self.client.get(reverse('deck-review', args=[self.deck.pk]))
        self.assertEqual(queue.data['counts'], {'due': 1, 'new': 1, 'learned': 0, 'total': 2})

    def test_due_cards_come_before_new_ones(self):
        state = ReviewState.objects.create(
            user=self.owner,
            card=self.card_two,
            due_at=timezone.now() - timedelta(days=2),
            interval_days=1,
            repetitions=1,
        )
        self.client.force_authenticate(self.owner)
        queue = self.client.get(reverse('deck-review', args=[self.deck.pk]))
        self.assertEqual(
            [row['id'] for row in queue.data['cards']], [state.card_id, self.card_one.pk]
        )

    def test_a_log_row_per_grade_and_nothing_updated(self):
        self.client.force_authenticate(self.owner)
        for grade in (3, 2, 4):
            self.client.post(
                reverse('card-grade', args=[self.card_one.pk]), {'grade': grade}, format='json'
            )
        self.assertEqual(ReviewLog.objects.filter(card=self.card_one).count(), 3)
        self.assertEqual(ReviewState.objects.filter(card=self.card_one).count(), 1)

    def test_a_bad_grade_is_400(self):
        self.client.force_authenticate(self.owner)
        for grade in (0, 5, 'x'):
            with self.subTest(grade=grade):
                response = self.client.post(
                    reverse('card-grade', args=[self.card_one.pk]), {'grade': grade}, format='json'
                )
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_stranger_may_not_grade(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.post(
            reverse('card-grade', args=[self.card_one.pk]), {'grade': 3}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(ReviewState.objects.count(), 0)

    def test_two_people_studying_one_placed_deck_have_two_schedules(self):
        self.place_on_course()
        self.client.force_authenticate(self.participant)
        self.client.post(
            reverse('card-grade', args=[self.card_one.pk]), {'grade': 4}, format='json'
        )
        self.client.force_authenticate(self.owner)
        self.client.post(
            reverse('card-grade', args=[self.card_one.pk]), {'grade': 1}, format='json'
        )
        self.assertEqual(ReviewState.objects.filter(card=self.card_one).count(), 2)
        mine = ReviewState.objects.get(card=self.card_one, user=self.owner)
        theirs = ReviewState.objects.get(card=self.card_one, user=self.participant)
        self.assertEqual(mine.interval_days, 0)
        self.assertEqual(theirs.interval_days, 2)

    def test_the_due_summary_across_decks(self):
        other = Deck.objects.create(owner=self.owner, name='Algebra')
        Card.objects.create(deck=other, order=0, exercise=self.one)
        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse('flashcards-due'))
        self.assertEqual(response.data['total'], 3)
        self.assertEqual(
            sorted((row['name'], row['due']) for row in response.data['decks']),
            [('Algebra', 1), ('Week 3', 2)],
        )

    def test_a_deck_on_a_public_course_is_not_due_for_somebody_who_never_joined(self):
        # The course is public, so the outsider MAY study the deck — but it is not work waiting
        # for them until they join or start it (`rules.my_study_decks`).
        self.place_on_course()
        self.client.force_authenticate(self.outsider)
        response = self.client.get(reverse('flashcards-due'))
        self.assertEqual(response.data, {'decks': [], 'total': 0})
        self.client.force_authenticate(self.participant)
        response = self.client.get(reverse('flashcards-due'))
        self.assertEqual(response.data['total'], 2)
        # Once the outsider grades a card, the deck is theirs to finish.
        self.client.force_authenticate(self.outsider)
        self.client.post(
            reverse('card-grade', args=[self.card_one.pk]), {'grade': 3}, format='json'
        )
        response = self.client.get(reverse('flashcards-due'))
        self.assertEqual([row['name'] for row in response.data['decks']], ['Week 3'])


class CopyTests(FlashcardsTestCase):
    def test_a_copy_is_private_mine_and_carries_no_placements(self):
        self.place_on_course()
        self.client.force_authenticate(self.participant)
        response = self.client.post(reverse('deck-copy', args=[self.deck.pk]))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        copy = Deck.objects.get(pk=response.data['id'])
        self.assertEqual(copy.owner, self.participant)
        self.assertFalse(copy.is_public)
        self.assertEqual(copy.cards.count(), 2)
        self.assertEqual(copy.placements.count(), 0)
        # A membership snapshot: the cards are new rows pointing at the SAME exercises.
        self.assertEqual(
            [card.exercise_id for card in copy.cards.all()],
            [card.exercise_id for card in self.deck.cards.all()],
        )

    def test_a_stranger_cannot_copy(self):
        self.client.force_authenticate(self.outsider)
        self.assertEqual(
            self.client.post(reverse('deck-copy', args=[self.deck.pk])).status_code,
            status.HTTP_404_NOT_FOUND,
        )


class ProviderTests(FlashcardsTestCase):
    """`record.py` and `work.py` are the two hooks the integrator registers
    (prompts/README.md §5 rule 13) — neither is imported anywhere on this branch, so their only
    proof that they work is here."""

    def test_work_items_carries_a_count_per_deck_not_a_row_per_card(self):
        items = work.work_items(self.owner)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['kind'], 'cards_due')
        self.assertEqual(items[0]['status'], '2 due')
        self.assertEqual(items[0]['url'], f'/flashcards/{self.deck.pk}/review')
        self.assertIsNone(items[0]['due_at'])

    def test_work_items_has_every_key_the_registry_requires(self):
        from work.providers import ITEM_KEYS

        self.assertEqual(set(work.work_items(self.owner)[0]), set(ITEM_KEYS))

    def test_a_deck_with_nothing_due_is_not_a_work_row(self):
        self.client.force_authenticate(self.owner)
        for card in (self.card_one, self.card_two):
            self.client.post(reverse('card-grade', args=[card.pk]), {'grade': 3}, format='json')
        self.assertEqual(work.work_items(self.owner), [])

    def test_work_items_is_empty_for_a_guest(self):
        from django.contrib.auth.models import AnonymousUser

        self.assertEqual(work.work_items(AnonymousUser()), [])

    def test_activity_by_branch_counts_reviews_per_branch(self):
        rules.apply_grade(self.owner, self.card_one, 3)
        rules.apply_grade(self.owner, self.card_one, 4)
        rules.apply_grade(self.owner, self.card_two, 2)
        self.assertEqual(
            record.activity_by_branch(self.owner),
            {self.branch.pk: {'cards_reviewed': 3}},
        )

    def test_a_free_text_card_has_no_branch_and_is_not_counted(self):
        text = Card.objects.create(deck=self.deck, order=2, front='Bez gałęzi')
        rules.apply_grade(self.owner, text, 3)
        self.assertEqual(record.activity_by_branch(self.owner), {})

    def test_activity_by_branch_is_per_person(self):
        rules.apply_grade(self.owner, self.card_one, 3)
        self.assertEqual(record.activity_by_branch(self.outsider), {})
