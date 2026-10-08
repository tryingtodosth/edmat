"""The admin for the management layer's text in every language somebody has written it in.

One row per (object, locale). Deliberately NOT `ExerciseTranslation`'s shape — there is no review
workflow here, because the people writing it are the people who already run the thing — so there is
no `status` to filter on and `is_original` is the only flag that matters.
"""

from django.contrib import admin

from .models import TextVersion


@admin.register(TextVersion)
class TextVersionAdmin(admin.ModelAdmin):
    list_display = ('content_type', 'object_id', 'locale', 'is_original', 'written_by', 'updated_at')
    list_filter = ('locale', 'is_original', 'content_type')
    search_fields = ('heading', 'body')
    raw_id_fields = ('written_by',)
    readonly_fields = ('created_at', 'updated_at')
