"""The slow half of co-authoring — every write, every side effect, every race.

Views stay thin: they resolve the object, ask `access.py` whether the caller may act, and call one
function here. Everything that is not a permission check lives in this module, including all three
kinds of side effect, which is what makes them auditable in one place:

* **Notifications** — `notifications.services.notify` is the only thing that creates a row
  (`notifications/CLAUDE.md`), and every one of this feature's seven types is sent from here. The
  link FK is `material=` when the project has a material and `material_project=` when it does not,
  so a notification about a draft project still opens something.
* **The feed** — `activity.services.record_activity('material_version', …)` fires for a new version
  of an **already published** material and for nothing else. Never for a first publication (whose
  `create_material` already announces the material itself) and never for the backfill. House rule 9:
  the feed is public by construction, so a row that would need filtering out must never be written.
* **The audit log** — `telemetry.audit.record_audit`, called OUTSIDE any `transaction.atomic()`
  block and after the write it records, because `AuditEvent` lives in a different SQLite file that a
  `default`-database transaction can neither roll back nor commit with.

**The concurrency shape, which is the same one every decision in this codebase uses.** No
`select_for_update` (backend/CLAUDE.md SQLite rule 1: Django silently no-ops it and the surrounding
block lock turns contention into `database is locked`). Instead every state change is ONE
WHERE-anchored `filter(pk=…, status=<expected>).update(…)`; the loser sees 0 rows and gets a clean
409. Where a publish has to supersede an existing row first, it supersedes and THEN claims — never
both `published` at once — which is the ordering `moderation/views.py _publish_translation` records
after the opposite order produced a deterministic 500 against the partial unique index. If the work
after a claim fails, the claim is reverted in an `except` so nothing is left stuck.
"""

from __future__ import annotations

from django.conf import settings
from django.db import IntegrityError, OperationalError, transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError as DRFValidationError

from accounts.minors import is_minor
from materials.validators import scan_for_malware
from notifications.services import notify
from telemetry.audit import record_audit

from .access import (
    can_autopublish_first,
    can_edit,
    is_member,
    needs_staff_review,
    propose_block_reason,
    publish_block_reason,
)
from .models import (
    MaterialProject,
    MaterialVersion,
    ProjectJoinRequest,
    ProjectMember,
)

#: How many times `allocate_number` retries a collision before giving up. The same bounded shape
#: (and the same bound) exercise-number allocation uses in `moderation/views.py _apply_submission`.
_NUMBER_ALLOCATION_ATTEMPTS = 8


class Stale(Exception):
    """A save was written against something that is no longer the head.

    Carries the head itself rather than just saying so, because the editor's whole job at that
    moment is to show the person what landed underneath them — "conflict" alone leaves them
    guessing whether to retype their change or reload. The view renders it as
    `409 {'detail': 'stale', 'head': {…summary}}`.
    """

    def __init__(self, head=None):
        super().__init__('stale')
        self.head = head


class Conflict(Exception):
    """The world moved: already decided, no longer a draft, no longer proposed.

    Distinct from `Refused` below, and the distinction is the one root CLAUDE.md is explicit about:
    409 means the state changed under the caller, 400 means the request itself was wrong. The view
    renders this as `409 {'detail': <reason>}`.
    """

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class Refused(Exception):
    """A rule said no: `minor`, `already_member`, `owner_immutable`, `note_required`, a
    `propose_block_reason`, a `join_block_reason`, an invite's `revoked`/`expired`/`used_up`.

    The reason IS the message — every one of them has its own sentence in both catalogues, which is
    house rule 6 made into a type. The view renders it as `400 {'detail': <reason>}`.
    """

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# --- version numbers ------------------------------------------------------------------------------


def allocate_number(project) -> int:
    """The next version number for this project — max+1, allocated under contention.

    A bare read-max-then-insert is the bug backend/CLAUDE.md's SQLite rule 3 exists to stop: two
    saves landing in the same instant both read the same max and the second one violates
    `unique_version_number`. The fix is the same bounded retry the exercise-number allocator uses —
    each attempt inside its own savepoint so a failure does not poison the outer transaction, and
    catching `OperationalError` as well as `IntegrityError` because SQLite reports a contended write
    as "database is locked" rather than as a constraint violation.

    Returns the number; the caller does the insert. The retry loop is therefore around the CALLER's
    insert, not this function — which is why this returns a candidate and `_create_version` below
    is what loops.
    """
    highest = (
        MaterialVersion.objects.filter(project=project)
        .order_by('-number')
        .values_list('number', flat=True)
        .first()
    )
    return (highest or 0) + 1


