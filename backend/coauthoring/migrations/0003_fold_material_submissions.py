"""Fold every `moderation.MaterialSubmission` into a project with a team of one.

Two ways to bring a material into being was the defect the board already named
(COAUTHORING-BRIEF.md §0): the single-shot `/submit-material` form and a co-authored project's
first publication did the same job through two models, two queues and two decision paths. This
migration is the half that keeps the history; `moderation/0038_delete_materialsubmission` is the
half that removes the model, and it depends on this one so the rows are always read before the
table goes.

**What each status becomes, and why.**

* `pending` → a DRAFT project (no material yet) whose version 1 is `proposed`. That is precisely
  what a pending submission was: somebody asking for a new material to exist, waiting for a
  moderator. It lands in the queue's `material_versions` section, which is the same list the queue
  showed it in before, and is decided at `POST /api/material-versions/{id}/decide/` by the same
  people (`access.needs_staff_review` → staff or the branch's governor).
* `rejected` → the same draft project with a `rejected` version 1, carrying who decided, their note,
  and the reclaim stamp when the blob was already dropped. House rule 12: the record of a decision
  is part of the trust model, so a refused upload keeps its row rather than vanishing with its
  table.
* `approved` → **nothing is created.** Its `resulting_material` already has a project and a
  published version 1 from the backfill (`0002_backfill_projects`); what the backfill could not know
  is what this submission records — who approved it, what they said, and what the scanner found at
  upload time — so those are written onto that existing version instead. Creating a second project
  here would give one material two.
* `approved` with no material left (`SET_NULL` fired when somebody deleted it) → skipped. There is
  nothing to attach the decision to, and a draft project holding a copy of a deleted material would
  be a new, wrong thing rather than a preserved old one.

**Idempotent, by matching rather than by a marker column.** Adding a column to record "this came
from submission 12" would be a schema change for a one-off migration, and the submission table is
about to be deleted anyway, so there would be nothing left to point back at. Instead a pending or
rejected submission is skipped when a draft project already exists with the same submitter, the same
branch, and a version 1 whose title and `created_at` are the ones this migration would give it — and
`created_at` is the sharp end of that match, because it is copied from the submission with an
explicit `update()` and is otherwise the migration's own run time. Approved rows are idempotent for
free: they only ever overwrite the same fields with the same values.

**Never a re-upload.** A folded version is assigned the stored NAME the submission already had
(`material_submissions/<uuid>.<ext>`), the same way the backfill assigns a material's. The bytes do
not move, nothing is copied, and `coauthoring.models.version_upload_path` records why a version may
legitimately carry a path from the other app's directory.

**No activity rows and no notifications**, for the reason `0002_backfill_projects` states in full:
nobody did anything here, the feed is public-by-construction rather than an audit log (house rule 9),
and a notification about a decision somebody was already told about months ago is noise.

Reverse is a deliberate no-op. Unapplying cannot un-fold — the submissions are what these rows were
made from, and `0038` will have dropped them — and a reverse that deleted the projects would take
whatever real work has since been done on top of them.
"""

import importlib

from django.db import migrations

#: `MaterialVersion.scan_detail` is 200 characters; the submission's was 300. SQLite would not
#: complain, but a column that quietly holds more than it declares is how a later database refuses
#: a migration nobody can explain.
_SCAN_DETAIL_MAX = 200


def _sanitize(value: str) -> str:
    """`MaterialVersion.save()` sanitizes title/description/body on every write, and a historical
    model in a migration does not run it — so this does, explicitly. It matters here more than for
    the backfill (whose text came from an already-sanitized `MaterialTranslation`): a submission's
    title and description were stored exactly as typed, and these rows are about to be rendered in
    the moderation queue and, once accepted, on a public page. House rule 8, on the write side."""
    from config.sanitize import sanitize_content

    return sanitize_content(value or '')


