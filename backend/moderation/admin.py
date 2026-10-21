from django.contrib import admin

from .models import ContentView, EditSuggestion, ExerciseSubmission, FeatureFlag, Report, GovernorApplication, NodeGovernor


@admin.register(ExerciseSubmission)
class ExerciseSubmissionAdmin(admin.ModelAdmin):
    list_display = ['submitted_by', 'branch', 'status', 'created_at', 'resulting_exercise']
    list_filter = ['status', 'branch']


@admin.register(EditSuggestion)
class EditSuggestionAdmin(admin.ModelAdmin):
    list_display = ['exercise', 'part', 'locale', 'field', 'submitted_by', 'status', 'created_at']
    list_filter = ['status', 'field']
    raw_id_fields = ['exercise', 'entry', 'part', 'submitted_by', 'reviewed_by']


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ['content_type', 'object_id', 'reported_by', 'status', 'created_at']
    list_filter = ['status', 'content_type']


@admin.register(ContentView)
class ContentViewAdmin(admin.ModelAdmin):
    list_display = ['user', 'exercise', 'viewed_at']
    list_filter = ['exercise']


@admin.register(FeatureFlag)
class FeatureFlagAdmin(admin.ModelAdmin):
    # A backup path alongside the real, staff-facing /moderation Flags tab — the same "Django admin
    # already works as a fallback" precedent CLAUDE.md notes for is_verified_contributor granting.
    list_display = ['key', 'is_enabled', 'updated_by', 'updated_at']
    list_editable = ['is_enabled']
    readonly_fields = ['updated_at']


# The scoped-moderation tables, registered 2026-10-08. A `NodeGovernor` row is a GRANT of authority
# over one node (`GOVERNABLE_NODE_MODELS`), which makes it the kind of row somebody should be able
# to look up by person — "what is this account allowed to moderate" is a support question.


@admin.register(NodeGovernor)
class NodeGovernorAdmin(admin.ModelAdmin):
    list_display = ['user', 'content_type', 'object_id', 'granted_by', 'created_at']
    list_filter = ['content_type']
    search_fields = ['user__username', 'granted_by__username']
    raw_id_fields = ['user', 'granted_by']


@admin.register(GovernorApplication)
class GovernorApplicationAdmin(admin.ModelAdmin):
    """Kept after a decision rather than deleted (house rule 12): who asked for authority over
    what, and whether they were given it, is part of the trust model."""

    list_display = ['applicant', 'content_type', 'object_id', 'status', 'decided_by', 'decided_at']
    list_filter = ['status', 'content_type']
    search_fields = ['applicant__username', 'statement', 'decision_note']
    raw_id_fields = ['applicant', 'decided_by', 'resulting_grant']
