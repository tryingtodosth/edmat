from django.contrib import admin

from .models import (
    Comment,
    CommentAttachment,
    CommentRevision,
    CommentVote,
    DiscussionLocation,
    InlineImage,
    Review,
    SavedComment,
)


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ['exercise', 'author', 'rating', 'is_removed', 'auto_hidden_at', 'created_at']
    list_filter = ['rating', 'is_removed']


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = [
        'author',
        'content_type',
        'object_id',
        'parent',
        'is_removed',
        'auto_hidden_at',
        'created_at',
    ]
    list_filter = ['is_removed', 'content_type']


@admin.register(CommentRevision)
class CommentRevisionAdmin(admin.ModelAdmin):
    """Registered specifically so a real superuser can read a SEALED revision's body somewhere —
    see `CommentRevision`'s own docstring: Django admin (`is_superuser`-gated by the framework
    itself) and `manage.py export_sealed_revision` are the only two intended ways to do that,
    since no API response ever serves one. Every field stays visible, not `readonly_fields`-
    trimmed — the one thing worth restricting here is WHO can open this page at all, which the
    admin site's own permission model already does."""

    list_display = ['comment', 'edited_by', 'created_at', 'hidden_by_moderator_at', 'sealed_at']
    list_filter = ['sealed_at', 'hidden_by_moderator_at']


# Registered 2026-10-08 (owner: *"django admin lacks funcionalities"*). Five tables that existed
# with no admin at all — one of them, `DiscussionLocation`, being the switchboard for every
# standing page's thread.


@admin.register(DiscussionLocation)
class DiscussionLocationAdmin(admin.ModelAdmin):
    """Where talk is allowed, and under what rules.

    This is the one table here with a reach beyond its own rows: a `page`/`section` pair is what
    `/privacy`, `/levels`, `/about` and — since 2026-10-08 — every task, plan, need and poll ask
    before drawing a thread at all. `is_enabled` is editable from the changelist for the same
    reason `FeatureFlagAdmin` makes `is_enabled` editable there: turning talk off on one page is a
    one-click decision somebody makes in a hurry.
    """

    list_display = ['page', 'section', 'is_enabled', 'audience', 'moderated', 'updated_by', 'updated_at']
    list_editable = ['is_enabled', 'moderated']
    list_filter = ['is_enabled', 'moderated', 'audience']
    search_fields = ['page', 'section']
    readonly_fields = ['updated_at']
    raw_id_fields = ['updated_by']


@admin.register(CommentAttachment)
class CommentAttachmentAdmin(admin.ModelAdmin):
    """What came with a comment. `original_name` is the UPLOADER'S name for the file and is
    untrusted input (house rule 7) — it is shown because it is what a person reporting the file
    will call it, and it is not what anything is stored under."""

    list_display = ['comment', 'kind', 'original_name', 'size_bytes', 'created_at']
    list_filter = ['kind']
    search_fields = ['original_name', 'comment__body']
    raw_id_fields = ['comment']
    readonly_fields = ['size_bytes', 'created_at']


@admin.register(InlineImage)
class InlineImageAdmin(admin.ModelAdmin):
    list_display = ['author', 'original_name', 'width', 'height', 'size_bytes', 'created_at']
    search_fields = ['original_name', 'alt', 'author__username']
    raw_id_fields = ['author']
    readonly_fields = ['width', 'height', 'size_bytes', 'created_at']


@admin.register(CommentVote)
class CommentVoteAdmin(admin.ModelAdmin):
    list_display = ['comment', 'voter', 'value', 'created_at']
    list_filter = ['value']
    search_fields = ['voter__username']
    raw_id_fields = ['comment', 'voter']


@admin.register(SavedComment)
class SavedCommentAdmin(admin.ModelAdmin):
    list_display = ['user', 'comment', 'note', 'created_at']
    search_fields = ['user__username', 'note']
    raw_id_fields = ['user', 'comment']
