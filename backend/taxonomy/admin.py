from django.contrib import admin

from .models import (
    Branch,
    BranchTranslation,
    Chapter,
    ChapterTranslation,
    Discipline,
    DisciplineTranslation,
    Subtopic,
    SubtopicTranslation,
    Topic,
    TopicTranslation,
)


class DisciplineTranslationInline(admin.TabularInline):
    model = DisciplineTranslation
    extra = 0


@admin.register(Discipline)
class DisciplineAdmin(admin.ModelAdmin):
    list_display = ['slug', 'published']
    inlines = [DisciplineTranslationInline]


class BranchTranslationInline(admin.TabularInline):
    model = BranchTranslation
    extra = 0


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ['slug', 'discipline', 'published', 'order']
    list_filter = ['discipline', 'published']
    inlines = [BranchTranslationInline]


class TopicTranslationInline(admin.TabularInline):
    model = TopicTranslation
    extra = 0


class SubtopicInline(admin.TabularInline):
    model = Subtopic
    extra = 0


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ['slug', 'branch', 'order']
    list_filter = ['branch']
    inlines = [TopicTranslationInline, SubtopicInline]


class SubtopicTranslationInline(admin.TabularInline):
    model = SubtopicTranslation
    extra = 0


@admin.register(Subtopic)
class SubtopicAdmin(admin.ModelAdmin):
    list_display = ['slug', 'topic', 'order']
    list_filter = ['topic__branch']
    inlines = [SubtopicTranslationInline]


class ChapterTranslationInline(admin.TabularInline):
    model = ChapterTranslation
    extra = 0


@admin.register(Chapter)
class ChapterAdmin(admin.ModelAdmin):
    list_display = ['branch', 'number', 'start_page']
    list_filter = ['branch']
    inlines = [ChapterTranslationInline]
