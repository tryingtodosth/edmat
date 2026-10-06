"""`flashcards.record.activity_by_branch(user)` — the learning-record provider shape
(prompts/03-learning-record.md §Shapes).

**Not imported anywhere on this branch**, and this module imports nothing from `identity/` either
(prompts/README.md §5 rule 13: a hook another step must wire goes in *your* app as a small module
the brief names, and the integrator registers it). The integrator calls
`identity.record.register_activity_provider(flashcards.record.activity_by_branch)` at integration.

One metric, `cards_reviewed`, counted per `taxonomy.Branch` — which is the whole of 00-DESIGN.md §1
rule 3 and §4.4 made concrete:

- **Counts, never cards.** The record says "300 cards reviewed in Analysis I". It never says which
  cards, when, or how well — `ReviewLog` rows are read in aggregate here and nowhere else.
- **Per Branch, because that is what makes the two blocks sit in one table honestly.** "4.5 in
  Analysis I" and "300 cards reviewed in Analysis I" line up without either pretending to be the
  other, and an EdMat activity count is never presented *as* a grade (§1 rule 3, last sentence).
- **Recounted on every read** (house rule 5): two `COUNT`s over an indexed FK are cheap and cannot
  drift, and `ReviewLog` is append-only so there is nothing to keep in step.
- **Behind `share_activity`**, which is step B's flag — this function does not check it, because a
  provider that decided its own consent would be a second place the consent lives. `identity`
  calls providers only when the flag is on.

Only **exercise** cards contribute, because `Exercise.branch` is the only route from a card to a
Branch (`exercises/models.py` — a direct FK, no topic model in between). A concept card has
`Concept.branches`, a many-to-many, so one review would have to be counted once per branch or
split between them, and neither is a number anybody asked for; a free-text card has no branch at
all. Both are named in "Left open" rather than guessed at.
"""

from django.db.models import Count

from .models import ReviewLog


def activity_by_branch(user) -> dict[int, dict[str, int]]:
    """`{branch_id: {'cards_reviewed': n}}` for this person. `{}` for an anonymous caller or
    somebody who has never graded a card — never `None`, so the registry can merge providers
    without each one's empty case needing a branch of its own."""
    if not (user is not None and getattr(user, 'is_authenticated', False)):
        return {}
    rows = (
        ReviewLog.objects.filter(user=user, card__exercise__isnull=False)
        .values('card__exercise__branch_id')
        .annotate(reviews=Count('id'))
    )
    return {
        row['card__exercise__branch_id']: {'cards_reviewed': row['reviews']}
        for row in rows
        if row['card__exercise__branch_id'] is not None
    }


__all__ = ['activity_by_branch']
