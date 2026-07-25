from django.contrib import admin

from .models import Comment, Review


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
