"""Serializers for `flashcards` (prompts/02-flashcards.md §API).

The two read shapes are **fixed by the brief** and must not shrink — steps C, D and E were written
against them before this app existed (`frontend/src/lib/types/flashcards.ts` mirrors them from the
other side):

```
Deck: id, name, audience, is_public, source_kind, source_id, card_count, due_count, created_at,
      can_edit, placements: [{id, node: node_ref}]
Card: id, order, kind, exercise: {…} | null, concept: {slug, title} | null, front, back,
      include_hint, include_solution
```

**An exercise card does not inline its statement.** The review screen loads a deck's exercises in
one request through `GET /api/exercises/bulk/?ids=`, which is already the endpoint for exactly this
(`exercises/views.py: bulk` — its docstring names My Set's PDF export as the same shape of caller)
and which already asks `exercises/entries.py: visible_entries` for the hint and solution pool. A
second, parallel resolve here would be the two-surfaces-disagree failure the rule-module boundary
exists to prevent, and it would make a 50-card review response carry fifty full statements for a
screen that shows one at a time.

A **concept** card is the other way round: its faces are two short strings (a resolved revision's
title and summary), so inlining them costs nothing and saves the review screen a second endpoint.
`concepts/resolve.py: resolve_page` answers which revision this reader gets, with the reader's own
audience bands and content locales from `config/audience.py` and `config/content_locale.py` exactly
as the concept views pass them.
"""

from rest_framework import serializers

from config import nodes as node_seam
from config.audience import AUDIENCE_VALUES, parse_audience_param
from config.content_locale import parse_content_locales
from config.i18n_utils import request_locale, resolve_translation

from . import rules
from .models import (
    FACE_MAX_LENGTH,
    GRADE_CHOICES,
    NAME_MAX_LENGTH,
    PLACEABLE_NODE_KINDS,
    SOURCE_KINDS,
    Card,
    Deck,
    DeckPlacement,
    ReviewState,
)


def _request_user(context):
    request = context.get('request')
    return getattr(request, 'user', None)


# ---- the two embedded content shapes -----------------------------------------------------------


def _exercise_ref(exercise, context) -> dict:
    """Just enough to name an exercise in a card list: what it is called, where it is filed, and
    whether a reader can still see it.

    An exercise's title lives on its translations, so it is resolved through
    `config/i18n_utils.resolve_translation` like every other exercise reference in this API —
    reading a field off the model would not compile, and taking the first translation by hand shows
    a Polish title to an English reader. `published` rides along because the deck's owner keeps
    seeing a pulled card (`rules.visible_cards`) and the page has to be able to say why it is
    greyed out.
    """
    locale = request_locale(context)
    # Read off `.all()` so a caller's `prefetch_related('exercise__translations')` is honoured
    # rather than re-queried once per card — the cache-preserving rule
    # `exercises/serializers.py: _published_translations` documents at length. Published rows only,
    # falling back to whatever exists for an exercise whose only translation is still pending (its
    # own submitter can see such a card).
    rows = [t for t in exercise.translations.all() if t.status == 'published']
    if not rows:
        rows = list(exercise.translations.all())
    translation = resolve_translation(
        _AsQuerySet(rows), locale, exercise.original_locale or 'pl'
    )
    return {
        'id': str(exercise.pk),
        # `str(exercise)` is "analiza-1-0042" — the subject-and-number identity this project has
        # always used where an exercise has no translated title at all (`courses/serializers.py`
        # makes the same fallback for the same reason).
        'title': translation.title if translation and translation.title else str(exercise),
        'branch_slug': exercise.branch.slug if exercise.branch_id else None,
        'number': exercise.number,
        'difficulty': exercise.difficulty,
        'published': exercise.published and exercise.auto_hidden_at is None,
    }


class _AsQuerySet:
    """`resolve_translation` takes something with `.all()` so that a caller's `prefetch_related`
    is honoured rather than re-queried (its own docstring says so). This wraps an already-filtered
    Python list in that one method, which is the whole interface it uses — the alternative is a
    second database round trip per card for rows the prefetch already fetched."""

    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