def _create_version(project, **fields) -> MaterialVersion:
    """Insert a version, re-allocating its number if somebody else took it first.

    Per-attempt savepoint (`transaction.atomic()` around ONE insert — rule 2's "a couple of fast
    statements on one table", not a wrapper around the whole save path), and both exception types.
    """
    last_error: Exception | None = None
    for _ in range(_NUMBER_ALLOCATION_ATTEMPTS):
        number = allocate_number(project)
        try:
            with transaction.atomic():
                return MaterialVersion.objects.create(project=project, number=number, **fields)
        except (IntegrityError, OperationalError) as exc:  # pragma: no cover - contention only
            last_error = exc
            continue
    raise last_error  # pragma: no cover - eight collisions in a row is a real outage, not a race


# --- files ----------------------------------------------------------------------------------------


def _incoming_size(upload) -> int:
    try:
        return upload.size if upload else 0
    except (OSError, ValueError):
        return 0


def check_upload_allowance(user, upload) -> None:
    """`Profile.material_upload_quota_bytes` — the per-account total, weighed with the incoming file.

    Word for word the check the retired `MaterialSubmissionViewSet._check_storage_allowance` ran,
    because this is now the only place a new material's bytes are ever admitted and the numbers a
    person is shown must not change with the form they came through.
    The incoming file is counted so an account sitting just under its allowance refuses what would
    take it over rather than accepting it and going over silently, and the check runs BEFORE the
    file is written to storage — refusing afterwards would mean writing bytes only to unlink them,
    which is exactly the disk pressure the quota exists to prevent.

    The refusal names the three numbers somebody needs to act on it (used, allowance, and the size
    of the file being refused); a bare "quota exceeded" leaves them guessing whether to compress the
    file, split it, or ask for more room.
    """
    profile = getattr(user, 'profile', None)
    quota = getattr(profile, 'material_upload_quota_bytes', 0) or 0
    if not quota:
        return
    incoming = _incoming_size(upload)
    used = profile.material_upload_bytes
    if used + incoming <= quota:
        return

    def _mb(value):
        return f'{value / (1024 * 1024):.1f}MB'

    raise DRFValidationError(
        {
            'file': [
                f'This upload would take you past your storage allowance — you are using '
                f'{_mb(used)} of {_mb(quota)}, and this file is {_mb(incoming)}. '
                f'A moderator can raise the allowance, and rejected uploads give their space '
                f'back.'
            ]
        }
    )


def _scan_stored_file(version) -> None:
    """Scan a just-stored version file and record what actually happened.

    The same three outcomes, in the same order, the retired single-shot submit path ran:
    an unreachable scanner is `skipped` and NEVER "clean" (house rule 10), a real detection deletes
    the row and refuses, and `MATERIAL_SCAN_REQUIRED=True` is what a deployment with a real ClamAV
    daemon flips to make the honest skip a hard refusal instead.
    """
    outcome = scan_for_malware(version.file)
    if not outcome.scanned and getattr(settings, 'MATERIAL_SCAN_REQUIRED', False):
        _destroy_version(version)
        raise DRFValidationError(
            {'file': [f'Could not scan this file for safety: {outcome.detail}']}
        )
    if outcome.scanned and not outcome.clean:
        _destroy_version(version)
        raise DRFValidationError({'file': [outcome.detail]})
    version.scan_status = 'clean' if outcome.scanned else 'skipped'
    version.scan_detail = outcome.detail
    version.save(update_fields=['scan_status', 'scan_detail'])


def _destroy_version(version) -> None:
    """A version that was refused before it ever existed to anybody — bytes and row both go.

    The one place in this app that hard-deletes, and the exception that proves house rule 12: a
    flagged upload was never a record of a decision, it is a file that failed the door check, and
    keeping it would mean keeping the malware.
    """
    stored = version.file
    if stored:
        try:
            stored.delete(save=False)
        except (OSError, ValueError):
            pass
    version.delete()


