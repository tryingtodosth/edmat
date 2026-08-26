from django.contrib import admin

from .models import Issue


@admin.register(Issue)
class IssueAdmin(admin.ModelAdmin):
    list_display = ('title', 'kind', 'status', 'is_public', 'reporter', 'created_at')
    list_filter = ('kind', 'status', 'is_public')
    search_fields = ('title', 'body')
