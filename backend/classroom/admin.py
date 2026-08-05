from django.contrib import admin

from .models import Enrollment, Lesson, TaughtCourse


class LessonInline(admin.TabularInline):
    model = Lesson
    extra = 0


@admin.register(TaughtCourse)
class TaughtCourseAdmin(admin.ModelAdmin):
    list_display = ['title', 'instructor', 'status', 'enrollment_policy', 'capacity']
    list_filter = ['status', 'enrollment_policy', 'language']
    search_fields = ['title', 'instructor__username']
    inlines = [LessonInline]


@admin.register(Enrollment)
class EnrollmentAdmin(admin.ModelAdmin):
    list_display = ['course', 'participant', 'status', 'requested_at', 'decided_at']
    list_filter = ['status']
    search_fields = ['course__title', 'participant__username']
