from django.contrib import admin

from .models import Plan, PlanStep, PlanSuggestion


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ['id', 'title', 'status', 'content_type', 'object_id', 'created_by', 'created_at']
    list_filter = ['status', 'content_type']
    search_fields = ['title']


@admin.register(PlanStep)
class PlanStepAdmin(admin.ModelAdmin):
    list_display = ['id', 'title', 'plan', 'parent', 'status', 'order', 'due_at']
    list_filter = ['status']


@admin.register(PlanSuggestion)
class PlanSuggestionAdmin(admin.ModelAdmin):
    list_display = ['id', 'plan', 'user', 'status', 'created_at']
    list_filter = ['status']