def reclaim_version_file(version) -> None:
    """Drop the stored blob of a rejected or withdrawn version, keeping the row.

    The argument is the one the retired `moderation/views.py _reclaim_rejected_material_file` made
    at length, and it is unchanged: the requirement is about the RECORD — who proposed what, when,
    and whether it was taken — and the disk is about the BYTES, which the record does not consist
    of. An appeal is therefore a re-upload rather than an un-reject; the metadata survives to make
    that conversation possible, and the bytes are the proposer's own to send again. Everything a
    reviewer or a proposer could later need is still on the row (title, description, change note,
    scan outcome, who decided and why); `file_reclaimed_at` and `file_size` say that a file was
    there and how big it was, so the row never reads as though it never had one.

    **A published or superseded version is never reclaimed**, because superseded versions keeping
    their files IS the history (COAUTHORING-BRIEF.md §9) and because the live `Material` may hold
    the very same stored path — deleting here would take a published material's file with it.
    """
    if version.file_reclaimed_at is not None:
        return
    if version.status in ('published', 'superseded'):
        return
    stored = version.file
    if not stored:
        return
    try:
        size = stored.size
    except (OSError, ValueError):
        size = 0
    try:
        stored.delete(save=False)
    except (OSError, ValueError):
        pass
    # `FieldFile.delete` sets the field to None on the instance and this column is NOT NULL — an
    # empty string is what "no file" is stored as everywhere else in Django.
    version.file = ''
    version.file_reclaimed_at = timezone.now()
    if not version.file_size:
        version.file_size = size
    version.save(update_fields=['file', 'file_reclaimed_at', 'file_size'])


# --- creating and saving --------------------------------------------------------------------------


def create_project(user, *, branch, locale, catalogue: dict, version_payload: dict) -> MaterialProject:
    """A brand-new draft project, its owner row and its first version, in one call.

    The owner row is not created here — `MaterialProject.save()` does it, for the reason that model
    records: a project created by a seed command, the admin or a fixture must not be one nobody has
    permission over.

    Version 1 lands as a `draft`. This function never publishes it, even for somebody who could
    auto-publish: creating and publishing are two decisions. The VIEW publishes straight afterwards
    when the caller asked for both in one request (`publish: true`, which is what the submit form
    sends and what the retired single-shot upload always meant), and it does so by calling
    `publish_version`, so there is one publish path rather than a second one hidden in here.

    **Nothing is left behind by a refusal.** The two checks a file has to pass before a byte is
    stored run BEFORE the project row exists, and a failure after it does — a flagged scan, a
    storage backend that refused the write — takes the project and its owner row with it. The
    alternative is an empty project nobody asked for, in the caller's own listing, from a request
    they saw fail; the retired form left nothing behind when it refused and neither does this.
    """
    if is_minor(user):
        # A minor may propose a version — a person always reads a proposal — but may not own a
        # project, whose members publish with nobody in between (COAUTHORING-BRIEF.md §0).
        raise Refused('minor')

    _check_upload(user, version_payload.get('file') or None)
    project = MaterialProject.objects.create(
        branch=branch,
        locale=locale or 'pl',
        created_by=user,
        **catalogue,
    )
    try:
        _save_payload(
            project, user, version_payload, status='draft', based_on=None, upload_checked=True
        )
    except Exception:
        # A project whose first version never came into being is not a project: it has no title, no
        # content and nothing to publish. `_destroy_version` has already taken the bytes.
        project.delete()
        raise
    return project


def save_version(project, user, payload: dict, *, based_on=None) -> MaterialVersion:
    """One new version — a `draft` from somebody on the team, a `proposed` one from anybody else.

    **The same endpoint for both, deliberately.** "Improve this material" and "edit this material"
    are the same act with different permissions; two endpoints would have been two sets of rules to
    keep in step, and the difference between them is one line here.

    `based_on` is what the caller wrote against. A member's save must be against the HEAD (the
    highest-numbered draft or published row) and a proposal must be against the PUBLISHED one —
    a proposer cannot see drafts, so the published version is the only basis they could have had.
    Anything else raises `Stale`, carrying the real head.
    """
    editing = can_edit(project, user)
    if not editing:
        reason = propose_block_reason(project, user)
        if reason is not None:
            raise Refused(reason)

    status = 'draft' if editing else 'proposed'
    expected = project.head_version if editing else project.published_version
    expected_id = expected.pk if expected is not None else None
    given_id = based_on.pk if based_on is not None else None
    if given_id != expected_id:
        # Turn-based collaboration is the design (PRODUCT.md's real-time-editing non-goal), so a
        # save written against yesterday's text is refused rather than silently winning.
        raise Stale(expected)

    version = _save_payload(project, user, payload, status=status, based_on=expected)

    if status == 'proposed':
        _notify_members(
            project,
            'material_version_proposed',
            actor=user,
            target_label=version.title,
            note=version.change_note,
        )
    return version


def _check_upload(user, upload) -> None:
    """The two refusals that have to happen before a single byte is written: who may upload at all
    (`material_uploads_verified_only`) and whether it fits in their allowance.

    Its own function because `create_project` runs it one step earlier than `_save_payload` does —
    before the project row exists — so that a refused upload leaves nothing behind at all.
    """
    if upload is None:
        return
    _require_verified_contributor_for_uploads(user)
    check_upload_allowance(user, upload)


