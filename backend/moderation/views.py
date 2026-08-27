"""Section 14's moderation surface. "Moderator" is, for this prototype, Django's own `is_staff` flag
— a coarser, adjacent concept to the separate verified-contributor tier (`Profile.is_verified_contributor`)
`ExerciseSubmissionViewSet.perform_create` below reads for the auto-publish fast path CLAUDE.md
Section 18 item 4 resolves.

The "node governor" feature (see `.models.NodeGovernor`/`.services.is_governor_of_course`) adds a
SECOND, narrower kind of moderator on top — scoped to one Discipline/Branch rather than the whole
platform. `is_staff` stays the coarser, global concept everywhere; it's checked first and always
wins, so nothing about today's existing global-moderator behavior changes for an `is_staff` user.
"""

from django.contrib.contenttypes.models import ContentType
from django.db import IntegrityError, OperationalError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.views import APIView

from exercises.models import Exercise, ExerciseTranslation
from exercises.serializers import ExerciseTranslationSerializer
from materials.models import Material
from materials.validators import scan_for_malware
from notifications.services import (
    label_for_exercise,
    label_for_material,
    label_for_taxonomy_node,
    notify,
    notify_tag_followers,
)
from services.models import Service

from .models import EditSuggestion, ExerciseSubmission, FeatureFlag, MaterialSubmission, NodeGovernor, Report
from .permissions import RequireVerifiedContributorForMaterialUploads, feature_gate
from .serializers import (
    EditSuggestionSerializer,
    ExerciseSubmissionSerializer,
    FeatureFlagSerializer,
    MaterialSubmissionSerializer,
    NodeGovernorSerializer,
    ReportCreateSerializer,
)
from .services import (
    REPORT_KIND_MODELS,
    _content_owner,
    _describe,
    build_moderation_queue_payload,
    count_pending_moderation,
    build_report_queue,
    check_auto_hide,
    governed_branch_ids,
    is_governor_of_course,
    resolve_view_scope_exercise,
)


