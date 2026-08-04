from django.contrib import admin

from .models import Event, EventAttendance


class AttendanceInline(admin.TabularInline):
    model = EventAttendance
    extra = 0


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ['title', 'host', 'starts_at', 'status', 'location_kind']
    list_filter = ['status', 'location_kind']
    search_fields = ['title', 'summary']
    inlines = [AttendanceInline]


@admin.register(EventAttendance)
class EventAttendanceAdmin(admin.ModelAdmin):
    list_display = ['event', 'attendee', 'status', 'responded_at']
    list_filter = ['status']
