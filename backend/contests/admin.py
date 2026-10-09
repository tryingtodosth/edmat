"""The admin for `contests`.

Three rules from `backend/CLAUDE.md` govern every page here:

1. **A derived field is `readonly_fields`.** `ContestSubmission.advanced` is written only by
   `rules.advance`, every score total is recounted and never stored, and `announced_at`,
   `results_published_at` and `closed_at` are written by the transition that earns them. The admin
   must not be the one surface that can set them by hand (house rule 5).
2. **Evidence is add/change-disabled, not merely read-only-ish.** `ContestResult` is the published
   ranking — the one thing a reader was given a link to — and `ContestRulesVersion` is the frozen
   text somebody accepted. An admin who can edit either answers nothing they were written to
   answer. `publish_results` / `publish_rules` are their only writers.
3. **Every FK to a person or a big table is `raw_id_fields`.**
"""

from django.contrib import admin

from .models import (
    Contest,
    ContestAnswer,
    ContestComplaint,
    ContestProblem,
    ContestRegistration,
    ContestResult,
    ContestRulesSection,
    ContestRulesVersion,
    ContestScore,
    ContestStaff,
    ContestStage,
    ContestSubmission,
)


class ContestStaffInline(admin.TabularInline):
    model = ContestStaff
    extra = 0
    raw_id_fields = ('user', 'added_by')


class ContestStageInline(admin.TabularInline):
    model = ContestStage
    extra = 0
    fields = ('order', 'key', 'title', 'mode', 'opens_at', 'closes_at', 'advancement', 'status')
    readonly_fields = ('status',)
    raw_id_fields = ('event',)


class ContestRulesSectionInline(admin.TabularInline):
    model = ContestRulesSection
    extra = 0
    fields = ('order', 'key', 'body')


@admin.register(Contest)
class ContestAdmin(admin.ModelAdmin):
    list_display = (
        'title', 'status', 'visibility', 'preset_key', 'organiser', 'has_prize', 'starts_at',
        'created_at',
    )
    list_filter = ('status', 'visibility', 'preset_key', 'audience', 'has_prize')
    search_fields = ('title',)
    raw_id_fields = ('organiser', 'organization', 'preparation_course')
    readonly_fields = ('announced_at', 'results_published_at', 'closed_at', 'created_at', 'updated_at')
    inlines = [ContestStaffInline, ContestStageInline, ContestRulesSectionInline]


class ContestProblemInline(admin.TabularInline):
    model = ContestProblem
    extra = 0
    raw_id_fields = ('exercise',)


@admin.register(ContestStage)
class ContestStageAdmin(admin.ModelAdmin):
    list_display = ('title', 'contest', 'order', 'mode', 'status', 'opens_at', 'closes_at')
    list_filter = ('mode', 'status', 'advancement')
    search_fields = ('title', 'contest__title')
    raw_id_fields = ('contest', 'event')
    readonly_fields = ('advanced_at', 'created_at')
    inlines = [ContestProblemInline]


@admin.register(ContestRegistration)
class ContestRegistrationAdmin(admin.ModelAdmin):
    list_display = ('user', 'contest', 'status', 'publish_name', 'created_at', 'decided_at')
    list_filter = ('status', 'publish_name')
    search_fields = ('user__username', 'contest__title')
    raw_id_fields = ('contest', 'user', 'decided_by')
    readonly_fields = ('created_at',)


class ContestAnswerInline(admin.TabularInline):
    model = ContestAnswer
    extra = 0
    raw_id_fields = ('problem', 'attachment')


class ContestScoreInline(admin.TabularInline):
    model = ContestScore
    extra = 0
    raw_id_fields = ('problem', 'juror')


@admin.register(ContestSubmission)
class ContestSubmissionAdmin(admin.ModelAdmin):
    list_display = ('registration', 'stage', 'status', 'advanced', 'submitted_at')
    list_filter = ('status', 'advanced')
    raw_id_fields = ('stage', 'registration')
    # `advanced` is `rules.advance`'s and nothing else's: it is the decision a participant was told
    # about, taken once by a published rule.
    readonly_fields = ('advanced', 'created_at', 'updated_at')
    inlines = [ContestAnswerInline, ContestScoreInline]


@admin.register(ContestResult)
class ContestResultAdmin(admin.ModelAdmin):
    """The published ranking. Readable, never writable: `rules.publish_results` is its only writer
    and `unpublish_results` its only deleter, and both exist so that a result cannot move under
    somebody holding the link."""

    list_display = ('contest', 'rank', 'title', 'total_points', 'published_at')
    list_filter = ('title',)
    raw_id_fields = ('contest', 'registration')
    readonly_fields = ('contest', 'registration', 'rank', 'total_points', 'title', 'published_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ContestComplaint)
class ContestComplaintAdmin(admin.ModelAdmin):
    list_display = ('contest', 'registration', 'status', 'created_at', 'answered_at')
    list_filter = ('status',)
    raw_id_fields = ('contest', 'registration', 'answered_by')
    readonly_fields = ('created_at',)


@admin.register(ContestRulesVersion)
class ContestRulesVersionAdmin(admin.ModelAdmin):
    """A frozen regulamin. A registration stores the number it accepted (KC art. 384), so editing
    one here would retroactively change the rules somebody agreed to."""

    list_display = ('contest', 'number', 'published_at', 'published_by')
    raw_id_fields = ('contest', 'published_by')
    readonly_fields = ('contest', 'number', 'published_at', 'published_by', 'snapshot')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
