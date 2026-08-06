from django.contrib import admin

from .models import Event, EventAttendance, EventPost, EventPostLink


class AttendanceInline(admin.TabularInline):
    model = EventAttendance
    extra = 0


class PostLinkInline(admin.TabularInline):
    model = EventPostLink
    extra = 0


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ['title', 'host', 'starts_at', 'status', 'location_kind']
    list_filter = ['status', 'location_kind']
    search_fields = ['title', 'summary']
    inlines = [AttendanceInline]


@admin.register(EventPost)
class EventPostAdmin(admin.ModelAdmin):
    list_display = ['event', 'author', 'created_at', 'edited_at']
    search_fields = ['body', 'event__title']
    inlines = [PostLinkInline]
    # A picture uploaded HERE is not re-encoded — the admin assigns the file directly and never
    # reaches `process_post_image`. `EventPost.image`'s own validator still applies the size, type and
    # decompression-bomb checks, which is the same trade `Profile.avatar` already makes and is worth
    # knowing about before using this form to upload somebody else's photo.
    readonly_fields = ['created_at']


@admin.register(EventAttendance)
class EventAttendanceAdmin(admin.ModelAdmin):
    list_display = ['event', 'attendee', 'status', 'responded_at']
    list_filter = ['status']
