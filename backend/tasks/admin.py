from django.contrib import admin

from .models import Task, TaskAssignee


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'status', 'priority', 'due_at', 'content_type', 'object_id')
    list_filter = ('status', 'priority')
    search_fields = ('title',)


@admin.register(TaskAssignee)
class TaskAssigneeAdmin(admin.ModelAdmin):
    list_display = ('task', 'user', 'assigned_at')
