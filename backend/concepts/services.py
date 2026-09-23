"""The slow half of concepts — every write, every side effect, every race.

Views stay thin: they resolve the object, ask `access.py` whether the caller may act, and call one
function here. Everything that is not a permission check lives in this module, including all three
kinds of side effect, which is what makes them auditable in one place:

* **Notifications** — `notifications.services.notify` is the only thing that creates a row
  (`notifications/CLAUDE.md`), and all three of this feature's types are sent from here. They all
  carry `concept=`, because `/concepts/<slug>` is the page a reader wants and a notification nobody
  can click is markedly less useful than one they can.
* **The feed** — `activity.services.record_activity` fires for a publication and for nothing else,
  never for a draft and never for a queued revision. House rule 9: the feed is public by
  construction, so a row that would need filtering out must never be written at all. The FIRST
  publication anywhere under a concept is kind `concept` ("this idea now has a page"); every later
  one is `concept_revision` ("that page got better"), which is a different thing to a reader who has
  already seen it.
* **The audit log** — `telemetry.audit.record_audit`, called OUTSIDE any `transaction.atomic()`
  block and after the write it records, because `AuditEvent` lives in a different SQLite file that a
  `default`-database transaction can neither roll back nor commit with.

**The concurrency shape is the one every decision in this codebase uses.** No `select_for_update`
(backend/CLAUDE.md SQLite rule 1: Django silently no-ops it and the surrounding block lock turns
contention into `database is locked`). Every state change is ONE WHERE-anchored
`filter(pk=…, status=<expected>).update(…)`; the loser sees 0 rows and gets a clean 409. Publishing
supersedes FIRST and claims second — never both rows `published` at once, which is the ordering
`moderation/views.py _publish_translation` records after the opposite order produced a
deterministic 500 against exactly this kind of partial unique index. If the work after a claim
fails, the claim is reverted in an `except` so nothing is left stuck.
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, OperationalError, transaction
from django.utils import timezone
from django.utils.text import slugify

from notifications.services import notify
from telemetry.audit import record_audit

from .access import (
    can_autopublish,
    can_edit_draft,
    can_pin,
    can_remove_link,
    link_block_reason,
    visible_concepts,
)
from .blocks import mentioned_slugs
from .models import (
    LINK_TARGET_MODELS,
    Concept,
    ConceptArticle,
    ConceptAsset,
    ConceptLink,
    ConceptRevision,
)

#: How many times a unique-key allocation retries a collision before giving up. The same bounded
#: shape (and the same bound) exercise-number allocation and `coauthoring.services` already use —
#: backend/CLAUDE.md's SQLite rule 3.
_ALLOCATION_ATTEMPTS = 8


class Stale(Exception):
    """A revision was written against something that is no longer the article's head.

    Carries the head itself rather than just saying so, because the editor's whole job at that
    moment is to show the person what landed underneath them — "conflict" alone leaves them guessing
    whether to retype their change or reload. The view renders it as
    `409 {'detail': 'stale', 'head': {…}}`.
    """

    def __init__(self, head=None):
        super().__init__('stale')
        self.head = head


class DraftExists(Exception):
    """This person already has an open draft on this article.

    One open draft per person per article, so a change becomes one thing to finish rather than a
    pile of half-written ones nobody (including its author) can tell apart. Carries the draft, so
    the editor can open it instead of refusing and stopping there — the refusal IS the navigation.
    """

    def __init__(self, draft):
        super().__init__('draft_exists')
        self.draft = draft


class Conflict(Exception):
    """The world moved: already decided, no longer a draft, no longer pending.

    Distinct from `Refused`, and the distinction is the one root CLAUDE.md is explicit about: 409
    means the state changed under the caller, 400 means the request itself was wrong.
    """

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class Refused(Exception):
    """A rule said no: `minor`, `self`, `relation`, `note_required`, `body_origin`, `quota`.

    The reason IS the message — every one of them has its own sentence in both catalogues, which is
    house rule 6 made into a type. The view renders it as `400 {'detail': <reason>}`.
    """

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# --- allocation ---------------------------------------------------------------------------------


def allocate_slug(title: str) -> str:
    """A free slug for a new concept, from its first article's title.

    `slugify` or the literal word `concept` when the title has nothing sluggable in it (a title that
    is entirely maths, or entirely non-Latin script, both real) — then `-2`, `-3` … while the name
    is taken. Bounded, because a loop that cannot end is worse than a refusal somebody can retry.

    The slug is allocated ONCE and is immutable through the API: it is what `[[slug]]` in somebody
    else's text resolves against, and what every shared link points at.
    """
    base = slugify(title or '')[:100] or 'concept'
    candidate = base
    suffix = 2
    while Concept.objects.filter(slug=candidate).exists():
        candidate = f'{base}-{suffix}'[:120]
        suffix += 1
        if suffix > 1000:  # pragma: no cover - a thousand concepts of one name is not a race
            candidate = f'{base}-{timezone.now().timestamp():.0f}'[:120]
            break
    return candidate


def allocate_number(article) -> int:
    """The next revision number for this article — max+1.

    Returns a candidate; `_create_revision` below is what loops, because the retry has to be around
    the INSERT rather than around the read (backend/CLAUDE.md SQLite rule 3: two saves landing in
    the same instant both read the same max, and the second one violates the unique index).
    """
    highest = (
        ConceptRevision.objects.filter(article=article)
        .order_by('-number')
        .values_list('number', flat=True)
        .first()
    )
    return (highest or 0) + 1


def _create_revision(article, **fields) -> ConceptRevision:
    """Insert a revision, re-allocating its number if somebody else took it first.

    Per-attempt savepoint (`transaction.atomic()` around ONE insert — rule 2's "a couple of fast
    statements on one table", not a wrapper around a whole save path), and both exception types,
    because SQLite reports a contended write as "database is locked" rather than as a constraint
    violation.
    """
    last_error: Exception | None = None
    for _ in range(_ALLOCATION_ATTEMPTS):
        number = allocate_number(article)
        try:
            with transaction.atomic():
                return ConceptRevision.objects.create(article=article, number=number, **fields)
        except (IntegrityError, OperationalError) as exc:  # pragma: no cover - contention only
            last_error = exc
            continue
    raise last_error  # pragma: no cover - eight collisions in a row is an outage, not a race


# --- creating -----------------------------------------------------------------------------------


def create_concept(
    user,
    *,
    title: str,
    summary: str = '',
    blocks=None,
    audience: str,
    locale: str,
    branches=(),
    tags=(),
    submit: bool = False,
    request=None,
):
    """A concept, its first article and revision 1 — in one call, because it is one act.

    A client that crashed between two requests would have left a concept nobody meant to keep, with
    no article and therefore no way to see or delete it, and the person filling in that form pressed
    one button. `submit=True` then hands the revision straight to `submit_revision`, which is what
    decides whether this person publishes outright or waits.

    Returns `(concept, article, revision)`. The revision's `status` is what the caller reads to tell
    which of the three outcomes it got — `draft`, `pending` or `published`.
    """
    concept = Concept.objects.create(slug=allocate_slug(title), created_by=user)
    if branches:
        concept.branches.set(branches)
    if tags:
        concept.tags.set(tags)
    article, revision = create_article(
        concept,
        user,
        audience=audience,
        locale=locale,
        title=title,
        summary=summary,
        blocks=blocks,
        submit=submit,
        request=request,
    )
    return concept, article, revision


def create_article(
    concept,
    user,
    *,
    audience: str,
    locale: str,
    title: str,
    summary: str = '',
    blocks=None,
    change_note: str = '',
    submit: bool = False,
    request=None,
):
    """A new article of this concept — somebody's own take on one `(audience, locale)`.

    Deliberately not refused when an article for that pair already exists: articles for one page are
    peers (CONCEPTS-BRIEF.md §0), and "somebody already wrote one" is the most ordinary reason to
    want to write your own. Returns `(article, revision)`.
    """
    article = ConceptArticle.objects.create(
        concept=concept, audience=audience, locale=locale, created_by=user
    )
    revision = _create_revision(
        article,
        status='draft',
        title=title,
        summary=summary,
        blocks=list(blocks or []),
        change_note=change_note,
        based_on=None,
        created_by=user,
    )
    if submit:
        revision = submit_revision(revision, user, request=request)
    return article, revision


def create_revision(
    article,
    user,
    *,
    title: str,
    summary: str = '',
    blocks=None,
    change_note: str = '',
    based_on=None,
    submit: bool = False,
    request=None,
) -> ConceptRevision:
    """A proposed change to an article — somebody else's, or your own.

    One open draft per (article, author): a second one raises `DraftExists` carrying the first, so
    the editor opens what they already started instead of quietly accumulating near-identical rows
    nobody can compare. A `pending` revision is NOT an open draft for this purpose — it is out of
    the author's hands and waiting on somebody, and `withdraw` is how they take it back.
    """
    open_draft = ConceptRevision.objects.filter(
        article=article, created_by=user, status='draft'
    ).first()
    if open_draft is not None:
        raise DraftExists(open_draft)

    revision = _create_revision(
        article,
        status='draft',
        title=title,
        summary=summary,
        blocks=list(blocks or []),
        change_note=change_note,
        based_on=based_on,
        created_by=user,
    )
    if submit:
        revision = submit_revision(revision, user, request=request)
    return revision


def save_draft(revision, payload: dict) -> ConceptRevision:
    """Edit a draft in place. A draft is the one mutable row in this app; everything after submit is
    immutable and kept (house rule 12), so anything else is a 409 rather than a silent no-op."""
    if revision.status != 'draft':
        raise Conflict('not_draft')
    for field in ('title', 'summary', 'blocks', 'change_note'):
        if field in payload:
            setattr(revision, field, payload[field])
    revision.save()
    return revision


# --- the lifecycle ------------------------------------------------------------------------------


def head_of(article):
    """The article's one `published` revision, or None. A partial unique index guarantees the
    "one"; this is the single place the rest of this module asks for it."""
    return ConceptRevision.objects.filter(article=article, status='published').first()


def submit_revision(revision, user, *, request=None) -> ConceptRevision:
    """Send a draft — which either publishes it outright or puts it in the queue.

    Answers with the revision, whose `status` is `published` **or** `pending`; the caller reads it
    rather than assuming, because those are two genuinely different outcomes of the same button and
    only the server knows which one a given person gets.

    The stale check is here and nowhere else. A draft written against an older head is fine to keep
    writing — it becomes a problem only when it is offered as the next version, because publishing
    it would silently overwrite whatever landed in between. `Stale` carries the real head so the
    editor can show what changed.
    """
    if revision.status != 'draft':
        raise Conflict('not_draft')

    article = revision.article
    head = head_of(article)
    if getattr(head, 'pk', None) != revision.based_on_id:
        raise Stale(head)

    if can_autopublish(user, article.concept):
        return publish_revision(revision, user, request=request)

    now = timezone.now()
    claimed = ConceptRevision.objects.filter(pk=revision.pk, status='draft').update(
        status='pending', submitted_at=now
    )
    if not claimed:
        raise Conflict('not_draft')
    revision.refresh_from_db()

    # The article's author is who reviews a change to their own text first (`access.can_review`), so
    # they are who is told one arrived. Staff and governors see it in the moderation queue, which is
    # a page they go to rather than a thing they are pinged about — the same posture every other
    # queue section takes.
    notify(
        article.created_by,
        'concept_revision_pending',
        actor=revision.created_by,
        target_label=revision.title,
        note=revision.change_note,
        concept=article.concept,
    )
    return revision


def publish_revision(revision, actor, *, request=None) -> ConceptRevision:
    """Make this revision the article's head.

    Supersede first, then ONE WHERE-anchored claim, then the side effects, with both writes reverted
    if anything in between fails. Never both rows `published` at once — see the module docstring,
    and `_publish_translation` for the 500 the other order produced.

    Accepts a `draft` (somebody publishing their own, having earned it) or a `pending` one (a
    reviewer accepting it): both are "this text should be the page now", and one function owns the
    sequence so the two paths cannot drift about what publishing means.
    """
    if revision.status not in ('draft', 'pending'):
        raise Conflict('already_decided')

    article = revision.article
    concept = article.concept
    # Read BEFORE the claim: whether anything under this concept has ever been published is what
    # decides which feed kind this is, and after the claim the answer is always yes.
    first_ever = not ConceptRevision.objects.filter(
        article__concept=concept, status__in=('published', 'superseded')
    ).exists()

    previous = head_of(article)
    superseded_pk = None
    if previous is not None and previous.pk != revision.pk:
        ConceptRevision.objects.filter(pk=previous.pk, status='published').update(
            status='superseded'
        )
        superseded_pk = previous.pk

    now = timezone.now()
    claimed = ConceptRevision.objects.filter(
        pk=revision.pk, status__in=('draft', 'pending')
    ).update(status='published', published_at=now)
    if not claimed:
        _restore_superseded(superseded_pk)
        raise Conflict('already_decided')
    revision.refresh_from_db()

    try:
        # `auto_now` does the work; the save exists to bump it, which is what `?sort=updated`
        # (the list default) orders by.
        concept.save(update_fields=['updated_at'])
        harvest_body_links(concept)
    except Exception:
        ConceptRevision.objects.filter(pk=revision.pk, status='published').update(
            status='draft', published_at=None
        )
        _restore_superseded(superseded_pk)
        raise

    _announce_publication(revision, first_ever=first_ever, publisher=actor)
    _audit(
        request,
        action='content_edit',
        concept=concept,
        summary=f'Published revision {revision.number} of "{revision.title}"',
        detail={
            'article': article.pk,
            'revision': revision.pk,
            'status': 'published',
            'audience': article.audience,
            'locale': article.locale,
            'first_publication': first_ever,
        },
    )
    return revision


def _restore_superseded(pk) -> None:
    if pk is not None:
        ConceptRevision.objects.filter(pk=pk, status='superseded').update(status='published')


def _announce_publication(revision, *, first_ever: bool, publisher=None) -> None:
    """The feed row and the notifications for a successful publication.

    Two kinds, because they are two events to a reader: `concept` says this idea now has a page at
    all, and `concept_revision` says a page they may already have read has changed. Only the first
    publication anywhere under the concept gets the first kind — a concept announcing itself once
    per article would be the feed repeating itself.
    """
    from activity.services import record_activity

    article = revision.article
    concept = article.concept
    if first_ever:
        record_activity(
            'concept',
            actor=revision.created_by,
            concept=concept,
            target_label=revision.title,
            source=article,
            tags=list(concept.tags.all()),
        )
    else:
        record_activity(
            'concept_revision',
            actor=revision.created_by,
            concept=concept,
            target_label=revision.title,
            source=revision,
            tags=list(concept.tags.all()),
        )

    # Everybody who has written any part of this article — its author and the author of every
    # earlier revision that was ever the page. De-duplicated, and the person who pressed the button
    # is skipped even when they are not the actor the row names (a reviewer accepting somebody
    # else's revision did it, and must not be told about it).
    recipients: dict[int, object] = {}
    if article.created_by_id is not None:
        recipients[article.created_by_id] = article.created_by
    for earlier in ConceptRevision.objects.filter(
        article=article, status__in=('published', 'superseded')
    ).exclude(pk=revision.pk).select_related('created_by__profile'):
        if earlier.created_by_id is not None:
            recipients.setdefault(earlier.created_by_id, earlier.created_by)

    publisher_pk = getattr(publisher, 'pk', None)
    for pk, recipient in recipients.items():
        if publisher_pk is not None and pk == publisher_pk:
            continue
        notify(
            recipient,
            'concept_revision_published',
            actor=revision.created_by,
            target_label=revision.title,
            note=revision.change_note,
            concept=concept,
        )


def decide_revision(revision, user, decision: str, note: str = '', *, request=None):
    """Accept or reject a pending revision. One decision per row, whoever clicks first.

    A rejection REQUIRES a note (house rule 6, and the same rule a denied solution entry and a
    declined governor application already follow): a refusal without a reason tells somebody who
    wanted to help nothing they can act on.

    The claim writes the decision fields under `status='pending'`, and for a rejection the status
    with them. For an acceptance the status move belongs to `publish_revision`, which owns the
    supersede-then-claim sequence — the same carve-out translation approval makes for the same
    reason, and the WHERE-anchored claim inside it is what two simultaneous accepts actually race
    on. There is deliberately no stale refusal here: the reviewer saw this revision's diff against
    the head in the queue row (`based_on_is_current` is what that row carries), so accepting it is a
    decision about what they read rather than a stale save.
    """
    note = (note or '').strip()
    if decision not in ('accept', 'reject'):
        raise Refused('bad_decision')
    if decision == 'reject' and not note:
        raise Refused('note_required')
    if revision.status != 'pending':
        raise Conflict('already_decided')

    now = timezone.now()
    fields = {'reviewed_by': user, 'reviewed_at': now, 'review_note': note}
    if decision == 'reject':
        fields['status'] = 'rejected'
    claimed = ConceptRevision.objects.filter(pk=revision.pk, status='pending').update(**fields)
    if not claimed:
        raise Conflict('already_decided')
    revision.refresh_from_db()

    if decision == 'accept':
        try:
            publish_revision(revision, user, request=request)
        except Exception:
            ConceptRevision.objects.filter(pk=revision.pk, status='pending').update(
                reviewed_by=None, reviewed_at=None, review_note=''
            )
            revision.refresh_from_db()
            raise
        revision.refresh_from_db()

    notify(
        revision.created_by,
        'concept_revision_decided',
        actor=user,
        target_label=revision.title,
        note=note,
        concept=revision.article.concept,
    )
    _audit(
        request,
        action='moderation_decision',
        concept=revision.article.concept,
        summary=f'{decision.capitalize()}ed revision {revision.number} of "{revision.title}"',
        detail={
            'article': revision.article_id,
            'revision': revision.pk,
            'status': revision.status,
            'decision': decision,
            'note': note[:200],
        },
    )
    return revision


def withdraw_revision(revision, user) -> ConceptRevision:
    """The author taking their own pending revision back. The row survives as `withdrawn` — who
    proposed what, and that they thought better of it, is part of the history (house rule 12)."""
    if revision.created_by_id != getattr(user, 'pk', None):
        raise Refused('not_yours')
    claimed = ConceptRevision.objects.filter(pk=revision.pk, status='pending').update(
        status='withdrawn', reviewed_at=timezone.now()
    )
    if not claimed:
        raise Conflict('not_pending')
    revision.refresh_from_db()
    return revision


def delete_draft(revision, user) -> None:
    """A draft is the ONE thing in this app that may be hard-deleted: nobody has seen it, nothing
    links to it, and keeping an abandoned one would make the author's own list of open work a lie."""
    if revision.status != 'draft':
        raise Conflict('not_draft')
    if not can_edit_draft(revision, user):
        raise Refused('not_yours')
    revision.delete()


def set_pinned(article, user, pinned: bool, *, request=None) -> ConceptArticle:
    """Which article of a page a reader sees first. Staff or a governor (`access.can_pin`)."""
    if not can_pin(user, article.concept):
        raise Refused('not_allowed')
    article.pinned = bool(pinned)
    article.save(update_fields=['pinned'])
    _audit(
        request,
        action='content_edit',
        concept=article.concept,
        summary=f'{"Pinned" if pinned else "Unpinned"} article {article.pk}',
        detail={'article': article.pk, 'pinned': bool(pinned)},
    )
    return article


# --- links --------------------------------------------------------------------------------------


def _resolve_link_target(target_type: str, target_id):
    """`(model, instance)` for a target type this app allows, or `(None, None)`.

    Never raises on bad input — every caller turns the miss into a 404, and a client sending
    nonsense should not be able to produce a 500 (`galleries.views._resolve_target`, the same
    function for the same reason).
    """
    key = LINK_TARGET_MODELS.get(target_type)
    if key is None:
        return None, None
    try:
        content_type = ContentType.objects.get_by_natural_key(*key)
    except ContentType.DoesNotExist:  # pragma: no cover - a missing app is a broken install
        return None, None
    model = content_type.model_class()
    try:
        return model, model.objects.filter(pk=int(target_id)).first()
    except (TypeError, ValueError):
        return model, None


def _target_is_visible(target, user) -> bool:
    """Whether the caller may link to this — the thing has to be something they can see, or a link
    becomes a way to find out which unpublished ids exist."""
    if target is None:
        return False
    if isinstance(target, Concept):
        from .access import can_view

        return can_view(target, user)
    return bool(getattr(target, 'published', False)) or bool(
        user is not None and getattr(user, 'is_authenticated', False) and user.is_staff
    )


def add_link(concept, user, *, target_type: str, target_id, relation: str = 'related', request=None):
    """File a link from this concept to an exercise, a material or another concept.

    The refusals are separate on purpose, each with its own reason (house rule 6): an unknown or
    invisible target is a 404, linking a concept to itself is `self`, asking for `prerequisite` on
    anything but another concept is `relation`, and a link that already exists is a 409
    `already_linked` — the world already agrees with you, which is not an error in the request.
    """
    reason = link_block_reason(user)
    if reason is not None:
        raise Refused(reason)

    model, target = _resolve_link_target(target_type, target_id)
    if model is None or target is None or not _target_is_visible(target, user):
        raise LookupError('no_such_target')

    if isinstance(target, Concept):
        if target.pk == concept.pk:
            raise Refused('self')
    elif relation == 'prerequisite':
        raise Refused('relation')
    if relation not in ('related', 'prerequisite'):
        raise Refused('relation')

    content_type = ContentType.objects.get_for_model(model)
    if ConceptLink.objects.filter(
        concept=concept, content_type=content_type, object_id=target.pk
    ).exists():
        raise Conflict('already_linked')

    link = ConceptLink.objects.create(
        concept=concept,
        content_type=content_type,
        object_id=target.pk,
        relation=relation,
        origin='manual',
        added_by=user,
    )
    _audit(
        request,
        action='content_edit',
        concept=concept,
        summary=f'Linked {target_type} {target.pk} to "{concept.slug}"',
        detail={'link': link.pk, 'target_type': target_type, 'target_id': target.pk, 'relation': relation},
    )
    return link


def remove_link(link, user, *, request=None) -> None:
    """Unfile a manual link. A `body` one is refused with `body_origin` — the text is what says it,
    and the next publication would put the row straight back."""
    if link.origin == 'body':
        raise Refused('body_origin')
    if not can_remove_link(link, user):
        raise Refused('not_allowed')
    concept = link.concept
    detail = {'link': link.pk, 'target_id': link.object_id, 'removed': True}
    link.delete()
    _audit(
        request,
        action='content_edit',
        concept=concept,
        summary=f'Unlinked a target from "{concept.slug}"',
        detail=detail,
    )


def harvest_body_links(concept) -> None:
    """Re-derive this concept's `body` links from what its published articles actually say.

    The union of `[[slug]]` mentions across the HEAD revision of every visible article, resolved to
    concepts that really exist and are publicly readable, minus this concept itself. Rows are added
    for mentions that have none and `body` rows are deleted for mentions that are gone; **`manual`
    rows are never touched**, because somebody filed those by hand and a sentence being edited is
    not a reason to discard their work.

    Recomputed from scratch on every publication rather than diffed against what changed: the
    mentions of a concept live across ALL of its articles, so a publication on one of them can
    remove the last mention of something another one never had. A recount cannot drift; an
    increment that misses one path is wrong forever (house rule 5).
    """
    from .access import visible_articles

    wanted: set[str] = set()
    for article in visible_articles(None).filter(concept=concept).prefetch_related('revisions'):
        for revision in article.revisions.all():
            if revision.status == 'published':
                wanted |= mentioned_slugs(revision.blocks)
    wanted.discard(concept.slug)

    concept_ct = ContentType.objects.get_for_model(Concept)
    target_ids = set()
    if wanted:
        target_ids = set(
            visible_concepts(None)
            .filter(slug__in=wanted)
            .exclude(pk=concept.pk)
            .values_list('pk', flat=True)
        )

    existing = {
        row.object_id: row
        for row in ConceptLink.objects.filter(concept=concept, content_type=concept_ct)
    }
    for object_id in target_ids - set(existing):
        # `get_or_create` rather than `create`: two publications racing on the same mention would
        # otherwise have one of them violate `one_link_per_target`, and the honest answer to "we
        # both added the same link" is that the link is there.
        ConceptLink.objects.get_or_create(
            concept=concept,
            content_type=concept_ct,
            object_id=object_id,
            defaults={'relation': 'related', 'origin': 'body'},
        )
    for object_id, row in existing.items():
        if row.origin == 'body' and object_id not in target_ids:
            row.delete()


def links_for_target(target_type: str, target_id, user):
    """Every concept link pointing AT one exercise or material — the chip row on its page.

    Scoped through `visible_concepts`, so a concept whose only article is still waiting never shows
    up on somebody else's page. Returns an empty queryset for an unknown target type rather than
    raising, because this read is called from pages that must keep working whatever they are handed.
    """
    model, target = _resolve_link_target(target_type, target_id)
    if model is None or target is None:
        return ConceptLink.objects.none()
    content_type = ContentType.objects.get_for_model(model)
    return (
        ConceptLink.objects.filter(content_type=content_type, object_id=target.pk)
        .filter(concept__in=visible_concepts(user))
        .select_related('concept')
        .prefetch_related('concept__articles__revisions')
    )


# --- assets -------------------------------------------------------------------------------------


def store_asset(user, upload) -> ConceptAsset:
    """One picture or PDF for a block — processed, never stored as sent (house rule 7).

    `community.attachments.process_attachment` is called rather than copied: a picture is decoded,
    EXIF-stripped and re-encoded to WebP, a PDF is sniffed, size-capped and scanned when a daemon
    exists, and anything else is refused. The quota is the shared per-account allowance, weighed
    with the incoming file and checked the same way the comment-attachment endpoint checks it, with
    the same numbers — an allowance that depended on which form the bytes came through would not be
    an allowance.
    """
    from community.attachments import process_attachment, used_upload_bytes

    from .models import asset_upload_path

    try:
        kind, content, name, size = process_attachment(upload)
    except DjangoValidationError:
        raise

    quota = getattr(getattr(user, 'profile', None), 'material_upload_quota_bytes', 0) or 0
    if quota and used_upload_bytes(user) + size > quota:
        raise Refused('quota')

    width = height = 0
    if kind == 'image':
        try:
            from PIL import Image

            content.seek(0)
            with Image.open(content) as image:
                width, height = image.size
        except Exception:  # pragma: no cover - a re-encoded WebP always opens
            width = height = 0
        content.seek(0)

    asset = ConceptAsset(
        uploaded_by=user, kind=kind, original_name=name, size_bytes=size, width=width, height=height
    )
    asset.file.save(asset_upload_path(asset, name), content, save=True)
    return asset


# --- the audit log ------------------------------------------------------------------------------


def _audit(request, *, action: str, concept, summary: str, detail: dict | None = None) -> None:
    """One `AuditEvent`, when there is a request to attribute it to.

    `record_audit` reads `request.user.id`, so a call from a management command, a seed or a
    migration has nothing to record and is skipped rather than faked (house rule 10). Always OUTSIDE
    any `atomic()` block, which is the rule that module states and the reason every caller above
    audits last.
    """
    if request is None or not getattr(request, 'user', None):
        return
    if not getattr(request.user, 'is_authenticated', False):
        return
    record_audit(
        request,
        action=action,
        target_type='concept',
        target_id=concept.pk,
        summary=summary,
        detail=detail,
    )


__all__ = [
    'Stale',
    'DraftExists',
    'Conflict',
    'Refused',
    'allocate_slug',
    'allocate_number',
    'create_concept',
    'create_article',
    'create_revision',
    'save_draft',
    'head_of',
    'submit_revision',
    'publish_revision',
    'decide_revision',
    'withdraw_revision',
    'delete_draft',
    'set_pinned',
    'add_link',
    'remove_link',
    'harvest_body_links',
    'links_for_target',
    'store_asset',
]
