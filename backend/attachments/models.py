"""One table for "what is attached to this", whatever "this" is.

The owner, 2026-10-08: *".md files, docs, etc, sketches etc for files when creating an event for
attachements (in multiple places we lack this funcionality)"* — and, asked where: events at creation
time, courses, tasks, plans, needs, goals, materials, organisations **and comments**, "EVERYWHERE".
Asked what to do about the three tables that already answered a piece of that question, the owner
chose **one table, supersede the others**.

The three it absorbs, and what each contributed:

- **`documents.EventDocument`** — the tiers, the mandatory-read acknowledgements pinned to a
  version, the supersession chain, the withdrawal that is a state rather than a delete, and the
  honest `scanned=False`. Every one of those is kept, because each was written for a reason this
  table now inherits.
- **`courses.Attachment`** — a title, a description, a rating thread, and the signal that deletes
  the bytes when the row goes.
- **`community.CommentAttachment`** — a file hung on something that is not a node at all.

**Why one table and not four with a shared base.** The question "what is attached to this?" has one
answer, and the root CLAUDE.md's second boundary says a rule more than one endpoint needs lives in
one module. Three tables meant three answers to "may I see this file", three upload paths and three
sets of refusals; the `/about` board already showed what that costs when a fourth surface wanted
attachments and got none.

**The visibility ladder is EventDocument's, generalised.** `public ⊂ members ⊂ staff ⊂ managers`,
with `venue` as the one side branch that is not on the ladder — the building's own administrators
are neither above nor below an organiser, they are somebody else entirely. The old event tiers map
onto it exactly (`attendees` → `members`, `organisers` → `managers`), which is what makes the data
migration a rename rather than a reinterpretation. For a target that has no such ladder — a comment —
only `public` is legal, and `access.py` refuses the rest rather than silently treating them as
public.

**`media_type`, not `content_type`.** The GenericForeignKey owns `content_type` here, so the sniffed
MIME keeps a different name. `EventDocument` called it `content_type` and could, having no generic
target; the migration renames it.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver

# ---- the ladder --------------------------------------------------------------------------------
# Lowest first. `access.visible_tiers_for` is the only thing that should read the ORDER; everything
# else asks it which tiers a person has.
TIER_PUBLIC = 'public'
TIER_MEMBERS = 'members'
TIER_STAFF = 'staff'
TIER_MANAGERS = 'managers'
TIER_VENUE = 'venue'

VISIBILITY_CHOICES = [
    (TIER_PUBLIC, 'Anybody who can see the thing it is attached to'),
    (TIER_MEMBERS, 'People in the room — enrolled, going, on the roster'),
    (TIER_STAFF, 'The people running it'),
    (TIER_MANAGERS, 'Whoever may manage it'),
    (TIER_VENUE, 'The venue’s administrators (an event only)'),
]
#: The ladder, lowest first. `venue` is deliberately NOT on it.
TIER_LADDER = [TIER_PUBLIC, TIER_MEMBERS, TIER_STAFF, TIER_MANAGERS]

# ---- the kinds ---------------------------------------------------------------------------------
KIND_FILE = 'file'
KIND_TEXT = 'text'
KIND_LINK = 'link'
KIND_SKETCH = 'sketch'
KIND_CHEM = 'chem'

KIND_CHOICES = [
    (KIND_FILE, 'An uploaded file'),
    (KIND_TEXT, 'Markdown or plain text, written or uploaded'),
    (KIND_LINK, 'A link somewhere else'),
    (KIND_SKETCH, 'A sketch that already exists here'),
    (KIND_CHEM, 'A chemistry drawing that already exists here'),
]
#: The two kinds that point at a row this site already holds rather than at bytes or at the open
#: web. They are REFERENCES: nothing is copied, so a sketch stays one drawing however many places
#: it is attached to, and deleting the attachment never deletes the drawing.
REFERENCE_KINDS = frozenset({KIND_SKETCH, KIND_CHEM})

MAX_TITLE_LENGTH = 200
#: A text attachment is a note, not a book. Generous enough for a real README or a page of working;
#: past that it is a material, which is a different thing with a different home.
MAX_TEXT_LENGTH = 100_000


def attachment_upload_path(instance, filename: str) -> str:
    """The uploader's own filename is untrusted input (path separators, a double extension, a
    collision with somebody else's upload) and is thrown away, exactly as `imaging.encode_webp`,
    `materials` and `documents` already throw it away. The extension comes from what the file was
    proven to BE, not from what it was called."""
    from .files import extension_for

    return f'attachments/{uuid.uuid4().hex}{extension_for(instance.media_type)}'


class Attachment(models.Model):
    # The polymorphic target — see `attachments/targets.py` for the registry and for why a board row
    # resolves to the node behind it rather than carrying standing of its own.
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')

    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default=KIND_FILE)
    title = models.CharField(max_length=MAX_TITLE_LENGTH)
    description = models.TextField(blank=True)

    # --- what it actually is, one of these by `kind` ---------------------------------------------
    file = models.FileField(upload_to=attachment_upload_path, blank=True)
    #: Markdown with the same LaTeX delimiters as every other body on this site, so a `.md` someone
    #: attaches renders through `renderContent.ts` rather than downloading. Stored as TEXT: there
    #: are no bytes to keep, which is house rule 7 answered by not having the question.
    body = models.TextField(blank=True, max_length=MAX_TEXT_LENGTH)
    url = models.URLField(max_length=500, blank=True)
    sketch = models.ForeignKey(
        'sketches.Sketch', related_name='attachments', null=True, blank=True, on_delete=models.CASCADE
    )
    chem_drawing = models.ForeignKey(
        'chem.ChemDrawing', related_name='attachments', null=True, blank=True, on_delete=models.CASCADE
    )

    # --- what the stored file turned out to be ---------------------------------------------------
    # Decided by the sniff/re-encode and never by the uploader — this is what the protected endpoint
    # puts in `Content-Type`, so it must not be client data.
    media_type = models.CharField(max_length=120, blank=True)
    #: Shown so a person can recognise the file they are about to download. Untrusted, never used to
    #: decide anything, and never what the bytes are stored under.
    original_name = models.CharField(max_length=120, blank=True)
    byte_size = models.PositiveIntegerField(default=0)
    # Honest scan reporting (house rule 10): `scanned=False` means no scanner was reachable, never
    # "clean". Kept on the row because the person deciding whether to open a file somebody else
    # uploaded is entitled to know which of the two it was.
    scanned = models.BooleanField(default=False)
    scan_detail = models.CharField(max_length=300, blank=True)

    # --- who may see it, and who owes a reading --------------------------------------------------
    visibility = models.CharField(max_length=10, choices=VISIBILITY_CHOICES, default=TIER_MEMBERS)
    # "You may not check anybody in until you have read this." Only ever meaningful together with
    # the tier: a mandatory attachment nobody in a role can see blocks nobody.
    requires_acknowledgement = models.BooleanField(default=False)

    # --- the record ------------------------------------------------------------------------------
    version = models.PositiveIntegerField(default=1)
    # The supersession pointer. Set on the OLD row when a replacement is uploaded, so the chain
    # reads forwards in time and "what is current" is `replaced_by IS NULL`.
    replaced_by = models.OneToOneField(
        'self', related_name='replaces', null=True, blank=True, on_delete=models.SET_NULL
    )
    # A withdrawal is a state, not a DELETE (house rule 12): an acknowledgement ledger whose rows
    # can vanish answers nothing, and a read receipt pointing at no attachment is worse than useless.
    removed_at = models.DateTimeField(null=True, blank=True)
    removed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='attachments_removed',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='attachments_uploaded',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', '-created_at', 'id']
        indexes = [
            models.Index(fields=['content_type', 'object_id', 'visibility']),
            models.Index(fields=['content_type', 'object_id', 'removed_at']),
        ]

    def __str__(self) -> str:
        return f'{self.title} (v{self.version}, {self.visibility})'

    def clean(self):
        """One `kind`, one payload. Each branch refuses the other four rather than ignoring them:
        a row carrying both a file and a link is a row two readers will disagree about."""
        carried = {
            KIND_FILE: bool(self.file),
            KIND_TEXT: bool((self.body or '').strip()),
            KIND_LINK: bool(self.url),
            KIND_SKETCH: self.sketch_id is not None,
            KIND_CHEM: self.chem_drawing_id is not None,
        }
        if not carried.get(self.kind):
            raise ValidationError({self.kind: f'A {self.kind} attachment needs its own payload.'})
        for other, present in carried.items():
            if other != self.kind and present:
                raise ValidationError(
                    {other: f'A {self.kind} attachment does not also carry a {other}.'}
                )

    @property
    def is_current(self) -> bool:
        return self.replaced_by_id is None and self.removed_at is None

    @property
    def is_reference(self) -> bool:
        return self.kind in REFERENCE_KINDS


@receiver(post_delete, sender=Attachment)
def _delete_attachment_file(sender, instance, **kwargs):
    """Deleting an attachment deletes its file — the reasoning `courses.Attachment`'s own signal
    spells out at length and which is inherited wholesale: Django's `FileField` deliberately does
    not remove the file when the row goes, so it has to be asked for, and here it should be. If the
    row disappears from the page while the bytes stay at a stable, still-servable URL, somebody who
    took their photo of a whiteboard down has not taken it down — they have only stopped being able
    to find it themselves.

    A signal rather than an override of `delete()`, because a model method is bypassed by the two
    paths that matter most: a queryset delete, and the cascade when a whole course is deleted.

    Note that an ordinary **withdrawal** does not reach this: it sets `removed_at`, which is the
    whole point of the field. This fires only for a real row deletion.
    """
    if not instance.file:
        return
    try:
        instance.file.delete(save=False)
    except (OSError, ValueError):
        pass


class Acknowledgement(models.Model):
    """One person saying "I have read this", pinned to the version they were shown.

    Not a boolean on the attachment and not a M2M: the pair (attachment, version) is the key, and
    the timestamp is the part an organiser actually needs when somebody asks who had seen the fire
    plan before the doors opened. `version` lives on BOTH rows, belt and braces — even if some
    future path did bump a version in place, an acknowledgement recorded at version 2 does not
    answer for version 3.
    """

    attachment = models.ForeignKey(
        Attachment, related_name='acknowledgements', on_delete=models.CASCADE
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='attachment_acknowledgements', on_delete=models.CASCADE
    )
    version = models.PositiveIntegerField()
    acknowledged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-acknowledged_at', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['attachment', 'user', 'version'], name='unique_attachment_acknowledgement'
            )
        ]

    def __str__(self) -> str:
        return f'{self.user} read {self.attachment_id} v{self.version}'


class AttachmentReview(models.Model):
    """A star rating and an optional written review on one attachment — `courses.AttachmentReview`,
    carried over whole so that a course's existing ratings survive the supersession.

    A direct FK rather than a generic one, matching `community.Review`, `MaterialReview` and
    `ServiceReview`: a review never needs to span more than the one thing it was built for.
    """

    attachment = models.ForeignKey(Attachment, related_name='reviews', on_delete=models.CASCADE)
    # `related_name` spelled out because `courses.AttachmentReview` is still here during the
    # supersession and the two would otherwise claim the same reverse accessor on User.
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='attachment_reviews', on_delete=models.CASCADE
    )
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        # One review per person per attachment, same as every other review model here.
        unique_together = [('attachment', 'author')]

    def __str__(self) -> str:
        return f'{self.author} rated {self.attachment_id} {self.rating}/5'
