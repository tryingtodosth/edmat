"""Flashcards — decks, cards, a per-person review schedule, and where a deck is placed
(prompts/02-flashcards.md, learning step A; the design is prompts/00-DESIGN.md §2).

Five models and one idea each:

- **`Deck`** is somebody's own pile of cards. It carries where it came from (`source_kind` /
  `source_id` / `source_set`) as *provenance*, never as a live link: a deck made from a set, a
  lesson or a session is a **membership snapshot**, exactly the shape `courses.LessonExerciseSet`
  already documents at length — the list of cards is copied once, and every card's *content* is a
  live FK, so a corrected statement reaches the deck and a later edit to the source set does not.
  `source_set` is SET_NULL for the same reason that model's is: a deleted set must leave the deck
  standing.
- **`Card`** is one front/back. Exactly one of three things: an exercise, a concept, or free text,
  enforced by a `CheckConstraint` spelled out in three explicit branches (the
  `courses.CourseItem.course_item_exactly_one_target` idiom — this is the constraint somebody
  adding a fourth kind will read, so it should show them exactly what to write). For an exercise
  or a concept card the faces are **resolved at read time** from the content itself; `front`/`back`
  are the free-text card's own words and are empty for the other two.
- **`ReviewState`** is one person's schedule for one card. Unique per `(user, card)`: a deck placed
  on a course is studied by thirty people and each of them has their own. This is the first
  *measurement* this site holds about a learner (00-DESIGN.md §1 rule 3), so it is private by
  construction — no endpoint anywhere answers with somebody else's row.
- **`ReviewLog`** is append-only: one row per grade pressed. `flashcards/record.py` aggregates it
  per `taxonomy.Branch` and nothing else ever reads an individual row back out.
- **`DeckPlacement`** is "this deck is on that course / that event", a `GenericForeignKey` resolved
  through `config/nodes.py` — never an FK to `Course` or `Event`, and never a sixth `CourseItem`
  kind (00-DESIGN.md §1 rule 4: no field on a shared model; prompts/README.md §5 rule 1: no
  migration outside your own app). It is also this cycle's **sharing mechanism**: a placed deck is
  studyable by everybody who can view the node (the integrator's decision of 2026-10-05, written
  up in `flashcards/CLAUDE.md`), while `is_public` — world-readable — stays off and closed to
  minors.

`SOURCE_KIND_CHOICES` and the grade scale are mirrored by hand in
`frontend/src/lib/utils/labels.ts`, which says so from its side (house rule 13).
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from config.audience import AUDIENCE_CHOICES, DEFAULT_AUDIENCE
from config.sanitize import sanitize_content

#: Where a deck came from. `''` is "somebody made this by hand", which is the honest answer for a
#: deck built card by card and is deliberately not a sixth word meaning the same thing. `source_id`
#: is the lesson / session / concept id the deck was built from, kept as a plain integer rather than
#: four nullable FKs: it is provenance for a line of text ("made from week 3"), not something this
#: app ever joins on, and four FKs would be four migrations in three other apps' tables.
SOURCE_KIND_CHOICES = [
    ('', 'Made by hand'),
    ('set', 'An exercise set'),
    ('lesson', 'A course lesson'),
    ('session', 'An event session'),
    ('concept', 'A concept'),
]
SOURCE_KINDS = [value for value, _ in SOURCE_KIND_CHOICES]

#: The four grades, 1 again / 2 hard / 3 good / 4 easy (00-DESIGN.md §4.2). Four rather than SM-2's
#: own six because a person pressing a button can honestly tell these four apart;
#: `flashcards/scheduling.py` maps them onto the algorithm.
GRADE_CHOICES = [
    (1, 'Again'),
    (2, 'Hard'),
    (3, 'Good'),
    (4, 'Easy'),
]
GRADE_VALUES = [value for value, _ in GRADE_CHOICES]

#: The starting ease factor, and the band it is held in. SM-2's own floor is 1.3; the ceiling is
#: ours, so one run of "easy" presses cannot schedule a card past the point of being studied.
DEFAULT_EASE = 2.5
MIN_EASE = 1.3
MAX_EASE = 3.0

FACE_MAX_LENGTH = 4000
NAME_MAX_LENGTH = 120

#: The node kinds a deck may be placed on. Deliberately SHORTER than `config.nodes.NODE_KINDS` —
#: the registries across this codebase are different lengths on purpose (root `CLAUDE.md`: a
#: thread makes sense on a coverage claim, a photo album does not). A deck on a course or an event
#: is "study this before week 3" / "take this home"; a deck on a *material* or an *organisation*
#: answers no question anybody asked, and a kind nobody can see the point of is a kind whose
#: visibility rule nobody checks.
#:
#: `contest` joined on 2026-10-09 (CONTESTS-BRIEF.md §3.B) and earns it for the same reason an event
#: does: a contest has people getting ready for a specific afternoon, and "practise these before the
#: first stage" is the deck an organiser already wants to hand them. `can_study` then makes it
#: studyable by everybody who can VIEW the contest, which for a draft is nobody but its staff and
#: after the announcement is anyone — exactly the contest's own visibility, with no second rule.
#: An `organization` and a `material` are still out: neither has a cohort getting ready for a date.
PLACEABLE_NODE_KINDS = ('course', 'event', 'contest')


class Deck(models.Model):
    """One person's deck. `owner` is the only authority over it (`flashcards/rules.py: can_edit`);
    who may *study* it is a wider question with three answers, and `can_study` is where it lives."""

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='decks', on_delete=models.CASCADE
    )
    name = models.CharField(max_length=NAME_MAX_LENGTH)
    # Who this is for — the same axis every content-bearing model carries (`config/audience.py`,
    # AUDIENCE-BRIEF.md §1), and the same default and reasoning `study.ExerciseSet` records.
    audience = models.CharField(
        max_length=12, choices=AUDIENCE_CHOICES, default=DEFAULT_AUDIENCE, db_index=True
    )
    # World-readable. Off by default and a minor may not turn it on (`rules.public_block_reason`).
    # NOT how a deck is shared in this cycle — `DeckPlacement` is (00-DESIGN.md §4.1 as amended by
    # prompts/README.md §9); this field is the later, public-library step and exists now so that the
    # read shape does not change when it arrives.
    is_public = models.BooleanField(default=False)
    source_kind = models.CharField(
        max_length=10, choices=SOURCE_KIND_CHOICES, blank=True, default=''
    )
    source_id = models.PositiveIntegerField(null=True, blank=True)
    # Provenance for the one source this app can really point at, and the "re-copy from here"
    # affordance a later step may want. SET_NULL, never CASCADE: deleting the set must not delete
    # the homework somebody has been studying for a fortnight (`courses.LessonExerciseSet`'s own
    # note, same decision).
    source_set = models.ForeignKey(
        'study.ExerciseSet',
        related_name='decks',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self) -> str:
        return f'{self.name} (owned by {self.owner})'

    def card_count(self) -> int:
        """A `COUNT` over an indexed FK, recomputed on every read — never a tally on the row
        (house rule 5: recount, never increment)."""
        return self.cards.count()


class Card(models.Model):
    """One card. Exercise XOR concept XOR free text, by database constraint.

    An exercise card does **not** store the statement: the review screen loads a deck's exercises
    in one request through `GET /api/exercises/bulk/?ids=`, which already asks
    `exercises/entries.py: visible_entries` for the hint and solution pool, so the faces are the
    live content and the pool's own visibility rule is never re-implemented here. Same for a
    concept: `concepts/resolve.py: resolve_page` answers which revision this reader gets, and its
    title and summary are the two faces.
    """

    deck = models.ForeignKey(Deck, related_name='cards', on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)
    exercise = models.ForeignKey(
        'exercises.Exercise',
        related_name='flashcards',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    concept = models.ForeignKey(
        'concepts.Concept',
        related_name='flashcards',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
    )
    # The free-text card's own two faces. Markdown with literal LaTeX delimiters, like every other
    # content field here, sanitized on write in `save()` below (house rule 8).
    front = models.TextField(blank=True, default='')
    back = models.TextField(blank=True, default='')
    # For an exercise card: show the hint, and the pinned solution, as optional reveals behind the
    # back face. The same per-item "what to include beyond the statement" `study.ExerciseSetItem`
    # already persists, and persisted here for the same reason: it is a property of the card
    # somebody made, not a checkbox in one browser session.
    include_hint = models.BooleanField(default=False)
    include_solution = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']
        constraints = [
            # Exactly one of the three, enforced by the database. Three explicit branches rather
            # than something clever, for the reason `courses.CourseItem`'s own version of this
            # states: it is the constraint most likely to be read by somebody adding a fourth
            # kind, and it should show them exactly what to write.
            models.CheckConstraint(
                condition=(
                    models.Q(exercise__isnull=False, concept__isnull=True)
                    | models.Q(exercise__isnull=True, concept__isnull=False)
                    # A free-text card is "neither FK set, and it has a front" — an empty front
                    # with no FK either is a card with nothing on it at all, which is the row this
                    # branch exists to refuse. Parenthesised rather than relying on `&` binding
                    # tighter than `|`: the precedence is right, but a reader should not have to
                    # know that to read a constraint.
                    | (
                        models.Q(exercise__isnull=True, concept__isnull=True)
                        & ~models.Q(front='')
                    )
                ),
                name='card_exactly_one_face',
            ),
        ]

    def __str__(self) -> str:
        return f'card {self.order} of {self.deck_id}'

    @property
    def kind(self) -> str:
        if self.exercise_id is not None:
            return 'exercise'
        if self.concept_id is not None:
            return 'concept'
        return 'text'

    def save(self, *args, **kwargs):
        # Both faces render through `MathContent` on the review screen, so both are content and
        # both are sanitized on write — the one choke point every rich-text field on this site
        # goes through (`config/sanitize.py`, house rule 8). The read side is DOMPurify, never
        # the only line.
        self.front = sanitize_content(self.front or '')[:FACE_MAX_LENGTH]
        self.back = sanitize_content(self.back or '')[:FACE_MAX_LENGTH]
        super().save(*args, **kwargs)


class ReviewState(models.Model):
    """One person's schedule for one card. Written only by `flashcards/rules.py: apply_grade`,
    which hands the arithmetic to the pure function in `flashcards/scheduling.py`.

    `due_at` is a real timestamp, but "due" is read on the **server's day** (00-DESIGN.md §4.3):
    there is no per-account timezone on this site (root `CLAUDE.md`, known gaps), so a card
    scheduled for tomorrow becomes due at the start of tomorrow in `settings.TIME_ZONE` and
    pretending otherwise would be a lie dressed as precision.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='review_states', on_delete=models.CASCADE
    )
    card = models.ForeignKey(Card, related_name='review_states', on_delete=models.CASCADE)
    due_at = models.DateTimeField(db_index=True)
    interval_days = models.PositiveIntegerField(default=0)
    ease = models.FloatField(default=DEFAULT_EASE)
    repetitions = models.PositiveIntegerField(default=0)
    lapses = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'card'], name='unique_review_state_per_card'),
        ]
        indexes = [models.Index(fields=['user', 'due_at'])]

    def __str__(self) -> str:
        return f'{self.user} on card {self.card_id} (due {self.due_at:%Y-%m-%d})'