def _concept_ref(concept, context) -> dict:
    """`{slug, title, summary}` — the front and the back of a concept card, resolved for this
    reader. The resolve is `concepts/resolve.py`'s, never a re-derivation: which article a reader
    gets is a rule with a module (audience ladder, locale pools, `all` as an exact answer rather
    than a fallback) and a second copy of it here would drift the first time somebody touched one.
    """
    from concepts import resolve as concept_resolve

    request = context.get('request')
    params = getattr(request, 'query_params', {}) or {}
    user = _request_user(context)
    audiences = parse_audience_param(params.get('audience'))
    locales = parse_content_locales(params.get('content_locales')) or [request_locale(context)]
    page, _exactness = concept_resolve.resolve_page(
        concept, audiences=audiences, locales=locales, user=user
    )
    title, summary = concept.slug, ''
    if page is not None:
        audience, locale = page
        rows = concept_resolve.pool_with_heads(concept, audience, locale, user)
        if rows:
            _article, head = rows[0]
            title, summary = head.title, head.summary
    return {'slug': concept.slug, 'title': title, 'summary': summary}


# ---- read shapes -------------------------------------------------------------------------------


class DeckPlacementSerializer(serializers.ModelSerializer):
    """`{id, node: node_ref, order, added_by}`. `node` is `config.nodes.node_ref`, which is what
    every panel on this site reads to know what it is sitting on and whether to draw its
    controls — not a shape invented here."""

    node = serializers.SerializerMethodField()
    added_by = serializers.SerializerMethodField()

    class Meta:
        model = DeckPlacement
        fields = ['id', 'node', 'order', 'added_by', 'added_at']
        read_only_fields = fields

    def get_node(self, placement: DeckPlacement) -> dict | None:
        node = placement.node
        if node is None:
            return None
        return node_seam.node_ref(node, _request_user(self.context))

    def get_added_by(self, placement: DeckPlacement) -> dict | None:
        user = placement.added_by
        if user is None:
            return None
        profile = getattr(user, 'profile', None)
        name = profile.display_name if profile and profile.display_name else user.username
        return {'id': user.pk, 'display_name': name}


class NodeDeckPlacementSerializer(serializers.ModelSerializer):
    """What `GET /api/nodes/{kind}/{pk}/decks/` answers: `{id, deck, order, added_by}`.

    A SECOND placement serializer, and deliberately so. The one above embeds the **node**, because
    it is read from inside a deck ("where is my deck?"); this one embeds the **deck**, because it is
    read from a course or an event page ("what is on this page?"). One serializer carrying both
    would be a cycle — a deck whose placements each carry a deck — and a client that asked for
    either would get the other one it did not need.
    """

    deck = serializers.SerializerMethodField()
    added_by = serializers.SerializerMethodField()

    class Meta:
        model = DeckPlacement
        fields = ['id', 'deck', 'order', 'added_by', 'added_at']
        read_only_fields = fields

    def get_deck(self, placement: DeckPlacement) -> dict:
        return DeckSerializer(placement.deck, context=self.context).data

    def get_added_by(self, placement: DeckPlacement) -> dict | None:
        return DeckPlacementSerializer(placement, context=self.context).get_added_by(placement)


