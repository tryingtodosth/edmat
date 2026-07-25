from django.contrib import admin

from .models import (
    Chapter,
    ChapterTranslation,
    Course,
    CourseTranslation,
    Field,
    FieldTranslation,
    Subtopic,
    SubtopicTranslation,
    Topic,
    TopicTranslation,
)


class FieldTranslationInline(admin.TabularInline):
    model = FieldTranslation
    extra = 0


@admin.register(Field)
class FieldAdmin(admin.ModelAdmin):
    list_display = ['slug', 'published']
    inlines = [FieldTranslationInline]


class CourseTranslationInline(admin.TabularInline):
    model = CourseTranslation
    extra = 0


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ['slug', 'field', 'university', 'published', 'order']
    list_filter = ['field', 'published']
    inlines = [CourseTranslationInline]


class TopicTranslationInline(admin.TabularInline):
    model = TopicTranslation
    extra = 0


class SubtopicInline(admin.TabularInline):
    model = Subtopic
    extra = 0


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ['slug', 'course', 'order']
    list_filter = ['course']
    inlines = [TopicTranslationInline, SubtopicInline]


class SubtopicTranslationInline(admin.TabularInline):
    model = SubtopicTranslation
    extra = 0


@admin.register(Subtopic)
class SubtopicAdmin(admin.ModelAdmin):
    list_display = ['slug', 'topic', 'order']
    list_filter = ['topic__course']
    inlines = [SubtopicTranslationInline]


class ChapterTranslationInline(admin.TabularInline):
    model = ChapterTranslation
    extra = 0


@admin.register(Chapter)
class ChapterAdmin(admin.ModelAdmin):
    list_display = ['course', 'number', 'start_page']
    list_filter = ['course']
    inlines = [ChapterTranslationInline]
