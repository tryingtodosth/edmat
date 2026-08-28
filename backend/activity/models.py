"""The activity feed's storage (root CLAUDE.md §17AI): a PUBLIC-BY-CONSTRUCTION event log, and the
anchored micro-posts that feed into it.

**`ActivityEvent` is not an audit log, and must never become a filtered view of one** — an owner
decision made explicitly against that alternative (2026-08-27). An audit log wants completeness
(rejections and their notes, private-course activity, deletions) and permanence; a feed wants
curation and the ability to forget. If the feed were "the log, filtered", every private thing in
the log would be one missing WHERE clause away from public — the exact failure
`PublicProfileSerializer` was rewritten to make impossible for profiles. So the rule here is the
inverse: a row is only ever WRITTEN for an event that is public the instant it happens
(`services.record_activity` is the one chokepoint), rows are DELETED when their content stops
being public (`services.remove_activity_for`, wired into auto-hide and moderator removal), and the
table trims itself to a retention window (`services.FEED_RETENTION_DAYS`) because the feed is
ambient discovery, not the historical record — profiles and the source tables remain the record.

**`Post`** is the owner's "Twitter-like, but educational by construction" call: your words, plus a
REQUIRED anchor — exactly one discipline, branch, or tag — so every post lives under a topic area
and the feed filtered by that anchor serves as the thread around it; plus an optional reference to
an exercise/material/course, and an optional image (re-encoded, never the uploaded bytes — see
postimage.py). Deliberately NOT free-form standalone posts: the anchor is what keeps this a pulse
on EdMat's topic areas rather than a general social timeline, and the reference (when present) is
what gives the report system's auto-hide a real viewer pool to measure against.
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

from .postimage import validate_activity_post_image

ACTIVITY_KIND_CHOICES = [
    ('exercise', 'New exercise'),
    ('material', 'New material'),
    ('solution_entry', 'New solution/hint'),
    ('translation', 'New translation'),
    ('course', 'New course'),
    ('event', 'New event'),
    ('service', 'New tutoring listing'),
    ('post', 'New post'),
    ('review', 'New review'),
    ('claim', 'New claim'),
    ('comment', 'New comment'),
]


class ActivityEvent(models.Model):
    kind = models.CharField(max_length=20, choices=ACTIVITY_KIND_CHOICES)
    # 'hint' | 'solution' for kind='solution_entry'; blank otherwise.
    entry_kind = models.CharField(max_length=10, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        related_name='activity_events',
        on_delete=models.CASCADE,
    )
    # Denormalized at write time (the notify()/targetLabel pattern): what the row is about, in the
    # words the reader should see. Deliberately captured once — the feed is ephemeral, and a title
    # edited later simply reads slightly stale until the row ages out.
    target_label = models.CharField(max_length=300, blank=True)

    # WHERE the reader goes — nullable typed links, CASCADE so a hard delete of the target takes
    # its feed rows with it for free. At most one is set per row (by construction in
    # record_activity, not a DB constraint — the chokepoint is the contract).
    exercise = models.ForeignKey(
        'exercises.Exercise', null=True, blank=True, related_name='+', on_delete=models.CASCADE
    )
    material = models.ForeignKey(
        'materials.Material', null=True, blank=True, related_name='+', on_delete=models.CASCADE
    )
    course = models.ForeignKey(
        'courses.Course', null=True, blank=True, related_name='+', on_delete=models.CASCADE
    )
    # The one-off `events.Event` — field named for the reader ("happening"), not the model, since
    # `event` on a model called ActivityEvent would read as self-reference.
    happening = models.ForeignKey(
        'events.Event', null=True, blank=True, related_name='+', on_delete=models.CASCADE
    )
    service = models.ForeignKey(
        'services.Service', null=True, blank=True, related_name='+', on_delete=models.CASCADE
    )
    post = models.ForeignKey(
        'activity.Post', null=True, blank=True, related_name='+', on_delete=models.CASCADE
    )

    # WHAT PRODUCED the row, precisely — the generic source is what lets `remove_activity_for(obj)`
    # delete exactly one comment's/review's/entry's rows when that specific thing is removed,
    # without a typed FK per producible kind. Nullable: a backfilled row may predate the idea.
    source_content_type = models.ForeignKey(
        ContentType, null=True, blank=True, related_name='+', on_delete=models.CASCADE
    )
    source_object_id = models.PositiveIntegerField(null=True, blank=True)
    source = GenericForeignKey('source_content_type', 'source_object_id')

    # Scoping for the feed's filters and the Followed view. `branch` covers most kinds (an
    # exercise's own branch); `discipline` exists separately because a Post may anchor to a
    # discipline directly, with no branch. `tags` (a real M2M, not a JSON list) is what makes
    # "followed tags" a database filter rather than a Python scan.
    branch = models.ForeignKey(
        'taxonomy.Branch', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    discipline = models.ForeignKey(
        'taxonomy.Discipline', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    # A topic-anchored post's own scope — what makes `?topic=` a database filter. Content events
    # don't set this (an exercise's topics reach the topic feed through `exercise__topics` in the
    # read query instead of denormalizing an M2M here).
    topic = models.ForeignKey(
        'taxonomy.Topic', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    tags = models.ManyToManyField('exercises.Tag', blank=True, related_name='+')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-id']
        indexes = [
            models.Index(fields=['kind', '-id']),
            models.Index(fields=['branch', '-id']),
        ]

    def __str__(self) -> str:
        return f'{self.kind}: {self.target_label[:40]}'


def post_image_upload_path(instance, filename: str) -> str:
    """UUID name, extension only — the same "the original filename is untrusted input too"
    reasoning `material_submission_upload_path` documents."""
    import os
    import uuid

    ext = os.path.splitext(filename)[1].lower()
    return f'activity_posts/{uuid.uuid4().hex}{ext}'


class Post(models.Model):
    """One anchored micro-post. Exactly ONE of discipline/branch/tag must be set (a real DB
    CheckConstraint below, not just serializer validation — the anchor is the feature's whole
    frame, so the database refuses an unanchored or doubly-anchored row no matter which write path
    produced it). The content reference is optional and at most one; when it names an exercise,
    the report system's auto-hide measures against that exercise's viewer pool — otherwise a
    reported post waits for a human, honestly (the same no-viewer-pool posture Service listings
    already have).

    Publishing is immediate (Twitter-like, per the owner's framing) — bounded by a per-account
    throttle (`post_create` scope) and the `posts` kill switch rather than a review queue.
    `is_removed` is the tombstone; `auto_hidden_at` the community trip-wire."""

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='activity_posts', on_delete=models.CASCADE
    )
    body = models.TextField()
    image = models.ImageField(
        upload_to=post_image_upload_path, blank=True, validators=[validate_activity_post_image]
    )

    # The required anchor — exactly one. `topic` joined the original three (2026-08-28, the
    # "covers/requires chips open the thread about that topic" ask): a claim chip names a TOPIC,
    # and the feed filtered to an anchor is the page those chips open — so topics had to be
    # anchorable or the chips had nowhere to send anyone.
    discipline = models.ForeignKey(
        'taxonomy.Discipline', null=True, blank=True, related_name='posts', on_delete=models.CASCADE
    )
    branch = models.ForeignKey(
        'taxonomy.Branch', null=True, blank=True, related_name='posts', on_delete=models.CASCADE
    )
    tag = models.ForeignKey(
        'exercises.Tag', null=True, blank=True, related_name='posts', on_delete=models.CASCADE
    )
    topic = models.ForeignKey(
        'taxonomy.Topic', null=True, blank=True, related_name='posts', on_delete=models.CASCADE
    )

    # The optional content reference — at most one. SET_NULL: deleting the referenced thing
    # orphans the reference, never the words somebody wrote around it.
    ref_exercise = models.ForeignKey(
        'exercises.Exercise', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    ref_material = models.ForeignKey(
        'materials.Material', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    ref_course = models.ForeignKey(
        'courses.Course', null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )

    is_removed = models.BooleanField(default=False)
    auto_hidden_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-id']
        constraints = [
            models.CheckConstraint(
                name='post_exactly_one_anchor',
                condition=(
                    (
                        models.Q(discipline__isnull=False)
                        & models.Q(branch__isnull=True)
                        & models.Q(tag__isnull=True)
                        & models.Q(topic__isnull=True)
                    )
                    | (
                        models.Q(discipline__isnull=True)
                        & models.Q(branch__isnull=False)
                        & models.Q(tag__isnull=True)
                        & models.Q(topic__isnull=True)
                    )
                    | (
                        models.Q(discipline__isnull=True)
                        & models.Q(branch__isnull=True)
                        & models.Q(tag__isnull=False)
                        & models.Q(topic__isnull=True)
                    )
                    | (
                        models.Q(discipline__isnull=True)
                        & models.Q(branch__isnull=True)
                        & models.Q(tag__isnull=True)
                        & models.Q(topic__isnull=False)
                    )
                ),
            ),
        ]

    def __str__(self) -> str:
        return f'post by {self.author}: {self.body[:40]}'

    def save(self, *args, **kwargs):
        # The same one-choke-point server-side sanitization every other content write gets.
        from config.sanitize import sanitize_content

        self.body = sanitize_content(self.body)
        super().save(*args, **kwargs)

    def is_visible_to_readers(self) -> bool:
        return not self.is_removed and self.auto_hidden_at is None
