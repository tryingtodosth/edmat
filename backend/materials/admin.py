from django.contrib import admin

from .models import Material, MaterialCoverage, MaterialCoverageVote, MaterialTranslation


class MaterialTranslationInline(admin.TabularInline):
    model = MaterialTranslation
    extra = 0


class MaterialCoverageInline(admin.TabularInline):
    model = MaterialCoverage
    extra = 0


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = ['slug', 'course', 'type', 'author', 'published', 'featured']
    list_filter = ['course', 'type', 'published', 'featured']
    inlines = [MaterialTranslationInline, MaterialCoverageInline]


@admin.register(MaterialCoverage)
class MaterialCoverageAdmin(admin.ModelAdmin):
    list_display = ['material', 'topic', 'subtopic', 'level', 'proposed_by', 'created_at']
    list_filter = ['topic__course']


@admin.register(MaterialCoverageVote)
class MaterialCoverageVoteAdmin(admin.ModelAdmin):
    list_display = ['coverage', 'voter', 'value', 'created_at']
    list_filter = ['value']
