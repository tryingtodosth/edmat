"""Where a piece of content came from: did a person write it, or did a person and a machine.

Built for the owner's task on the EdMat organisation ("The “AI-assisted” score",
`work/edmat_project.py: TASKS`), which had stood as *"to do; nothing exists in the code yet"* since
2026-10-07. Two of its three open questions were settled by the owner on 2026-10-08:

- **A vote is a confidence, not a yes/no.** *"mark as AI-assisted and how % sure are you about
  that"* — so `AssistanceVote.confidence` is 0–100 and carries the whole opinion. Zero means "I
  am not at all convinced this is AI-assisted", which is a vote AGAINST on the same scale rather
  than a second field; a lifecycle is one field, never two (root CLAUDE.md house rule).
- **The surfaces** are the exercise statement, every hint, every solution, every comment and every
  review — `targets.PROVENANCE_KIND_MODELS`.

The third — the vote weight and the threshold — is still the organisation's poll to answer, and
`rules.py` keeps it as two named constants in one place for exactly that reason.

**Three tables and not one**, because three genuinely different people are speaking and conflating
them is how a badge starts lying about who claimed what:

- `AuthorMark` is the author's own disclosure. It is a FACT about the work, so nothing anybody else
  does ever overwrites it — the owner's own wording: *"that mark is stored on its own and is never
  lost under votes"*.
- `AssistanceVote` is one reader's reading, changeable, one per person per target.
- `ScoreLock` is a moderator ending the argument at a value, with a reason (house rule 6).
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.validators import MaxValueValidator
from django.db import models


class AuthorMark(models.Model):
    """The author saying, of their own content, whether a machine helped write it.

    One row per target and not one per (target, person): a piece of content has one author's
    answer, and a second person editing it later changes that answer rather than adding a competing
    one. `declared_by` records WHO gave the current answer, so a co-authored material that changes
    hands still says whose claim is standing — which is the "who, when, at which version" the
    owner's task asks for.

    `assisted=False` is a real, stored answer and deliberately not the same as having no row: "the
    author says no machine helped" and "nobody has asked the author" read identically to a boolean
    and completely differently to a person deciding whether to trust the page.
    """

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    assisted = models.BooleanField()
    #: Free text the author may add ("the derivation is mine, the wording was tidied up"). Minors
    #: may vote but not write one of these — see `rules.can_declare`.
    note = models.TextField(blank=True)
    #: "At which version" — free text rather than an FK, because the four target kinds version
    #: themselves in four different ways (a `SolutionEntry` not at all) and an FK would have to be
    #: nullable for most of them anyway. Written by the server, never by the client.
    version_label = models.CharField(max_length=120, blank=True)
    declared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('content_type', 'object_id')]
        ordering = ['-updated_at']

    def __str__(self) -> str:
        said = 'AI-assisted' if self.assisted else 'written without AI'
        return f'author of {self.target!r} says: {said}'


class AssistanceVote(models.Model):
    """One reader's answer to "how sure are you that this was written with AI?", 0–100.

    `unique_together` is the same correctness rule `moderation.Report` carries and for the same
    reason: without it one account could move a target's score as far as it liked by voting
    repeatedly, which would make the threshold in `rules.py` meaningless.

    Changeable by design — re-voting updates the row rather than adding one, so `updated_at` is
    "when this person last looked" and the count is always the number of people, never the number
    of opinions.
    """

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    voter = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='assistance_votes', on_delete=models.CASCADE
    )
    #: Percent. 0 = "certainly a person wrote this", 100 = "certainly a machine helped".
    confidence = models.PositiveSmallIntegerField(validators=[MaxValueValidator(100)])
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('content_type', 'object_id', 'voter')]
        ordering = ['-updated_at']
        indexes = [models.Index(fields=['content_type', 'object_id'])]

    def __str__(self) -> str:
        return f'{self.voter} is {self.confidence}% sure {self.target!r} is AI-assisted'


class ScoreLock(models.Model):
    """A moderator freezing the community reading at a value, with the reason that made them.

    House rule 6 — a refusal carries its reason: "this is locked" and "this is locked because the
    author showed us the drafts" are the same state to a boolean and different things to the person
    whose work it is. `reason` is therefore not blank-able.

    A lock replaces the COMMUNITY half of the reading and never the author's mark: the author's
    answer is a record of something a person said, and a moderator overwriting it would be putting
    words in their mouth rather than ending an argument about them.
    """

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    #: The percent the community reading is held at while this row exists.
    value = models.PositiveSmallIntegerField(validators=[MaxValueValidator(100)])
    reason = models.TextField()
    locked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('content_type', 'object_id')]
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.target!r} locked at {self.value}% by {self.locked_by}'
