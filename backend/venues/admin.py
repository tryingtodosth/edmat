from django.contrib import admin

from .models import (
    ChecklistInstance,
    ChecklistInstanceItem,
    ChecklistTemplate,
    ChecklistTemplateItem,
    Room,
    RoomBooking,
    Venue,
    VenueStaff,
)


class RoomInline(admin.TabularInline):
    model = Room
    extra = 0


class VenueStaffInline(admin.TabularInline):
    model = VenueStaff
    extra = 0
    # The one place a building's FIRST administrator is granted (CONFERENCE-BRIEF.md §6.4).
    fk_name = 'venue'
    raw_id_fields = ['user', 'added_by']


@admin.register(Venue)
class VenueAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'is_active']
    list_filter = ['is_active']
    search_fields = ['name', 'slug', 'address']
    prepopulated_fields = {'slug': ('name',)}
    inlines = [RoomInline, VenueStaffInline]


@admin.register(RoomBooking)
class RoomBookingAdmin(admin.ModelAdmin):
    list_display = ['room', 'event', 'starts_at', 'ends_at', 'status']
    list_filter = ['status']
    raw_id_fields = ['event', 'room', 'decided_by', 'requested_by']


class ChecklistTemplateItemInline(admin.TabularInline):
    model = ChecklistTemplateItem
    extra = 0


@admin.register(ChecklistTemplate)
class ChecklistTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'venue', 'version', 'is_active']
    list_filter = ['is_active']
    inlines = [ChecklistTemplateItemInline]


class ChecklistInstanceItemInline(admin.TabularInline):
    model = ChecklistInstanceItem
    extra = 0
    raw_id_fields = ['done_by', 'signed_off_by']


@admin.register(ChecklistInstance)
class ChecklistInstanceAdmin(admin.ModelAdmin):
    list_display = ['template_name', 'event', 'venue', 'template_version']
    raw_id_fields = ['event', 'venue', 'template', 'created_by']
    inlines = [ChecklistInstanceItemInline]
