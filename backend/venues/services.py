"""Instantiating a checklist, keeping its due dates honest, and offering a building's later edits.

Three functions, all of them about the one decision this app makes that is not obvious: a checklist
instance is a **snapshot**. `instantiate` copies every word; `sync_new_items` adds what the building
has since written and touches nothing that exists; `recompute_due_dates` re-derives the clock when
the event moves.
"""

from datetime import timedelta

from django.db import transaction

from .models import ChecklistInstance, ChecklistInstanceItem

#: The fields copied verbatim from a template item into an instance item. Named once, because a
#: field added to the template and forgotten here is an item that silently loses its rule.
SNAPSHOT_FIELDS = (
    'title_en',
    'title_pl',
    'description_en',
    'description_pl',
    'owner_role',
    'due_offset_minutes',
    'anchor',
    'is_mandatory',
    'na_allowed',
    'evidence_kind',
    'requires_venue_signoff',
    'order',
)


def due_at_for(event, anchor: str, offset_minutes: int):
    """`None` when the event has no time yet — an honest "not known", never "due now".

    `anchor='end'` measures from `Event.ends_at`, which is a property (`runs_until`, or the start
    plus the duration), so "T + 1 day" on a two-day conference lands the day after it finishes and
    not the day after it opens.
    """
    base = event.starts_at if anchor == 'start' else event.ends_at
    if base is None:
        return None
    return base + timedelta(minutes=offset_minutes or 0)


@transaction.atomic
def instantiate(event, venue, template, *, created_by=None) -> ChecklistInstance:
    """Cut a working copy of `template` for `event` at `venue`.

    `transaction.atomic` around exactly two adjacent statements on two tables — the instance and one
    `bulk_create` of its items — which is the shape `backend/CLAUDE.md` rule 2 permits. An instance
    that exists with no items would look to an organiser like a building that asked for nothing.
    """
    instance = ChecklistInstance.objects.create(
        event=event,
        venue=venue,
        template=template,
        template_version=template.version,
        template_name=template.name,
        created_by=created_by,
    )
    ChecklistInstanceItem.objects.bulk_create(
        [
            ChecklistInstanceItem(
                instance=instance,
                computed_due_at=due_at_for(event, source.anchor, source.due_offset_minutes),
                **{field: getattr(source, field) for field in SNAPSHOT_FIELDS},
            )
            for source in template.items.all()
        ]
    )
    return instance


def sync_new_items(instance) -> int:
    """Add the template's lines that this instance does not have, and return how many.

    Matched by (`order`, `title_en`) rather than by a FK, because there is no FK — that is what
    "snapshot" means. The consequence, stated honestly rather than hidden: a building that *renames*
    an existing line produces a second item here rather than an edit, and the organiser is the one
    who notices they now have two. An edit-in-place would be the alternative, and it would overwrite
    an item somebody has already ticked and signed — which is the thing this whole shape exists to
    refuse.

    Nothing existing is ever touched, so this is safe to offer at any point.
    """
    template = instance.template
    if template is None:
        return 0
    have = {(item.order, item.title_en) for item in instance.items.all()}
    fresh = [
        ChecklistInstanceItem(
            instance=instance,
            computed_due_at=due_at_for(
                instance.event, source.anchor, source.due_offset_minutes
            ),
            **{field: getattr(source, field) for field in SNAPSHOT_FIELDS},
        )
        for source in template.items.all()
        if (source.order, source.title_en) not in have
    ]
    if fresh:
        ChecklistInstanceItem.objects.bulk_create(fresh)
    instance.template_version = template.version
    instance.save(update_fields=['template_version'])
    return len(fresh)


def recompute_due_dates(event) -> int:
    """Re-derive every stored due date for an event whose time has changed, and return how many rows
    moved.

    Called explicitly rather than from a signal on `Event`: a signal would fire on every save of
    every event on the platform to answer a question that matters for the handful that have a
    checklist, and `events` is an app this one is not allowed to add machinery to
    (CONFERENCE-BRIEF.md §4 rule 1). The checklist endpoint refreshes on read of its own instance,
    which is the moment the answer is actually looked at.
    """
    moved = 0
    for item in ChecklistInstanceItem.objects.filter(instance__event=event):
        wanted = due_at_for(event, item.anchor, item.due_offset_minutes)
        if wanted != item.computed_due_at:
            item.computed_due_at = wanted
            item.save(update_fields=['computed_due_at'])
            moved += 1
    return moved
