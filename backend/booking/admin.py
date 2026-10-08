"""The admin for availability and the bookings made against it.

This file used to be three bare `admin.site.register()` calls, which gave a changelist reading
`Booking object (41)` — true, and useless for the one question an operator has ("who is booked with
whom, when, and in what state"). 2026-10-08: real `ModelAdmin`s, and the week templates/schedules
registered at all for the first time.

`status` is editable, deliberately and unlike `needs.Need.status`: a booking's state is a decision
somebody makes, not a count of other rows, and an operator fixing a double-booking after a support
request is the case the admin exists for. Every FK to a person is `raw_id_fields` — a select with
every account in it is both slow and a way to pick the wrong person.
"""

from django.contrib import admin

from .models import (
    AvailabilityException,
    AvailabilityRule,
    Booking,
    WeekSchedule,
    WeekScheduleWindow,
    WeekTemplate,
    WeekTemplateWindow,
)


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ('starts_at', 'service', 'tutor', 'student', 'status', 'decided_at')
    list_filter = ('status',)
    search_fields = ('service__title', 'tutor__username', 'student__username', 'student_note')
    raw_id_fields = ('service', 'tutor', 'student', 'cancelled_by')
    date_hierarchy = 'starts_at'


@admin.register(AvailabilityRule)
class AvailabilityRuleAdmin(admin.ModelAdmin):
    list_display = ('tutor', 'service', 'weekday', 'start_time', 'end_time')
    list_filter = ('weekday',)
    search_fields = ('tutor__username', 'service__title')
    raw_id_fields = ('tutor', 'service')


@admin.register(AvailabilityException)
class AvailabilityExceptionAdmin(admin.ModelAdmin):
    list_display = ('tutor', 'date', 'kind', 'start_time', 'end_time')
    list_filter = ('kind',)
    search_fields = ('tutor__username', 'note')
    raw_id_fields = ('tutor',)
    date_hierarchy = 'date'


class WeekTemplateWindowInline(admin.TabularInline):
    model = WeekTemplateWindow
    extra = 0
    fields = ('weekday', 'start_time', 'end_time', 'service')
    raw_id_fields = ('service',)


@admin.register(WeekTemplate)
class WeekTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'tutor', 'updated_at')
    search_fields = ('name', 'tutor__username')
    raw_id_fields = ('tutor',)
    inlines = [WeekTemplateWindowInline]


class WeekScheduleWindowInline(admin.TabularInline):
    model = WeekScheduleWindow
    extra = 0
    fields = ('weekday', 'start_time', 'end_time', 'service')
    raw_id_fields = ('service',)


@admin.register(WeekSchedule)
class WeekScheduleAdmin(admin.ModelAdmin):
    list_display = ('tutor', 'week_start', 'source_template', 'updated_at')
    search_fields = ('tutor__username',)
    raw_id_fields = ('tutor', 'source_template')
    date_hierarchy = 'week_start'
    inlines = [WeekScheduleWindowInline]
