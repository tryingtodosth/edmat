from django.contrib import admin

from .models import (
    Exercise,
    ExerciseSource,
    ExerciseSourceTranslation,
    ExerciseTranslation,
    SolutionEntry,
    Tag,
    TagFollow,
)


class ExerciseTranslationInline(admin.TabularInline):
    model = ExerciseTranslation
    extra = 0
    fields = ['locale', 'title', 'status', 'translated_by', 'reviewed_by']


class ExerciseSourceInline(admin.StackedInline):
    model = ExerciseSource
    extra = 0


@admin.register(Exercise)
class ExerciseAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'branch', 'number', 'difficulty', 'published', 'verified', 'original_locale']
    list_filter = ['branch', 'difficulty', 'published', 'verified']
    search_fields = ['number']
    filter_horizontal = ['topics', 'tags']
    inlines = [ExerciseSourceInline, ExerciseTranslationInline]


@admin.register(ExerciseSource)
class ExerciseSourceAdmin(admin.ModelAdmin):
    list_display = ['exercise', 'type', 'collection']
    list_filter = ['type']


admin.site.register(ExerciseSourceTranslation)
admin.site.register(ExerciseTranslation)


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ['slug']
    search_fields = ['slug']


@admin.register(TagFollow)
class TagFollowAdmin(admin.ModelAdmin):
    list_display = ['user', 'tag', 'notify', 'created_at']
    list_filter = ['notify']


@admin.register(SolutionEntry)
class SolutionEntryAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'kind', 'locale', 'status', 'pinned', 'author', 'created_at']
    list_filter = ['kind', 'status', 'pinned', 'locale']
    raw_id_fields = ['exercise', 'author', 'reviewed_by']
