"""Recording who changed a course's structure, and when.

Lives outside `courses` own tables on purpose, in `telemetry.AuditEvent` — see that model's own
docstring for the full reasoning (a separate, sharded-by-user SQLite file, kept far longer than
ordinary traffic logs). That model already existed, with `content_edit` as one of its own action
choices, and a test proving the shard write works — but nothing in this codebase actually created
one until this file. Reusing it here is exactly the "some other place, specifically for history"
this project already built, not a second logging system next to it.

The concurrency story this exists for: `CourseViewSet.reorder`/`chapter_detail`/`lesson_detail` do
not lock anything, so two curators racing the same chapter is a real, unremarkable "newer write
wins" — whichever PATCH the database applies last is what every later reader sees. That is the
correct behaviour for a low-stakes structural edit (nobody wants a drag-and-drop to fail with a
409 because somebody else moved a different lesson a moment earlier), but it means the LOSING
write would otherwise vanish with no trace it ever happened. `record_content_change` is called
once per accepted request, win or lose — the log is what still answers "did I actually do this"
independent of whose write the database ended up keeping.
"""

from telemetry.models import AuditEvent


def record_content_change(request, course, *, summary: str, detail: dict) -> None:
    """One `AuditEvent` for one accepted write against `course`'s own structure.

    Deliberately outside the write's own `transaction.atomic()` block (every call site here runs it
    right after the block, not inside it): `AuditEvent` lives in a completely different SQLite file,
    which a `default`-database transaction can neither roll back nor commit atomically together with
    the content write. Logging after the fact means a failed content write never produces an
    orphaned log entry for something that didn't happen — the log recording an action implies the
    action itself already succeeded.

    Built then `.save()`d rather than `.objects.create(...)` — deliberately, not a style choice.
    `telemetry.routers.LogShardRouter.db_for_write` picks the shard from the INSTANCE's own
    `actor_id`, but `QuerySet.create()` resolves which database to use before that instance exists
    (it reads `self.db`, computed from the queryset's own hints, then constructs the row) — so the
    router sees no instance to read `actor_id` off and falls back to `default`, which has no
    `telemetry_auditevent` table at all (`allow_migrate` keeps every telemetry model OFF `default`
    on purpose). A plain model `.save()` passes `instance=self` to the router correctly, which is
    exactly the difference between this working and raising `OperationalError: no such table`.
    """
    event = AuditEvent(
        actor_id=request.user.id,
        actor_label=getattr(request.user, 'username', ''),
        action='content_edit',
        target_type='course',
        target_id=str(course.pk),
        summary=summary,
        detail=detail,
    )
    event.save()
