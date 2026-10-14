from django.contrib import admin

from .models import (
    Material,
    MaterialCoverage,
    MaterialCoverageImportanceVote,
    MaterialCoverageVote,
    MaterialRequirement,
    MaterialRequirementVote,
    MaterialReview,
    MaterialTranslation,
    MaterialType,
    MaterialTypeTranslation,
    MaterialView,
)


class MaterialTranslationInline(admin.TabularInline):
    model = MaterialTranslation
    extra = 0


class MaterialCoverageInline(admin.TabularInline):
    model = MaterialCoverage
    extra = 0


class MaterialRequirementInline(admin.TabularInline):
    model = MaterialRequirement
    extra = 0


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    # The licence changes only through licensing.rules.change_licence, which records the change and
    # only widens it (a Creative Commons grant is irrevocable) — the admin must not be a way around it.
    readonly_fields = ('licence',)
    list_display = [
        'slug',
        'branch',
        'type',
        'author',
        'published',
        'featured',
        'price_amount',
        'estimated_minutes',
    ]
    list_filter = ['branch', 'type', 'published', 'featured']
    filter_horizontal = ['tags']
    inlines = [MaterialTranslationInline, MaterialCoverageInline, MaterialRequirementInline]


@admin.register(MaterialCoverage)
class MaterialCoverageAdmin(admin.ModelAdmin):
    list_display = ['material', 'topic', 'subtopic', 'level', 'proposed_by', 'created_at']
    list_filter = ['topic__branch']


@admin.register(MaterialCoverageVote)
class MaterialCoverageVoteAdmin(admin.ModelAdmin):
    list_display = ['coverage', 'voter', 'value', 'created_at']
    list_filter = ['value']


# ---- registered 2026-10-08 (owner: *"django admin lacks funcionalities"*) ----------------------


class MaterialTypeTranslationInline(admin.TabularInline):
    model = MaterialTypeTranslation
    extra = 0
    fields = ['locale', 'name']


@admin.register(MaterialType)
class MaterialTypeAdmin(admin.ModelAdmin):
    """A type somebody proposed and a moderator accepted — `status` is that decision, and the name
    lives in the translation rows rather than on the row itself (the project's standing shape:
    text lives in a translation table, including the original)."""

    list_display = ['slug', 'status', 'order', 'proposed_by', 'proposed_at']
    list_filter = ['status']
    search_fields = ['slug', 'translations__name']
    raw_id_fields = ['proposed_by']
    inlines = [MaterialTypeTranslationInline]


@admin.register(MaterialTypeTranslation)
class MaterialTypeTranslationAdmin(admin.ModelAdmin):
    list_display = ['material_type', 'locale', 'name']
    list_filter = ['locale']
    search_fields = ['name']
    raw_id_fields = ['material_type']


@admin.register(MaterialTranslation)
class MaterialTranslationAdmin(admin.ModelAdmin):
    list_display = ['material', 'locale', 'title', 'updated_at']
    list_filter = ['locale']
    search_fields = ['title', 'description']
    raw_id_fields = ['material']


@admin.register(MaterialReview)
class MaterialReviewAdmin(admin.ModelAdmin):
    list_display = ['material', 'author', 'rating', 'created_at']
    list_filter = ['rating']
    search_fields = ['body', 'author__username', 'material__title']
    raw_id_fields = ['material', 'author']


@admin.register(MaterialRequirement)
class MaterialRequirementAdmin(admin.ModelAdmin):
    list_display = ['label', 'material', 'order', 'is_removed']
    list_filter = ['is_removed']
    search_fields = ['label']
    raw_id_fields = ['material']


@admin.register(MaterialRequirementVote)
class MaterialRequirementVoteAdmin(admin.ModelAdmin):
    list_display = ['requirement', 'voter', 'value', 'created_at']
    list_filter = ['value']
    raw_id_fields = ['requirement', 'voter']


@admin.register(MaterialCoverageImportanceVote)
class MaterialCoverageImportanceVoteAdmin(admin.ModelAdmin):
    list_display = ['coverage', 'voter', 'value', 'created_at']
    list_filter = ['value']
    raw_id_fields = ['coverage', 'voter']


@admin.register(MaterialView)
class MaterialViewAdmin(admin.ModelAdmin):
    """One row per person per material opened — the input the view count is RECOUNTED from, never
    incremented (house rule 5). Read-only: editing it would make the count a fiction."""

    list_display = ['material', 'user', 'viewed_at']
    search_fields = ['material__title', 'user__username']
    raw_id_fields = ['material', 'user']
    readonly_fields = ['material', 'user', 'viewed_at']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
