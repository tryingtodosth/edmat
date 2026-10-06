"""`flashcards.work_items(user)` — the work-dashboard provider shape (`work/CLAUDE.md`).

**Not imported anywhere on this branch**, and this module imports nothing from `work/` either
(prompts/README.md §5 rule 13). The integrator adds the two-line registration at integration:

```python
register('cards_due', 'flashcards', flashcards.work.work_items)
```

One row per deck that has cards ready, carrying the **count** rather than one row per card — the
same decision `needs/work.py` records for a need with fifteen applicants: a dashboard is a list of
things to look at, and "47 cards due in Analiza I" is one thing to look at.

`urgency` is 1 or 2, never 3: cards being due is not a deadline anybody can miss. A card waiting a
week is still the same card, so "overdue" (3) would be a word this feature has no honest use for —
2 marks a deck with a real backlog (`_BACKLOG`), 1 a deck with a handful.
"""

from . import rules

#: Where "a few cards" becomes "a backlog". Twenty is roughly one sitting; past that the deck is
#: something to plan for rather than clear on the way past.
_BACKLOG = 20


def work_items(user) -> list[dict]:
    if not (user is not None and getattr(user, 'is_authenticated', False)):
        return []
    items: list[dict] = []
    for deck in rules.my_study_decks(user):
        due = rules.due_count(user, deck)
        if due == 0:
            continue
        items.append(
            {
                'kind': 'cards_due',
                'title': deck.name,
                'url': f'/flashcards/{deck.pk}/review',
                # A review schedule has no deadline — see the module docstring.
                'due_at': None,
                'status': f'{due} due',
                'urgency': 2 if due >= _BACKLOG else 1,
                # A deck may sit on several nodes or on none; a work row names one thing, so the
                # node is deliberately omitted rather than picking one of them arbitrarily. The
                # deck's own page lists every placement.
                'node': None,
            }
        )
    items.sort(key=lambda row: (-row['urgency'], row['title']))
    return items


__all__ = ['work_items']
