"""Documents hung on an event, and the ledger of who has read the ones that had to be read.

CONFERENCE-BRIEF.md §3.C. Two models and one idea: **a document is visible to a TIER, and a
mandatory document is not read until somebody says so at the version they saw.**

**Why its own app rather than two more models in `events`.** The rule the brief is really asking
for ("a volunteer's tools stay locked until the briefing is acknowledged") is asked by three
different surfaces — check-in today, the ticket scanner and the cloakroom desk once steps D and F
land — so it has to live in a module those three can import without dragging the whole of `events`
along, and `events` must not grow a migration this cycle (§4 rule 1). The event ↔ document link is
a row here pointing at `events.Event` by string reference, so `events` knows nothing about this app
and nothing in `events` had to change except the one check-in guard.

**The tiers are a ladder, plus one side branch.** `public ⊂ attendees ⊂ staff ⊂ organisers` — each
step up sees everything below it, because a document an attendee may read is not a secret from the
volunteer standing at the door. `venue` is deliberately NOT on that ladder: the building's own
administrators are neither above nor below an organiser, they are somebody else entirely (a fire
plan they wrote; an access arrangement they need signed). Until step A lands, nobody but an
organiser answers to it — see `access.venue_admin_check`.

**A replacement is a new row, not an edit.** The old row keeps its bytes, its version number and
every acknowledgement made against it, and gains a pointer to the one that supersedes it (house
rule 12: tombstone, don't hard-delete). That is what makes "who had read the fire plan on the
morning of the event" answerable at all — an in-place edit would rewrite history and silently
convert 40 people's "I have read it" into a claim about text they never saw. `version` lives on
BOTH the document and the acknowledgement for the same reason, belt and braces: even if some future
path did bump a version in place, an acknowledgement recorded at version 2 does not answer for
version 3.

**Nothing here stores the bytes that were uploaded** (house rule 7). An image is decoded and
re-encoded to WebP through `backend/imaging.py`; a PDF gets the size cap, the libmagic sniff and the
ClamAV pass that `materials/validators.py` already owns, and is stored under a random name. See
`documents/files.py` — this module only holds what came back.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

# The ladder, lowest first. `access.visible_tiers_for` is the only thing that should read the
# ORDER; everything else asks that function which tiers a person has.
TIER_PUBLIC = 'public'
TIER_ATTENDEES = 'attendees'
TIER_STAFF = 'staff'
TIER_ORGANISERS = 'organisers'
TIER_VENUE = 'venue'

VISIBILITY_CHOICES = [
    (TIER_PUBLIC, 'Anybody who can see the event'),
    (TIER_ATTENDEES, 'People with a seat'),
    (TIER_STAFF, 'Event staff'),
    (TIER_ORGANISERS, 'Organisers only'),
    (TIER_VENUE, 'The venue’s administrators'),
]

KIND_FILE = 'file'
KIND_LINK = 'link'
KIND_CHOICES = [
    (KIND_FILE, 'An uploaded file'),
    (KIND_LINK, 'A link somewhere else'),
]

MAX_TITLE_LENGTH = 200


def document_upload_path(instance, filename: str) -> str:
    """The uploader's own filename is untrusted input (path separators, a double extension, a
    collision with somebody else's upload) and is thrown away here exactly as
    `imaging.encode_webp` and `materials`' own upload path already throw it away. The extension
    comes from what the file was proven to BE, not from what it was called."""
    suffix = '.pdf' if (instance.content_type or '').endswith('pdf') else '.webp'
    return f'event-documents/{uuid.uuid4().hex}{suffix}'


class EventDocument(models.Model):
    # String reference on purpose: this app imports nothing from `events` at module level, so the
    # dependency runs one way only and `events` keeps no knowledge of documents at all.
    event = models.ForeignKey('events.Event', related_name='documents', on_delete=models.CASCADE)
    title = models.CharField(max_length=MAX_TITLE_LENGTH)
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default=KIND_FILE)
    file = models.FileField(upload_to=document_upload_path, blank=True)
    url = models.URLField(max_length=500, blank=True)
    # What the stored file actually is, decided by the sniff/re-encode and never by the uploader —
    # this is what the protected endpoint puts in `Content-Type`, so it must not be client data.
    content_type = models.CharField(max_length=80, blank=True)
    byte_size = models.PositiveIntegerField(default=0)
    visibility = models.CharField(max_length=10, choices=VISIBILITY_CHOICES, default=TIER_STAFF)
    # "You may not check anybody in until you have read this." Only ever meaningful together with
    # the tier: a mandatory document nobody in a role can see blocks nobody.
    requires_acknowledgement = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='event_documents_uploaded',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    # The supersession pointer. Set on the OLD row when a replacement is uploaded, so the chain
    # reads forwards in time and "what is current" is `replaced_by IS NULL`.
    replaced_by = models.OneToOneField(
        'self', related_name='replaces', null=True, blank=True, on_delete=models.SET_NULL
    )
    # A withdrawal is a state, not a DELETE: an acknowledgement ledger whose documents can vanish
    # answers nothing, and a read receipt pointing at no document is worse than useless.
    removed_at = models.DateTimeField(null=True, blank=True)
    removed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='event_documents_removed',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    # Honest scan reporting (house rule 10): `scanned=False` means no scanner was reachable, never
    # "clean". Kept on the row because the person deciding whether to open a PDF somebody else
    # uploaded is entitled to know which of the two it was.
    scanned = models.BooleanField(default=False)
    scan_detail = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['visibility', 'title', 'id']
        indexes = [models.Index(fields=['event', 'visibility'])]

    def __str__(self) -> str:
        return f'{self.title} (v{self.version}, {self.visibility})'

    def clean(self):
        if self.kind == KIND_FILE:
            if not self.file:
                raise ValidationError({'file': 'A file document needs a file.'})
            if self.url:
                raise ValidationError({'url': 'A file document does not also carry a link.'})
        else:
            if not self.url:
                raise ValidationError({'url': 'A link document needs a link.'})
            if self.file:
                raise ValidationError({'file': 'A link document does not also carry a file.'})

    @property
    def is_current(self) -> bool:
        return self.replaced_by_id is None and self.removed_at is None


class DocumentAcknowledgement(models.Model):
    """One person saying "I have read this", pinned to the version they were shown.

    Not a boolean on the document and not a M2M: the pair (document, version) is the key, and the
    timestamp is the part an organiser actually needs when somebody asks who had seen the fire plan
    before the doors opened.
    """

    document = models.ForeignKey(
        EventDocument, related_name='acknowledgements', on_delete=models.CASCADE
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='document_acknowledgements', on_delete=models.CASCADE
    )
    version = models.PositiveIntegerField()
    acknowledged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-acknowledged_at', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['document', 'user', 'version'], name='unique_document_acknowledgement'
            )
        ]

    def __str__(self) -> str:
        return f'{self.user} read {self.document_id} v{self.version}'
