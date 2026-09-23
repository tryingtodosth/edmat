"""Concepts: the wiki-like pages for the things exercises and materials are *about*.

"Derivative", "quantum mechanics", "mole", "recursion" — a corpus of exercises has always implied
these, and never had anywhere to say what one *is*. Five models, and the reason each is shaped the
way it is:

* `Concept` — one language-neutral node with a slug, some branches and some tags. Deliberately with
  **no title and no text of its own**: the title of "quantum mechanics" for a nine-year-old and for
  a third-year physicist are different sentences, and a column here would have forced one of them
  to be the real one.
* `ConceptArticle` — one written take, for one `(audience, locale)`. **Several people may write
  their own article for the same pair**, which is the decision this app turns on: articles for one
  page are peers, the way `exercises.SolutionEntry` hints and solutions are a pool, rather than one
  page whose text two people take turns overwriting. `pinned` is the same staff/governor lever the
  entry pool has, and `is_removed` / `auto_hidden_at` are the exact names the reports machinery
  already looks for.
* `ConceptRevision` — one immutable attempt at an article's content, numbered from 1. Improving an
  article means adding one of these; publishing it supersedes the previous one. A partial unique
  index means exactly one `published` row per article, which is what makes "the head" a fact rather
  than a convention, and what a stale save is detected against.
* `ConceptAsset` — a picture or a PDF placed as a block. Never the bytes that were uploaded
  (house rule 7): `community.attachments.process_attachment` re-encodes a picture and sniffs,
  size-caps and scans a PDF, which is the same pipeline a comment attachment goes through — reused
  rather than copied, so a change to what this platform accepts lands in one place.
* `ConceptLink` — a concept pointing at an exercise, a material or another concept, from either of
  two origins: somebody filed it, or it was harvested from a `[[slug]]` written in the text.

The vocabulary is mirrored on the frontend (`types/concept.ts`, house rule 13) and there is no
`approved` anywhere in this app: the positive terminal state is what the row IS, `published` — the
same call `coauthoring` made, for the same reason `moderation/CLAUDE.md` records.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import models

from config.audience import AUDIENCE_CHOICES, DEFAULT_AUDIENCE

#: The six states a revision can be in. `draft` is the only mutable one and the only one that may
#: be hard-deleted; the last three are terminal history and are kept, never deleted, because who
#: proposed what and whether it was taken is part of the trust model (house rule 12).
REVISION_STATUS_CHOICES = [
    ('draft', 'Draft'),
    ('pending', 'Waiting for review'),
    ('published', 'Published'),
    ('superseded', 'Superseded'),
    ('rejected', 'Rejected'),
    ('withdrawn', 'Withdrawn'),
]

ASSET_KIND_CHOICES = [
    ('image', 'Picture'),
    ('pdf', 'PDF'),
]

RELATION_CHOICES = [
    ('related', 'Related'),
    # "Know this first." The only other relation in v1, and the only one worth the second word: a
    # reader who has landed on "eigenvalue" without "linear map" needs to be told, and a generic
    # "related" cannot say it.
    ('prerequisite', 'Prerequisite'),
]

ORIGIN_CHOICES = [
    ('manual', 'Added by somebody'),
    # Harvested from a `[[slug]]` in the text of a published article (`services.harvest_body_links`).
    # Not removable by hand: the text is what says it, so removing the link means editing the text.
    ('body', 'From the text'),
]

# What a concept may be linked to, in the same `(app_label, model) -> short name` vocabulary
# `community/targets.py` and `galleries/models.py` already established — and, like theirs, a
# deliberately SEPARATE and much shorter table. A concept is about content and about other
# concepts; it is not about a review, a booking or a course lesson, and inheriting a longer list
# would make every future comment target silently linkable here.
LINK_TARGETS = {
    ('exercises', 'exercise'): 'exercise',
    ('materials', 'material'): 'material',
    ('concepts', 'concept'): 'concept',
}
LINK_TARGET_MODELS = {name: key for key, name in LINK_TARGETS.items()}

MAX_TITLE_LENGTH = 300
MAX_SUMMARY_LENGTH = 500


def asset_upload_path(instance, filename: str) -> str:
    """A random name, discarding whatever the uploader called it — the same reasoning every upload
    path in this codebase carries: a filename is untrusted input (a path separator, a double
    extension, a collision), and the original is kept in a column where it is data rather than a
    path."""
    ext = '.webp' if instance.kind == 'image' else '.pdf'
    return f'concept-assets/{uuid.uuid4().hex}{ext}'


class Concept(models.Model):
    """One idea, named once, written about many times.

    No title, no text, no audience — all of that belongs to the articles, and putting any of it here
    would immediately raise "whose version?". What IS here is the part that genuinely is
    language-neutral: the slug a link points at, the branches that decide who governs it, and the
    tags that let it be found the way everything else on this platform is found.

    There are no removal columns either, and that is a decision rather than a gap: a concept with no
    visible article is invisible by construction (`access.visible_concepts`), so hiding one means
    dealing with its articles — which is where a report lands and where a moderator's decision
    belongs. A second, concept-level hidden flag would be a way for the two to disagree.
    """

    #: Allocated once from the first article's title (`services.allocate_slug`) and **immutable
    #: through the API**: it is what `[[slug]]` in somebody's text and every shared link resolve
    #: against. Renaming is a staff/admin job and is deliberately not built (CONCEPTS-BRIEF.md §9).
    slug = models.SlugField(max_length=120, unique=True)
    #: Governance scope and browse, not a taxonomy position: a concept may belong to several
    #: branches (the derivative belongs to every analysis course) or to none at all, and one with
    #: none is reviewed by staff and its own authors alone.
    branches = models.ManyToManyField('taxonomy.Branch', related_name='concepts', blank=True)
    #: The same global vocabulary exercises and materials use — a tag is how a reader gets from an
    #: exercise to the idea behind it without anybody having filed a link.
    tags = models.ManyToManyField('exercises.Tag', related_name='concepts', blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='concepts_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    #: Bumped by `services.publish_revision` on every publication under this concept, which is what
    #: `?sort=updated` (the default) orders by. `auto_now` as well, so a metadata edit counts too.
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at', 'slug']

    def __str__(self) -> str:
        return self.slug


class ConceptArticle(models.Model):
    """One person's article about one concept, for one audience band and one language.

    The pair `(audience, locale)` is what CONCEPTS-BRIEF.md calls a **page** — not a table, a key
    the articles share. Several articles may hold the same key, and they are peers: the page shows
    one in full and lists the rest, ordered pinned-first and then by how recently each one's head
    was published. "Write your own article" and "Edit this article" are two different actions, and
    keeping them different is what stops a disagreement about wording from becoming an edit war.
    """

    concept = models.ForeignKey(Concept, related_name='articles', on_delete=models.CASCADE)
    audience = models.CharField(
        max_length=12, choices=AUDIENCE_CHOICES, default=DEFAULT_AUDIENCE, db_index=True
    )
    #: Lower-cased on save. A free string rather than an enum tied to Paraglide's list, for the
    #: reason root CLAUDE.md gives: content language and interface language are separate axes, and
    #: the content one is unbounded.
    locale = models.CharField(max_length=8)
    #: The author of the article — and, per CONCEPTS-BRIEF.md §0, its first reviewer: the person who
    #: wrote a text is the natural first reader of a change to it (`exercises.entries
    #: .can_decide_entry_suggestion` is the same call for a solution entry).
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='concept_articles',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    #: Staff and governors only (`access.can_pin`) — the `SolutionEntry.pinned` lever, for the same
    #: job: saying which of several good answers a reader should see first.
    pinned = models.BooleanField(default=False)

    # The two names the reports machinery already expects (`moderation.services
    # .resolve_report_decision` looks for exactly these, and finding them is the whole of what makes
    # `concept_article` a reportable kind).
    is_removed = models.BooleanField(default=False)
    auto_hidden_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['concept', 'audience', 'locale', '-pinned', 'id']

    def __str__(self) -> str:
        return f'{self.concept.slug} [{self.audience}/{self.locale}] #{self.pk}'

    def save(self, *args, **kwargs):
        self.locale = (self.locale or '').strip().lower()
        super().save(*args, **kwargs)

    def is_visible_to_readers(self) -> bool:
        """The half of the visibility question that needs no caller — `access.can_view_article` is
        the whole answer. Same name and same shape as `SolutionEntry` and `activity.Post`, because
        `activity/signals.py` and the report queue both ask for it by that name."""
        return not self.is_removed and self.auto_hidden_at is None


class ConceptRevision(models.Model):
    """One immutable attempt at an article's content.

    Immutable is the load-bearing word: a `draft` is mutable and is the one row in this app that may
    be hard-deleted, and everything after submit is fixed except its own decision fields. That is
    what makes the history real, what makes a change reviewable against a known basis, and what
    makes a stale save detectable at all — `based_on` records which head this was written against,
    and submitting against anything else is a 409 carrying the head that landed underneath.
    """

    article = models.ForeignKey(ConceptArticle, related_name='revisions', on_delete=models.CASCADE)
    #: 1-based per article, allocated max+1 in a bounded retry loop (`services.allocate_number`)
    #: rather than by a bare read-then-insert — backend/CLAUDE.md's SQLite rule 3.
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=REVISION_STATUS_CHOICES, default='draft')

    title = models.CharField(max_length=MAX_TITLE_LENGTH)
    #: Plain text: sanitized and then flattened in `save()`. It is what a card, a search result and
    #: a queue row show, none of which render markup, and a summary that could carry a tag would be
    #: markup rendered in three places that never asked for any.
    summary = models.CharField(max_length=MAX_SUMMARY_LENGTH, blank=True)
    #: The ordered block list — `blocks.py` is the one place that says what may be in it.
    blocks = models.JSONField(default=list, blank=True)
    #: `blocks.plain_text(blocks)`, written in `save()`. What `?q=` searches beside title and
    #: summary, so a phrase inside a paragraph (or inside a formula) is findable without the list
    #: endpoint having to open the JSON column per row.
    search_text = models.TextField(blank=True, editable=False)
    #: What changed and why, in the author's own words — the one line a reviewer reads before the
    #: diff. Short on purpose: it is a line in a history list, not a second summary.
    change_note = models.CharField(max_length=500, blank=True)
    #: The article head this was written against; None for revision 1. SET_NULL rather than CASCADE
    #: because the basis being deleted must not take the work with it, and a null still reads
    #: correctly as "we no longer know what this was written against".
    based_on = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='concept_revisions',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    submitted_at = models.DateTimeField(null=True, blank=True)

    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['article', 'number']
        constraints = [
            models.UniqueConstraint(
                fields=['article', 'number'], name='unique_revision_number_per_article'
            ),
            # One published row per article — the same partial-index shape `ExerciseTranslation`
            # and `coauthoring.MaterialVersion` use. Publishing therefore has to supersede FIRST
            # and claim second, never both `published` at once: `moderation/views.py
            # _publish_translation` records the deterministic 500 the opposite order produced.
            models.UniqueConstraint(
                fields=['article'],
                condition=models.Q(status='published'),
                name='one_published_revision_per_article',
            ),
        ]

    def __str__(self) -> str:
        return f'revision {self.number} of article {self.article_id} [{self.status}]'

    def save(self, *args, **kwargs):
        """Sanitize here, not in a serializer.

        The API is a second entry point and the admin, the seed command and any future write path
        are more; a rule that lives in a serializer is a rule exactly one of them follows. `blocks`
        goes through `sanitize_blocks` (the half of `clean_blocks` that neither raises nor queries —
        the request path has already refused a malformed list with a 400) and `search_text` is
        derived from the result, so the two can never disagree about what this revision says.
        """
        from config.sanitize import sanitize_content

        from .blocks import plain_text, sanitize_blocks

        self.title = sanitize_content(self.title or '')[:MAX_TITLE_LENGTH]
        self.summary = _flatten(self.summary)[:MAX_SUMMARY_LENGTH]
        self.blocks = sanitize_blocks(self.blocks)
        self.search_text = plain_text(self.blocks)
        super().save(*args, **kwargs)

    def is_visible_to_readers(self) -> bool:
        """The two statuses an ordinary reader may see. A draft belongs to its author, and a pending
        or rejected revision to its author and the people who may decide it — `access
        .can_view_revision` is where that full answer lives; this is the half that needs no caller.
        """
        return self.status in ('published', 'superseded')


def _flatten(value: str | None) -> str:
    import re

    from config.sanitize import sanitize_content

    return re.sub(r'<[^>]+>', '', sanitize_content(value or '')).strip()


class ConceptAsset(models.Model):
    """A picture or a PDF placed as a block.

    **Never the bytes that were uploaded** (house rule 7). The processing is
    `community.attachments.process_attachment` called as-is rather than copied: a picture is decoded
    and re-encoded to WebP with its EXIF discarded, a PDF is sniffed, size-capped and scanned when a
    daemon exists, and anything else is refused. Reusing that function means the day this platform
    changes what it accepts, it changes here too.

    **There is no DELETE endpoint**, for the same reason `community.InlineImage` and
    `chem.ChemDrawing` have none: a block inside a published revision must keep resolving, and a
    revision is history that is kept rather than rewritten. The space is bounded by the shared
    per-account allowance instead (`community.attachments.used_upload_bytes`, which counts these).
    """

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='concept_assets', on_delete=models.CASCADE
    )
    kind = models.CharField(max_length=5, choices=ASSET_KIND_CHOICES)
    file = models.FileField(upload_to=asset_upload_path)
    #: Display only, and kept at 120 characters: the uploader's filename is untrusted input, so it
    #: is data in a column and never part of a path.
    original_name = models.CharField(max_length=120, blank=True)
    size_bytes = models.PositiveIntegerField(default=0)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.kind} #{self.pk} by {self.uploaded_by_id}'


class ConceptLink(models.Model):
    """A concept pointing at an exercise, a material or another concept.

    Two origins, and the difference is what somebody may do about the row. A `manual` link was filed
    by a person and can be unfiled by the person who filed it, staff or a governor. A `body` link
    was harvested from a `[[slug]]` in a published article, and removing it by hand would be a lie
    the next publication corrects — so it is refused, with `body_origin` as the reason, and the way
    to remove one is to edit the sentence that says it.

    One row per (concept, target), whatever the relation: two people linking the same exercise with
    different words is one link with one answer, not two rows a reader has to reconcile.
    """

    concept = models.ForeignKey(Concept, related_name='links', on_delete=models.CASCADE)
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    relation = models.CharField(max_length=12, choices=RELATION_CHOICES, default='related')
    origin = models.CharField(max_length=8, choices=ORIGIN_CHOICES, default='manual')
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['relation', 'id']
        constraints = [
            models.UniqueConstraint(
                fields=['concept', 'content_type', 'object_id'], name='one_link_per_target'
            ),
        ]
        indexes = [
            # "Which concepts point at exercise 5?" is the chip row on every exercise and material
            # page, so it is the one read this table has to be fast at.
            models.Index(fields=['content_type', 'object_id']),
        ]

    def __str__(self) -> str:
        return f'{self.concept.slug} -{self.relation}-> {self.content_type_id}:{self.object_id}'

    def clean(self):
        """`prerequisite` means "know this first", which only another concept can be, and a concept
        is never a prerequisite of itself.

        Enforced here AND in `services.add_link` (which answers 400 with a reason) rather than as a
        DB constraint: the first half needs a `ContentType` lookup that a `CheckConstraint` cannot
        do, and the second is about two columns whose comparison depends on which content type the
        row carries.
        """
        concept_ct = ContentType.objects.get_for_model(Concept)
        if self.relation == 'prerequisite' and self.content_type_id != concept_ct.pk:
            raise ValidationError(
                {'relation': 'Only another concept can be a prerequisite.'}
            )
        if self.content_type_id == concept_ct.pk and self.object_id == self.concept_id:
            raise ValidationError({'object_id': 'A concept cannot link to itself.'})