def _stored_size(name: str) -> int:
    """How big the already-stored blob is, or 0 when storage cannot say.

    A missing file must not fail the migration: the row it belongs to is still a true record of what
    was submitted, and `Profile.material_upload_bytes` sums live from storage anyway — this number
    is the record, not the budget (`MaterialVersion.file_size`).
    """
    if not name:
        return 0
    from django.core.files.storage import default_storage

    try:
        return default_storage.size(name)
    except (OSError, ValueError, NotImplementedError):
        return 0


def _kind_of(submission) -> str:
    """`file` whenever there was one — including a rejected row whose blob has been reclaimed, which
    still records that a file is what was submitted. `link` otherwise.

    A submission could carry BOTH a file and a URL (its serializer required one or the other, never
    exactly one). The version keeps both columns as they were rather than silently dropping the
    link, and `kind` names the file, because the file is what a publication would carry.
    """
    if submission.file or submission.file_reclaimed_at is not None:
        return 'file'
    if submission.url:
        return 'link'
    return 'file'


def _catalogue(submission) -> dict:
    return {
        'branch_id': submission.branch_id,
        'locale': submission.locale or 'pl',
        'type': submission.type or '',
        'audience': submission.audience,
        'author': submission.author or '',
        'source_url': submission.source_url or '',
        'price_amount': submission.price_amount,
        'price_currency': submission.price_currency or 'PLN',
        'estimated_minutes': submission.estimated_minutes,
        'requirements': submission.requirements or [],
        'coverage': submission.coverage or [],
        'created_by_id': submission.submitted_by_id,
    }


def fold(apps, schema_editor):
    MaterialSubmission = apps.get_model('moderation', 'MaterialSubmission')
    MaterialProject = apps.get_model('coauthoring', 'MaterialProject')
    MaterialVersion = apps.get_model('coauthoring', 'MaterialVersion')
    ProjectMember = apps.get_model('coauthoring', 'ProjectMember')
    Profile = apps.get_model('accounts', 'Profile')

    submissions = list(MaterialSubmission.objects.all().order_by('pk'))
    if not submissions:
        return

    # Every material needs a project before the approved rows below can write onto one. The backfill
    # normally did that in `0002`, but a material approved through the old path AFTER that migration
    # ran (a real window on any environment that deployed the two phases separately — this project's
    # own dev box is one) never got a project at all. Re-running the backfill is the honest fix and
    # costs nothing when there is nothing to do: it skips every material that already has one, which
    # is what makes it safe to call from here rather than copying its body.
    importlib.import_module('coauthoring.migrations.0002_backfill_projects').backfill(
        apps, schema_editor
    )

    # A minor may propose a version — a person always reads a proposal — but may never OWN a project
    # (COAUTHORING-BRIEF.md §0), and the single-shot form never asked. Their submission still becomes
    # a project, with `created_by` naming them so the byline and the feed stay honest
    # (`services.materialise` falls back to it), but no owner row: nothing this migration writes may
    # hand somebody an ability the live rules refuse them.
    minor_ids = set(
        Profile.objects.filter(
            user_id__in={s.submitted_by_id for s in submissions}, is_minor=True
        ).values_list('user_id', flat=True)
    )

    for submission in submissions:
        if submission.status == 'approved':
            _fold_approved(submission, MaterialProject, MaterialVersion)
            continue
        _fold_undecided(
            submission, MaterialProject, MaterialVersion, ProjectMember, minor_ids
        )