class DeckSerializer(serializers.ModelSerializer):
    """The one read shape for a deck, on every endpoint that answers with one.

    `card_count` and `due_count` are **recounted** on every read (house rule 5) — two counts over
    an indexed FK are cheap and cannot drift, and `due_count` could not be stored on the row at all
    even if somebody wanted to: it is per *reader*, and thirty people studying one placed deck have
    thirty different answers.
    """

    card_count = serializers.SerializerMethodField()
    due_count = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    placements = serializers.SerializerMethodField()
    owner_display_name = serializers.SerializerMethodField()

    class Meta:
        model = Deck
        fields = [
            'id',
            'name',
            'audience',
            'is_public',
            'source_kind',
            'source_id',
            'card_count',
            'due_count',
            'created_at',
            'can_edit',
            'placements',
            'owner_display_name',
        ]
        read_only_fields = [
            'id',
            'source_kind',
            'source_id',
            'card_count',
            'due_count',
            'created_at',
            'can_edit',
            'placements',
            'owner_display_name',
        ]

    def get_card_count(self, deck: Deck) -> int:
        return deck.card_count()

    def get_due_count(self, deck: Deck) -> int:
        return rules.due_count(_request_user(self.context), deck)

    def get_can_edit(self, deck: Deck) -> bool:
        return rules.can_edit(_request_user(self.context), deck)

    def get_placements(self, deck: Deck) -> list:
        """Only the placements whose node this reader can actually see. A deck placed on a private
        course and on a public one must not tell a stranger that the private course exists — house
        rule 4 one level down, the same narrowing `node_placements` does from the other end."""
        user = _request_user(self.context)
        out = []
        for placement in deck.placements.all():
            node = placement.node
            if node is None or not node_seam.can_view_node(user, node):
                continue
            out.append(DeckPlacementSerializer(placement, context=self.context).data)
        return out

    def get_owner_display_name(self, deck: Deck) -> str:
        """So a placed deck reads "Kasia's deck" on a course page rather than a numeric id — the
        same field and the same reasoning `study.ExerciseSetSerializer` already carries for a
        shared set."""
        profile = getattr(deck.owner, 'profile', None)
        if profile and profile.display_name:
            return profile.display_name
        return deck.owner.username

    def validate_is_public(self, value: bool) -> bool:
        if not value:
            return value
        reason = rules.public_block_reason(_request_user(self.context), self.instance or Deck())
        if reason:
            raise serializers.ValidationError(reason)
        return value

    def validate_name(self, value: str) -> str:
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('A deck needs a name.')
        return value[:NAME_MAX_LENGTH]


class CardSerializer(serializers.ModelSerializer):
    kind = serializers.SerializerMethodField()
    exercise = serializers.SerializerMethodField()
    concept = serializers.SerializerMethodField()

    class Meta:
        model = Card
        fields = [
            'id',
            'order',
            'kind',
            'exercise',
            'concept',
            'front',
            'back',
            'include_hint',
            'include_solution',
        ]
        read_only_fields = ['id', 'kind', 'exercise', 'concept']

    def get_kind(self, card: Card) -> str:
        return card.kind

    def get_exercise(self, card: Card) -> dict | None:
        if card.exercise_id is None:
            return None
        return _exercise_ref(card.exercise, self.context)

    def get_concept(self, card: Card) -> dict | None:
        if card.concept_id is None:
            return None
        return _concept_ref(card.concept, self.context)


class ReviewStateSerializer(serializers.ModelSerializer):
    """What `POST /api/cards/{id}/grade/` answers: this person's new schedule for that card, and
    nothing about anybody else's."""

    class Meta:
        model = ReviewState
        fields = ['card', 'due_at', 'interval_days', 'ease', 'repetitions', 'lapses', 'updated_at']
        read_only_fields = fields


# ---- write shapes ------------------------------------------------------------------------------


class SourceRefSerializer(serializers.Serializer):
    """`{kind, id}` — where a deck came from. Provenance, not a link: see `Deck.source_kind`.

    `id` is a **string**, not an integer, because the four source kinds are not addressed the same
    way on this site: a lesson and a session are numeric pks, a `study.ExerciseSet` is reached by
    its random slug (`study/views.py: lookup_field = 'slug'`, and the frontend's `ExerciseSet.id`
    IS that slug), and a concept is reached by its slug too. `views.py: _resolve_source` turns
    whichever arrives into the numeric pk `Deck.source_id` stores, and leaves `source_id` null
    rather than refusing when it cannot — "made from a concept" is still true and still worth
    showing even if the concept has since been renamed out from under the deck.
    """

    kind = serializers.ChoiceField(choices=[k for k in SOURCE_KINDS if k])
    id = serializers.CharField(max_length=120)


