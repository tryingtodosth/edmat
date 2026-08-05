"""ExerciseSubmission (a brand-new exercise, pending review) and EditSuggestion (a proposed change to
an existing exercise/translation) — see CLAUDE.md Section 9. Report and ContentView (below) extend
this app into moderating already-PUBLISHED content (Exercise/Comment/Review), not just pre-publish
submissions — a genuinely different concern from the three models above, which is why they get their
own doc comment rather than being folded into this file's original one."""

import os

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from exercises.models import Exercise
from materials.models import CURRENCY_CHOICES
from materials.validators import validate_material_submission_file
from taxonomy.models import Course, Field

REVIEW_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]


class ExerciseSubmission(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    payload = models.JSONField()  # draft of everything Exercise + ExerciseTranslation would need
    status = models.CharField(max_length=10, choices=REVIEW_STATUS_CHOICES, default='pending')
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    review_note = models.TextField(blank=True)
    resulting_exercise = models.ForeignKey(
        Exercise, null=True, blank=True, on_delete=models.SET_NULL
    )  # set once approved
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'submission by {self.submitted_by} [{self.status}]'


class EditSuggestion(models.Model):
    exercise = models.ForeignKey(Exercise, related_name='edit_suggestions', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)  # which translation this edits
    field = models.CharField(max_length=30)  # 'statement' | 'hint' | 'answer' | 'solution' | ...
    proposed_value = models.TextField()
    reason = models.TextField(blank=True)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    status = models.CharField(max_length=10, choices=REVIEW_STATUS_CHOICES, default='pending')
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    # Phase 3 — a real, found-before-first-use gap: the frontend's own EditSuggestion type
    # (lib/types/submission.ts) has always carried an optional reviewNote, same as ExerciseSubmission
    # gets — this model's own original Section 9 sketch just never included it, so a moderator's
    # note on an edit-suggestion decision would have been silently discarded. Added to match.
    review_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'edit suggestion by {self.submitted_by} on {self.exercise} [{self.status}]'


def material_submission_upload_path(instance, filename: str) -> str:
    """Deliberately discards the uploader's own original filename, keeping only its (already
    validated, by the time this actually gets saved) extension — "kept safe" storage, not just safe
    CONTENT: a real original filename is untrusted input too (path-traversal characters, a
    double-extension trick like "invoice.pdf.exe", or just an unpredictable collision), and Django's
    own default `get_valid_name` sanitization is a lower bar than not trusting the name at all. A
    random UUID is enough to make every stored path unique and unguessable without needing to know
    anything about `instance` itself (unlike `Material`'s own `upload_to='materials/'`, which is
    fine for admin/import-created rows where the filename was never adversarial input to begin
    with)."""
    import uuid

    ext = os.path.splitext(filename)[1].lower()
    return f'material_submissions/{uuid.uuid4().hex}{ext}'


class MaterialSubmission(models.Model):
    """A brand-new Material (an exam, a practice test, lecture slides, ...) submitted by a
    registered user, pending moderator review before it becomes a real, published Material — the
    same "queue, don't trust blindly" shape ExerciseSubmission above already establishes, adapted
    for a genuinely FILE-centric submission rather than a JSON payload of text fields (a Material
    has no rich statement/hint/solution text to draft, just a file plus a handful of plain metadata
    fields, so a flat JSONField would just be extra indirection around fields this model can hold
    directly).

    `scan_status`/`scan_detail` record what `materials.validators.scan_for_malware` actually found
    (or honestly didn't find, if no scanner was reachable) at submission time — surfaced to the
    moderator reviewing the queue, not silently discarded, since "was this file ever actually
    scanned" is exactly the kind of thing a moderator deciding whether to trust it should be able to
    see."""

    SCAN_STATUS_CHOICES = [
        ('skipped', 'Not scanned'),
        ('clean', 'Scanned — clean'),
        ('flagged', 'Scanned — flagged'),
    ]

    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    type = models.CharField(max_length=20)  # materials.models.MATERIAL_TYPE_CHOICES values
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    locale = models.CharField(max_length=8, default='pl')
    file = models.FileField(
        upload_to=material_submission_upload_path,
        validators=[validate_material_submission_file],
    )
    # Provenance, declared by the uploader and carried onto the real Material on approval — both
    # mirror `materials.models.Material`'s own fields of the same names exactly (see `Material
    # .source_url`'s doc comment for why the source is a URL rather than free text, and why neither
    # field is required).
    #
    # These matter more at SUBMISSION time than anywhere else, and are the reason they were added:
    # the uploader is the only person who actually knows where a file came from. A moderator looking
    # at a pending PDF in the queue has no way to determine its author or origin from the bytes, so
    # if the form never asks, the information is not merely missing from the record — it is
    # unrecoverable. `MaterialSubmissionSerializer` exposes both, and the moderation queue's own
    # Materials tab renders them alongside the file link so a reviewer can actually weigh provenance
    # as part of the approve/reject decision (CLAUDE.md Section 18 item 2's still-open copyright
    # question is exactly the kind of call that needs this in front of the person making it).
    author = models.CharField(max_length=200, blank=True)
    source_url = models.URLField(max_length=500, blank=True)
    # A brand-new upload can optionally declare its own requirements/price/time-estimate at
    # submission time, mirroring the same three fields `materials.models.Material`/
    # `MaterialRequirement` itself carries once published — see `_apply_material_submission`
    # (views.py) for how these three carry over onto the real Material row on approval.
    # `requirements` is a plain `list[str]` (materials.models.MaterialRequirement has no equivalent
    # at submission time, since there's no real Material row yet for it to be a FK to) — a JSONField,
    # not a second typed model, since this is a draft value that only becomes real MaterialRequirement
    # rows once approved, the same "structural fields now, translation/derived rows later" split
    # ExerciseSubmission.payload already establishes for a different field, just narrower (three
    # plain fields instead of one whole JSON draft, since a Material submission is otherwise
    # real, typed fields already, not a JSON blob).
    requirements = models.JSONField(default=list, blank=True)
    # A brand-new upload can optionally declare initial "Covers" claims too, the requirement-side
    # sibling above — a plain `list[{"topic_id": int, "level": int}]`, not real `MaterialCoverage`
    # rows, since there's no real Material yet for them to be a FK to (see `requirements`'s own doc
    # comment for the identical reasoning). Deliberately narrower than the post-publish "+Add
    # coverage" flow (`MaterialViewSet.coverage`, materials/views.py): topic + level only, no
    # subtopic — the get-or-create-a-subtopic-on-the-fly flow that action supports is real UX
    # richness this submission form doesn't need on day one; a submitter who wants subtopic-level
    # precision can still add it after publish via that same, already-working flow.
    coverage = models.JSONField(default=list, blank=True)
    price_amount = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    price_currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default='PLN', blank=True)
    estimated_minutes = models.PositiveIntegerField(null=True, blank=True)
    scan_status = models.CharField(max_length=10, choices=SCAN_STATUS_CHOICES, default='skipped')
    scan_detail = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=10, choices=REVIEW_STATUS_CHOICES, default='pending')
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    review_note = models.TextField(blank=True)
    resulting_material = models.ForeignKey(
        'materials.Material', null=True, blank=True, on_delete=models.SET_NULL
    )  # set once approved
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'material submission by {self.submitted_by} [{self.status}]'