def _save_payload(
    project, user, payload: dict, *, status: str, based_on, upload_checked: bool = False
) -> MaterialVersion:
    """Create one version row from a validated payload, doing the file work in the right order.

    Order is the whole of this function: the verified-contributor restriction and the byte quota are
    both checked BEFORE anything is written to storage, and the malware scan runs AFTER, because it
    needs a stored file to hand to the daemon. That is the sequence the retired single-shot submit
    path ran, for the same reasons, and it is why this is one function rather than three lines in
    each of its two callers. `upload_checked` is for the one caller that has already run the first
    two, having had to do so before it created anything at all.
    """
    upload = payload.get('file') or None
    if not upload_checked:
        _check_upload(user, upload)

    kind = payload.get('kind') or 'file'
    version = _create_version(
        project,
        status=status,
        kind=kind,
        file=upload if kind == 'file' else '',
        url=payload.get('url', '') if kind == 'link' else '',
        body=payload.get('body', '') if kind == 'body' else '',
        title=payload.get('title', ''),
        description=payload.get('description', ''),
        change_note=payload.get('change_note', ''),
        based_on=based_on,
        created_by=user,
        file_size=_incoming_size(upload) if upload is not None else 0,
    )
    if upload is not None:
        _scan_stored_file(version)
    return version


def _require_verified_contributor_for_uploads(user) -> None:
    """`material_uploads_verified_only`, applied to a version that carries a file.

    **The one place this flag is read now** — `moderation.permissions
    .RequireVerifiedContributorForMaterialUploads`, the permission class that used to hold it, went
    with the submission model it gated. Its reasoning is kept here because the flag still has it:

    * The flag's semantics are INVERTED from every other one in the table (`moderation/models.py`'s
      own note): `is_enabled=True` means "the RESTRICTION is on", so only a verified contributor or
      staff may put a file on a version.
    * It fails CLOSED. `is_feature_enabled` returns True for a missing row, which for every other
      flag means "the feature is up" and for this one means "the restriction is active" — the safer
      failure direction for an anti-abuse gate, and a deliberate reversal rather than an accident
      (in practice the row is always there; migration 0011 seeds it OFF, so provisioning it never
      narrowed anybody's access).
    * It is checked here rather than as a permission class because it restricts ONE SHAPE of
      request, not one action: the same endpoint takes a link or a written text from anybody, and a
      permission class cannot see which of the three a version carries.
    """
    from moderation.services import is_feature_enabled

    if user is not None and getattr(user, 'is_staff', False):
        return
    if not is_feature_enabled('material_uploads_verified_only'):
        return
    profile = getattr(user, 'profile', None)
    if not (profile and profile.is_verified_contributor):
        raise DRFValidationError(
            {'file': ['Only verified contributors can upload material files right now.']}
        )


# --- publishing -----------------------------------------------------------------------------------


def publish_version(version, user, *, request=None) -> MaterialVersion:
    """Make this draft the material — or, for a first publication nobody has vouched for, queue it.

    Answers with the version, whose `status` is `published` **or** `proposed`; the caller reads it
    rather than assuming, because those are two genuinely different outcomes of the same button and
    only the server knows which one a given person gets.

    The published path is supersede-first, then ONE WHERE-anchored claim, then the projection, with
    both writes reverted if the projection fails. Never both rows `published` at once — see the
    module docstring, and `_publish_translation` for the 500 the other order produced.
    """
    project = version.project
    reason = publish_block_reason(version)
    if reason == 'not_draft':
        raise Conflict('not_draft')

    previous = project.published_version
    if reason == 'stale':
        # Two shapes of the same refusal (`access.publish_block_reason`): a draft numbered below
        # the published row is a revert, not a publication, and a draft written against a version
        # that has since been superseded would overwrite whatever superseded it. Saving a new
        # version from the current one is the honest way to do either.
        raise Stale(previous)

    first_publication = project.material_id is None
    if first_publication and not can_autopublish_first(user, project.branch):
        queued = MaterialVersion.objects.filter(pk=version.pk, status='draft').update(
            status='proposed'
        )
        if not queued:
            raise Conflict('not_draft')
        version.refresh_from_db()
        return version

    now = timezone.now()
    superseded_pk = None
    if previous is not None:
        MaterialVersion.objects.filter(pk=previous.pk, status='published').update(
            status='superseded'
        )
        superseded_pk = previous.pk

    claimed = MaterialVersion.objects.filter(pk=version.pk, status='draft').update(
        status='published', published_at=now
    )
    if not claimed:
        _restore_superseded(superseded_pk)
        raise Conflict('not_draft')

    version.refresh_from_db()
    try:
        if first_publication:
            # `materialise` IS the projection for a first publication: `create_material` writes the
            # payload and the translation row itself. Calling `sync_material` as well would rewrite
            # what was just written and bump the translation's `updated_at` for nothing.
            materialise(project, version, user)
        else:
            sync_material(project, version)
    except Exception:
        MaterialVersion.objects.filter(pk=version.pk, status='published').update(
            status='draft', published_at=None
        )
        _restore_superseded(superseded_pk)
        raise

    _announce_publication(project, version, first_publication=first_publication, publisher=user)
    _audit(
        request,
        action='content_edit',
        target_id=project.pk,
        summary=f'Published version {version.number} of "{version.title}"',
        detail={
            'version_id': version.pk,
            'number': version.number,
            'kind': version.kind,
            'first_publication': first_publication,
            'material_id': project.material_id,
        },
    )
    return version


