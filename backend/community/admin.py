from django.contrib import admin

from .models import Comment, CommentRevision, Review


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
