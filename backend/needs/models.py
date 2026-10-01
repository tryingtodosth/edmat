"""`Need` — a public "help wanted" hung off a course, an event or a material through the shared
node seam (`config/nodes.py`, MANAGEMENT-BRIEF.md §3.C), and `NeedApplication` — who answered.

**Never paid.** `FINANCES.md`: nothing on this platform takes or mentions money, and this app is
one of the places that rule was written with in mind — `estimated_hours` is an estimate for
somebody deciding whether they have the time, not a rate.

`status` is one field, never a pair of booleans (root `CLAUDE.md`, the lifecycle shape): `open` →
`in_progress` (a manager's own call, or left alone) → `fulfilled` (**derived**, never set by hand —
`needs/rules.py: recount` is the only writer) or `cancelled` (a manager's call, terminal in
practice though the model does not forbid reopening it by the same PATCH that got it there).

`NeedApplication.status` is `pending | accepted | declined | withdrawn`, **unique per
(need, user) across every status, not just the live ones** — a withdrawn or declined application
is the record of a decision (house rule 12: tombstone, don't hard-delete) and a second row for the
same pair would be a second, disagreeing record of the same relationship. Applying again after
withdrawing is therefore not offered; the honest read is that the applicant changed their mind once
and the conversation moves to a message to the node's staff, not a second form.
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from config.sanitize import sanitize_content

# Mirrored in `frontend/src/lib/types/need.ts` and labelled in `frontend/src/lib/utils/labels.ts`
# (root CLAUDE.md house rule 13 — say so in both places).
NEED_KIND_CHOICES = [
    ('help', 'General help'),
    ('expertise', 'Expertise'),
    ('equipment', 'Equipment'),
    ('venue', 'Venue'),
    ('other', 'Other'),
]

NEED_STATUS_CHOICES = [
    ('open', 'Open'),
    ('in_progress', 'In progress'),
    ('fulfilled', 'Fulfilled'),
    ('cancelled', 'Cancelled'),
]

SKILL_LEVEL_CHOICES = [
    ('none', 'No particular skill needed'),
    ('beginner', 'Beginner'),
    ('intermediate', 'Intermediate'),
    ('advanced', 'Advanced'),
]

APPLICATION_STATUS_CHOICES = [
    ('pending', 'Pending'),
    ('accepted', 'Accepted'),
    ('declined', 'Declined'),
    ('withdrawn', 'Withdrawn'),
]

DESCRIPTION_MAX_LENGTH = 4000
MESSAGE_MAX_LENGTH = 2000
#: How many languages one volunteer may claim. Not a judgement about polyglots — a bound, so a
#: free-string list cannot become an unbounded one through the API.
MAX_SPOKEN_LANGUAGES = 12


class Need(models.Model):
    """One "help wanted" posting. The node it hangs off is a `GenericForeignKey` resolved through
    `config/nodes.py`'s registry — never a direct FK to `Course`/`Event`/`Material`, because that
    would be a fourth app each of those three would need a migration for (MANAGEMENT-BRIEF.md §4
    rule 1: one app per step, and no migration outside it)."""

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    node = GenericForeignKey('content_type', 'object_id')

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    kind = models.CharField(max_length=10, choices=NEED_KIND_CHOICES, default='help')
    status = models.CharField(max_length=12, choices=NEED_STATUS_CHOICES, default='open')
    skill_level = models.CharField(max_length=12, choices=SKILL_LEVEL_CHOICES, default='none')
    estimated_hours = models.PositiveIntegerField(null=True, blank=True)
    deadline = models.DateTimeField(null=True, blank=True)
    is_remote = models.BooleanField(default=False)
    wanted_count = models.PositiveIntegerField(default=1)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='needs_created',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['content_type', 'object_id'])]

    def __str__(self) -> str:
        return self.title

    def save(self, *args, **kwargs):
        self.description = sanitize_content(self.description or '')[:DESCRIPTION_MAX_LENGTH]
        super().save(*args, **kwargs)

    def accepted_count(self) -> int:
        """A `COUNT` over an indexed FK, recomputed on every read (house rule 5) — never a tally
        kept on the row, which is exactly the field `needs/rules.py: recount` exists to replace."""
        return self.applications.filter(status='accepted').count()


class NeedApplication(models.Model):
    need = models.ForeignKey(Need, related_name='applications', on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='need_applications', on_delete=models.CASCADE
    )
    message = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=APPLICATION_STATUS_CHOICES, default='pending')
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='need_applications_decided',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [
            models.UniqueConstraint(fields=['need', 'user'], name='unique_need_application_per_user'),
        ]
        indexes = [models.Index(fields=['need', 'status'])]

    def __str__(self) -> str:
        return f'user {self.user_id} -> need {self.need_id} ({self.status})'

    def save(self, *args, **kwargs):
        self.message = sanitize_content(self.message or '')[:MESSAGE_MAX_LENGTH]
        super().save(*args, **kwargs)


# ---------------------------------------------------------------------------------------------
# The other half of the same question (2026-10-01, owner's "make it possible to add /volunteering
# offers, in different languages"). `Need` is the demand side — a course, an event or a material
# saying what it needs. `VolunteeringOffer` is the supply side: a person saying what they can do,
# attached to nobody.
#
# It lives in THIS app rather than in a new one, by the owner's choice, and the shared vocabulary
# is why that pays: an offer reuses `NEED_KIND_CHOICES` and `SKILL_LEVEL_CHOICES` verbatim, so
# "expertise, advanced" means exactly the same thing on both sides and a future matcher has one
# vocabulary to join on rather than two that nearly agree.
#
# It is deliberately NOT a `services.Service` with a `kind` column, which was the other candidate:
# a Service carries a rate, a currency, a bookable calendar and a reviews table, every one of
# which is wrong here. `FINANCES.md` governs both, but a volunteering offer should not have a
# money field to leave empty.
# ---------------------------------------------------------------------------------------------

#: One field, never a pair of booleans (root `CLAUDE.md`): `paused but closed` is not a state.
#: `paused` is "not right now, ask me later" and keeps the row on the volunteer's own page;
#: `closed` is "this is over" and is kept rather than deleted (house rule 12) so a conversation
#: that referred to it still has something to refer to.
OFFER_STATUS_CHOICES = [
    ('open', 'Open to being asked'),
    ('paused', 'Paused'),
    ('closed', 'Closed'),
]


class VolunteeringOffer(models.Model):
    """"I can help with this" — a public, unpaid offer by one person.

    **Never paid**, the same invariant `Need` carries and for the same reason (`FINANCES.md`):
    `hours_per_week` is how much time somebody has, never a rate, and nothing here computes a cost.

    **Two language fields, because they answer two different questions**, and collapsing them
    would lose the one that matters most to a reader:

    - `language` is the language the offer is WRITTEN in. It is the platform's existing content
      axis — `config/content_locale.py` filters every list on exactly this shape, so an offer
      written in Ukrainian is hidden from a reader who reads neither Ukrainian nor its
      fallbacks, and the list says how many it left out. Same field, same name, same job as
      `services.Service.language`.
    - `spoken_languages` is the languages the volunteer can actually HELP in. That is a fact about
      the person, not about the text, and it is the one somebody searching is looking for — "I
      need a volunteer who can talk to a Ukrainian family" is not answered by what language the
      advert happens to be typed in. A `JSONField` list of locale codes, the shape
      `accounts.Profile.content_locales` already uses; free strings, not an enum, for the reason
      the root `CLAUDE.md` gives about `locale` generally.
    """

    volunteer = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='volunteering_offers', on_delete=models.CASCADE
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    kind = models.CharField(max_length=10, choices=NEED_KIND_CHOICES, default='help')
    skill_level = models.CharField(max_length=12, choices=SKILL_LEVEL_CHOICES, default='none')
    status = models.CharField(max_length=10, choices=OFFER_STATUS_CHOICES, default='open')

    language = models.CharField(max_length=8, default='pl')
    spoken_languages = models.JSONField(default=list, blank=True)

    hours_per_week = models.PositiveSmallIntegerField(null=True, blank=True)
    is_remote = models.BooleanField(default=True)
    #: Free text on purpose, not a pin: an offer is "around Warsaw", not a point on a map. The
    #: `services` app has coordinates because a student travels to a specific address; nobody
    #: travels to a volunteer.
    location_text = models.CharField(max_length=300, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [models.Index(fields=['status', 'language'])]

    def __str__(self) -> str:
        return f'{self.title} (volunteer {self.volunteer_id})'

    def save(self, *args, **kwargs):
        """Sanitized on write, because the description renders as content — Markdown, literal
        LaTeX and the `<img data-chem>` a drawing becomes, the same input every other prose field
        on this site has (house rule 8; the API is a second entry point no DOMPurify ever sees).

        `spoken_languages` is normalised here rather than in the serializer so that the admin and
        any future importer get the same answer: lower-cased, de-duplicated, order kept, capped.
        A free string is not an excuse for an unbounded one.
        """
        self.description = sanitize_content(self.description or '')[:DESCRIPTION_MAX_LENGTH]
        seen, cleaned = set(), []
        for raw in self.spoken_languages or []:
            code = str(raw).strip().lower()[:8]
            if code and code not in seen:
                seen.add(code)
                cleaned.append(code)
        self.spoken_languages = cleaned[:MAX_SPOKEN_LANGUAGES]
        super().save(*args, **kwargs)
