"""Take home — what a programme session hands the room to keep (`prompts/06-event-takeaways.md`).

One question, asked in two places, so it lives here and both ask it (root `CLAUDE.md`, boundary 2):
**which exercises does this session point at?** `GET /api/events/{id}/sessions/{sid}/exercises/`
answers it as a list, and `SessionSerializer.takehome_count` answers it as a number so the
programme can decide whether to draw the button at all. A serializer that counted links itself
and an endpoint that resolved set membership would be two answers to one question, and the button
would appear for a session whose only exercise was unpublished.

Three decisions worth the words:

- **A linked set is read THROUGH the session, even when the set is private.** `study.ExerciseSet`
  is private by default and `ExerciseSetViewSet.retrieve` refuses a stranger — but an organiser
  who puts a set on a published programme has published its *membership* to that room, which is
  the whole point of the link. So this reads `study.ExerciseSetItem` directly, read-only, and
  never consults `is_public`. Nothing is copied: the ids are live references
  (`00-DESIGN.md` §1 rule 2), and the snapshot happens later, in the deck.

- **Order is the programme's order.** Links come back in `SessionLink.Meta.ordering`
  (`order`, `id`) — the order the organiser arranged them in — and a set contributes its own
  items in `ExerciseSetItem.Meta.ordering`. First occurrence wins when an exercise appears twice
  (linked directly *and* inside a set), so a deck made from this never holds the same card twice.

- **Unpublished exercises are dropped.** `published=False` is what this codebase's every exercise
  surface excludes (it is also how moderation's auto-hide takes an exercise down —
  `exercises/models.py: auto_hidden_at`), and `GET /api/exercises/bulk/`, which is what the review
  screen will load these with, filters on exactly that. A link to an exercise that has since been
  hidden is honestly absent rather than a card with no front.
"""


def session_exercises(session) -> list:
    """Every published exercise this session points at, in programme order, deduplicated.

    Reads prefetched caches when the caller's queryset supplied them (`_session_queryset()` in
    `agenda_views.py` does, which is what keeps a programme of forty sessions from costing a query
    per link) and works correctly, just with its own queries, when it did not.
    """
    picked: list = []
    seen: set[int] = set()

    def take(exercise):
        if exercise is None or not exercise.published or exercise.pk in seen:
            return
        seen.add(exercise.pk)
        picked.append(exercise)

    for link in session.links.all():
        if link.exercise_id:
            take(link.exercise)
        elif link.exercise_set_id:
            for item in link.exercise_set.exercisesetitem_set.all():
                take(item.exercise)
    return picked


def session_exercise_count(session) -> int:
    """How many there are — the number the programme reads to decide whether the "Take home"
    button means anything for this session. Deliberately `len()` of the list above rather than a
    cheaper `COUNT`: two queries that disagree about what counts is the drift this module exists
    to prevent, and the rows are already in memory (house rule 5 — recount, never track)."""
    return len(session_exercises(session))
