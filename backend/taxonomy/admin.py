from django.contrib import admin

from .models import (
    Chapter,
    ChapterTranslation,
    Course,
    CourseTranslation,
    Field,
    FieldTranslation,
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


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ['slug', 'course', 'order']
    list_filter = ['course']
    inlines = [TopicTranslationInline]


class ChapterTranslationInline(admin.TabularInline):
    model = ChapterTranslation
    extra = 0


@admin.register(Chapter)
class ChapterAdmin(admin.ModelAdmin):
    list_display = ['course', 'number', 'start_page']
    list_filter = ['course']
    inlines = [ChapterTranslationInline]