def _restore_superseded(pk) -> None:
    if pk is not None:
        MaterialVersion.objects.filter(pk=pk, status='superseded').update(status='published')


def _announce_publication(project, version, *, first_publication: bool, publisher=None) -> None:
    """The feed row and the members' notifications for a successful publication.

    `record_activity` fires **only** for a new version of an already-published material. A first
    publication is announced by `create_material` as kind `material` (its docstring is explicit that
    it is the only caller of that, and that a caller which has already announced must not announce
    again), and the backfill announces nothing at all — house rule 9 means the feed only ever gets a
    row for something that was public at that instant, and none of the backfilled v1 rows were new.
    """
    if not first_publication:
        from activity.services import record_activity

        record_activity(
            'material_version',
            actor=version.created_by,
            material=project.material,
            target_label=version.title,
            source=version,
        )
    _notify_members(
        project,
        'material_version_published',
        actor=version.created_by,
        target_label=version.title,
        note=version.change_note,
        # The actor on the row is the version's AUTHOR, which is who the reader wants named — but
        # the person who pressed Publish (a co-author publishing someone's draft, or accepting a
        # proposal) did it and must not be told about it.
        skip=publisher,
    )


def sync_material(project, version) -> None:
    """**The projection.** Copy a published version's payload onto the `Material` row.

    This function is why nothing else in the codebase had to change for co-authoring to exist. A
    listing, a course item, a gallery, a report and the recommender all read `Material`; they keep
    reading it, and it keeps being right, because publishing writes through to it here.

    `Material.file` is assigned the STORED NAME of the version's file, never a re-upload: Django's
    `FileField` assignment copies the reference to the path the bytes are already at, exactly as
    material-submission approval always did. The other two kinds are cleared rather than left,
    so a material that used to be a PDF and is now a written text does not offer a stale download.

    The title and description go onto the translation row for the PROJECT's locale, not for the
    reader's: a version is written in one language, and a project that publishes in Polish must not
    overwrite somebody's English translation with Polish text. The other locales' rows keep whatever
    they said, which is exactly the situation `MaterialSerializer.translation_stale` reports.
    """
    from materials.models import MaterialTranslation

    material = project.material
    if material is None:  # pragma: no cover - publish never reaches here without one
        return
    material.file = version.file.name if (version.kind == 'file' and version.file) else ''
    material.url = version.url if version.kind == 'link' else ''
    material.body = version.body if version.kind == 'body' else ''
    material.save(update_fields=['file', 'url', 'body'])
    MaterialTranslation.objects.update_or_create(
        material=material,
        locale=project.locale,
        defaults={'title': version.title, 'description': version.description},
    )


