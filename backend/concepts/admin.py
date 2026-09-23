"""Read-mostly admin for concepts.

Registered so a staff account can find a row and see its real text when something has gone wrong —
the same reason every other app here registers its models. Deliberately thin: every state change in
this app goes through `services.py`, which is where the claims, the notifications, the feed rows and
the audit entries live, and an admin action that moved a status directly would skip all four.
"""

from django.contrib import admin

from .models import Concept, ConceptArticle, ConceptAsset, ConceptLink, ConceptRevision


@admin.register(Concept)
class ConceptAdmin(admin.ModelAdmin):
    list_display = ('slug', 'created_by', 'created_at', 'updated_at')
    search_fields = ('slug',)
    filter_horizontal = ('branches', 'tags')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(ConceptArticle)
class ConceptArticleAdmin(admin.ModelAdmin):
    list_display = ('id', 'concept', 'audience', 'locale', 'pinned', 'is_removed', 'created_by')
    list_filter = ('audience', 'locale', 'pinned', 'is_removed')
    search_fields = ('concept__slug',)
    raw_id_fields = ('concept', 'created_by')


@admin.register(ConceptRevision)
class ConceptRevisionAdmin(admin.ModelAdmin):
    list_display = ('id', 'article', 'number', 'status', 'title', 'created_by', 'published_at')
    list_filter = ('status',)
    search_fields = ('title', 'summary')
    raw_id_fields = ('article', 'based_on', 'created_by', 'reviewed_by')
    readonly_fields = ('search_text',)


@admin.register(ConceptAsset)
class ConceptAssetAdmin(admin.ModelAdmin):
    list_display = ('id', 'kind', 'original_name', 'size_bytes', 'uploaded_by', 'created_at')
    list_filter = ('kind',)
    raw_id_fields = ('uploaded_by',)


@admin.register(ConceptLink)
class ConceptLinkAdmin(admin.ModelAdmin):
    list_display = ('id', 'concept', 'relation', 'origin', 'content_type', 'object_id')
    list_filter = ('relation', 'origin')
    raw_id_fields = ('concept', 'added_by')
