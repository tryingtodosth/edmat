from django.contrib import admin

from .models import Exercise, ExerciseSource, ExerciseSourceTranslation, ExerciseTranslation, Tag


class ExerciseTranslationInline(admin.TabularInline):
    model = ExerciseTranslation
    extra = 0
    fields = ['locale', 'title', 'status', 'translated_by', 'reviewed_by']


class ExerciseSourceInline(admin.StackedInline):
    model = ExerciseSource
    extra = 0


@admin.register(Exercise)
class ExerciseAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'course', 'number', 'difficulty', 'published', 'verified', 'original_locale']
    list_filter = ['course', 'difficulty', 'published', 'verified']
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