REPORT_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('resolved', 'Resolved'),
]


class Report(models.Model):
    """A user flagging an already-PUBLISHED piece of content (an Exercise, a Comment, or a Review —
    the three named in the task this was built for) as needing moderator attention. Generic FK,
    same pattern Comment itself already uses for its own polymorphic target — deliberately not
    restricted at the model layer to those three, since the exact same mechanism would work for any
    future reportable type without a schema change; the *view* layer (moderation/views.py's
    `ReportViewSet`) is what actually restricts `kind` to `exercise`/`comment`/`review` today.

    `unique_together` on (content_type, object_id, reported_by) is a real correctness rule, not
    just tidiness — without it, one user could inflate a target's own report count arbitrarily by
    reporting it repeatedly, which would make the whole percentage-of-viewers threshold below
    meaningless.
    """

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=REPORT_STATUS_CHOICES, default='pending')
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    resolved_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('content_type', 'object_id', 'reported_by')]
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'report by {self.reported_by} on {self.target!r} [{self.status}]'


class ContentView(models.Model):
    """One row per (user, exercise) — recorded the FIRST time an authenticated user loads that
    exercise's own detail page (exercises/views.py's `ExerciseViewSet.retrieve`). This is the "how
    many people have actually seen this" denominator moderation/services.py's `check_auto_hide`
    divides a report count against.

    Exercise is the only content type in this app with a real per-user detail-page view to track —
    a Comment or a Review has no page of its own, it's read as part of viewing its own parent
    Exercise, so `check_auto_hide` resolves a reported Comment/Review's own "viewer pool" through
    this same table via whichever Exercise it's attached to, rather than this model needing a
    separate row per content type. Guests aren't tracked (there's no identity to key a unique row
    on), so the percentage this feeds is honestly "percentage of REGISTERED viewers," not literally
    everyone who ever loaded the page — the same kind of registered-users-only approximation this
    app already accepts elsewhere (e.g. `browsingHistoryStore`'s own client-side view history, which
    similarly only means anything for the one browser it's stored in).
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    exercise = models.ForeignKey(Exercise, related_name='views', on_delete=models.CASCADE)
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'exercise')]

    def __str__(self) -> str:
        return f'{self.user} viewed {self.exercise}'


# The "node governor" concept: a moderator scoped to ONE taxonomy node (a Field or a Course),
# distinct from Django's own `is_staff` (a GLOBAL moderator — unchanged, still checked first
# everywhere this matters, see moderation/services.py's `is_governor_of_course`). A Field-level
# grant cascades down to every Course under it (a field coordinator governs everything in their
# field); a Course-level grant is scoped to just that one course (a single course's own TA/rep).
# Generic FK to Field/Course rather than two separate models — the two node kinds share every real
# behavior here (who's granted, by whom, when), so a discriminated pair would just be the same row
# shape twice; GENERIC_NODE_MODELS (services.py) is the one place `kind` <-> model is defined,
# mirroring moderation/services.py's own REPORT_KIND_MODELS precedent exactly.
class NodeGovernor(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='governed_nodes', on_delete=models.CASCADE
    )
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    node = GenericForeignKey('content_type', 'object_id')
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, related_name='+', on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'content_type', 'object_id')]
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.user} governs {self.node!r}'


# The one place `kind` <-> model is defined for node governance — moderation/serializers.py's
# NodeGovernorSerializer (validating a grant/list request) imports this rather than keeping its own
# copy, the same discipline REPORT_KIND_MODELS already establishes for the reporting system.
GOVERNABLE_NODE_MODELS = {'field': Field, 'course': Course}


# A fixed, curated set — not user-creatable, matching this codebase's own "curated choices=, not
# free text" discipline for a small, known enum (MATERIAL_TYPE_CHOICES, CURRENCY_CHOICES). The 4
# real rows are provisioned once by a data migration; a client can only ever flip is_enabled on one
# of these, never add/remove a key. Deliberately platform-wide (not course-scoped like NodeGovernor)
# — a genuine "kill switch" for an entire feature surface, not a per-course moderation tool.
FEATURE_FLAG_CHOICES = [
    ('tutoring', 'Tutoring/services listings'),
    ('messaging', 'User-to-user messaging'),
    ('exercise_submissions', 'New exercise submissions'),
    ('material_submissions', 'New material uploads'),
    # Deliberately INVERTED semantics from the 4 rows above — those are plain kill switches
    # (is_enabled=True means "the feature is up"); this one instead means "the RESTRICTION is on."
    # `is_enabled=False` (this row's own seeded default, see the data migration) matches today's
    # existing behavior — any authenticated user may upload — so provisioning this flag never
    # narrows who can upload until a moderator deliberately turns it on. Kept in the same curated
    # choices/model/admin-UI list as the other 4 (the tutoring-listings feature request's own
    # explicit "it should be with other kill switches" instruction), not a separate mechanism.
    ('material_uploads_verified_only', 'Material uploads: verified contributors only'),
]


class FeatureFlag(models.Model):
    """A platform-wide kill switch. `services.is_feature_enabled(key)` is the one place this gets
    read from — it fails OPEN (returns True) if a row is somehow missing, so a flag that hasn't
    been provisioned yet (a fresh env before its data migration ran, or a key introduced after this
    row existed) never accidentally breaks the feature it's meant to gate; the intended, safe
    default for every feature in this app is "on" until a moderator deliberately turns it off.

    `is_staff` always bypasses this (see moderation/permissions.py's `feature_gate`) — a kill switch
    hides a feature from ordinary visitors, it never locks staff out of their own moderation tools,
    including the ability to see what a "killed" feature's existing data still looks like."""

    key = models.CharField(max_length=40, choices=FEATURE_FLAG_CHOICES, unique=True)
    is_enabled = models.BooleanField(default=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, related_name='+', on_delete=models.SET_NULL
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['key']

    def __str__(self) -> str:
        return f'{self.key}: {"on" if self.is_enabled else "off"}'
