from django.contrib import admin

from .models import (
    Material,
    MaterialCoverage,
    MaterialCoverageVote,
    MaterialRequirement,
    MaterialTranslation,
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
