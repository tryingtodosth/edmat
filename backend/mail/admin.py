from django.contrib import admin

from .models import ConfirmedEmail, InboundEmail, MailPreference, OutboundEmail


@admin.register(OutboundEmail)
class OutboundEmailAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'kind', 'status', 'to', 'subject', 'attempts']
    list_filter = ['kind', 'status']
    search_fields = ['to', 'subject']


@admin.register(InboundEmail)
class InboundEmailAdmin(admin.ModelAdmin):
    list_display = ['date', 'from_address', 'subject']
    search_fields = ['from_address', 'subject']


admin.site.register(ConfirmedEmail)
admin.site.register(MailPreference)
