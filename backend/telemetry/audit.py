"""Writing one `AuditEvent` — the shared half of what `courses/history.py` did for courses alone.

`courses.history.record_content_change` was the first and, for a while, the only thing in this
codebase that ever created an `AuditEvent` row. It is still the right shape; it was simply written
where the first caller happened to live. Co-authoring needs the same row for a different
`target_type` and three different actions — a version published (`content_edit`), a proposal
decided (`moderation_decision`), a co-author added, removed or made owner (`permission_change`) —
which takes this past house rule 13's three strikes, so the body moves here and
`record_content_change` becomes what it always described itself as: `record_audit` with
`action='content_edit'` and `target_type='course'` filled in.

Read `courses/history.py`'s module docstring for WHY this table is the right place for an edit
history at all (`telemetry.AuditEvent` already existed, with `content_edit` among its own action
choices, kept far longer than traffic logs and surviving account deletion in pseudonymised form).
Nothing about that reasoning is course-specific.

The two rules below are the whole reason this is a function rather than four lines at each call
site. Both were learned the hard way, and both are restated in `record_audit`'s own docstring so a
reader who lands on the function never has to come back up here for them.
"""

from telemetry.models import AuditEvent


def record_audit(
    request,
    *,
    action: str,
    target_type: str,
    target_id,
    summary: str,
    detail: dict | None = None,
) -> None:
    """One `AuditEvent` for one accepted write, in the acting user's own log shard.

    `action` is one of `AuditEvent.ACTION_CHOICES` (telemetry/models.py); `target_type`/`target_id`
    say what was acted on, in free text rather than a ContentType FK because this row lives in a
    different SQLite file from `django_content_type` and cannot join to it. `target_id` is coerced
    to a string here so a caller can pass a pk without remembering to.

    **Call this OUTSIDE any `transaction.atomic()` block, after the write it records.**
    `AuditEvent` lives in a completely different SQLite file, which a `default`-database
    transaction can neither roll back nor commit atomically together with the content write.
    Logging after the fact means a failed content write never produces an orphaned log entry for
    something that did not happen — the log recording an action implies the action itself already
    succeeded.

    **Built then `.save()`d rather than `.objects.create(...)`** — deliberately, not a style
    choice. `telemetry.routers.LogShardRouter.db_for_write` picks the shard from the INSTANCE's own
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
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        summary=summary,
        detail=detail if detail is not None else {},
    )
    event.save()