class IsModerator(permissions.BasePermission):
    """True for Django's own global `is_staff` moderator, OR anyone who governs at least one
    taxonomy node — the coarse, VIEW-level gate that lets a scoped node governor even reach the
    moderation surface at all. `ModerationActionView`/`ReportActionView` below still do their own,
    narrower OBJECT-level check afterward (governs THIS SPECIFIC item's own course) — this class
    only answers "should this request be allowed anywhere near the moderation endpoints."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_staff:
            return True
        if NodeGovernor.objects.filter(user=user).exists():
            return True
        # Somebody who runs a course can reach the report ACTION for content inside it — the queue
        # itself stays scoped by the object-level checks below, so this admits them to the endpoint
        # without showing them anything that is not theirs. Their own scoped list of what has been
        # reported lives on the course (`GET /api/courses/{id}/reports/`), not here.
        #
        # Local import: `courses` imports `moderation.permissions` for its own feature gate, so
        # reaching back at module scope invites a cycle. Same shape as `ProfileSerializer`'s own
        # local import of `NodeGovernor`.
        from courses.models import CURATING_ROLES, CourseStaff

        return CourseStaff.objects.filter(user=user, role__in=CURATING_ROLES).exists()


class ExerciseSubmissionViewSet(viewsets.ModelViewSet):
    """POST /api/exercise-submissions/ (auth required) → moderation queue, unless the submitter is a
    verified contributor (below). A regular user only ever sees their own submissions; a moderator
    (is_staff) sees every submission."""

    serializer_class = ExerciseSubmissionSerializer
    # feature_gate('exercise_submissions') applies to EVERY action (list/retrieve/create/...), not
    # just create — a killed feature genuinely vanishes from the API for a non-staff caller (see
    # permissions.py's own doc comment), not just from the "Submit exercise" nav link.
    permission_classes = [permissions.IsAuthenticated, feature_gate('exercise_submissions')]

    def get_queryset(self):
        qs = ExerciseSubmission.objects.all()
        if not self.request.user.is_staff:
            qs = qs.filter(submitted_by=self.request.user)
        branch = self.request.query_params.get('branch')
        if branch:
            qs = qs.filter(branch__slug=branch)
        return qs

    def perform_create(self, serializer):
        """CLAUDE.md Section 18 item 4's own real, previously-undecided policy question — resolved: a
        NEW EXERCISE from a verified contributor (`Profile.is_verified_contributor`, already a real
        tier this app grants and reads elsewhere for material-coverage vote weighting,
        materials/serializers.py) goes live immediately, no moderator review. Deliberately narrow,
        matching the policy exactly as decided, not "trust this person generally": an EDIT SUGGESTION
        or a TRANSLATION from the same verified contributor still queues regardless
        (`EditSuggestionViewSet`/`ExerciseTranslationViewSet` are both untouched by this) — trust in
        someone's own NEW exercise being mathematically sound doesn't extend to trusting an unreviewed
        CHANGE to something that's already published and already been checked once.

        Reuses `_apply_submission` unchanged — the exact same function `ModerationActionView` calls
        for a moderator's own approve action, retry-safe number allocation included, so an auto-
        published submission racing a real concurrent moderator approval for the same course (Section
        17I) is already covered by the same fix, not a new, second race this path could reintroduce.

        `reviewed_by` is deliberately left unset — genuinely no one reviewed this, and pretending the
        submitter reviewed their own work would be dishonest in exactly the place a moderator might
        later want to distinguish "a person checked this" from "the system published it on trust."
        `review_note` says so in plain language instead. No `_notify_decision` call either: that
        notification exists to tell a submitter about a moderator's decision they weren't present
        for — here the submitter IS the one making this request right now, and the response body
        (`status: 'approved'`, `resulting_exercise` set) already tells them synchronously; a
        notification a moment later about their own just-completed action would just be noise. Tag
        followers still get notified as usual — that already happens unconditionally inside
        `_apply_submission` itself, regardless of which path led there."""
        submission = serializer.save(submitted_by=self.request.user)
        profile = getattr(self.request.user, 'profile', None)
        if profile and profile.is_verified_contributor:
            _apply_submission(submission, self.request.user)
            submission.status = 'approved'
            submission.review_note = 'Auto-published — submitted by a verified contributor.'
            submission.save(update_fields=['status', 'review_note', 'resulting_exercise'])


class EditSuggestionViewSet(viewsets.ModelViewSet):
    """POST /api/edit-suggestions/ (auth required) → moderation queue, always — deliberately
    unconditional, unlike `ExerciseSubmissionViewSet` right above. The verified-contributor
    auto-publish policy (CLAUDE.md Section 18 item 4) only ever covers a brand-new exercise; an edit
    suggestion is a change to something that's ALREADY published and already been reviewed once, so
    trusting a verified contributor's own new work doesn't extend to skipping review of a change to
    someone else's."""

    serializer_class = EditSuggestionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = EditSuggestion.objects.all()
        if not self.request.user.is_staff:
            # Your own suggestions — plus, new with the solution pool, every PENDING suggestion
            # against an entry YOU authored: its author is one of the people who may decide it
            # (see `decide` below), and they cannot decide what they cannot list.
            from django.db.models import Q

            qs = qs.filter(
                Q(submitted_by=self.request.user)
                | Q(status='pending', entry__author=self.request.user)
            )
        exercise = self.request.query_params.get('exercise')
        if exercise:
            qs = qs.filter(exercise_id=exercise)
        entry = self.request.query_params.get('entry')
        if entry:
            qs = qs.filter(entry_id=entry)
        return qs.distinct()

    def perform_create(self, serializer):
        serializer.save(submitted_by=self.request.user)

    @action(detail=True, methods=['post'])
    def decide(self, request, pk=None):
        """POST /api/edit-suggestions/{id}/decide/ {decision: 'approve'|'reject', note?} — the
        decision path for a suggestion that targets a SOLUTION ENTRY, where the deciding circle is
        different from the moderation queue's: the entry's own AUTHOR (it is their entry), staff,
        or a governor of the exercise's branch (`can_decide_entry_suggestion` — also the seam the
        future field-expert tier lands in). Deliberately NOT every verified contributor: folding
        words into somebody else's solution is a different act than reviewing a new standalone
        entry. Translation-targeted suggestions stay with `ModerationActionView` alone and are
        refused here — one deciding circle per target kind, stated rather than blurred.

        Same idempotent claim pattern as every other decision in this app; the submitter is
        notified through the identical `edit_suggestion_*` types a queue decision produces."""
        suggestion = self.get_object()
        if suggestion.entry_id is None:
            return Response(
                {'detail': 'Only a suggestion against a solution/hint entry is decided here.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from exercises.entries import can_decide_entry_suggestion

        if not can_decide_entry_suggestion(request.user, suggestion.entry):
            return Response(status=status.HTTP_403_FORBIDDEN)
        decision = request.data.get('decision')
        if decision not in ('approve', 'reject'):
            return Response(
                {'decision': ["Must be 'approve' or 'reject'."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        note = (request.data.get('note') or '').strip()
        target_status = 'approved' if decision == 'approve' else 'rejected'
        claimed = EditSuggestion.objects.filter(pk=suggestion.pk, status='pending').update(
            status=target_status, reviewed_by=request.user, review_note=note
        )
        if not claimed:
            return Response(
                {'detail': 'This suggestion has already been decided.'},
                status=status.HTTP_409_CONFLICT,
            )
        suggestion.refresh_from_db()
        if decision == 'approve':
            try:
                _apply_edit_suggestion(suggestion)
            except Exception:
                EditSuggestion.objects.filter(pk=suggestion.pk).update(
                    status='pending', reviewed_by=None, review_note=''
                )
                raise
        notify(
            suggestion.submitted_by,
            f'edit_suggestion_{target_status}',
            actor=request.user,
            target_label=label_for_exercise(suggestion.exercise),
            exercise=suggestion.exercise,
            note=note,
        )
        return Response(EditSuggestionSerializer(suggestion).data)


class MaterialSubmissionViewSet(viewsets.ModelViewSet):
    """POST /api/material-submissions/ (multipart/form-data — auth required) → moderation queue.
    "exams, tests, etc. — usually a PDF/PNG, but a whole LaTeX/Word document should be accepted too,
    scanned and kept safe" — the real content-type/size validation (materials/validators.py's
    `validate_material_submission_file`, wired onto the model field itself) runs on every write via
    this ViewSet's own DRF serializer validation; the malware scan below is a SECOND, separate check
    this view runs explicitly, since "scan it" isn't something a plain field validator can express
    (it needs network I/O to a scanner, not just a look at the bytes already in hand).

    `parser_classes` declared explicitly rather than left to DRF's own default (which already
    includes MultiPartParser) — a reader shouldn't have to already know that default to see this
    endpoint accepts a real file upload, not a JSON body."""

    serializer_class = MaterialSubmissionSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        # The verified-contributor restriction is deliberately scoped to `create` alone — an
        # ordinary (non-verified) user who already has past submissions should still see them here
        # (list/retrieve), and the platform-wide `material_submissions` kill switch above still
        # gates every action for everyone regardless, unchanged.
        perms = [permissions.IsAuthenticated(), feature_gate('material_submissions')()]
        if self.action == 'create':
            perms.append(RequireVerifiedContributorForMaterialUploads())
        return perms

    def get_throttles(self):
        """Scopes the tighter `material_submission` budget (config/settings.py's own
        DEFAULT_THROTTLE_RATES) to `create` alone.

        Set here rather than as a plain class attribute — the shape `AvatarView.throttle_scope`
        uses, which is a single-purpose APIView and so has nothing to distinguish — because a
        ViewSet's actions are not all the same request: reading back one's own past submissions is
        an ordinary cheap GET that should keep the loose global `user` budget, while `create` writes
        up to 25MB to disk and runs a malware scan over it. `ScopedRateThrottle` reads
        `throttle_scope` off the view at request time and treats a falsy one as "not scoped at all",
        and `self.action` is already resolved by the time DRF asks for throttles (`initialize_request`
        sets it before `initial()` runs), so this is the honest place to make that distinction.
        """
        self.throttle_scope = 'material_submission' if self.action == 'create' else None
        return super().get_throttles()

    def get_queryset(self):
        qs = MaterialSubmission.objects.all()
        if not self.request.user.is_staff:
            qs = qs.filter(submitted_by=self.request.user)
        branch = self.request.query_params.get('branch')
        if branch:
            qs = qs.filter(branch__slug=branch)
        return qs

    def perform_create(self, serializer):
        """Scans the upload BEFORE it's ever visible to a moderator, recording an honest
        `scan_status`/`scan_detail` either way (see `MaterialSubmission`'s own doc comment for why
        this is surfaced, not silently discarded). `MATERIAL_SCAN_REQUIRED` (config/settings.py) —
        False in this project's own sandboxed dev environment, where no ClamAV daemon exists to
        reach at all — is what a real deployment that actually runs ClamAV would flip to True, which
        turns "couldn't scan it" into a hard rejection instead of a recorded, honest skip."""
        from django.conf import settings
        from rest_framework.exceptions import ValidationError

        self._check_storage_allowance(serializer)
        submission = serializer.save(submitted_by=self.request.user)
        outcome = scan_for_malware(submission.file)
        if not outcome.scanned and getattr(settings, 'MATERIAL_SCAN_REQUIRED', False):
            submission.delete()
            raise ValidationError({'file': [f'Could not scan this file for safety: {outcome.detail}']})
        if outcome.scanned and not outcome.clean:
            submission.delete()
            raise ValidationError({'file': [outcome.detail]})
        submission.scan_status = 'clean' if outcome.scanned else 'skipped'
        submission.scan_detail = outcome.detail
        submission.save(update_fields=['scan_status', 'scan_detail'])

    def _check_storage_allowance(self, serializer):
        """`Profile.material_upload_quota_bytes` — the per-account total, enforced here because this
        is the only place a new submission's bytes are ever admitted.

        Sits alongside the per-FILE cap rather than instead of it: `MAX_MATERIAL_SUBMISSION_SIZE_BYTES`
        (materials/validators.py, a real field validator that has already run by the time this is
        reached) bounds ONE upload at 25MB, which says nothing about how many an account may make.
        This is the aggregate half, and it is the half the material-submission path never had —
        `TaughtCourse.upload_quota_bytes` bounds a course's stored bytes on the course-content path,
        and nothing bounded a person's.

        **The incoming file is weighed too**, so an account sitting just under its allowance refuses
        what would take it over rather than accepting it and going over silently — the same rule the
        course-side check (classroom/views.py) already states, kept identical on purpose, because
        two quota checks that round differently is a bug nobody would ever look for.

        **Checked before `serializer.save()`, which is what actually writes the file to storage.**
        The course-side check has the same ordering for a different reason (its file already exists,
        being an already-stored Material); here it genuinely matters — refusing after the save would
        mean writing bytes only to unlink them, which is exactly the disk pressure the quota exists
        to prevent, and would leave a real orphan behind if the unlink ever failed.

        The refusal names the three numbers a person needs to act on it (used, allowance, and the
        size of the file being refused). A bare "quota exceeded" leaves somebody guessing whether to
        compress the file, split it, or ask for more room.
        """
        profile = getattr(self.request.user, 'profile', None)
        quota = getattr(profile, 'material_upload_quota_bytes', 0) or 0
        if not quota:
            return

        incoming = serializer.validated_data.get('file')
        try:
            incoming_size = incoming.size if incoming else 0
        except (OSError, ValueError):
            incoming_size = 0

        used = profile.material_upload_bytes
        if used + incoming_size <= quota:
            return

        from rest_framework.exceptions import ValidationError

        def _mb(value):
            return f'{value / (1024 * 1024):.1f}MB'

        raise ValidationError(
            {
                'file': [
                    f'This upload would take you past your storage allowance — you are using '
                    f'{_mb(used)} of {_mb(quota)}, and this file is {_mb(incoming_size)}. '
                    f'A moderator can raise the allowance, and rejected uploads give their space '
                    f'back.'
                ]
            }
        )


class ReportViewSet(viewsets.ModelViewSet):
    """POST /api/reports/ (auth required) — the user-facing side of the reporting system (see
    moderation/services.py's own module doc comment for the full feature). Create-only from this
    surface: a moderator's own view of reports goes through ModerationQueueView's grouped `reports`
    key (build_report_queue) and acts through ReportActionView below, never through this ViewSet's
    own list/retrieve/update — a plain per-row Report is never itself the unit a moderator reviews.
    """

    http_method_names = ['post']
    serializer_class = ReportCreateSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        report = serializer.save(reported_by=self.request.user)
        check_auto_hide(report.target)


class ModerationQueueView(APIView):
    """GET /api/moderation/queue/ — pending submissions + edits + translations + reports (grouped,
    priority-sorted — see build_report_queue's own doc comment), moderator (global OR node
    governor) only. Passing `request.user` through is what makes a scoped node governor
    automatically see only their own governed course(s) — build_moderation_queue_payload resolves
    `None` (a global is_staff moderator) back to today's original, completely unfiltered
    behavior."""

    permission_classes = [IsModerator]

    def get(self, request):
        # ✅ Phase 4 — the real query-building logic lives in build_moderation_queue_payload()
        # (services.py) now, not duplicated here — the exact same function
        # `measure_moderation_queue` imports and measures directly, so there is only ever one real
        # code path to keep correct/optimized.
        return Response(build_moderation_queue_payload(user=request.user))


def _apply_submission(submission, reviewer):
    """Builds a real Exercise + ExerciseTranslation from the submission's own JSON payload — same
    structural/translation-field split as everywhere else (CLAUDE.md Section 9). Auto-assigns the
    next free `number` within the course rather than trusting the payload for it, since (course,
    number) is the real uniqueness constraint.

    That constraint made this a genuine, found-and-reproduced race, not a theoretical one: two
    submissions for the SAME course, approved by two genuinely simultaneous requests, can both read
    the identical `next_number` before either one's `Exercise.objects.create()` commits — confirmed
    directly by firing two real, concurrent `POST .../approve/` calls against a real dev server and
    watching one come back a raw `django.db.utils.IntegrityError` / HTTP 500
    (`UNIQUE constraint failed: exercises_exercise.branch_id, exercises_exercise.number`). The
    textbook fix, `select_for_update()` on the course while computing the next number, doesn't help
    here: this project's own dev database is SQLite, which has no row-level locking at all
    (`connection.features.has_select_for_update` is `False`; Django silently no-ops a `select_for_update()`
    call rather than raising on a backend that can't honor it), so a lock-based fix would work on a
    real production Postgres deployment but do nothing in the one environment this was actually
    reproduced in.

    A small, bounded retry loop is what's genuinely correct on both — it doesn't try to prevent the
    collision, it makes the collision harmless by re-reading the current max and trying again the
    instant one is detected. Two DIFFERENT exceptions turned out to need catching, both found by
    directly re-running the same real concurrent-request test, not assumed up front:
    `IntegrityError` for the actual `(course, number)` collision described above, and — separately —
    `OperationalError` ("database is locked"), SQLite's own single-writer limitation surfacing under
    genuine concurrent write pressure even for this one small statement (`config/settings.py`'s own
    `DATABASES['default']['OPTIONS']['timeout']` was raised from Python's 5-second `sqlite3` default
    specifically because of this same finding, which helps but doesn't eliminate the chance of hitting
    it under real load). Each attempt gets its own SAVEPOINT (a nested `atomic()`) so a failed one
    doesn't poison whatever transaction the caller happens to be running in — without a savepoint,
    Django refuses any further query on that connection until an explicit rollback, which would turn
    a handled retry into the exact same unhandled 500 this is fixing."""
    payload = submission.payload
    branch = submission.branch
    for attempt in range(5):
        next_number = (
            Exercise.objects.filter(branch=branch)
            .order_by('-number')
            .values_list('number', flat=True)
            .first()
            or 0
        ) + 1
        try:
            with transaction.atomic():
                exercise = Exercise.objects.create(
                    branch=branch,
                    number=next_number,
                    difficulty=payload.get('difficulty', 'medium'),
                    published=True,
                    verified=False,
                    original_locale=payload.get('locale', 'pl'),
                    submitted_by=submission.submitted_by,
                )
            break
        except (IntegrityError, OperationalError):
            if attempt == 4:
                raise
            continue
    topic_ids = payload.get('topic_ids') or payload.get('topicIds') or []
    if topic_ids:
        exercise.topics.set(topic_ids)
    tag_slugs = payload.get('tags', [])
    if tag_slugs:
        from exercises.models import Tag

        tags = [Tag.objects.get_or_create(slug=slug)[0] for slug in tag_slugs]
        exercise.tags.set(tags)
        for tag in tags:
            notify_tag_followers(tag, actor=submission.submitted_by, exercise=exercise)
    # `requirements` — a plain list[str] of skill-tag labels, already cleaned/deduped by
    # ExerciseSubmissionSerializer.validate_payload at submission time — turned into real,
    # ordered ExerciseRequirement rows the instant a real Exercise first exists to attach them to,
    # mirroring `_apply_material_submission`'s own identical handling for MaterialRequirement.
    requirement_labels = payload.get('requirements', [])
    if requirement_labels:
        from exercises.models import ExerciseRequirement

        ExerciseRequirement.objects.bulk_create(
            ExerciseRequirement(exercise=exercise, label=label, order=i)
            for i, label in enumerate(requirement_labels)
        )
    source = payload.get('source') or {}
    if source:
        from exercises.models import ExerciseSource, ExerciseSourceTranslation

        exercise_source = ExerciseSource.objects.create(
            exercise=exercise,
            type=source.get('type', 'other'),
            collection=source.get('collection', '') or '',
            original_problem_number=source.get('original_problem_number')
            or source.get('originalProblemNumber'),
            pages=str(source.get('pages', '')) if source.get('pages') is not None else '',
            chapter=source.get('chapter'),
        )
        source_name = source.get('name', '')
        if source_name:
            ExerciseSourceTranslation.objects.create(
                source=exercise_source, locale=payload.get('locale', 'pl'), name=source_name
            )
    ExerciseTranslation.objects.create(
        exercise=exercise,
        locale=payload.get('locale', 'pl'),
        title=payload.get('title', ''),
        statement=payload.get('statement', ''),
        answer=payload.get('answer', ''),
        status='published',
        translated_by=None,
    )
    # The submission form's own hint/solution become real SolutionEntry rows — the founding
    # entries of this exercise's pool. Pinned only when a MODERATOR approved (submission.reviewed_by
    # was set by the claim step before this runs); the verified-contributor fast path publishes but
    # does not pin, since nobody actually reviewed it — the same honesty that path's own
    # `reviewed_by is None` already keeps for the submission itself.
    from exercises.models import SolutionEntry

    for kind in ('hint', 'solution'):
        body = (payload.get(kind) or '').strip()
        if body:
            SolutionEntry.objects.create(
                exercise=exercise,
                kind=kind,
                locale=payload.get('locale', 'pl'),
                body=body,
                author=submission.submitted_by,
                status='published',
                pinned=submission.reviewed_by_id is not None,
                reviewed_by=submission.reviewed_by,
            )
    submission.resulting_exercise = exercise
    return exercise


def _apply_edit_suggestion(suggestion):
    """Applies a proposed change onto its target: a SolutionEntry's `body` when the suggestion
    carries an `entry` (hints/solutions left the translation table — see EditSuggestion.entry's
    own comment), else onto the (exercise, locale) translation it targets. The translation field
    set is title/statement/answer only now; 'hint'/'solution' can no longer arrive from the
    serializer and the two historical values would target columns that no longer exist."""
    if suggestion.entry_id is not None:
        entry = suggestion.entry
        entry.body = suggestion.proposed_value
        entry.save(update_fields=['body'])
        return
    translation, _created = ExerciseTranslation.objects.get_or_create(
        exercise=suggestion.exercise,
        locale=suggestion.locale,
        status='published',
        defaults={'title': ''},
    )
    if suggestion.field in {'title', 'statement', 'answer'}:
        setattr(translation, suggestion.field, suggestion.proposed_value)
        translation.save(update_fields=[suggestion.field])


def _apply_material_submission(submission, reviewer):
    """Builds a real, published Material + MaterialTranslation from an approved MaterialSubmission
    — the file-centric counterpart to `_apply_submission` above. `Material.file` is assigned the
    SAME already-uploaded, already-validated, already-scanned file the submission itself holds
    (Django's own FileField assignment just copies the reference to the already-stored path, no
    re-upload/re-validation needed) rather than re-saving the bytes a second time under a new path.

    `slug` has no equivalent in the submission's own payload (unlike Exercise's `number`, which
    `_apply_submission` computes from the course's own existing rows) — generated here from the
    submitted title via `slugify`, with a numeric suffix appended only if it collides with an
    existing Material in the same course (`unique_together = [('course', 'slug')]`,
    materials/models.py), mirroring the exact "retry until it doesn't collide" shape
    `_apply_submission`'s own number-allocation loop already established for a different field."""
    from django.utils.text import slugify

    from materials.models import Material, MaterialCoverage, MaterialRequirement, MaterialTranslation

    base_slug = slugify(submission.title) or 'material'
    slug = base_slug
    suffix = 1
    while Material.objects.filter(branch=submission.branch, slug=slug).exists():
        suffix += 1
        slug = f'{base_slug}-{suffix}'

    material = Material.objects.create(
        branch=submission.branch,
        slug=slug,
        type=submission.type,
        file=submission.file,
        # A link-only material has no file and lives at its own URL — see Material.url for why this
        # is not `source_url`, which is next to it and answers a different question.
        url=submission.url,
        published=True,
        submitted_by=submission.submitted_by,
        # Provenance declared at submission time, carried onto the real row. `author` is the free-text
        # human name the uploader gave (a TA/professor, almost never a platform account — that's what
        # `submitted_by` above is), `source_url` is where the file came from.
        author=submission.author,
        source_url=submission.source_url,
        price_amount=submission.price_amount,
        price_currency=submission.price_currency or 'PLN',
        estimated_minutes=submission.estimated_minutes,
    )
    MaterialTranslation.objects.create(
        material=material,
        locale=submission.locale,
        title=submission.title,
        description=submission.description,
    )
    # The submission's own `requirements` (a plain list[str] draft, moderation/models.py's own doc
    # comment) becomes real, ordered MaterialRequirement rows only now — there was no real Material
    # row for them to be a FK to before this point.
    MaterialRequirement.objects.bulk_create(
        MaterialRequirement(material=material, label=label, order=i)
        for i, label in enumerate(submission.requirements or [])
    )
    # Same "no real row to attach to before now" reasoning as `requirements` just above, for the
    # submission's own initial "Covers" claims (`MaterialSubmissionSerializer.validate_coverage`
    # already confirmed each `topic_id` really belongs to this submission's own course) — created
    # with `proposed_by=submission.submitted_by`, the same attribution a post-publish
    # `MaterialViewSet.coverage` proposal already gets, not left null.
    MaterialCoverage.objects.bulk_create(
        MaterialCoverage(
            material=material,
            topic_id=entry['topic_id'],
            level=entry['level'],
            kind=entry.get('kind', 'covers'),
            proposed_by=submission.submitted_by,
        )
        for entry in (submission.coverage or [])
    )
    submission.resulting_material = material
    return material


def _reclaim_rejected_material_file(submission) -> None:
    """Drops the stored blob of a just-rejected MaterialSubmission, keeping the row and everything
    else on it.

    **This is a deliberate resolution of a real tension, not an oversight in either direction.**
    CLAUDE.md's own non-functional requirements say, in as many words: "No silent data loss on
    moderation — rejecting a submission should keep a record of what was rejected and why, not just
    delete it." Against that sits the fact that nothing in this codebase has ever deleted a
    `MaterialSubmission.file`, so a rejected 25MB upload occupied disk on a shared university box
    permanently, for a file no reader would ever be shown. Both concerns are real. What resolves
    them is noticing that they are about different things: the requirement is about the RECORD —
    who submitted what, when, and was it accepted, which is part of the trust model — and the disk
    is about the BYTES, which the record does not consist of.

    So: the row survives untouched, with its title, description, declared author and `source_url`,
    its requirements, its recorded scan outcome, the moderator who decided and the note saying why.
    Everything a moderator or a submitter could later need to know WHAT was rejected and on what
    grounds is still there and still queryable. Only the blob goes, and `file_reclaimed_at`/
    `reclaimed_file_bytes` record that it went and how big it was, so the row never reads as though
    it never had a file. That is the opposite of silent.

    **Three alternatives, and why each was rejected:**

    - *Keep the bytes.* The status quo, and the actual hole: nothing in this app can ever serve them
      again. A rejected submission can never be re-approved — `ModerationActionView`'s claim step
      requires `status='pending'`, so rejection is already terminal and already irreversible today —
      and `_apply_material_submission` is the only thing that ever hands the file to a published
      `Material`. The file was therefore already unreachable through every path except its raw
      `MEDIA_ROOT` URL, which is worse than useless: a refused upload staying quietly downloadable
      at a guessable-to-its-uploader path is a small leak on top of the disk cost.
    - *A grace period.* Attractive, and undeliverable here: expiring anything needs scheduled work
      (cron or a task queue), which this project has nowhere to run — the same constraint already
      recorded for event reminders (CLAUDE.md 17V.7). A grace period nothing sweeps is just the
      status quo with a comment claiming otherwise, which is the failure mode this codebase is
      least willing to ship.
    - *Only on a separate, explicit "reject and delete" action.* It splits one decision into two
      and makes the safe-for-disk path the one a busy moderator has to remember, so the default
      would stay "keep 25MB forever" for exactly the rejections nobody thought hard about — which is
      most of them. Rejection already means "this is not going to be published here"; reclaiming the
      bytes is that decision's honest consequence rather than a second, optional one.

    **If an appeal path is ever built it must be a re-upload, not an un-reject** — the metadata
    survives to make that conversation possible ("you rejected this, here it is again"), and the
    bytes are the submitter's own to send again. That is stated here rather than left implied,
    because it is the one thing this function makes impossible.

    Defensive on both counts a mistake would be expensive: a row that already has a
    `resulting_material` is left completely alone (a published `Material` holds the SAME stored
    path, so deleting here would take a live material's file with it — unreachable today, since the
    claim step guarantees this row was `pending`, and cheap to guarantee anyway), and a storage
    backend that has already lost the file still gets the row marked, since the outcome it records
    is true either way.
    """
    from django.utils import timezone

    if submission.file_reclaimed_at is not None or submission.resulting_material_id:
        return
    stored = submission.file
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
    # `FieldFile.delete` sets the field to None on the instance, and this column is NOT NULL — an
    # empty string is what "no file" is stored as everywhere else in Django, so normalize rather
    # than saving a None the database would refuse.
    submission.file = ''
    submission.file_reclaimed_at = timezone.now()
    submission.reclaimed_file_bytes = size
    submission.save(update_fields=['file', 'file_reclaimed_at', 'reclaimed_file_bytes'])


def _publish_translation(translation):
    """Promotes a pending translation to published, superseding whatever was previously published
    for the same (exercise, locale) — `ExerciseTranslation`'s own partial unique constraint
    (published rows only, `exercises/models.py`) means only one row can hold 'published' per
    locale at a time.

    ✅ Phase 4 fix (CLAUDE.md Section 17I's own "left open, not chased" note, and a real, more
    severe finding made while chasing it): the CALLER used to set `translation.status = 'published'`
    itself, via `ModerationActionView.post()`'s own generic claim step, BEFORE this function ever
    ran — which meant the row being promoted and the row it was about to supersede briefly BOTH
    held `status='published'` at once. That's not a rare concurrency edge case: it collided with
    the unique constraint on the very FIRST, ordinary, single-moderator approval of any translation
    that superseded an already-published one for the same locale, reproduced with zero concurrency
    involved (a plain shell script, no threads). Ordering is the whole fix: delete whatever this
    row is superseding FIRST, and only THEN flip this row itself — never both `published` at once.

    The flip below (`filter(pk=..., status='pending').update(status='published')`) is also the
    ONE genuine atomic ownership claim for this row, not a redundant afterthought — the caller no
    longer safely claims 'pending' → 'published' itself (it can't, for the ordering reason above),
    so this statement's own WHERE clause is what decides who wins if two requests really do reach
    this exact row at the same instant: only one UPDATE can see `status='pending'` still true;
    reviewed_by/review_note are still set by the caller's own earlier, non-exclusive claim (safe to
    set twice — the DB row can only end up holding whichever moderator's values arrived last, an
    honest, harmless outcome for a same-row race that should be vanishingly rare in practice given
    the caller's own guard before this ever runs).

    Returns True if this call actually won the flip, False if a genuinely simultaneous second
    approval of this SAME row got there first — the caller treats False as the same clean 409 every
    other double-decision race in this view already reports, not a silent, false 'success'."""
    ExerciseTranslation.objects.filter(
        exercise=translation.exercise, locale=translation.locale, status='published'
    ).exclude(pk=translation.pk).delete()
    won = ExerciseTranslation.objects.filter(pk=translation.pk, status='pending').update(
        status='published'
    )
    return bool(won)


_KIND_MODELS = {
    'submission': (ExerciseSubmission, ExerciseSubmissionSerializer),
    'edit': (EditSuggestion, EditSuggestionSerializer),
    'translation': (ExerciseTranslation, ExerciseTranslationSerializer),
    'material': (MaterialSubmission, MaterialSubmissionSerializer),
}


def _course_for_moderation_target(kind, obj):
    """Which Branch a pending moderation-queue item belongs to — the scope
    `is_governor_of_course` checks a node governor's own authority against. A submission (exercise
    OR material) carries its own `course` FK directly; an edit suggestion/translation are both
    scoped through the Exercise they target."""
    if kind in ('submission', 'material'):
        return obj.branch
    return obj.exercise.branch


class ModerationActionView(APIView):
    """POST /api/moderation/{kind}/{id}/approve/ and /reject/ — moderator only.

    Idempotency guard, added after a real concurrent-access test reproduced a genuine race: nothing
    used to stop the SAME queue row from being approved/rejected twice at once (a moderator
    double-clicking, or two moderators racing the same row) — every branch used to re-run its full
    apply logic unconditionally, which for `submission` specifically meant a real risk of two full
    Exercise rows built from ONE submission.

    The first version of this fix wrapped the whole request in `transaction.atomic()` with
    `select_for_update()` on the row — the textbook approach, and genuinely correct on a real
    production Postgres deployment. It made things WORSE here, on this project's own dev database:
    SQLite has no row-level locking at all (`connection.features.has_select_for_update` is `False`,
    so `select_for_update()` silently does nothing on it), while Django's SQLite backend still holds a
    real, exclusive write lock for the FULL DURATION of an `atomic()` block, not just per statement —
    so wrapping `_apply_submission`'s own multi-statement work (several creates, tag lookups,
    notifications) in one big transaction meant two genuinely concurrent requests could now both hit
    a hard `sqlite3.OperationalError: database is locked` waiting on each other, a strictly worse
    failure than the one this was meant to fix (confirmed directly — re-running the exact same
    concurrent-request test against that version reproduced this new error instead of the old one).

    What's here now is a single, small, unconditional `UPDATE ... WHERE status = 'pending'` — a plain
    `QuerySet.update()`, no explicit transaction wrapper at all. That WHERE-clause evaluation is
    atomic at the database engine level on every backend, SQLite included, with zero reliance on row
    locking, and it only ever holds a write lock for the duration of that one fast statement, not for
    the whole slow apply sequence that follows. Exactly one concurrent request can ever see its own
    `UPDATE` affect a row still in `'pending'`; every other one gets `0` rows affected and returns a
    clean 409 instead of touching anything. The honest tradeoff: this claims the FINAL status before
    the apply logic that's supposed to justify it has actually run, so if `_apply_*` then fails for
    some unrelated reason, the item would be left claimed but incomplete — handled below by reverting
    the claim back to `'pending'` in that case, so a moderator can simply retry.

    ✅ Phase 4 — ONE deliberate carve-out from that otherwise-uniform claim, for approving a
    `translation` specifically (CLAUDE.md Section 17I's own "left open" note, and a more severe,
    non-concurrent bug found while chasing it — see `_publish_translation`'s own doc comment for the
    full story). Every other kind/decision pair can safely jump straight from `'pending'` to its
    final status in this one claim step; `translation` + `approve` can't, because the row being
    approved is about to SUPERSEDE whatever else currently holds `'published'` for the same
    (exercise, locale) — flipping straight to `'published'` here, before that supersede has actually
    happened, collides with the exact constraint meant to prevent it. So for that one combination,
    this claim only marks `reviewed_by`/`review_note` and leaves `status` at `'pending'`;
    `_publish_translation` itself owns the real ordering (delete the superseded row, THEN flip this
    one) and is the genuine atomic ownership claim for this case, reported back via its own return
    value rather than this step's `claimed` count.

    ✅ "Node governor" scoping — `IsModerator` above only checks that SOME kind of moderation
    authority exists; a real node governor is scoped to one Discipline/Branch, so this view still needs
    its own, narrower OBJECT-level check for THIS SPECIFIC item, done once, up front, before the row
    is ever claimed — a governor with no authority over the relevant course gets a plain `403`
    without the row being touched at all, the same "check before you claim" ordering
    `is_governor_of_course`'s own callers already establish."""

    permission_classes = [IsModerator]

    def post(self, request, kind, pk, decision):
        if kind not in _KIND_MODELS or decision not in ('approve', 'reject'):
            return Response(status=status.HTTP_404_NOT_FOUND)
        model, serializer_class = _KIND_MODELS[kind]

        target_obj = get_object_or_404(model, pk=pk)
        if not is_governor_of_course(request.user, _course_for_moderation_target(kind, target_obj)):
            return Response(status=status.HTTP_403_FORBIDDEN)

        review_note = request.data.get('review_note', '')
        publishing_translation = kind == 'translation' and decision == 'approve'
        if decision == 'reject':
            target_status = 'rejected'
        else:
            # ExerciseTranslation's own status vocabulary calls its approved state 'published', not
            # 'approved' — REVIEW_STATUS_CHOICES (submission/edit) and TRANSLATION_STATUS_CHOICES
            # (translation) genuinely disagree on the name for the same idea (moderation/models.py vs
            # exercises/models.py); this is the one place that difference has to be bridged explicitly.
            target_status = 'published' if kind == 'translation' else 'approved'

        claim_fields = {'reviewed_by': request.user, 'review_note': review_note}
        if not publishing_translation:
            claim_fields['status'] = target_status
        claimed = model.objects.filter(pk=pk, status='pending').update(**claim_fields)
        if not claimed:
            # existence was already confirmed by get_object_or_404 above, so 0 rows affected here
            # only ever means "already decided by someone else" — a real 409, not a disguised 404.
            return Response(
                {'detail': 'This item has already been reviewed by another moderator.'},
                status=status.HTTP_409_CONFLICT,
            )
        obj = model.objects.get(pk=pk)

        if decision == 'approve':
            try:
                if kind == 'submission':
                    _apply_submission(obj, request.user)
                    obj.save(update_fields=['resulting_exercise'])
                elif kind == 'material':
                    _apply_material_submission(obj, request.user)
                    obj.save(update_fields=['resulting_material'])
                elif kind == 'edit':
                    _apply_edit_suggestion(obj)
                elif kind == 'translation':
                    won = _publish_translation(obj)
                    if not won:
                        # A genuinely simultaneous second approval of this SAME translation got to
                        # _publish_translation's own atomic flip first — this request's own earlier
                        # (non-exclusive) reviewed_by/review_note claim never actually secured
                        # anything on its own, so there's nothing to revert; just report the same
                        # clean conflict every other double-decision race in this view already does,
                        # rather than a false "success".
                        return Response(
                            {'detail': 'This item has already been reviewed by another moderator.'},
                            status=status.HTTP_409_CONFLICT,
                        )
                    obj.status = 'published'
            except Exception:
                model.objects.filter(pk=pk).update(status='pending', reviewed_by=None, review_note='')
                raise
        elif decision == 'reject' and kind == 'material':
            # A rejected upload's bytes are reclaimed, its row and every other field kept — see
            # `_reclaim_rejected_material_file` for the full reasoning, including why this is not
            # the "silent data loss on moderation" CLAUDE.md's own non-functional requirements
            # forbid. Deliberately outside the try/except above: that block exists to un-claim a row
            # whose apply logic failed, and there is nothing to un-claim here — a rejection is
            # complete the moment the claim lands, and a failure to unlink a file must not hand the
            # row back to the queue as though the moderator had never decided.
            _reclaim_rejected_material_file(obj)

        outcome = 'rejected' if decision == 'reject' else 'approved'
        self._notify_decision(kind, obj, request.user, outcome, review_note)
        return Response(serializer_class(obj).data)

    @staticmethod
    def _notify_decision(kind, obj, moderator, outcome, note):
        """One place for the 4-kind x 2-outcome notification matrix — both the approve and reject
        branches above call this rather than each repeating the same recipient/label lookup times
        over. `obj.resulting_exercise`/`obj.resulting_material` are only ever set on a `submission`/
        `material` that was just approved (still None on a rejected one, since it never became a
        real Exercise/Material) — `label_for_exercise(None)`/`label_for_material(None)` and
        `notify(..., exercise=None)`/`notify(..., material=None)` all already handle that honestly
        rather than needing a special case here."""
        notify_kwargs = {}
        if kind == 'submission':
            recipient = obj.submitted_by
            exercise = obj.resulting_exercise
            label = label_for_exercise(exercise) if exercise else obj.payload.get('title', '')
            notify_kwargs['exercise'] = exercise
        elif kind == 'material':
            recipient = obj.submitted_by
            material = obj.resulting_material
            label = label_for_material(material) if material else obj.title
            notify_kwargs['material'] = material
        elif kind == 'edit':
            recipient = obj.submitted_by
            exercise = obj.exercise
            label = label_for_exercise(exercise)
            notify_kwargs['exercise'] = exercise
        else:  # translation
            recipient = obj.translated_by
            exercise = obj.exercise
            label = label_for_exercise(exercise)
            notify_kwargs['exercise'] = exercise

        kind_prefix = {
            'submission': 'submission',
            'material': 'material_submission',
            'edit': 'edit_suggestion',
            'translation': 'translation',
        }[kind]
        notify(recipient, f'{kind_prefix}_{outcome}', actor=moderator, target_label=label, note=note, **notify_kwargs)


def _course_for_report_target(target):
    """Which Branch a reported target belongs to — an Exercise's own `course` directly, or (for a
    Comment/Review) whichever Exercise `resolve_view_scope_exercise` already resolves its viewer
    pool against. `None` when that can't be determined at all (the same honest gap
    `resolve_view_scope_exercise` itself already documents) — a Service, Tag, Material, or
    MaterialRequirement report all fall through to this, same as the pre-existing Service case:
    a real, if narrow, scope decision (matching Service's own already-shipped precedent, not a new
    one invented here) that only a global `is_staff` moderator can act on these four kinds today,
    never a course-scoped node governor. Material/MaterialRequirement DO have a real, resolvable
    course (`target.course`/`target.material.course`) that a future pass could wire through here to
    give governors real scoped access — left as a genuine follow-up, not attempted in this pass."""
    if isinstance(target, Exercise):
        return target.branch
    exercise = resolve_view_scope_exercise(target)
    return exercise.branch if exercise is not None else None


class ModerationQueueCountView(APIView):
    """GET /api/moderation/queue/count/ — how many decisions are waiting, for a badge.

    Separate from the queue itself so a navigation badge does not have to fetch and serialize the
    whole queue to render one number. Same permission and the same scoping, so the count always
    agrees with the page it links to.
    """

    permission_classes = [IsModerator]

    def get(self, request):
        return Response(count_pending_moderation(request.user))


class ReportActionView(APIView):
    """POST /api/moderation/reports/{kind}/{id}/restore/ or .../remove/ — a moderator resolving
    every PENDING report against one target at once (the group build_report_queue rendered as a
    single row), moderator only.

    - `restore`: the reports were unfounded (or a false-positive auto-hide) — content becomes
      visible again exactly as before. `is_removed` is deliberately left untouched here: restoring
      never un-removes something a moderator had ALREADY permanently removed in an earlier, separate
      decision — this action only ever reverses the community-driven auto-hide, not a moderator's
      own prior call.
    - `remove`: the reports were founded — a real, permanent moderator decision (Comment/Review's
      own `is_removed`, or `published = False` for an Exercise), the same terminal state the
      pre-existing `ModerationActionView` already produces for other content, just reached via a
      different path.

    Either way, `auto_hidden_at` is cleared — once a moderator has actually decided, the content is
    no longer merely "auto-hidden pending review," it's in whatever state that decision produced.

    ✅ "Node governor" scoping — same object-level check `ModerationActionView` does, resolving
    which Branch this report's own target belongs to (`resolve_view_scope_exercise`, the SAME
    function `check_auto_hide`/`build_report_queue` already use, so a governor's own authority is
    checked against the identical scope the queue itself was already filtered by — no risk of the
    two disagreeing). A target with no resolvable course (e.g. a Comment on something with no
    viewer-pool concept) is a safe-default `403` for anyone who isn't a real global moderator.
    """

    permission_classes = [IsModerator]

    def post(self, request, kind, pk, decision):
        if kind not in REPORT_KIND_MODELS or decision not in ('restore', 'remove'):
            return Response(status=status.HTTP_404_NOT_FOUND)
        model = REPORT_KIND_MODELS[kind]
        target = get_object_or_404(model, pk=pk)
        # Two independent routes to authority over one report, ORed rather than nested: the taxonomy
        # one (a node governor over the branch this content belongs to) and the course one (staff on
        # the user-run course the reported comment sits inside). They are different axes and neither
        # implies the other — a course owner governs no branch, and a branch governor is deliberately
        # given nothing inside somebody's private course. See courses/reports.py for that decision.
        #
        # A local import: `moderation` is imported BY `courses` (for `feature_gate`), so importing it
        # back at module scope would be a real cycle. Same shape as `ProfileSerializer`'s own local
        # import of NodeGovernor.
        from courses.reports import may_moderate_in_course

        if not (
            is_governor_of_course(request.user, _course_for_report_target(target))
            or may_moderate_in_course(request.user, target)
        ):
            return Response(status=status.HTTP_403_FORBIDDEN)
        note = request.data.get('resolved_note', '')

        # A real, found-by-a-failing-test gap: Service has no `auto_hidden_at` field at all (it can
        # never actually auto-hide in the first place — check_auto_hide always no-ops for it, no
        # viewer-pool to measure against), so unconditionally including this in `update_fields` blew
        # up with a real `ValueError` from `.save()` the first time this action ran against a
        # reported Service. Same defensive `hasattr` shape `is_removed` below already uses, applied
        # here too rather than assuming every reportable model has this field.
        update_fields = []
        if hasattr(target, 'auto_hidden_at'):
            target.auto_hidden_at = None
            update_fields.append('auto_hidden_at')
        if decision == 'restore':
            if isinstance(target, (Exercise, Material)):
                target.published = True
                update_fields.append('published')
        else:  # remove
            if hasattr(target, 'is_removed'):
                target.is_removed = True
                update_fields.append('is_removed')
            if isinstance(target, (Exercise, Material)):
                target.published = False
                update_fields.append('published')
            if isinstance(target, Service):
                # A real, found-before-shipping gap: Service has neither `is_removed` nor
                # `published`, so without this branch a "remove" decision on a reported tutoring
                # listing resolved the report rows but left the listing itself fully live and
                # discoverable — the moderator action would have had no actual effect. Reuses the
                # SAME `is_active` field a provider's own pause/reactivate toggle already writes to
                # (services/models.py's own "tombstone, don't hard-delete" field), rather than
                # inventing a second, parallel "hidden" concept for this one content type.
                target.is_active = False
                update_fields.append('is_active')
        target.save(update_fields=update_fields)

        content_type = ContentType.objects.get_for_model(model)
        Report.objects.filter(content_type=content_type, object_id=pk, status='pending').update(
            status='resolved', resolved_by=request.user, resolved_note=note
        )

        preview, _exercise_id, _exercise_title = _describe(target, kind)
        exercise = target if isinstance(target, Exercise) else resolve_view_scope_exercise(target)
        notify(
            _content_owner(target),
            'content_restored' if decision == 'restore' else 'content_removed',
            actor=request.user,
            target_label=preview,
            exercise=exercise,
            note=note,
        )
        # Scoped the same way ModerationQueueView's own read already is — an unscoped call here
        # would otherwise hand a node governor back every OTHER pending report on the platform too,
        # not just their own, the moment they restore/remove one real item of their own.
        return Response(build_report_queue(branch_ids=governed_branch_ids(request.user)))


class NodeGovernorViewSet(viewsets.ModelViewSet):
    """CRUD for the "node governor" grants themselves — the actual administration panel this
    feature is named for: who governs which Discipline/Branch. `list`/`create`/`destroy` only; no
    `update` — revoking and re-granting is a simpler, less error-prone flow than a partial-update
    one for a role assignment (change the node, change the user — both really are "a different
    grant," not an edit of this one).

    `list` is scoped to the requester's OWN grants unless they're a real, global `is_staff`
    moderator, who sees every grant — the same staff-vs-own `get_queryset` split
    `ExerciseSubmissionViewSet` already establishes. `create`/`destroy` are deliberately
    `IsAdminUser`-only for v1: only a global moderator can delegate this scoped role today, not
    (yet) a Discipline-level governor delegating Branch-level ones under their own field — a real,
    narrower-than-technically-possible scope decision, flagged in CLAUDE.md rather than silently
    assumed, not an oversight.
    """

    serializer_class = NodeGovernorSerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = NodeGovernor.objects.select_related('user__profile', 'granted_by', 'content_type')
        if not self.request.user.is_staff:
            qs = qs.filter(user=self.request.user)
        return qs

    def get_permissions(self):
        if self.action in ('create', 'destroy'):
            return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]

    def perform_create(self, serializer):
        serializer.save(granted_by=self.request.user)


class FeatureFlagViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """GET /api/feature-flags/ — AllowAny, the one place every part of the app (staff or not, logged
    in or not) learns whether a given feature is currently killed; the frontend fetches this once on
    boot (independent of auth) so even an anonymous visitor's nav/routes reflect the current state.
    PATCH /api/feature-flags/{key}/ — IsAdminUser only, matching NodeGovernorViewSet's own
    create/destroy gate for a comparably platform-wide admin action; there's no narrower "node
    governor can toggle their own course's flags" concept here, these are deliberately global.

    No `create`/`destroy` at all (only List + Update mixins) — the 4 real flags are a fixed set
    (FeatureFlag.Meta / the seeding migration), not something a client can add or remove.
    `lookup_field = 'key'` so the URL reads as `/feature-flags/tutoring/`, not an opaque numeric id
    — the key already IS the natural, stable identifier, the same reasoning Branch/Discipline use their
    own slug as the URL lookup rather than a raw PK."""

    queryset = FeatureFlag.objects.select_related('updated_by__profile')
    serializer_class = FeatureFlagSerializer
    lookup_field = 'key'

    def get_permissions(self):
        if self.action == 'list':
            return [permissions.AllowAny()]
        return [permissions.IsAdminUser()]

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class TaxonomyProposalActionView(APIView):
    """POST /api/moderation/taxonomy/<kind>/<pk>/ — decide on a proposed node.

    Four actions, and three of them are corrections rather than refusals. That shape is forced by
    the design: a pending node is REAL and referenceable from the moment it is proposed (that is why
    `status` lives on the node instead of in a submission table), so by the time anybody reviews it,
    exercises and materials are filed under it.

        approve            it is right           flip status, move nothing
        merge  + target    it already exists     move its content onto the target, delete the husk
        move   + target    right thing, wrong    re-parent it, content follows
                           parent or level
        reject + note      not a real thing      delete it — refused if anything is filed under it

    "Duplicate" and "wrong level" were the obvious rejection REASONS, and both are wrong as
    rejections: the moderator already knows the right answer, so the interface should let them apply
    it rather than bounce it back for the proposer to redo. It also makes the reply carry the useful
    fact — "your exercises are now under Analiza matematyczna" tells somebody where to go, where
    "rejected: wrong level" only tells them they were wrong.

    **Reject refuses when content is attached, and that is a bug fix.** `Exercise.branch` and
    `Material.branch` are both `on_delete=CASCADE`, so the previous bare `node.delete()` meant a
    moderator rejecting a branch with five exercises filed under it silently destroyed those five
    exercises. A moderator who genuinely wants such a node gone can still have it, by moving or
    deleting the content first — deliberately, rather than as a side effect of clicking Reject.
    """

    permission_classes = [IsModerator]

    KINDS = {'discipline': 'Discipline', 'branch': 'Branch', 'topic': 'Topic'}

    @staticmethod
    def _model_for(kind):
        """`material_type` lives in the materials app, the other three in taxonomy. Imported here
        rather than at module scope because materials.models imports taxonomy.models."""
        from taxonomy import models as taxonomy_models

        if kind == 'material_type':
            from materials.models import MaterialType

            return MaterialType
        return getattr(taxonomy_models, TaxonomyProposalActionView.KINDS[kind])

    @staticmethod
    def _attached(node, kind):
        """What would be destroyed if this node were deleted. Counted, not guessed."""
        if kind == 'branch':
            return {
                'exercises': node.exercises.count(),
                'materials': node.materials.count(),
                'topics': node.topics.count(),
            }
        if kind == 'topic':
            return {'exercises': node.exercises.count(), 'materials': node.material_coverage.count()}
        if kind == 'material_type':
            # `Material.type` is a slug column, not a ForeignKey, so deleting the row would not take
            # the materials with it — it would leave them naming a type nobody can look up. Counted
            # the same way and refused the same way, because the outcome is still data nobody
            # intended to break.
            from materials.models import Material

            return {'materials': Material.objects.filter(type=node.slug).count()}
        return {'branches': node.branches.count()}

    def post(self, request, kind, pk):
        from django.db import transaction
        from taxonomy import models as taxonomy_models

        decidable = {**self.KINDS, 'material_type': 'MaterialType'}
        if kind not in decidable:
            return Response(
                {'detail': f'Expected one of {sorted(decidable)}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        model = self._model_for(kind)
        node = model.objects.filter(pk=pk, status='pending').first()
        if node is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        decision = request.data.get('decision')
        note = (request.data.get('note') or '').strip()

        # Read both BEFORE anything happens: merge and reject delete the node, and a notification
        # that has to name what was decided cannot go looking for it afterwards.
        proposer = node.proposed_by
        label = label_for_taxonomy_node(node)

        def reply(notif_type, extra=''):
            """Tell the proposer what was decided. `note` is the moderator's own words; `extra` is
            the fact the decision itself produced (the target it went to), and both are worth
            keeping, so they are joined rather than one overwriting the other."""
            notify(
                proposer,
                notif_type,
                actor=request.user,
                target_label=label,
                note=' — '.join(p for p in (extra, note) if p),
            )

        if decision == 'approve':
            node.status = 'approved'
            node.save(update_fields=['status'])
            reply('taxonomy_approved')
            return Response({'kind': kind, 'slug': node.slug, 'status': 'approved'})

        if decision in ('merge', 'move'):
            target_slug = request.data.get('target')
            if not target_slug:
                raise DRFValidationError({'target': f'A {decision} needs somewhere to {decision} to.'})

            if decision == 'merge':
                target = model.objects.filter(slug=target_slug).exclude(pk=node.pk).first()
                if target is None:
                    raise DRFValidationError({'target': 'No such node to merge into.'})
                target_label = label_for_taxonomy_node(target)
                with transaction.atomic():
                    self._move_content(node, target, kind)
                    node.delete()
                reply('taxonomy_merged', target_label)
                return Response(
                    {'kind': kind, 'slug': target.slug, 'status': 'merged', 'target': target.slug}
                )

            # move: re-parent, keeping everything filed under it.
            if kind in ('discipline', 'material_type'):
                raise DRFValidationError(
                    {'target': f'A {kind.replace("_", " ")} has nothing above it to move under.'}
                )
            parent_model = (
                taxonomy_models.Discipline if kind == 'branch' else taxonomy_models.Branch
            )
            parent = parent_model.objects.filter(slug=target_slug).first()
            if parent is None:
                raise DRFValidationError({'target': 'No such parent.'})
            setattr(node, 'discipline' if kind == 'branch' else 'branch', parent)
            node.status = 'approved'
            node.save()
            reply('taxonomy_moved', label_for_taxonomy_node(parent))
            return Response(
                {'kind': kind, 'slug': node.slug, 'status': 'approved', 'target': parent.slug}
            )

        if decision == 'reject':
            attached = self._attached(node, kind)
            if any(attached.values()):
                # The guard that makes Reject safe. Refusing is the right answer rather than a
                # confirm dialog: whoever filed that content is not the person clicking the button.
                return Response(
                    {
                        'detail': 'has_attached_content',
                        'attached': attached,
                        'hint': 'Merge or move it instead, or clear its content first.',
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            slug = node.slug
            node.delete()
            reply('taxonomy_rejected')
            return Response({'kind': kind, 'slug': slug, 'status': 'rejected', 'note': note})

        return Response(
            {'detail': 'decision must be approve, merge, move or reject.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    @staticmethod
    def _move_content(node, target, kind):
        """Re-point everything filed under `node` at `target`, so a merge loses nothing.

        Collisions are real: two branches can hold a topic with the same slug, and `(branch, slug)`
        is unique. A colliding child folds into the target's existing one rather than aborting the
        merge — the same choice `taxonomy.0005` made when it collapsed four przedmiot rows.
        """
        if kind == 'material_type':
            # A slug column, so "re-point" is literally rewriting the string every material holds.
            # This is what makes merging a duplicate type safe: nothing is orphaned, and the
            # reject-with-content guard never has to fire for a case a merge can simply fix.
            from materials.models import Material

            Material.objects.filter(type=node.slug).update(type=target.slug)
            from moderation.models import MaterialSubmission

            MaterialSubmission.objects.filter(type=node.slug).update(type=target.slug)
        elif kind == 'branch':
            for topic in node.topics.all():
                twin = target.topics.filter(slug=topic.slug).first()
                if twin is None:
                    topic.branch = target
                    topic.save(update_fields=['branch'])
                else:
                    for exercise in topic.exercises.all():
                        exercise.topics.add(twin)
                        exercise.topics.remove(topic)
                    topic.delete()
            last = target.exercises.order_by('-number').first()
            number = (last.number if last else 0) + 1
            for exercise in node.exercises.order_by('number'):
                # `(branch, number)` is unique, so an incoming exercise is renumbered onto the end
                # rather than colliding.
                exercise.branch = target
                exercise.number = number
                exercise.save(update_fields=['branch', 'number'])
                number += 1
            for material in node.materials.all():
                slug = material.slug
                if target.materials.filter(slug=slug).exists():
                    slug = f'{slug}-{node.slug}'[:50]
                material.branch = target
                material.slug = slug
                material.save(update_fields=['branch', 'slug'])
        elif kind == 'topic':
            for exercise in node.exercises.all():
                exercise.topics.add(target)
                exercise.topics.remove(node)
            node.material_coverage.update(topic=target)
        else:
            node.branches.update(discipline=target)
