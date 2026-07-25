from django.contrib import admin

from .models import ContentView, EditSuggestion, ExerciseSubmission, Report


@admin.register(ExerciseSubmission)
class ExerciseSubmissionAdmin(admin.ModelAdmin):
    list_display = ['submitted_by', 'course', 'status', 'created_at', 'resulting_exercise']
    list_filter = ['status', 'course']


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