class ReviewLog(models.Model):
    """Append-only. One row per grade pressed, and nothing ever updates or deletes one.

    Read back only in aggregate: `flashcards/record.py: activity_by_branch` counts rows per
    `taxonomy.Branch` for the learning record (step B), which is counts-only, per-Branch and
    behind its own consent flag (00-DESIGN.md §4.4). No endpoint in this app answers with a log
    row, and `interval_before` is here so that a future analysis of how well the schedule works
    does not need the state's history reconstructed from nothing.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='review_logs', on_delete=models.CASCADE
    )
    card = models.ForeignKey(Card, related_name='review_logs', on_delete=models.CASCADE)
    grade = models.PositiveSmallIntegerField(choices=GRADE_CHOICES)
    reviewed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    interval_before = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['-reviewed_at', '-id']
        indexes = [models.Index(fields=['user', 'reviewed_at'])]

    def __str__(self) -> str:
        return f'{self.user} graded card {self.card_id} {self.grade}'


class DeckPlacement(models.Model):
    """A deck put on a course or an event, through the shared node seam (`config/nodes.py`).

    Placing needs `can_manage_node`; seeing a placement needs `can_view_node`; and a placement is
    what makes the deck studyable by everybody who can view that node
    (`flashcards/rules.py: can_study`). The kind allowlist is `PLACEABLE_NODE_KINDS` above and is
    checked in `rules.place_block_reason`, which answers the word `kind` for anything else.
    """

    deck = models.ForeignKey(Deck, related_name='placements', on_delete=models.CASCADE)
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    node = GenericForeignKey('content_type', 'object_id')
    order = models.PositiveIntegerField(default=0)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='deck_placements',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']
        constraints = [
            # The same deck twice on one course is one decision recorded twice with no way to say
            # which is meant. A plain unique constraint rather than a partial one: unlike
            # `courses.LessonExerciseSet`, neither column is ever NULL here, so NULLs-do-not-compare
            # -equal never arises.
            models.UniqueConstraint(
                fields=['deck', 'content_type', 'object_id'], name='unique_deck_per_node'
            ),
        ]
        indexes = [models.Index(fields=['content_type', 'object_id'])]

    def __str__(self) -> str:
        return f'{self.deck.name} on {self.content_type.model} {self.object_id}'
