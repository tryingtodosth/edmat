"""What this app contributes to a person's learning record, per `taxonomy.Branch`.

Step B (`prompts/03-learning-record.md`) owns the record itself: `identity/record.py` holds the
registry, the consent flag and the endpoint, and the integrator registers this function in it
(`prompts/README.md` §5 rule 13 — a hook another step must wire lives in *this* app, and this app
never imports `identity/`). The shape is fixed there: ``{branch_id: {metric: count}}``.

**Counts, never rows** (`00-DESIGN.md` §4.4 and rule 3). "Seven lessons done in Analysis I" is what
goes on a profile; *which* seven, and when, is between a person and the course they are in. Grouping
by Branch is what lets an imported grade and an EdMat count sit in one table without pretending to
be the same kind of thing — the design says that out loud and §3 forbids presenting one as the
other.

**A statement, not a measurement.** Every number here comes from `LessonProgress`, which is a button
somebody pressed about their own work (`models.py: LessonProgress`). The metric name says so by
being `lessons_done` rather than `lessons_completed`, and the profile's own copy repeats it.

**This reads; it never widens.** `Course.progress_visibility` governs who may see somebody's rows
*inside a course*; it is deliberately not consulted here, because this is the person's own record
being shown under their own `share_activity` consent, and a course that keeps its tracker private
has said nothing about what its participants may say about themselves. The consent that matters is
the profile's, and step B checks it before ever calling this.
"""

from __future__ import annotations

from .models import LessonProgress


def activity_by_branch(user) -> dict[int, dict[str, int]]:
    """``{branch_id: {'lessons_done': n}}`` for this account.

    A lesson is counted once per branch its course claims (`Course.subjects` is a many-to-many: a
    course on numerical methods legitimately sits under both Analysis and Programming), so the sum
    over branches can exceed the number of lessons. That is the honest reading of "work done in this
    subject" and the alternative — picking one branch per course — would be the client inventing a
    primary subject the course never declared. A course with no branches at all contributes nothing,
    because there is no row in the table for it to land in.

    One query, grouped in Python rather than by the database: the values list is one row per
    (progress, branch) pair for one person, which is bounded by how many lessons they have ticked
    off, and `values_list` over an indexed FK is the cheap half of this function either way.
    """
    if not (user and getattr(user, 'is_authenticated', False)):
        return {}
    pairs = LessonProgress.objects.filter(participant=user, status='done').values_list(
        'lesson__chapter__course__subjects', flat=False
    )
    counts: dict[int, dict[str, int]] = {}
    for (branch_id,) in pairs:
        if branch_id is None:
            continue
        counts.setdefault(branch_id, {'lessons_done': 0})['lessons_done'] += 1
    return counts
