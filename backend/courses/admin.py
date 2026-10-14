from django.contrib import admin

from .models import (
    Attachment,
    AttachmentReview,
    Chapter,
    ChapterReview,
    Course,
    CourseClaim,
    CourseClaimImportanceVote,
    CourseClaimVote,
    CourseCompletion,
    CourseInvite,
    CourseItem,
    CourseNote,
    CourseStaff,
    Enrollment,
    Lesson,
    LessonExerciseSet,
    LessonProgress,
    LessonReview,
    LessonSetExercise,
)


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
    list_filter = ['kind', 'visibility', 'status', 'enrollment_policy', 'language']
    search_fields = ['title', 'instructor__username', 'university', 'course_code']
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


# ---- registered 2026-10-08 (owner: *"django admin lacks funcionalities"*) ----------------------
# Sixteen of this app's nineteen models had no admin page at all. Every FK to a person or to a
# course is `raw_id_fields`: a select holding every account is both slow and a way to pick the
# wrong one.


@admin.register(Lesson)
class LessonAdmin(admin.ModelAdmin):
    list_display = ['title', 'chapter', 'order', 'scheduled_at', 'duration_minutes']
    search_fields = ['title', 'description']
    raw_id_fields = ['chapter']


@admin.register(CourseStaff)
class CourseStaffAdmin(admin.ModelAdmin):
    list_display = ['course', 'user', 'role', 'added_by', 'added_at']
    list_filter = ['role']
    search_fields = ['course__title', 'user__username']
    raw_id_fields = ['course', 'user', 'added_by']


@admin.register(CourseItem)
class CourseItemAdmin(admin.ModelAdmin):
    """One row per thing put into a course, whatever kind it is — and its `status`, which is the
    queue a curator decides on."""

    list_display = ['course', 'status', 'lesson', 'chapter', 'order', 'submitted_by', 'decided_by', 'decided_at']
    list_filter = ['status']
    search_fields = ['course__title', 'note', 'decision_note']
    raw_id_fields = ['course', 'lesson', 'chapter', 'material', 'exercise', 'attachment', 'event', 'discussion', 'submitted_by', 'decided_by']


@admin.register(CourseInvite)
class CourseInviteAdmin(admin.ModelAdmin):
    """`revoked_at` rather than a delete (house rule 12) — a revoked invite is a decision, and the
    link people were given has to keep resolving to "no longer valid" rather than to nothing."""

    list_display = ['course', 'label', 'role', 'uses', 'max_uses', 'expires_at', 'revoked_at', 'created_by']
    list_filter = ['role']
    search_fields = ['label', 'course__title', 'token']
    raw_id_fields = ['course', 'created_by']
    readonly_fields = ['token', 'uses', 'created_at']


@admin.register(CourseNote)
class CourseNoteAdmin(admin.ModelAdmin):
    """A person's PRIVATE notes. Listed without the body on purpose: an operator may legitimately
    need to know a note exists (a quota question, a deletion request) and has no business reading
    one from a changelist."""

    list_display = ['author', 'course', 'lesson', 'updated_at']
    search_fields = ['author__username', 'course__title']
    raw_id_fields = ['author', 'course', 'lesson']


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ['title', 'course', 'uploaded_by', 'created_at']
    search_fields = ['title', 'description', 'course__title']
    raw_id_fields = ['course', 'uploaded_by']


@admin.register(AttachmentReview)
class AttachmentReviewAdmin(admin.ModelAdmin):
    list_display = ['attachment', 'author', 'rating', 'created_at']
    list_filter = ['rating']
    search_fields = ['body', 'author__username']
    raw_id_fields = ['attachment', 'author']


@admin.register(LessonReview)
class LessonReviewAdmin(admin.ModelAdmin):
    list_display = ['lesson', 'author', 'rating', 'created_at']
    list_filter = ['rating']
    search_fields = ['body', 'author__username']
    raw_id_fields = ['lesson', 'author']


@admin.register(ChapterReview)
class ChapterReviewAdmin(admin.ModelAdmin):
    list_display = ['chapter', 'author', 'rating', 'created_at']
    list_filter = ['rating']
    search_fields = ['body', 'author__username']
    raw_id_fields = ['chapter', 'author']


class LessonSetExerciseInline(admin.TabularInline):
    model = LessonSetExercise
    extra = 0
    raw_id_fields = ['exercise']
    ordering = ['order']


@admin.register(LessonExerciseSet)
class LessonExerciseSetAdmin(admin.ModelAdmin):
    """A set linked into a lesson, and `refreshed_at` — the moment somebody last pulled the saved
    set's current contents in. The exercises are a COPY, which is why they are an inline here."""

    list_display = ['title', 'lesson', 'chapter', 'exercise_set', 'order', 'linked_by', 'refreshed_at']
    search_fields = ['title', 'note']
    raw_id_fields = ['lesson', 'chapter', 'exercise_set', 'linked_by']
    inlines = [LessonSetExerciseInline]


@admin.register(LessonSetExercise)
class LessonSetExerciseAdmin(admin.ModelAdmin):
    list_display = ['link', 'exercise', 'order']
    raw_id_fields = ['link', 'exercise']


@admin.register(LessonProgress)
class LessonProgressAdmin(admin.ModelAdmin):
    list_display = ['participant', 'lesson', 'status', 'updated_at']
    list_filter = ['status']
    search_fields = ['participant__username']
    raw_id_fields = ['lesson', 'participant']


@admin.register(CourseCompletion)
class CourseCompletionAdmin(admin.ModelAdmin):
    """A certificate. `revoked_at` rather than a delete: the certificate's own page has to keep
    resolving, saying it was withdrawn, for anybody holding the link."""

    list_display = ['participant', 'course', 'issued_by', 'issued_at', 'revoked_at']
    search_fields = ['participant__username', 'course__title', 'note']
    raw_id_fields = ['course', 'participant', 'issued_by']


@admin.register(CourseClaim)
class CourseClaimAdmin(admin.ModelAdmin):
    """`level` is the claim; the votes beside it are what the community thinks of it. Neither is
    recomputed here — the score is derived by `materials/claims.py` and this page only shows the
    inputs."""

    list_display = ['course', 'kind', 'topic', 'subtopic', 'level', 'proposed_by', 'created_at']
    list_filter = ['kind']
    search_fields = ['course__title', 'subtopic']
    raw_id_fields = ['course', 'topic', 'proposed_by']


@admin.register(CourseClaimVote)
class CourseClaimVoteAdmin(admin.ModelAdmin):
    list_display = ['claim', 'voter', 'value', 'created_at']
    list_filter = ['value']
    raw_id_fields = ['claim', 'voter']


@admin.register(CourseClaimImportanceVote)
class CourseClaimImportanceVoteAdmin(admin.ModelAdmin):
    list_display = ['claim', 'voter', 'value', 'created_at']
    list_filter = ['value']
    raw_id_fields = ['claim', 'voter']
