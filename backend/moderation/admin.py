from django.contrib import admin

from .models import ContentView, EditSuggestion, ExerciseSubmission, FeatureFlag, Report


@admin.register(ExerciseSubmission)
class ExerciseSubmissionAdmin(admin.ModelAdmin):
    list_display = ['submitted_by', 'branch', 'status', 'created_at', 'resulting_exercise']
    list_filter = ['status', 'branch']


@admin.register(EditSuggestion)
class EditSuggestionAdmin(admin.ModelAdmin):
    list_display = ['exercise', 'locale', 'field', 'submitted_by', 'status', 'created_at']
    list_filter = ['status', 'field']


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