def materialise(project, version, actor):
    """A project's first publication becomes a real `Material`.

    Through `materials.publish.create_material` and nothing else — it is the one way a material
    comes into being (slug allocation inside the branch, the original-locale translation, the
    requirement and coverage rows, the feed announcement), and a second implementation here is
    exactly the drift house rule 2 exists to prevent.

    `submitted_by` is the project's **owner**, because that is the byline a material carries: whose
    material this is, not who happened to press publish. `activity_actor` is the version's own
    author, so the feed names the person who wrote what is being announced — for a first publication
    that staff accepted out of the queue those two are genuinely different people, which is the case
    `create_material`'s own `activity_actor` parameter exists for.

    A draft project with no owner row falls back to whoever CREATED it before falling back to the
    actor. That is not hypothetical: `0003_fold_material_submissions` deliberately seats no owner
    when the person who uploaded is a minor (they may propose, never own — COAUTHORING-BRIEF.md §0),
    and attributing their work to the moderator who accepted it would be the wrong byline twice
    over. The actor remains the last resort, for a project nobody is recorded as having started.
    """
    from materials.publish import create_material

    owner = _owner_of(project) or project.created_by or actor
    material = create_material(
        branch=project.branch,
        type=project.type,
        audience=project.audience,
        submitted_by=owner,
        locale=project.locale,
        title=version.title,
        description=version.description,
        file=version.file if (version.kind == 'file' and version.file) else None,
        url=version.url if version.kind == 'link' else '',
        body=version.body if version.kind == 'body' else '',
        author=project.author,
        source_url=project.source_url,
        price_amount=project.price_amount,
        price_currency=project.price_currency or 'PLN',
        estimated_minutes=project.estimated_minutes,
        requirements=project.requirements or [],
        coverage=project.coverage or [],
        activity_actor=version.created_by or actor,
    )
    project.material = material
    project.save(update_fields=['material'])
    return material


def _owner_of(project):
    for row in project.members.all():
        if row.role == 'owner':
            return row.user
    return None


# --- deciding ---------------------------------------------------------------------------------------


def decide_version(version, user, decision: str, note: str = '', *, request=None) -> MaterialVersion:
    """Accept or reject a proposal. One decision per row, whoever clicks first.

    A rejection REQUIRES a note (house rule 6, and the same rule a denied solution entry and a
    declined governor application already follow): a refusal without a reason tells somebody who
    wanted to help nothing they can act on.

    The claim moves `proposed → draft` on an accept rather than straight to `published`, and that
    is not a detour: `one_published_version_per_project` means publishing has to supersede first,
    so `publish_version` owns that sequence and this hands it a row in the state it expects. A
    `draft` is exactly what "accepted, not yet the material" means, and if the publish then fails
    the claim goes back to `proposed` rather than leaving somebody's proposal in limbo.
    """
    note = (note or '').strip()
    if decision not in ('accept', 'reject'):
        raise Refused('bad_decision')
    if decision == 'reject' and not note:
        raise Refused('note_required')
    if version.status != 'proposed':
        raise Conflict('already_decided')

    now = timezone.now()
    target = 'draft' if decision == 'accept' else 'rejected'
    claimed = MaterialVersion.objects.filter(pk=version.pk, status='proposed').update(
        status=target, decided_by=user, decided_at=now, decision_note=note
    )
    if not claimed:
        raise Conflict('already_decided')
    version.refresh_from_db()

    project = version.project
    if decision == 'accept':
        try:
            publish_version(version, user, request=request)
        except Exception:
            MaterialVersion.objects.filter(pk=version.pk, status='draft').update(
                status='proposed', decided_by=None, decided_at=None, decision_note=''
            )
            version.refresh_from_db()
            raise
    else:
        # The bytes go, the record stays — see `reclaim_version_file`.
        reclaim_version_file(version)

    version.refresh_from_db()
    notify(
        version.created_by,
        'material_version_decided',
        actor=user,
        target_label=version.title,
        note=note,
        **_link_kwargs(project),
    )
    _audit(
        request,
        action='moderation_decision',
        target_id=project.pk,
        summary=f'{decision.capitalize()}ed version {version.number} of "{version.title}"',
        detail={
            'version_id': version.pk,
            'number': version.number,
            'decision': decision,
            'note': note[:200],
            'needed_staff_review': needs_staff_review(project),
        },
    )
    return version


def withdraw_version(version, user) -> MaterialVersion:
    """The proposer taking their own proposal back. The row survives as `withdrawn`; only the blob
    goes, the same way a rejection's does."""
    if version.created_by_id != getattr(user, 'pk', None):
        raise Refused('not_yours')
    claimed = MaterialVersion.objects.filter(pk=version.pk, status='proposed').update(
        status='withdrawn', decided_at=timezone.now()
    )
    if not claimed:
        raise Conflict('not_proposed')
    version.refresh_from_db()
    reclaim_version_file(version)
    version.refresh_from_db()
    return version


# --- the team ---------------------------------------------------------------------------------------


