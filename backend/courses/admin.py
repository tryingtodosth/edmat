from django.contrib import admin

from .models import Chapter, Enrollment, Lesson, Course


class ChapterInline(admin.TabularInline):
    """Chapters, not lessons — a lesson hangs off a chapter now, so it is one level too deep to
    inline here. `ChapterAdmin` below carries its own lessons."""

    model = Chapter
    extra = 0


class LessonInline(admin.TabularInline):
    model = Lesson
    extra = 0


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    # The two limits an administrator actually sets — seats and stored bytes — are editable from the
    # changelist, so capping a handful of courses is one screen and one Save rather than a round
    # trip through each course's own form. `uploaded_bytes` sits beside the quota because a quota
    # with nothing to compare it against is a number you cannot choose sensibly.
    list_display = [
        'title',
        'instructor',
        'visibility',
        'status',
        'enrollment_policy',
        'capacity',
        'upload_quota_bytes',
        'uploaded_mb',
    ]
    list_editable = ['capacity', 'upload_quota_bytes']
    list_filter = ['visibility', 'status', 'enrollment_policy', 'language']
    search_fields = ['title', 'instructor__username']
    inlines = [ChapterInline]

    @admin.display(description='Used (MB)')
    def uploaded_mb(self, obj):
        return round(obj.uploaded_bytes / (1024 * 1024), 1)


@admin.register(Chapter)
class ChapterAdmin(admin.ModelAdmin):
    list_display = ['course', 'title', 'order', 'unlocks_at']
    list_filter = ['course']
    inlines = [LessonInline]


@admin.register(Enrollment)
class EnrollmentAdmin(admin.ModelAdmin):
    list_display = ['course', 'participant', 'status', 'requested_at', 'decided_at']
    list_filter = ['status']
    search_fields = ['course__title', 'participant__username']
