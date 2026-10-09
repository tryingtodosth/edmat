from django.contrib import admin

from .models import Contest, ContestStaff


class ContestStaffInline(admin.TabularInline):
    model = ContestStaff
    extra = 0
    raw_id_fields = ('user', 'added_by')


@admin.register(Contest)
class ContestAdmin(admin.ModelAdmin):
    list_display = ('title', 'status', 'visibility', 'preset_key', 'organiser', 'starts_at', 'created_at')
    list_filter = ('status', 'visibility', 'preset_key', 'audience')
    search_fields = ('title',)
    raw_id_fields = ('organiser', 'organization')
    inlines = [ContestStaffInline]