def add_member(project, user, *, role: str = 'coauthor', added_by=None, request=None) -> ProjectMember:
    """Put somebody on the team. Refuses a minor and a duplicate, each with its own reason."""
    if is_minor(user):
        raise Refused('minor')
    if is_member(project, user):
        raise Refused('already_member')
    member = ProjectMember.objects.create(
        project=project, user=user, role=role, added_by=added_by
    )
    notify(
        user,
        'project_member_added',
        actor=added_by,
        target_label=_project_label(project),
        **_link_kwargs(project),
    )
    _audit(
        request,
        action='permission_change',
        target_id=project.pk,
        summary=f'Added {user} as {role}',
        detail={'user_id': user.pk, 'role': role},
    )
    return member


def remove_member(project, user, *, by=None, request=None) -> None:
    """Remove somebody, or leave yourself — to the row they are the same act.

    The owner cannot be removed, by anybody including themselves: a project with no owner is one
    nobody can hand over, invite to, or decide join requests for. `transfer_ownership` is how that
    changes, which is the same hostage-proofing `courses.CourseStaff` applies to its own owner row.
    """
    row = project.members.filter(user=user).first()
    if row is None:
        raise Refused('not_member')
    if row.role == 'owner':
        raise Refused('owner_immutable')
    row.delete()
    _audit(
        request,
        action='permission_change',
        target_id=project.pk,
        summary=f'Removed {user}',
        detail={'user_id': user.pk, 'by': getattr(by, 'pk', None)},
    )


def transfer_ownership(project, from_user, to_user, *, request=None) -> MaterialProject:
    """Hand the project over. Demote first, then promote — the partial unique index demands it.

    `one_owner_per_project` is a real index, so promoting before demoting would have two owner rows
    in flight and fail deterministically on the very first, uncontended transfer — the same class of
    bug (and the same fix: get the order right) that `_publish_translation` records for translations.

    Somebody who is not yet on the team is added by this call rather than refused. The UI only ever
    offers the button beside an existing co-author, so this is the honest handling of a direct API
    call rather than a second refusal reason nobody has written a sentence for — and "hand it to
    this account" plainly implies they are on the team afterwards.
    """
    if is_minor(to_user):
        raise Refused('minor')
    with transaction.atomic():
        # Two fast statements on one table, which is the only shape `atomic()` is safe in on SQLite
        # (backend/CLAUDE.md rule 2).
        project.members.filter(role='owner').update(role='coauthor')
        existing = project.members.filter(user=to_user).first()
        if existing is None:
            ProjectMember.objects.create(
                project=project, user=to_user, role='owner', added_by=from_user
            )
        else:
            project.members.filter(pk=existing.pk).update(role='owner')
    _audit(
        request,
        action='permission_change',
        target_id=project.pk,
        summary=f'Transferred ownership to {to_user}',
        detail={'from_user_id': getattr(from_user, 'pk', None), 'to_user_id': to_user.pk},
    )
    return project


def accept_invite(invite, user, *, request=None) -> MaterialProject:
    """Follow an invite link and become a co-author.

    The use count is claimed with ONE conditional `update()` rather than under a lock: two people
    following the last remaining use of a link at the same instant must produce one member and one
    clean refusal, and `filter(uses < max_uses).update(uses=F('uses') + 1)` is atomic on every
    backend including SQLite, where `select_for_update` is a silent no-op (rule 1). The precheck
    above it is not redundant — it is what produces the RIGHT reason (`revoked`/`expired`) for the
    two cases that are not a race at all.
    """
    project = invite.project
    reason = invite.unusable_reason()
    if reason:
        raise Refused(reason)
    if is_minor(user):
        raise Refused('minor')
    if is_member(project, user):
        raise Refused('already_member')

    from .models import ProjectInvite

    claimed = (
        ProjectInvite.objects.filter(pk=invite.pk, revoked_at__isnull=True)
        .filter(Q(max_uses=0) | Q(uses__lt=F('max_uses')))
        .update(uses=F('uses') + 1)
    )
    if not claimed:
        raise Refused('used_up')

    add_member(project, user, added_by=invite.created_by, request=request)
    notify(
        invite.created_by,
        'project_invite_used',
        actor=user,
        target_label=_project_label(project),
        **_link_kwargs(project),
    )
    return project


def create_join_request(project, user, statement: str) -> ProjectJoinRequest:
    """Ask to be let on. Every member is told — a queue that notifies one person stalls, which is
    the lesson `courses`' contribution queue and `moderation`'s application queue both record."""
    from .access import join_block_reason

    reason = join_block_reason(project, user)
    if reason is not None:
        raise Refused(reason)
    request_row = ProjectJoinRequest.objects.create(
        project=project, user=user, statement=statement
    )
    _notify_members(
        project,
        'project_join_requested',
        actor=user,
        target_label=_project_label(project),
        note=statement[:200],
    )
    return request_row


