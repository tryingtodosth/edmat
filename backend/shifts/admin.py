from django.contrib import admin

from .models import Assignment, Shift, Station, VolunteerRecord


@admin.register(Station)
class StationAdmin(admin.ModelAdmin):
    list_display = ['name', 'event', 'kind', 'minors_permitted', 'requires_adult']
    list_filter = ['kind', 'minors_permitted', 'requires_adult']
    search_fields = ['name', 'event__title']


@admin.register(Shift)
class ShiftAdmin(admin.ModelAdmin):
    list_display = ['station', 'starts_at', 'ends_at', 'needed', 'follows_session']
    list_filter = ['follows_session']


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ['user', 'shift', 'status', 'source', 'hours_credited']
    list_filter = ['status', 'source']


@admin.register(VolunteerRecord)
class VolunteerRecordAdmin(admin.ModelAdmin):
    list_display = ['user', 'event', 'consent_recorded_at', 'vetting_checked_at']
    search_fields = ['user__username', 'event__title']
