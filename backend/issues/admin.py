from django.contrib import admin

from .models import Issue


@admin.register(Issue)
class IssueAdmin(admin.ModelAdmin):
    # `source` leads the filter row rather than sitting at the end: "show me only the school
    # demo's reports" is the first cut somebody running a pilot makes, and `area` is only
    # meaningful once it has been made.
    list_display = ('title', 'source', 'area', 'kind', 'status', 'is_public', 'reporter', 'created_at')
    list_filter = ('source', 'area', 'kind', 'status', 'is_public')
    search_fields = ('title', 'body')
