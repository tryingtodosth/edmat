"""Applying to look after a discipline, a branch or one material — the queue, and what deciding one
does.

Kept beside `NodeGovernor` rather than in an app of its own: an application is a request for exactly
that row, and splitting the two would mean the rule about who may hold authority living in one place
and the rule about who may ask for it living in another.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.db import transaction

from notifications.services import notify

from .models import (
    GOVERNABLE_NODE_MODELS,
    GovernorApplication,
    NodeGovernor,
)

User = get_user_model()


def node_label(node) -> str:
    """A human name for whatever kind of node this is. Materials carry `title` on their translation
    rows and taxonomy nodes carry `name`; neither has a `__str__` worth showing a reader."""
    if node is None:
        return ''
    translations = getattr(node, 'translations', None)
    if translations is not None:
        row = translations.first()
        if row is not None:
            return getattr(row, 'name', None) or getattr(row, 'title', '') or ''
    return getattr(node, 'slug', '') or str(getattr(node, 'pk', ''))


def kind_of(node) -> str:
    for kind, model in GOVERNABLE_NODE_MODELS.items():
        if isinstance(node, model):
            return kind
    return ''


def notify_staff_of_application(application) -> None:
    """Tell every staff account there is something waiting.

    Every one of them rather than a single owner, for the reason the course contribution queue
    already records: a queue that notifies one person stalls the moment that person is away. `notify`
    itself drops the applicant if they happen to be staff (`actor == recipient`), so nobody is told
    about their own application.
    """
    label = node_label(application.node)
    for recipient in User.objects.filter(is_staff=True, is_active=True):
        notify(
            recipient,
            'governor_application_submitted',
            actor=application.applicant,
            target_label=label,
            note=application.statement[:200],
        )


@transaction.atomic
def finish_decision(application, *, decided_by, note: str = '') -> GovernorApplication:
    """Everything a decision does AFTER the row has already been claimed.

    The claim itself is a single WHERE-anchored `update()` in the view, which is the shape §17I
    settled on for every decision endpoint here: it is atomic on every backend including SQLite,
    it holds a write lock for one fast statement rather than for the whole apply, and exactly one of
    two simultaneous clicks can see a row still `pending`. This function is the slow half, and it
    runs only for the request that won.

    Approving creates the real `NodeGovernor` row — this is the only place an application turns into
    authority, so there is no path where somebody is told yes without the grant existing. An
    existing grant is reused rather than duplicated: staff may well have granted it by hand while
    the application sat in the queue, and that should read as yes rather than as a constraint error.
    """
    if application.status == 'approved':
        grant, _ = NodeGovernor.objects.get_or_create(
            user=application.applicant,
            content_type=application.content_type,
            object_id=application.object_id,
            defaults={'granted_by': decided_by},
        )
        application.resulting_grant = grant
        application.save(update_fields=['resulting_grant'])

    notify(
        application.applicant,
        'governor_application_decided',
        actor=decided_by,
        target_label=node_label(application.node),
        note=note or application.decision_note,
    )
    return application


def resolve_node(kind: str, node_ref):
    """(content_type, node) for a `kind` and either a slug or a pk, or (None, None).

    Both forms are accepted for the same reason `NodeGovernorSerializer` accepts both: a discipline
    and a branch are addressed by slug everywhere in this API, and a material cannot be, because its
    slug is only unique within its branch.
    """
    model = GOVERNABLE_NODE_MODELS.get(kind)
    if model is None:
        return None, None
    node = None
    if isinstance(node_ref, int) or (isinstance(node_ref, str) and node_ref.isdigit()):
        node = model.objects.filter(pk=int(node_ref)).first()
    if node is None and isinstance(node_ref, str) and node_ref:
        node = model.objects.filter(slug=node_ref).first()
    if node is None:
        return None, None
    return ContentType.objects.get_for_model(model), node
