from django.contrib import admin

from .models import EditSuggestion, ExerciseSubmission


@admin.register(ExerciseSubmission)
class ExerciseSubmissionAdmin(admin.ModelAdmin):
    list_display = ['submitted_by', 'course', 'status', 'created_at', 'resulting_exercise']
    list_filter = ['status', 'course']


@admin.register(EditSuggestion)
class EditSuggestionAdmin(admin.ModelAdmin):
    list_display = ['exercise', 'locale', 'field', 'submitted_by', 'status', 'created_at']
    list_filter = ['status', 'field']
