"""ExerciseSubmission (a brand-new exercise, pending review) and EditSuggestion (a proposed change to
an existing exercise/translation) — see CLAUDE.md Section 9. Report and ContentView (below) extend
this app into moderating already-PUBLISHED content (Exercise/Comment/Review), not just pre-publish
submissions — a genuinely different concern from the three models above, which is why they get their
own doc comment rather than being folded into this file's original one.

`MaterialSubmission` used to sit beside `ExerciseSubmission` here and does not any more: a new
material is a `coauthoring.MaterialProject` with a team of one now, its first `MaterialVersion` is
what waits in the queue, and the two models were two ways to do one thing (COAUTHORING-BRIEF.md §0).
The data migration that folded it is `coauthoring/0003_fold_material_submissions`; the model went in
`moderation/0038_delete_materialsubmission`. What stayed: the `material_submissions` feature flag
(the ability is unchanged, only its endpoint moved), the `material_submission` throttle scope, the
`material_submission_approved`/`_rejected` notification types that existing rows carry, and
`material_submission_upload_path` below, which the migration history imports by dotted path.
"""

import os

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from exercises.models import Exercise
from materials.models import Material
from taxonomy.models import Branch, Discipline

REVIEW_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
]


class ExerciseSubmission(models.Model):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE)
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
    field = models.CharField(max_length=30)  # 'statement' | 'answer' | 'title', or 'body' when entry is set
    # Set when the suggestion targets a SOLUTION/HINT row (`exercises.SolutionEntry`) rather than a
    # translation field — hints/solutions left `ExerciseTranslation` entirely (2026-08, the
    # solution-pool feature), so an edit to one is an edit to a specific, OWNED entry. `field` is
    # always 'body' for these; `exercise`/`locale` mirror the entry's own for queue scoping. Who may
    # DECIDE one differs too: the entry's own author may (it is their entry), alongside
    # staff/governors — see EditSuggestionViewSet.decide and `can_decide_entry_suggestion`.
    entry = models.ForeignKey(
        'exercises.SolutionEntry',
        null=True,
        blank=True,
        related_name='edit_suggestions',
        on_delete=models.CASCADE,
    )
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
    """**Kept only for the migration history.** Nothing calls this any more: `MaterialSubmission`
    was folded into `coauthoring.MaterialProject`/`MaterialVersion` and deleted
    (`coauthoring/0003_fold_material_submissions`, `moderation/0038_delete_materialsubmission`), and
    new material files are named by `coauthoring.models.version_upload_path`. Migrations 0005 and
    0021 reference this function BY DOTTED PATH, though, so deleting it would make the historical
    migration chain unimportable on a fresh database — which is the one thing a retired model's
    helper must never do. Its reasoning is left intact below because `version_upload_path` cites it.

    Deliberately discards the uploader's own original filename, keeping only its (already
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


# The "node governor" concept: a moderator scoped to ONE taxonomy node (a Discipline or a Branch),
# distinct from Django's own `is_staff` (a GLOBAL moderator — unchanged, still checked first
# everywhere this matters, see moderation/services.py's `is_governor_of_course`). A Discipline-level
# grant cascades down to every Branch under it (a field coordinator governs everything in their
# field); a Branch-level grant is scoped to just that one course (a single course's own TA/rep).
# Generic FK to Discipline/Branch rather than two separate models — the two node kinds share every real
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
#
# A Material joined the two taxonomy nodes when galleries arrived: somebody who photographed all
# twelve pages of a handout, captioned them and put them in order is looking after THAT material,
# and making them a governor of the whole branch to let them do it would hand them moderation
# authority over everything else in it. The three levels nest — a grant on a material, on its
# branch, or on that branch's discipline all answer yes for the material — which is what
# `is_governor_of_material` resolves.
GOVERNABLE_NODE_MODELS = {'discipline': Discipline, 'branch': Branch, 'material': Material}



GOVERNOR_APPLICATION_STATUS_CHOICES = [
    ('pending', 'Waiting to be read'),
    ('approved', 'Approved'),
    ('declined', 'Declined'),
    ('withdrawn', 'Withdrawn by the applicant'),
]


class GovernorApplication(models.Model):
    """Somebody asking to look after a discipline, a branch, or one material.

    **Why there is a queue at all.** Until galleries, the only way to become a governor was for a
    staff member to already know who you were and grant it (§17M, which also recorded having no user
    search — so in practice it needed your numeric account id). That is workable when the role is
    rare and platform-wide. It stops being workable the moment there is a per-material job worth
    doing — putting a scanned handout's twelve photographed pages in the right order — because the
    person who wants to do it is exactly the person staff have never heard of.

    **It is first come, first served, and there is deliberately no way to change that.** There is no
    priority column, no fee and no hook for one. That is a decision (Piotr, 2026-09-18) rather than
    an omission, and it is worth writing down because the alternative was specifically proposed and
    specifically dropped: letting somebody pay to be read sooner would be selling queue position for
    authority over content other people wrote, and it would give the queue an incentive to stay
    slow. What an applicant gets instead is the truth about where they are — see
    `queue_position` — which is the part of "transparent queue tracking" that was actually worth
    having.

    **Deciding stays with staff**, unchanged from §17M. A governor of a branch cannot approve an
    application for a material inside it, even though that is the obvious next step and the role
    hierarchy now runs three deep. Delegated granting is a real feature with real failure modes
    (somebody granting their way into a ring of mutual approvals) and it is not this pass's to
    invent.
    """

    applicant = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='governor_applications', on_delete=models.CASCADE
    )
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    node = GenericForeignKey('content_type', 'object_id')
    # Why they want it, in their own words. Required: an application with nothing in it gives a
    # reader nothing to decide on, and "no" would then be the only safe answer.
    statement = models.TextField()
    status = models.CharField(
        max_length=12, choices=GOVERNOR_APPLICATION_STATUS_CHOICES, default='pending'
    )
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)
    # What approving produced, kept so the record still reads correctly after the grant is revoked —
    # SET_NULL rather than CASCADE, because losing the application would lose the reason the person
    # was trusted in the first place.
    resulting_grant = models.ForeignKey(
        'NodeGovernor', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Oldest first — the queue IS this ordering, and putting it on the model means no listing
        # can accidentally present a different one.
        ordering = ['created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['applicant', 'content_type', 'object_id'],
                condition=models.Q(status='pending'),
                name='one_pending_application_per_node',
            )
        ]

    def __str__(self) -> str:
        return f'application #{self.pk} by {self.applicant} ({self.status})'

    @property
    def queue_position(self) -> int | None:
        """How many people are ahead of this one, plus itself. `None` once it has been decided —
        a position is a fact about waiting, and reporting one for a finished application would be
        answering a question nobody asked."""
        if self.status != 'pending':
            return None
        return (
            GovernorApplication.objects.filter(status='pending', created_at__lt=self.created_at).count()
            + 1
        )


# A fixed, curated set — not user-creatable, matching this codebase's own "curated choices=, not
# free text" discipline for a small, known enum (MATERIAL_TYPE_CHOICES, CURRENCY_CHOICES). The 4
# real rows are provisioned once by a data migration; a client can only ever flip is_enabled on one
# of these, never add/remove a key. Deliberately platform-wide (not course-scoped like NodeGovernor)
# — a genuine "kill switch" for an entire feature surface, not a per-course moderation tool.
FEATURE_FLAG_CHOICES = [
    ('tutoring', 'Tutoring/services listings'),
    ('courses', 'User-run courses'),
    ('messaging', 'User-to-user messaging'),
    ('exercise_submissions', 'New exercise submissions'),
    ('material_submissions', 'New material uploads'),
    # One-off events (events/). A plain kill switch like the five above it: with this off, an
    # ordinary visitor cannot list, read, create or answer an event, the whole `/api/events/` surface
    # 403s, events stop appearing in `/api/my-schedule/`, and the frontend hides every link that
    # points at them — the nav entry, the "Add…" menu item, the homepage tab and the profile links.
    # A killed feature that still shows its buttons is a feature that only breaks louder.
    ('events', 'One-off events'),
    # Site issue reports (issues/). Off: no filing, no /issues page, and every link to it goes.
    ('issues', 'Site issue reports'),
    # Anchored micro-posts (activity/). Off: no posting, no post pages, the composer and every
    # post row leave the feed surface; the feed's system events stay.
    ('posts', 'Activity micro-posts'),
    # Chemical structure drawings (chem/, Ketcher). Off: no saving or editing a drawing, and the
    # editor button leaves every composer; pictures already embedded in content keep rendering,
    # since they are ordinary media files.
    ('chemistry', 'Chemistry drawings (Ketcher)'),
    # Freehand whiteboard sketches (sketches/, Excalidraw). Off: no saving or editing a sketch, and
    # the Sketch button leaves every composer; pictures already embedded in content keep rendering,
    # since they are ordinary media files. Seeded ON by migration 0042 — there is no sketch on the
    # platform the moment it runs, so turning the switch on removes nothing from anybody.
    ('sketches', 'Freehand sketches (whiteboard)'),
    # The six conference surfaces (CONFERENCE-BRIEF.md §0), seeded ON together by migration 0043 —
    # none of them has a row anywhere the moment it runs, so turning them on removes nothing. Each
    # is a plain kill switch owned by one app: venues/ (venues, rooms, room bookings, checklists),
    # documents/ (event documents and acknowledgements), events/scanning.py (tickets, QR, scans),
    # shifts/ (the volunteer rota), cloakroom/ (the desk), and the role-preview toggle on the event
    # page. Off, each closes its own endpoints to a non-staff caller and takes its own links with it
    # (house rule 3); the older events surfaces keep working with all six off.
    ('venues', 'Venues, rooms and checklists'),
    ('event_documents', 'Event documents and briefings'),
    ('tickets', 'Tickets, QR codes and scanning'),
    ('shifts', 'Volunteer rota (shifts)'),
    ('cloakroom', 'Cloakroom desk'),
    ('role_preview', 'View an event as a visitor'),
    # Deliberately INVERTED semantics from the 4 rows above — those are plain kill switches
    # (is_enabled=True means "the feature is up"); this one instead means "the RESTRICTION is on."
    # `is_enabled=False` (this row's own seeded default, see the data migration) matches today's
    # existing behavior — any authenticated user may upload — so provisioning this flag never
    # narrows who can upload until a moderator deliberately turns it on. Kept in the same curated
    # choices/model/admin-UI list as the other 4 (the tutoring-listings feature request's own
    # explicit "it should be with other kill switches" instruction), not a separate mechanism.
    ('material_uploads_verified_only', 'Material uploads: verified contributors only'),
    ('galleries', 'Picture galleries on content'),
    # The age gate on self-registration (accounts/serializers.py's RegisterSerializer). A plain
    # kill switch like the others, NOT an inverted one: is_enabled=True means "the age question is
    # asked," which is this row's seeded default, so provisioning it changes nothing.
    #
    # Off means exactly one thing — /register stops asking for a year of birth and stops refusing
    # an under-16 with `guardian_required`. It does NOT touch the minors regime: every rule in
    # accounts/minors.py still applies to every `is_minor` account, and a guardian can still create
    # a child under Settings -> Children (accounts/views.py's ChildrenView, the only code path that
    # ever sets `is_minor` — self-registration pops `birth_year` and stores nothing, so turning
    # this off removes a refusal and changes no stored data whatsoever).
    #
    # Read with a plain `is_feature_enabled()` call, deliberately NOT through `feature_gate` as a
    # permission class: registration is an anonymous endpoint, so a gate there would 403 the whole
    # thing for exactly the people it exists to serve, and `feature_gate`'s is_staff bypass means
    # nothing to a caller who has no account yet.
    ('age_verification', 'Age gate on self-registration'),
    # Co-authoring a material (coauthoring/): the version history, the project's team, proposals
    # from readers, invites and join requests. A plain kill switch, seeded on.
    #
    # It gates COLLABORATING on a material that already exists, and deliberately NOT the existence
    # of the material itself: `Material` stays the published projection of whatever version is
    # current, so turning this off takes away the project panel, the version pages, the "improve
    # this material" button and every link to them, while every material on the site keeps
    # rendering, downloading and being found exactly as before. That is the whole reason the
    # projection exists — a kill switch here must never be able to hide content.
    #
    # CREATING a new material stays under the existing `material_submissions` flag, which is a
    # genuinely different ability with a genuinely different reason to be switched off (a flood of
    # new uploads is not the same problem as a fight over one document's text), so the two are two
    # switches rather than one: `material_submissions` gates starting a project, this one gates
    # everything that happens inside one afterwards.
    ('coauthoring', 'Co-authoring materials: versions, teams, proposals'),
    # Concepts (concepts/, CONCEPTS-BRIEF.md): the wiki-like pages for the things exercises and
    # materials are ABOUT, their per-(audience, locale) articles and the links between them.
    # A plain kill switch, seeded on.
    #
    # Off, every `/api/concepts/`, `/api/concept-articles/`, `/api/concept-revisions/`,
    # `/api/concept-links/` and `/api/concept-assets/` endpoint 403s a non-staff caller — with one
    # deliberate carve-out that house rule 3 requires rather than contradicts:
    # `GET /api/concept-links/?target_type=…` answers `[]` instead of 403, because it is read by the
    # chip row on an exercise's and a material's own page and those pages must keep working while
    # returning nothing for this feature. Every link, tab, menu item and chip row disappears on the
    # frontend; a `[[slug]]` anchor already inside somebody's text still renders (it is an ordinary
    # relative link) and the page it leads to shows the gate.
    ('concepts', 'Concepts: wiki articles per audience'),
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
