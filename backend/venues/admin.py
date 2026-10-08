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


# Registered 2026-10-08 (owner: *"django admin lacks funcionalities"*). `Room` and `VenueStaff` are
# standalone pages as well as inlines: "which rooms are inactive across every building" and "who
# administers what" are questions about the TABLE, and an inline can only answer them one venue at
# a time.


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ['name', 'venue', 'number', 'floor', 'seated_capacity', 'fire_capacity', 'has_av', 'accessible', 'is_active']
    list_filter = ['is_active', 'has_av', 'accessible', 'venue']
    search_fields = ['name', 'number', 'notes', 'venue__name']
    raw_id_fields = ['venue']


@admin.register(VenueStaff)
class VenueStaffAdmin(admin.ModelAdmin):
    """`role` decides who may answer a booking and sign a checklist item off
    (`VENUE_ADMIN_ROLES`), so it is the first filter."""

    list_display = ['user', 'venue', 'role', 'added_by', 'added_at']
    list_filter = ['role']
    search_fields = ['user__username', 'venue__name']
    raw_id_fields = ['user', 'venue', 'added_by']


@admin.register(ChecklistTemplateItem)
class ChecklistTemplateItemAdmin(admin.ModelAdmin):
    list_display = ['title_pl', 'template', 'owner_role', 'is_mandatory', 'evidence_kind', 'anchor', 'due_offset_minutes', 'order']
    list_filter = ['owner_role', 'is_mandatory', 'evidence_kind', 'requires_venue_signoff']
    search_fields = ['title_pl', 'title_en', 'description_pl', 'description_en']
    raw_id_fields = ['template']


@admin.register(ChecklistInstanceItem)
class ChecklistInstanceItemAdmin(admin.ModelAdmin):
    """One `status`, never two booleans — and `not_applicable` is a real outcome beside `done`,
    which is why both are offered rather than a tick."""

    list_display = ['title_pl', 'instance', 'status', 'owner_role', 'is_mandatory', 'computed_due_at', 'done_by', 'signed_off_by']
    list_filter = ['status', 'owner_role', 'is_mandatory', 'requires_venue_signoff']
    search_fields = ['title_pl', 'title_en', 'na_reason', 'evidence_text']
    raw_id_fields = ['instance', 'done_by', 'signed_off_by']
