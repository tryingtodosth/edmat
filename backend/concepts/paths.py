"""The prerequisite closure — "know this first", walked further than one hop.

`ConceptLink(relation='prerequisite')` already says it one edge at a time: a row on *eigenvalue*
pointing at *linear map* means "to read this, know that first". One hop is what the concept's own
page has always shown. What a reader actually wants to be told, standing in front of an exercise
they cannot start, is the whole chain — *linear map*, and before that *vector space* — and that is
a graph walk, which is the one shape a chip row cannot grow into by itself.

Three things bound it, and all three are the point rather than a safety net:

* **Depth ≤ 4.** Past four hops the answer stops being "before this, know…" and becomes a syllabus.
  A reader who needs six prerequisites needs a course, which is step C's job and is named in the
  brief's "left open".
* **≤ 20 concepts.** The walk is breadth-first, so a truncation drops the FARTHEST rungs rather
  than the nearest — the ones that matter least to somebody who is stuck right now.
* **Cycles cut.** Nothing is visited twice and the seeds themselves are never in the answer, so
  *a → b → a* answers `[b]` instead of looping. The data really can contain one: two people each
  filing the pair from their own end is an honest disagreement about which comes first, not a bug
  to refuse at write time (`ConceptLink.clean()` only refuses a self-link).

**Pure over `ConceptLink`** — no request, no user, no visibility. That split is deliberate: the
walk is one fact about the graph, and *who may see each rung* is a different question with an
answer that already exists (`access.visible_concepts`), asked by the two endpoints afterwards. It
does mean an invisible concept can sit in the MIDDLE of a chain and be counted as a hop while being
dropped from the answer; the alternative — passing a pool in — would have made the walk depend on
the caller and the distances disagree between two readers of the same page, which is worse. Said
out loud rather than hidden.

Order is `(distance, slug)`, which is "distance, then title" as closely as this app can mean it: a
concept has no title (`concepts/CLAUDE.md`'s first invariant), and the slug is the database's best
stand-in for one — `ConceptViewSet.list` says the same thing about its own ordering. The endpoints
resolve a real title per reader afterwards and keep this order, because re-sorting by a resolved
title would put a nearer prerequisite below a farther one and the nearest-first promise is the
whole shape of the answer.

Cost: one `values_list` per level plus one fetch per level — at most eight queries for the deepest
legal walk, whatever the size of the graph. `PathTests.test_the_walk_is_bounded_in_queries` pins it.
"""

from __future__ import annotations

from collections.abc import Iterable

#: The ceilings. A caller may ask for less; it may not ask for more, because these are what make
#: the endpoint's cost independent of the shape of the graph.
MAX_DEPTH = 4
MAX_CONCEPTS = 20


def prerequisite_closure(concepts: Iterable, *, depth: int = MAX_DEPTH, limit: int = MAX_CONCEPTS):
    """`[(concept, distance), …]` — everything to know before the given concepts, nearest first.

    The seeds are not in the answer: they are what the reader is looking at. `distance` is the
    number of `prerequisite` hops from the nearest seed, so 1 is "directly before this".

    `depth` and `limit` are clamped to `MAX_DEPTH` / `MAX_CONCEPTS` rather than trusted, so a query
    parameter that ever reaches them cannot turn a page read into a full graph export.
    """
    from django.contrib.contenttypes.models import ContentType

    from .models import Concept, ConceptLink

    seed_ids = {concept.pk for concept in concepts if getattr(concept, 'pk', None)}
    if not seed_ids:
        return []

    depth = max(0, min(int(depth), MAX_DEPTH))
    limit = max(0, min(int(limit), MAX_CONCEPTS))
    if depth == 0 or limit == 0:
        return []

    concept_ct = ContentType.objects.get_for_model(Concept)
    # The seeds start out "seen", which is what cuts a cycle back to one of them.
    seen = set(seed_ids)
    frontier = list(seed_ids)
    out: list[tuple] = []

    for distance in range(1, depth + 1):
        if not frontier:
            break
        found = set(
            ConceptLink.objects.filter(
                concept_id__in=frontier, relation='prerequisite', content_type=concept_ct
            ).values_list('object_id', flat=True)
        ) - seen
        if not found:
            break
        seen |= found
        # Ordered by slug HERE, in the database, so that a truncation at `limit` keeps the same
        # rungs on every run — a non-deterministic cut would make the line on an exercise page
        # change between two reloads for no reason the reader could see.
        level = list(Concept.objects.filter(pk__in=found).order_by('slug'))
        for concept in level:
            if len(out) >= limit:
                return out
            out.append((concept, distance))
        frontier = [concept.pk for concept in level]

    return out


__all__ = ['MAX_CONCEPTS', 'MAX_DEPTH', 'prerequisite_closure']
