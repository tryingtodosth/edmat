"""Snapshot-then-save, kept out of the view so any future write path (not just
`CommentViewSet.partial_update`, the only one that exists today) gets history for free rather than
silently bypassing it — `events.EventPost` has the identical edited_at/is_edited pattern
independently and would be the first candidate to share this.

Wrapped in `transaction.atomic()`, deliberately WITHOUT `select_for_update()` — see
backend/CLAUDE.md's SQLite rules. This app's SQLite backend has no row-level locking at all, and a
`select_for_update()` inside `atomic()` would hold a whole-block write lock for as long as this
function runs, which has already once turned a rare edge case into `database is locked` under real
concurrent requests (CLAUDE.md §17I). The race this guards against — two simultaneous edits of the
same comment, realistically two tabs of the same author — is far lower-stakes than the one that
taught that lesson (a duplicate exercise number): a lost update on your own comment, not a
correctness disaster. `atomic()` alone is fine here because it wraps two fast, adjacent statements
against one table, the same shape `ExerciseSetSerializer.update()` already uses.
"""

from django.db import transaction

from .models import Comment, CommentRevision


def record_revision(comment: Comment, *, edited_by) -> CommentRevision:
    """Snapshot `comment.body` as it stood BEFORE the caller applies a new one. Call this, then
    assign the new body and save — never the other way around, or the snapshot records the
    version that is about to become current instead of the one being superseded."""
    return CommentRevision.objects.create(comment=comment, body=comment.body, edited_by=edited_by)


def apply_comment_edit(comment: Comment, body: str, *, edited_by) -> Comment:
    """The one place `Comment.body` is overwritten after creation. Records the pre-edit body as a
    revision and stamps `edited_at` in the same transaction."""
    from django.utils import timezone

    with transaction.atomic():
        record_revision(comment, edited_by=edited_by)
        comment.body = body
        comment.edited_at = timezone.now()
        comment.save(update_fields=['body', 'edited_at'])
    return comment


def hide_revision(revision: CommentRevision, *, moderator, note: str) -> CommentRevision:
    """Staff-only, one-way. Never touches an already-sealed revision's fields further — sealing is
    the stricter tier and nothing here should look like it could loosen it."""
    from django.utils import timezone

    revision.hidden_by_moderator = moderator
    revision.hidden_by_moderator_at = timezone.now()
    revision.moderator_hide_note = note
    revision.save(update_fields=['hidden_by_moderator', 'hidden_by_moderator_at', 'moderator_hide_note'])
    return revision


def seal_revision(revision: CommentRevision, *, sealed_by, note: str) -> CommentRevision:
    """Superuser-only, one-way, and permanent — see the model's own docstring for why nothing in
    this app ever serves `body` again once this is set."""
    from django.utils import timezone

    revision.sealed_by = sealed_by
    revision.sealed_at = timezone.now()
    revision.seal_note = note
    revision.save(update_fields=['sealed_by', 'sealed_at', 'seal_note'])
    return revision