class NodeRefSerializer(serializers.Serializer):
    """`{kind, id}` — a course or an event. The kind allowlist is `PLACEABLE_NODE_KINDS`, shorter
    than `config.nodes.NODE_KINDS` on purpose (`flashcards/models.py` says why)."""

    kind = serializers.ChoiceField(choices=list(PLACEABLE_NODE_KINDS))
    id = serializers.IntegerField(min_value=1)


class DeckDraftSerializer(serializers.Serializer):
    """`POST /api/decks/`. Everything but `name` is optional, because the three callers want three
    different subsets: the "new deck" form sends a name, "make a deck from this set" sends a name
    plus ids plus a source, and steps C and E send all four."""

    # **No `max_length` here, deliberately** — `validate_name` truncates instead, the way
    # `DeckSerializer.validate_name` already did for the edit path. A field-level `max_length`
    # runs BEFORE `validate_name` and raises, which is the right answer for a name somebody typed
    # (both inputs that do are capped at 120 in the browser) and the wrong one for a name nobody
    # typed: the three "make a deck" buttons GENERATE theirs from a lesson, session or concept
    # title, each of which is `max_length=200` in its own app. A 130-character lesson title then
    # took the whole deck down with a 400 the person could do nothing about, and the button said
    # only "The deck could not be made." Found against the real endpoint by
    # `frontend/e2e/make-a-deck.mjs` (§17BU.D); the create path now agrees with the edit path.
    name = serializers.CharField()
    audience = serializers.ChoiceField(choices=AUDIENCE_VALUES, required=False)
    exercise_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, allow_empty=True
    )
    source = SourceRefSerializer(required=False)
    placement = NodeRefSerializer(required=False)

    def validate_name(self, value: str) -> str:
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('A deck needs a name.')
        return value[:NAME_MAX_LENGTH]


class CardDraftSerializer(serializers.Serializer):
    """`POST /api/decks/{id}/cards/`. Exactly one of the three faces, refused here as a **400**
    rather than left to the database's own `card_exactly_one_face` constraint, which would surface
    as a 500: DRF derives uniqueness validators from `unique_together` but **not** from
    `Meta.constraints` (`backend/CLAUDE.md`, Testing), so a check constraint needs its serializer
    counterpart written by hand or a malformed request becomes an `IntegrityError`."""

    exercise = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    concept = serializers.CharField(required=False, allow_blank=True)
    front = serializers.CharField(max_length=FACE_MAX_LENGTH, required=False, allow_blank=True)
    back = serializers.CharField(max_length=FACE_MAX_LENGTH, required=False, allow_blank=True)
    include_hint = serializers.BooleanField(required=False, default=False)
    include_solution = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        has_exercise = attrs.get('exercise') is not None
        has_concept = bool((attrs.get('concept') or '').strip())
        has_text = bool((attrs.get('front') or '').strip())
        chosen = [has_exercise, has_concept, has_text]
        if sum(1 for flag in chosen if flag) != 1:
            raise serializers.ValidationError(
                'A card is exactly one of: an exercise, a concept, or its own front text.'
            )
        return attrs


class CardEditSerializer(serializers.ModelSerializer):
    """`PATCH /api/cards/{id}/` — the order and the free-text faces. The exercise and the concept
    are deliberately **not** editable: a card that changes which exercise it is about is a
    different card, and its owner's `ReviewState` and `ReviewLog` rows would silently become a
    record of studying something else. Delete it and add the one you meant."""

    class Meta:
        model = Card
        fields = ['order', 'front', 'back', 'include_hint', 'include_solution']


class GradeSerializer(serializers.Serializer):
    grade = serializers.ChoiceField(choices=[value for value, _ in GRADE_CHOICES])
