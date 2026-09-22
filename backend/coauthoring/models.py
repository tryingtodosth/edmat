"""Co-authoring: a project, a team, and the immutable versions a material is published from.

**The `Material` row stays the published projection.** A project owns the history; publishing a
version copies its payload onto the material and its title/description onto the original-locale
translation row (`services.sync_material`), so every read site that already existed — listings,
courses, galleries, reports, the feed, the recommender — keeps working without knowing this app
exists, and turning the `coauthoring` kill switch off never removes a material. That is the whole
design decision this file exists to hold; everything below follows from it.

Five models, and the reason each one is shaped the way it is:

* `MaterialProject` — the thing a team works on. Its `material` is NULL while the project is still
  a draft that has never published anything, which is the ONE state where its catalogue fields
  (type, audience, author, price, coverage …) mean something: after the first publication those
  copies are frozen and the real answers live on the `Material` row, because there must be exactly
  one place a reader's browse filter reads them from.
* `ProjectMember` — the team. The owner is a real row, not an implied special case, exactly as
  `courses.CourseStaff` is: `role_of` is then one lookup with no branch for "…or the creator
  field", and a partial unique index makes "one owner" the database's promise rather than
  whichever view happens to remember.
* `ProjectInvite` — a link that adds somebody to the team, addressed by bare token.
* `ProjectJoinRequest` — asking to be added, with a statement a person reads.
* `MaterialVersion` — one immutable attempt at the material's content. Improving a material means
  proposing one of these; accepting it publishes it. Collaboration is turn-based by design
  (PRODUCT.md's real-time-editing non-goal), which is why a version records what it was written
  against (`based_on`) and a save against a stale head is refused.

Vocabulary is deliberate and mirrored on the frontend (`types/materialProject.ts`, house rule 13):
there is no `approved` anywhere in this app. `moderation/CLAUDE.md` records the `approved` vs
`published` clash the exercise/translation vocabulary already lives with; the positive terminal
state here is what the row IS, `published`.
"""

from __future__ import annotations

import os
import secrets

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from config.audience import AUDIENCE_CHOICES, DEFAULT_AUDIENCE
from materials.models import CURRENCY_CHOICES
from materials.validators import validate_material_submission_file

#: The six states a version can be in. `draft` and `published` are the only two a reader can ever
#: be pointed at; `proposed` is waiting for the team (or for staff, on a first publication) and the
#: last three are terminal history — kept, never deleted, because who proposed what and whether it
#: was taken is part of the trust model (house rule 12).
VERSION_STATUS_CHOICES = [
    ('draft', 'Draft'),
    ('proposed', 'Proposed'),
    ('published', 'Published'),
    ('superseded', 'Superseded'),
    ('rejected', 'Rejected'),
    ('withdrawn', 'Withdrawn'),
]

#: Exactly one payload per version, and the same three shapes a `Material` itself can take.
VERSION_KIND_CHOICES = [
    ('file', 'A file'),
    ('link', 'A link'),
    ('body', 'Text written here'),
]

MEMBER_ROLE_CHOICES = [
    ('owner', 'Owner'),
    ('coauthor', 'Co-author'),
]

JOIN_REQUEST_STATUS_CHOICES = [
    ('pending', 'Waiting for a decision'),
    ('accepted', 'Accepted'),
    ('declined', 'Declined'),
    ('withdrawn', 'Withdrawn'),
]

#: The three honest outcomes of `materials.validators.scan_for_malware`, inherited word for word
#: from the retired `moderation.MaterialSubmission` (this app is the only producer of material bytes
#: now): a version that carries a file goes through the same validate → re-encode → scan pipeline,
#: and an unreachable scanner records `skipped`, never "clean" (house rule 10).
SCAN_STATUS_CHOICES = [
    ('skipped', 'Not scanned'),
    ('clean', 'Scanned — clean'),
    ('flagged', 'Scanned — flagged'),
]

#: The minimum a join request has to say. The same bar `moderation.GovernorApplication.statement`
#: sets, for the same reason: it is read by a person deciding, and "hi" is not a request.
MIN_JOIN_STATEMENT_LENGTH = 20


