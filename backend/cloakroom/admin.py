from django.contrib import admin

from .models import CloakroomDesk, CloakroomItem


@admin.register(CloakroomDesk)
class CloakroomDeskAdmin(admin.ModelAdmin):
    list_display = ('name', 'event', 'status', 'closed_at')
    list_filter = ('status',)


@admin.register(CloakroomItem)
class CloakroomItemAdmin(admin.ModelAdmin):
    # No person column, because there is no person column — see cloakroom/models.py.
    list_display = ('rack_label', 'token', 'status', 'desk', 'deposited_at', 'returned_at')
    list_filter = ('status', 'exception_identity_kind')
    search_fields = ('token', 'rack_label')
