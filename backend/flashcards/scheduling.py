"""SM-2, as one pure function. No queries, no models, no clock of its own.

`review(state, grade, now) -> state` takes a plain dict and returns a plain dict. That shape is the
point: the schedule is the one piece of this app that is pure arithmetic, so it is testable as a
**table of grade sequences and expected intervals** (`flashcards/tests.py: SchedulingTests`) rather
than through an endpoint, and `flashcards/rules.py: apply_grade` is the only thing that ever turns
the answer into a row. `now` is passed in for the same reason — a function that reads the clock
cannot be tested against a table.

## The algorithm, and where it departs from the paper

SM-2 (Wozniak, 1987) grades 0–5 and treats anything below 3 as a failure. This site offers **four**
buttons (00-DESIGN.md §4.2) because four is as many distinctions as somebody pressing a key can
honestly make: 1 again, 2 hard, 3 good, 4 easy. They map onto the paper's behaviour like this:

| grade | ease | repetitions | interval |
|---|---|---|---|
| 1 again | −0.20 | reset to 0, `lapses` +1 | **0 — due now**, so it comes back in this session |
| 2 hard | −0.15 | +1 | 1, then 3, then `× 1.2` |
| 3 good | unchanged | +1 | 1, then 6, then `× ease` |
| 4 easy | +0.15 | +1 | 2, then 8, then `× ease × 1.3` |

Two deliberate choices:

- **A lapse is due again immediately, not tomorrow.** The paper has no concept of a study session;
  a person pressing "again" means "I did not know that, show me again". An interval of 0 with
  `due_at = now` is what makes the card reappear in the same queue, and it is also why
  `GET /api/decks/{id}/review/` is safe to re-request — the queue is recomputed, never held.
- **The ease factor is clamped to [1.3, 3.0].** 1.3 is SM-2's own floor. The ceiling is ours: a run
  of "easy" presses on an unclamped ease schedules a card years out, which is not a schedule, it is
  a deletion with extra steps.

`interval_days` is a whole number of days and "due" is read on the server's day
(`flashcards/rules.py`), because there is no per-account timezone on this site (root `CLAUDE.md`,
known gaps) and a half-day precision nobody can act on would be a lie dressed as rigour.
"""

from datetime import timedelta

from .models import DEFAULT_EASE, MAX_EASE, MIN_EASE

#: Two years. Not a judgement about memory — a bound, so that a stored interval cannot grow past
#: anything a person would recognise as a review schedule.
MAX_INTERVAL_DAYS = 730

#: How the ease factor moves per grade. `3` ("good") is deliberately 0.0: an answer that came out
#: right at the interval the schedule chose is evidence the schedule was right, not that it should
#: change.
_EASE_DELTA = {1: -0.20, 2: -0.15, 3: 0.0, 4: +0.15}

#: The first two intervals per grade, in days — the "learning steps". After them the interval is
#: multiplied (`_GROWTH` below) rather than looked up.
_FIRST_STEPS = {2: (1, 3), 3: (1, 6), 4: (2, 8)}


def _growth(grade: int, ease: float) -> float:
    if grade == 2:
        # "Hard" grows, but barely: the card was recalled, so it is not a lapse, and an interval
        # that stood still would make "hard" and "again" the same button.
        return 1.2
    if grade == 4:
        return ease * 1.3
    return ease


def initial_state() -> dict:
    """A card nobody has graded yet. `due_at` is absent on purpose — a new card has no due date,
    it is simply *new*, which is a different thing the queue counts separately."""
    return {
        'interval_days': 0,
        'ease': DEFAULT_EASE,
        'repetitions': 0,
        'lapses': 0,
        'due_at': None,
    }


def review(state: dict | None, grade: int, now) -> dict:
    """The next schedule for one card, given its current one and the grade just pressed.

    `state` may be `None` (or any dict missing keys) — a card being graded for the first time. The
    returned dict carries exactly the five keys `ReviewState` stores, so the caller writes it
    straight through without knowing anything about the algorithm.

    Raises `ValueError` for a grade outside 1–4: a grade is validated at the serializer (400 to the
    client) and a bad one reaching here is a programming error, not a request.
    """
    if grade not in _EASE_DELTA:
        raise ValueError(f'grade must be 1, 2, 3 or 4 — got {grade!r}')

    current = {**initial_state(), **(state or {})}
    ease = float(current['ease'] or DEFAULT_EASE)
    repetitions = int(current['repetitions'] or 0)
    lapses = int(current['lapses'] or 0)
    interval = int(current['interval_days'] or 0)

    ease = min(MAX_EASE, max(MIN_EASE, ease + _EASE_DELTA[grade]))

    if grade == 1:
        # A lapse: the ladder is climbed again from the bottom, and the card is due now rather
        # than tomorrow (see the module docstring).
        repetitions = 0
        lapses += 1
        interval = 0
    else:
        first, second = _FIRST_STEPS[grade]
        if repetitions == 0:
            interval = first
        elif repetitions == 1:
            interval = second
        else:
            interval = max(1, round(interval * _growth(grade, ease)))
        repetitions += 1

    interval = min(interval, MAX_INTERVAL_DAYS)
    return {
        'interval_days': interval,
        # Rounded so that a float's own drift never shows up in an API response as 2.4499999999.
        'ease': round(ease, 4),
        'repetitions': repetitions,
        'lapses': lapses,
        'due_at': now if interval == 0 else now + timedelta(days=interval),
    }


__all__ = ['MAX_INTERVAL_DAYS', 'initial_state', 'review']
