"""The licence history is EVIDENCE (backend/CLAUDE.md, admin rule 2): add/change-disabled. A
change is made through `rules.change_licence`, which checks who may and in which direction."""

from django.contrib import admin

from .models import LicenceChange


@admin.register(LicenceChange)
class LicenceChangeAdmin(admin.ModelAdmin):
    list_display = ('content_type', 'object_id', 'from_licence', 'to_licence', 'changed_by', 'as_staff', 'changed_at')
    list_filter = ('to_licence', 'content_type', 'as_staff')
    search_fields = ('note', 'changed_by__username')
    raw_id_fields = ('changed_by',)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