def _fold_approved(submission, MaterialProject, MaterialVersion):
    """Teach the backfilled version 1 what only the submission knew."""
    if not submission.resulting_material_id:
        return
    project = MaterialProject.objects.filter(material_id=submission.resulting_material_id).first()
    if project is None:  # pragma: no cover - the backfill above gives every material one
        return
    first = project.versions.filter(number=1).first()
    if first is None:  # pragma: no cover - the backfill always writes one
        return
    MaterialVersion.objects.filter(pk=first.pk).update(
        # The uploader is the version's author, whatever `Material.submitted_by` says today — the
        # submission is the record of who actually sent these bytes.
        created_by_id=submission.submitted_by_id,
        decided_by_id=submission.reviewed_by_id,
        # There is no `reviewed_at` on a submission and never was. The material's own `created_at`
        # IS the moment of approval (the approve request is what created it), so it is the honest
        # answer for a row a moderator decided — and stays null for an auto-published one, where
        # nobody decided anything and `review_note` says so in the submitter's stead.
        decided_at=(
            project.material.created_at if submission.reviewed_by_id is not None else None
        ),
        decision_note=submission.review_note or '',
        # What the scanner found at UPLOAD time, which the backfill could not have known: it read a
        # `Material`, and a material does not carry a scan outcome.
        scan_status=submission.scan_status or 'skipped',
        scan_detail=(submission.scan_detail or '')[:_SCAN_DETAIL_MAX],
        # When it was written rather than when the backfill ran.
        created_at=submission.created_at,
    )


def _fold_undecided(submission, MaterialProject, MaterialVersion, ProjectMember, minor_ids):
    """A pending or rejected submission becomes a draft project with one version."""
    title = _sanitize(submission.title)
    if MaterialProject.objects.filter(
        material__isnull=True,
        branch_id=submission.branch_id,
        created_by_id=submission.submitted_by_id,
        versions__number=1,
        versions__title=title,
        versions__created_at=submission.created_at,
    ).exists():
        return

    project = MaterialProject.objects.create(**_catalogue(submission))
    if submission.submitted_by_id and submission.submitted_by_id not in minor_ids:
        # `MaterialProject.save()` seats the creator as owner on a live model; a historical one has
        # the plain `Model.save`, so the row is created here — the same note `0002` carries.
        ProjectMember.objects.create(
            project=project, user_id=submission.submitted_by_id, role='owner'
        )

    reclaimed = submission.file_reclaimed_at is not None
    version = MaterialVersion.objects.create(
        project=project,
        number=1,
        status='proposed' if submission.status == 'pending' else 'rejected',
        kind=_kind_of(submission),
        # The SAME stored name the submission held — never a re-upload. A reclaimed row has none
        # left, which is exactly what `file_reclaimed_at` beside it records.
        file=submission.file.name if submission.file else '',
        url=submission.url or '',
        title=title,
        description=_sanitize(submission.description),
        created_by_id=submission.submitted_by_id,
        decided_by_id=submission.reviewed_by_id,
        # A rejection's own timestamp survives only as the moment its blob was reclaimed — the two
        # happened in one request. Null when there was nothing to reclaim, rather than invented.
        decided_at=submission.file_reclaimed_at,
        decision_note=submission.review_note or '',
        scan_status=submission.scan_status or 'skipped',
        scan_detail=(submission.scan_detail or '')[:_SCAN_DETAIL_MAX],
        file_reclaimed_at=submission.file_reclaimed_at,
        # The reclaimed size is the only place those bytes survive at all; an intact file is
        # measured from storage.
        file_size=(
            submission.reclaimed_file_bytes
            if reclaimed
            else _stored_size(submission.file.name if submission.file else '')
        ),
    )
    # `auto_now_add` ignores a `created_at` kwarg, so both rows are stamped afterwards — and the
    # version's stamp is what makes this migration's own idempotency check sharp. A project is as
    # old as the submission it came from: it is the same act, under a new name.
    MaterialVersion.objects.filter(pk=version.pk).update(created_at=submission.created_at)
    MaterialProject.objects.filter(pk=project.pk).update(created_at=submission.created_at)


class Migration(migrations.Migration):

    dependencies = [
        ('coauthoring', '0002_backfill_projects'),
        # The whole moderation app as it stands, so `MaterialSubmission` is still in the historical
        # state this reads it from — and so `0038`, which deletes it, can depend on this.
        ('moderation', '0037_seed_coauthoring_flag'),
        # `Profile.is_minor` (added by 0021) is read to decide who does NOT get an owner row.
        ('accounts', '0021_guardianship'),
    ]

    operations = [
        migrations.RunPython(fold, migrations.RunPython.noop),
    ]