def version_upload_path(instance, filename: str) -> str:
    """Random name, validated extension — the same reasoning (and the same shape) as
    `moderation.models.material_submission_upload_path`, which states it in full and is now kept
    only so the migration history can still import it: the uploader's own filename is untrusted
    input (path traversal, a double extension, a collision) and Django's `get_valid_name` is a lower
    bar than not trusting it at all.

    Its own directory rather than `material_submissions/`, which is where the retired single-shot
    submit form wrote. Rows folded out of that model (`0003_fold_material_submissions`) keep the
    stored path they already had — the bytes are never re-uploaded — so a `material_submissions/…`
    name on a version is a folded row rather than a bug, and reclaiming it is this app reclaiming
    its own file: nothing else refers to it once the submission table is gone.
    """
    import uuid

    ext = os.path.splitext(filename)[1].lower()
    return f'material_versions/{uuid.uuid4().hex}{ext}'


class MaterialProject(models.Model):
    """One material's team and its history — or, before the first publication, a material that does
    not exist yet.

    `material` is a nullable OneToOne rather than the project living on the `Material` row, because
    the project genuinely predates it: "let us write this together" is a real state with a team, a
    draft and a review thread in it before anything has been published. Once the first version
    publishes, `services.materialise` fills this in and it never changes again.

    **The catalogue fields below are drafting-only.** While `material` is NULL they are the answer;
    the moment it is not, the `Material` row is, and `views.MaterialProjectViewSet.partial_update`
    routes an edit onto the material instead of onto these columns. They are left on the row rather
    than deleted because a rejected first publication has to keep what was proposed (house rule 12),
    and because the moderation queue's row for a first publication renders them — there is no
    material to read them off yet, which is precisely what the reviewer is deciding about.
    """

    material = models.OneToOneField(
        'materials.Material',
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name='project',
    )
    branch = models.ForeignKey(
        'taxonomy.Branch', on_delete=models.CASCADE, related_name='material_projects'
    )
    # The language the versions' title and description are written in. NOT the reader's interface
    # language and not a translation workflow: a material's other-locale translations are not
    # versioned at all, and the stale marker (`materials.serializers.MaterialSerializer
    # .translation_stale`) is the whole of what this app says about them (COAUTHORING-BRIEF.md §9).
    locale = models.CharField(max_length=8, default='pl')

    # --- catalogue, used ONLY while drafting (see the class docstring) --------------------------
    type = models.CharField(max_length=50, blank=True)
    audience = models.CharField(
        max_length=12, choices=AUDIENCE_CHOICES, default=DEFAULT_AUDIENCE
    )
    # Free text provenance, never a FK — the same field, with the same reasoning, as
    # `Material.author`: the human who wrote the document is almost never a platform account.
    author = models.CharField(max_length=200, blank=True)
    source_url = models.URLField(max_length=500, blank=True)
    price_amount = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    price_currency = models.CharField(
        max_length=3, choices=CURRENCY_CHOICES, default='PLN', blank=True
    )
    estimated_minutes = models.PositiveIntegerField(null=True, blank=True)
    #: list[str] — plain labels, turned into real `MaterialRequirement` rows by `create_material`.
    requirements = models.JSONField(default=list, blank=True)
    #: list[{topic_id, level, kind}] — the draft shape `materials.publish.create_material` turns
    #: into real `MaterialCoverage` rows at the first publication.
    coverage = models.JSONField(default=list, blank=True)

    # Whether a stranger may ask to join, and what they are being asked to help with. Two fields
    # rather than a note that is empty when closed: "we are looking for somebody" and "here is what
    # we need" are separately true, and a project can want help without having written the pitch.
    seeking_coauthors = models.BooleanField(default=False)
    seeking_note = models.CharField(max_length=500, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='material_projects_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        if self.material_id is not None:
            return f'project for {self.material}'
        return f'draft project in {self.branch.slug} (#{self.pk})'

    def save(self, *args, **kwargs):
        """Creating a project also seats its creator as owner.

        Here rather than in the viewset, for exactly the reason `courses.Course.save` records and
        which cost that app sixteen tests when it was in the wrong place: seed commands, the Django
        admin, fixtures, the backfill migration and tests all create projects too, and every one of
        them would otherwise produce a project nobody — including its own author — has any
        permission over, since `access.role_of` reads `ProjectMember` alone.

        `get_or_create` rather than `create`, so re-saving is not an error and a project whose owner
        row already exists (a transfer, the backfill's own work) is left exactly as it is.
        """
        from config.sanitize import sanitize_content

        # The pitch a stranger reads before asking to join. Sanitized like every other user-written
        # string in this codebase even though it renders as plain text — `MaterialTranslation.save`
        # states the same reasoning for its own `description`: defense in depth does not get to
        # depend on which client happens to render a field, and the API is a second entry point.
        self.seeking_note = sanitize_content(self.seeking_note)
        creating = self._state.adding
        super().save(*args, **kwargs)
        if creating and self.created_by_id:
            ProjectMember.objects.get_or_create(
                project=self, user_id=self.created_by_id, defaults={'role': 'owner'}
            )

    # --- the two versions that matter -----------------------------------------------------------
    # Both read `versions.all()` rather than filtering, so a prefetched list of projects answers
    # without a query each — the same cache-preserving rule `courses.Course.role_of` and
    # `exercises.entries.visible_entries` already follow, and the reason the serializers below can
    # render a listing in a bounded number of queries.

    @property
    def published_version(self):
        """The one row holding `published`, or None. A partial unique index guarantees the "one"."""
        for version in self.versions.all():
            if version.status == 'published':
                return version
        return None

    @property
    def head_version(self):
        """The highest-numbered `draft` or `published` row — what a save is written against.

        For anybody who is not a member this is the published one, because a draft is not visible to
        them at all; the two answers coincide rather than being computed differently per caller,
        which is what keeps `based_on` meaningful across the propose path.

        **Plus, while the project has no material yet, a `proposed` row.** That third case is a first
        publication waiting in the moderation queue, and it is the team's OWN work rather than an
        outsider's proposal — a stranger cannot propose on a project that has never published
        (`access.propose_block_reason` answers `not_published`), so before the first publication
        `proposed` can only mean "we pressed Publish and a moderator has not read it yet". It is the
        latest content the project has and the version the next draft must be written on top of.
        Leaving it out gave a queued project no head at all: nothing to name it by in a listing, and
        an editor offering `based_on: null` against a version that plainly exists. After the first
        publication the rule narrows back, because from then on a `proposed` row is somebody else's.
        """
        allowed = ('draft', 'published', 'proposed') if self.material_id is None else ('draft', 'published')
        head = None
        for version in self.versions.all():
            if version.status not in allowed:
                continue
            if head is None or version.number > head.number:
                head = version
        return head


class ProjectMember(models.Model):
    """One co-author, and in what capacity.

    Two roles, not five: `owner` is the person who cannot be removed and who can hand the project
    on; `coauthor` is everybody else, and everybody else can do everything else. A richer ladder was
    available (courses has one) and is not warranted here — a course has a roster, a queue and
    content policy to delegate, while a project has one document and a handful of people writing it.
    """

    project = models.ForeignKey(MaterialProject, related_name='members', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='material_project_memberships',
        on_delete=models.CASCADE,
    )
    role = models.CharField(max_length=10, choices=MEMBER_ROLE_CHOICES, default='coauthor')
    # Who brought them in. Null for the owner row, which nobody added, and for rows the backfill
    # created — an honest absence rather than attributing it to whoever ran the migration.
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['added_at', 'id']
        constraints = [
            models.UniqueConstraint(fields=['project', 'user'], name='unique_member_per_project'),
            # One owner per project, enforced by the database rather than by whichever view
            # remembers. A partial unique index constrains only the `owner` rows and leaves any
            # number of co-authors alone — the `courses.CourseStaff` shape exactly.
            models.UniqueConstraint(
                fields=['project'],
                condition=models.Q(role='owner'),
                name='one_owner_per_project',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.user} — {self.role} of project {self.project_id}'


class ProjectInvite(models.Model):
    """A link that puts somebody on the team without them having to ask.

    Addressed by bare token, like `courses.CourseInvite`: the holder of a link knows the token and
    nothing else, which is the entire point of a link. Revoking is a timestamp rather than a delete,
    so a link that stops working leaves a trace of who killed it and when, and so the row's own use
    count survives to be looked at (house rule 12).

    There is deliberately no role on an invite. Ownership is a decision about a named person — the
    same call `courses.CourseInvite` makes by not offering `owner` as an invite role — and a link
    that could hand a project away is a link somebody can forward.
    """

    project = models.ForeignKey(MaterialProject, related_name='invites', on_delete=models.CASCADE)
    token = models.CharField(max_length=64, unique=True, db_index=True)
    label = models.CharField(max_length=100, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    # 0 means unlimited, matching the convention `courses.CourseInvite.max_uses` and
    # `Course.capacity` already use in this codebase rather than inventing a second way to say it.
    max_uses = models.PositiveIntegerField(default=0)
    uses = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'invite to project {self.project_id}'

    @staticmethod
    def new_token() -> str:
        # Not a UUID: this ends up in a URL somebody pastes into a chat, and `token_urlsafe` gives
        # more entropy in fewer characters. 32 bytes because a guessable invite is an open door.
        return secrets.token_urlsafe(32)

    def unusable_reason(self, now=None) -> str | None:
        """Why this link will not work, or None — a reason rather than a boolean (house rule 6).
        "Expired" and "already used up" are the same refusal to a boolean and completely different
        to the person holding the link."""
        now = now or timezone.now()
        if self.revoked_at:
            return 'revoked'
        if self.expires_at and now >= self.expires_at:
            return 'expired'
        if self.max_uses and self.uses >= self.max_uses:
            return 'used_up'
        return None

    @property
    def is_usable(self) -> bool:
        return self.unusable_reason() is None


class ProjectJoinRequest(models.Model):
    """Asking to be let onto a project that says it is looking for people.

    The partial unique constraint is on PENDING rows only, for the reason
    `exercises.ExerciseTranslation` records in full after it produced three deterministic 500s: a
    full `unique_together` over all statuses makes "ask, be declined, ask again after fixing what
    they objected to" impossible, and the second ask is exactly the conversation this is for.
    """

    project = models.ForeignKey(
        MaterialProject, related_name='join_requests', on_delete=models.CASCADE
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='material_project_join_requests',
        on_delete=models.CASCADE,
    )
    statement = models.TextField()
    status = models.CharField(
        max_length=10, choices=JOIN_REQUEST_STATUS_CHOICES, default='pending'
    )
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['project', 'user'],
                condition=models.Q(status='pending'),
                name='one_pending_join_request',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.user} → project {self.project_id} [{self.status}]'


class MaterialVersion(models.Model):
    """One immutable attempt at a material's content.

    Immutable is the load-bearing word: nothing edits a version after it is saved except the
    decision fields and the reclaim stamp. "Improving a material" means adding a row here, which is
    what makes the history real, what makes a proposal reviewable against a known basis, and what
    makes a stale save detectable at all.

    **Exactly one payload, enforced in `clean()` and the serializer and NOT as a DB
    `CheckConstraint`.** A rejected or withdrawn file version has its blob reclaimed (`file=''`,
    `file_reclaimed_at` stamped) and has to remain a valid row afterwards — a check constraint would
    make the reclaim itself impossible, which is the wrong trade: the bytes are what cost disk, and
    the row is what carries the record of what was refused and why.
    """

    project = models.ForeignKey(MaterialProject, related_name='versions', on_delete=models.CASCADE)
    # 1-based, allocated max+1 in a bounded retry loop (`services.allocate_number`) rather than by
    # a bare read-then-insert — backend/CLAUDE.md's SQLite rule 3, the same shape exercise-number
    # allocation uses.
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=VERSION_STATUS_CHOICES, default='draft')
    kind = models.CharField(max_length=5, choices=VERSION_KIND_CHOICES, default='file')

    file = models.FileField(
        upload_to=version_upload_path,
        blank=True,
        validators=[validate_material_submission_file],
    )
    url = models.URLField(max_length=500, blank=True)
    # Markdown + raw-HTML passthrough + literal LaTeX delimiters, like every other content field
    # here; sanitized in `save()` below rather than in a serializer, so the admin, the backfill and
    # any future write path are covered without remembering to be.
    body = models.TextField(blank=True)

    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    # What changed and why, in the author's own words — the one thing a reviewer reads before the
    # diff. Short on purpose: it is a line in a history list, not a second description.
    change_note = models.CharField(max_length=500, blank=True)
    # The version this one was written against. SET_NULL rather than CASCADE because the basis
    # being deleted must not take the work with it, and a null here still reads correctly as "we
    # no longer know what this was written against".
    based_on = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='material_versions',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)
    published_at = models.DateTimeField(null=True, blank=True)

    scan_status = models.CharField(max_length=10, choices=SCAN_STATUS_CHOICES, default='skipped')
    scan_detail = models.CharField(max_length=200, blank=True)
    # Recorded at upload so a reclaimed row still says how big it was. The per-account quota still
    # sums live (`accounts.Profile.material_upload_bytes`) — a stored number that can drift is not
    # what a quota is allowed to be bounded by; this is the record, not the budget.
    file_size = models.PositiveBigIntegerField(default=0)
    file_reclaimed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['project', 'number']
        constraints = [
            models.UniqueConstraint(
                fields=['project', 'number'], name='unique_version_number'
            ),
            # One published row per project, the same partial-index shape as the owner row above
            # and as `ExerciseTranslation`'s published-only constraint. Publishing therefore has to
            # supersede first and claim second, never both `published` at once — see
            # `services.publish_version`, and `moderation/views.py _publish_translation` for the
            # deterministic 500 the opposite ordering produced there.
            models.UniqueConstraint(
                fields=['project'],
                condition=models.Q(status='published'),
                name='one_published_version_per_project',
            ),
        ]

    def __str__(self) -> str:
        return f'v{self.number} of project {self.project_id} [{self.status}]'

    def clean(self):
        """A version is a file, a link, or a text — exactly one, and the one its `kind` names.

        Skipped entirely for a row whose blob has been reclaimed: that row deliberately has no
        payload left and must stay valid (see the class docstring). `full_clean()` is what the
        admin runs; the reclaim path writes through `save(update_fields=…)`, which never calls this.
        """
        if self.file_reclaimed_at is not None:
            return
        # Keyed by KIND, not by column: a link's column is `url` but its kind is `link`, and keying
        # this by column name once made every link version fail `full_clean()` in the admin.
        filled = {
            'file': bool(self.file),
            'link': bool(self.url),
            'body': bool(self.body),
        }
        chosen = [name for name, present in filled.items() if present]
        if len(chosen) != 1:
            raise ValidationError(
                {
                    'kind': 'A version is a file, a link, or a text written here — exactly one of '
                    'the three.'
                }
            )
        if chosen[0] != self.kind:
            raise ValidationError(
                {'kind': f'This version says it is a {self.kind} but carries a {chosen[0]}.'}
            )

    def save(self, *args, **kwargs):
        # The same server-side sanitization `MaterialTranslation.save` and `Material.save` apply,
        # and it matters more here than on either of them: a co-authored version is written by
        # whoever the project let in and publishes with no moderator between it and every reader.
        from config.sanitize import sanitize_content

        self.title = sanitize_content(self.title)
        self.description = sanitize_content(self.description)
        self.body = sanitize_content(self.body)
        super().save(*args, **kwargs)

    def is_visible_to_readers(self) -> bool:
        """The two statuses an ordinary reader may see. A draft belongs to the team, a proposal to
        its author and the people who may decide it — `access.can_view_version` is where that full
        answer lives; this is the half of it that needs no caller."""
        return self.status in ('published', 'superseded')
