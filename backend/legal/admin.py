from django.contrib import admin

from .models import LegalNotice


@admin.register(LegalNotice)
class LegalNoticeAdmin(admin.ModelAdmin):
    list_display = ('content_url', 'status', 'contact_email', 'reporter', 'created_at')
    list_filter = ('status',)
    search_fields = ('content_url', 'explanation', 'contact_email', 'notifier_name')
    readonly_fields = ('created_at', 'updated_at')
