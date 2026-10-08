"""The management layer's text, in every language somebody has written it in.

Built for the owner's instruction of 2026-10-08: *"all of the tasks and other project management
stuff should be bilingual: User sees the version in their UI language by default, if there's a
newer version in a different language it says how much newer."*

**What was wrong before this.** A task, a plan, a need and a poll each had ONE `title` and ONE
`description`, so the only way to be bilingual was by hand, in the field — which is exactly what
`work/edmat_project.py: _pl_en()` did: it glued the Polish and the English together with a `/` and
a `---` rule, and every reader of `/about` got both languages at once whichever one they had
chosen. That is the content axis of the root CLAUDE.md's i18n rule ("two separate axes,
deliberately") done by hand in a single column.

## Why this is NOT `ExerciseTranslation`'s shape

`ExerciseTranslation` is a per-model table with a `status`, because a stranger's translation of a
corpus exercise is a SUBMISSION that a moderator decides on. Management text is not: the owner's
instruction is that *"mods/admins can edit and submit edit/new stuff"* — the people writing it are
the people who already run the thing, and `tasks.rules.can_edit` (and its three siblings) is
already the right answer to "may you write this". So there is no review queue here and no `status`
field, and one table serves six models through a `GenericForeignKey` plus a registry
(`targets.py`) rather than six near-identical tables in four apps.

## Why the model's own column survives

`Task.title` is NOT dropped and NOT emptied. The original's text is written through to it on every
save, so it stays what it always was: the row's own text, in its original language. That keeps
every existing reader of it correct and untouched — the work dashboard, notification bodies, the
activity feed, an export, a `__str__`, Django admin — none of which has any idea this app exists.
This table is the ADDITION that lets a page that does know resolve a better answer for its reader.

A target with no rows here therefore behaves exactly as it did before this app existed, which is
what makes the whole change additive: nothing had to be migrated, and nothing had to guess what
language a task written in 2026-09 was in.
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models


class TextVersion(models.Model):
    """One management row's text in one language.

    `is_original` marks the language it was WRITTEN in — the one the model's own column mirrors,
    and the fallback for a reader whose language nobody has written yet. At most one per target,
    enforced by a partial unique constraint rather than by `unique_together`, which is the
    `ExerciseTranslation` precedent and for the related reason: a plain `unique_together` across
    (target, is_original) would make the FALSE rows unique too and so allow exactly one
    translation, which is the opposite of the point.

    `heading` and `body` are named for their SHAPE and not for any one model's field, because the
    six targets call them four different things (`title`/`description`, `question`/`description`,
    and a poll option's bare `text`). `targets.py` holds the mapping, in one place, and
    `heading`/`body` are both blank-able because a poll option has no body at all.
    """

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    #: A free string, not an enum — the same decision the root CLAUDE.md records for content
    #: locales: "`locale` is a free string, not an enum tied to Paraglide's list", so a third
    #: language needs no migration here.
    locale = models.CharField(max_length=8)
    is_original = models.BooleanField(default=False)
    heading = models.TextField(blank=True)
    body = models.TextField(blank=True)
    written_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)
    #: What the staleness reading is computed from — "the Polish is 4 minutes newer than the
    #: English you are reading".
    #:
    #: Deliberately NOT `auto_now`. `services.write_versions` stamps every language it writes with
    #: ONE timestamp, so two languages written together are exactly equal and `resolve` has nothing
    #: to report — which is the property the owner asked for in as many words (*"so that if a user
    #: translates and edit/update/new content, there's no sth like “newer in PL by 4 minutes”"*).
    #: Under `auto_now` the two rows would save microseconds apart, and the reading would say "newer
    #: by 0 minutes" on content that had just been written in one go.
    updated_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['content_type', 'object_id', 'locale'],
                name='one_text_version_per_locale',
            ),
            models.UniqueConstraint(
                fields=['content_type', 'object_id'],
                condition=models.Q(is_original=True),
                name='one_original_text_version',
            ),
        ]
        indexes = [models.Index(fields=['content_type', 'object_id'])]
        ordering = ['locale']

    def __str__(self) -> str:
        mark = ' (original)' if self.is_original else ''
        return f'{self.locale}{mark} text for {self.target!r}'

    def save(self, *args, **kwargs):
        # The BODY gets the one-choke-point server-side sanitization every other user-written body
        # gets — house rule 8, sanitize on write as well as on read, because the API is a second
        # independent entry point.
        #
        # The HEADING deliberately does not, and that is not an oversight. It is a plain-text field
        # everywhere it is read (a title, a poll's question, an option's line) and it mirrors onto
        # `Task.title` / `Plan.title` / `Need.title` / `Poll.question`, none of which has ever been
        # sanitized in this codebase — they are rendered through `MathTitle`, which sanitizes on
        # read. Running `bleach` over one does not strip anything useful; it ENTITY-ESCAPES, so
        # `i18n & content` became `i18n &amp; content`, which a reader then sees literally. It also
        # broke the EdMat seed's idempotence: the seed looks its rows up by title, the mirrored
        # title no longer matched the one in the file, and a second run created a duplicate of every
        # plan step whose heading contained an `&`. Ten of them, found by running the seed twice.
        from config.sanitize import sanitize_content

        self.body = sanitize_content(self.body)
        super().save(*args, **kwargs)
