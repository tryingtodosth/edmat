from django.contrib import admin

from .models import (
    Exercise,
    ExerciseClaim,
    ExerciseClaimImportanceVote,
    ExerciseClaimVote,
    ExerciseMaterialLink,
    ExerciseRequirement,
    ExerciseRequirementVote,
    ExerciseSource,
    ExerciseSourceTranslation,
    ExerciseTranslation,
    SolutionEntry,
    SolutionEntryAttachment,
    SolutionEntryVote,
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
    # The licence changes only through licensing.rules.change_licence, which records the change and
    # only widens it (a Creative Commons grant is irrevocable) — the admin must not be a way around it.
    readonly_fields = ('licence',)
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
    # The licence changes only through licensing.rules.change_licence, which records the change and
    # only widens it (a Creative Commons grant is irrevocable) — the admin must not be a way around it.
    readonly_fields = ('licence',)
    list_display = ['__str__', 'kind', 'locale', 'status', 'pinned', 'author', 'created_at']
    list_filter = ['kind', 'status', 'pinned', 'locale']
    raw_id_fields = ['exercise', 'author', 'reviewed_by']


# ---- registered 2026-10-08 (owner: *"django admin lacks funcionalities"*) ----------------------


@admin.register(ExerciseMaterialLink)
class ExerciseMaterialLinkAdmin(admin.ModelAdmin):
    """"This exercise is worked in that script, at that page." `locator` is the page or section,
    free text because a material is a PDF, a video or a set of notes and none of them number the
    same way."""

    list_display = ['exercise', 'material', 'role', 'locator', 'added_by', 'created_at']
    list_filter = ['role']
    search_fields = ['locator', 'material__title']
    raw_id_fields = ['exercise', 'material', 'added_by']


@admin.register(SolutionEntryAttachment)
class SolutionEntryAttachmentAdmin(admin.ModelAdmin):
    """`original_name` is the uploader's own name for the file and is untrusted input (house rule
    7); what it is stored under is random."""

    list_display = ['entry', 'kind', 'original_name', 'size_bytes', 'order', 'created_at']
    list_filter = ['kind']
    search_fields = ['original_name']
    raw_id_fields = ['entry']
    readonly_fields = ['size_bytes', 'created_at']


@admin.register(SolutionEntryVote)
class SolutionEntryVoteAdmin(admin.ModelAdmin):
    list_display = ['entry', 'voter', 'value', 'created_at']
    list_filter = ['value']
    raw_id_fields = ['entry', 'voter']


@admin.register(ExerciseRequirement)
class ExerciseRequirementAdmin(admin.ModelAdmin):
    """`is_removed` rather than a delete: a requirement people have voted on is a thread of
    opinion, and deleting the row would delete the votes with it."""

    list_display = ['label', 'exercise', 'order', 'is_removed']
    list_filter = ['is_removed']
    search_fields = ['label']
    raw_id_fields = ['exercise']


@admin.register(ExerciseRequirementVote)
class ExerciseRequirementVoteAdmin(admin.ModelAdmin):
    list_display = ['requirement', 'voter', 'value', 'created_at']
    list_filter = ['value']
    raw_id_fields = ['requirement', 'voter']


@admin.register(ExerciseClaim)
class ExerciseClaimAdmin(admin.ModelAdmin):
    list_display = ['exercise', 'kind', 'topic', 'subtopic', 'level', 'proposed_by', 'created_at']
    list_filter = ['kind']
    search_fields = ['subtopic']
    raw_id_fields = ['exercise', 'topic', 'proposed_by']


@admin.register(ExerciseClaimVote)
class ExerciseClaimVoteAdmin(admin.ModelAdmin):
    list_display = ['claim', 'voter', 'value', 'created_at']
    list_filter = ['value']
    raw_id_fields = ['claim', 'voter']


@admin.register(ExerciseClaimImportanceVote)
class ExerciseClaimImportanceVoteAdmin(admin.ModelAdmin):
    list_display = ['claim', 'voter', 'value', 'created_at']
    list_filter = ['value']
    raw_id_fields = ['claim', 'voter']