def decide_join_request(req, user, decision: str, note: str = '', *, request=None) -> ProjectJoinRequest:
    """Accept or decline. A decline needs a note, the same rule a rejected version follows."""
    note = (note or '').strip()
    if decision not in ('accept', 'decline'):
        raise Refused('bad_decision')
    if decision == 'decline' and not note:
        raise Refused('note_required')
    if req.status != 'pending':
        raise Conflict('already_decided')

    target = 'accepted' if decision == 'accept' else 'declined'
    claimed = ProjectJoinRequest.objects.filter(pk=req.pk, status='pending').update(
        status=target, decided_by=user, decided_at=timezone.now(), decision_note=note
    )
    if not claimed:
        raise Conflict('already_decided')
    req.refresh_from_db()

    if decision == 'accept':
        try:
            add_member(req.project, req.user, added_by=user, request=request)
        except Refused as exc:
            if exc.reason != 'already_member':
                # Same revert-on-failure shape as every other claim here: the decision was written
                # before the work that justifies it, so a failure has to put it back.
                ProjectJoinRequest.objects.filter(pk=req.pk, status='accepted').update(
                    status='pending', decided_by=None, decided_at=None, decision_note=''
                )
                req.refresh_from_db()
                raise
    notify(
        req.user,
        'project_join_decided',
        actor=user,
        target_label=_project_label(req.project),
        note=note,
        **_link_kwargs(req.project),
    )
    return req


def withdraw_join_request(req, user) -> ProjectJoinRequest:
    if req.user_id != getattr(user, 'pk', None):
        raise Refused('not_yours')
    claimed = ProjectJoinRequest.objects.filter(pk=req.pk, status='pending').update(
        status='withdrawn'
    )
    if not claimed:
        raise Conflict('already_decided')
    req.refresh_from_db()
    return req


# --- the small shared bits ---------------------------------------------------------------------------


def _link_kwargs(project) -> dict:
    """Which FK a notification about this project hangs off.

    `material` once one exists, because that is the page a reader wants; `material_project`
    otherwise, because a draft project has a page too and a notification nobody can click is
    markedly less useful than one they can (`notifications/CLAUDE.md`'s own standard for adding an
    FK at all).
    """
    if project.material_id is not None:
        return {'material': project.material}
    return {'material_project': project}


def _project_label(project) -> str:
    """A human name for the project: whatever its head version is called, else the material's title.

    Captured at notification time rather than resolved at read time, which is the denormalization
    `Notification.target_label` exists for — a version can be superseded, and the notification
    should still say what it was about.
    """
    head = project.head_version
    if head is not None and head.title:
        return head.title
    if project.material_id is not None:
        from notifications.services import label_for_material

        return label_for_material(project.material)
    return ''


def _notify_members(
    project, notif_type: str, *, actor, target_label: str, note: str = '', skip=None
) -> None:
    """Tell everybody on the team. `notify()`'s own `actor == recipient` guard skips the actor;
    `skip` is for the one case where the person who acted is not the actor the row names (a
    publication names the version's author, while somebody else may have pressed Publish)."""
    link = _link_kwargs(project)
    skip_pk = getattr(skip, 'pk', None)
    for member in project.members.select_related('user__profile'):
        if skip_pk is not None and member.user_id == skip_pk:
            continue
        notify(
            member.user,
            notif_type,
            actor=actor,
            target_label=target_label,
            note=note,
            **link,
        )


def _audit(request, *, action: str, target_id, summary: str, detail: dict | None = None) -> None:
    """One `AuditEvent`, when there is a request to attribute it to.

    `record_audit` reads `request.user.id`, so a call from a management command or a migration has
    nothing to record and is skipped rather than faked. Always OUTSIDE any `atomic()` block, which
    is the rule that module states and the reason every caller above audits last.
    """
    if request is None or not getattr(request, 'user', None):
        return
    if not getattr(request.user, 'is_authenticated', False):
        return
    record_audit(
        request,
        action=action,
        target_type='material_project',
        target_id=target_id,
        summary=summary,
        detail=detail,
    )


__all__ = [
    'Stale',
    'Conflict',
    'Refused',
    'allocate_number',
    'check_upload_allowance',
    'create_project',
    'save_version',
    'publish_version',
    'decide_version',
    'withdraw_version',
    'sync_material',
    'materialise',
    'reclaim_version_file',
    'add_member',
    'remove_member',
    'transfer_ownership',
    'accept_invite',
    'create_join_request',
    'decide_join_request',
    'withdraw_join_request',
]
