"""How much there is under each discipline and branch, per audience band — derived, never stored.

The browse pages lead with the reader's audience (owner, 2026-11-02: "we want the audience to be
the primary way of serving materials"). A taxonomy node has no audience of its own and must not get
one: mathematical analysis is not "for" anybody, the exercises under it are. Whether a branch "has
something for primary school" is a fact about other rows, so it is DERIVED here and nothing writes
it (root CLAUDE.md, "a lifecycle is one status field"; house rule 5, recount never increment).

The shape returned for one node is sparse — only non-zero bands appear:

    {"exercises": {"university": 392}, "materials": {"university": 12, "early_years": 3},
     "courses": {"university": 4}}

**Every band, whatever the reader's `?audience=`.** The node lists are cached once per `?lang=`
(`config/cachemw.py`) and preloaded by `preload_cache`; narrowing them per band would multiply those
entries by seven and leave the frontend unable to say "N for other groups". The lens is applied in
the browser, where the "showing for X · N for others · show everything" strip needs both numbers.

**What counts** is what an anonymous reader can open from a list, kind by kind, through each kind's
own visibility rule rather than a copy of it:

- exercises: `published=True` (an auto-hidden one is unpublished, `exercises/models.py`);
- materials: `published=True`;
- courses: `courses.rules.visible_courses(qs, None)` — public, and not under a hidden parent —
  counted under every branch in `subjects`, and under a discipline once (DISTINCT) whether it got
  there through a subject or through `Course.field`.

Counts are language-agnostic: a row counts whatever language it is published in. The lists the
cards lead to narrow by content language as well (`X-EdMat-Hidden-Languages`), so a card can say
12 and the list show 9 with "3 in other languages" — both numbers honest.

Cost: four queries per request, independent of how many nodes are serialized. Events,
tutoring and concepts are not counted yet (left open, HISTORY §17DE).
"""

from collections import defaultdict

from django.db.models import Count

KINDS = ('exercises', 'materials', 'courses')


def _nested():
    return defaultdict(lambda: defaultdict(dict))


def _put(target, kind, rows, node_key):
    for row in rows:
        if row[node_key] is None:
            continue
        target[row[node_key]][kind][row['audience']] = row['n']


def content_counts():
    """`(by_branch_id, by_discipline_id)`, each `{node_id: {kind: {band: n}}}`."""
    from courses.models import Course
    from courses.rules import visible_courses
    from exercises.models import Exercise
    from materials.models import Material

    by_branch = _nested()
    by_discipline = _nested()

    for qs, kind in (
        (Exercise.objects.filter(published=True), 'exercises'),
        (Material.objects.filter(published=True), 'materials'),
    ):
        rows = list(qs.values('branch_id', 'branch__discipline_id', 'audience').annotate(n=Count('id')))
        _put(by_branch, kind, rows, 'branch_id')
        # A row has exactly one branch, so a discipline's count is a plain sum — taken over the
        # rows, not over the published branches, so it matches what `?discipline=` finds.
        totals = defaultdict(int)
        for row in rows:
            totals[(row['branch__discipline_id'], row['audience'])] += row['n']
        for (discipline_id, band), n in totals.items():
            by_discipline[discipline_id][kind][band] = n

    courses = visible_courses(Course.objects.all(), None)
    _put(
        by_branch,
        'courses',
        courses.values('subjects', 'audience').annotate(n=Count('id', distinct=True)),
        'subjects',
    )
    # A course reaches a discipline through any of its subjects OR its own `field`; DISTINCT per
    # (discipline, band) so a course with two subjects in one discipline counts once.
    seen = set()
    for course_id, band, via_subject, via_field in courses.values_list(
        'id', 'audience', 'subjects__discipline_id', 'field_id'
    ):
        for discipline_id in (via_subject, via_field):
            if discipline_id is not None:
                seen.add((discipline_id, band, course_id))
    totals = defaultdict(int)
    for discipline_id, band, _ in seen:
        totals[(discipline_id, band)] += 1
    for (discipline_id, band), n in totals.items():
        by_discipline[discipline_id]['courses'][band] = n

    return by_branch, by_discipline


def counts_for(context, node_kind, node_id):
    """The counts for one node, computing the whole map once per serializer context.

    A `many=True` serializer shares one context dict across its children, so a list of N nodes
    still costs the four queries once, not N times.
    """
    cached = context.get('_taxonomy_counts')
    if cached is None:
        cached = content_counts()
        context['_taxonomy_counts'] = cached
    by_branch, by_discipline = cached
    source = by_branch if node_kind == 'branch' else by_discipline
    node = source.get(node_id, {})
    return {kind: dict(node.get(kind, {})) for kind in KINDS}
