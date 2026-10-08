from django.contrib import admin

from .models import (
    Contribution,
    Event,
    EventAttendance,
    EventPost,
    EventPostLink,
    EventStaff,
    ExportLog,
    RegistrationField,
    ScanEvent,
    Session,
    SessionAttendance,
    SessionBookmark,
    SessionLink,
    SessionSpeaker,
    Track,
)


class AttendanceInline(admin.TabularInline):
    model = EventAttendance
    extra = 0


class PostLinkInline(admin.TabularInline):
    model = EventPostLink
    extra = 0


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ['title', 'host', 'starts_at', 'event_time', 'status', 'visibility', 'location_kind']
    list_filter = ['status', 'visibility', 'location_kind']
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


# ---- registered 2026-10-08 (owner: *"django admin lacks funcionalities"*) ----------------------
# Twelve of this app's fifteen models had no page. The programme (track → session → speaker/link),
# the call for contributions, the door log and the export log are all things somebody answering a
# support question needs to be able to LOOK at.


@admin.register(EventStaff)
class EventStaffAdmin(admin.ModelAdmin):
    """`role` is what `Event.can_organise` reads (`ORGANISING_ROLES`), so it is the first filter —
    and the host's own row lives here too, created by `Event.save()` rather than implied."""

    list_display = ['event', 'user', 'role', 'added_by', 'added_at']
    list_filter = ['role']
    search_fields = ['event__title', 'user__username']
    raw_id_fields = ['event', 'user', 'added_by']


@admin.register(Track)
class TrackAdmin(admin.ModelAdmin):
    list_display = ['name', 'event', 'colour', 'order']
    search_fields = ['name', 'event__title']
    raw_id_fields = ['event']


class SessionSpeakerInline(admin.TabularInline):
    model = SessionSpeaker
    extra = 0
    fields = ['order', 'user', 'name', 'affiliation']
    raw_id_fields = ['user']
    ordering = ['order']


class SessionLinkInline(admin.TabularInline):
    model = SessionLink
    extra = 0
    fields = ['order', 'role', 'label', 'material', 'exercise', 'exercise_set', 'url']
    raw_id_fields = ['material', 'exercise', 'exercise_set']
    ordering = ['order']


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = ['title', 'event', 'track', 'kind', 'starts_at', 'duration_minutes', 'capacity', 'order']
    list_filter = ['kind']
    search_fields = ['title', 'abstract', 'location_text', 'event__title']
    raw_id_fields = ['event', 'track']
    inlines = [SessionSpeakerInline, SessionLinkInline]


@admin.register(SessionSpeaker)
class SessionSpeakerAdmin(admin.ModelAdmin):
    """A speaker may be an ACCOUNT or just a name — an invited speaker who has never signed in is
    a real and common case, which is why `user` is nullable and `name` is not derived from it."""

    list_display = ['name', 'session', 'user', 'affiliation', 'order']
    search_fields = ['name', 'affiliation', 'session__title']
    raw_id_fields = ['session', 'user']


@admin.register(SessionLink)
class SessionLinkAdmin(admin.ModelAdmin):
    list_display = ['session', 'role', 'label', 'url', 'order']
    list_filter = ['role']
    search_fields = ['label', 'url', 'note', 'session__title']
    raw_id_fields = ['session', 'material', 'exercise', 'exercise_set']


@admin.register(SessionBookmark)
class SessionBookmarkAdmin(admin.ModelAdmin):
    list_display = ['user', 'session', 'created_at']
    search_fields = ['user__username', 'session__title']
    raw_id_fields = ['user', 'session']


@admin.register(SessionAttendance)
class SessionAttendanceAdmin(admin.ModelAdmin):
    list_display = ['session', 'attendance', 'created_at']
    search_fields = ['session__title']
    raw_id_fields = ['session', 'attendance']


@admin.register(RegistrationField)
class RegistrationFieldAdmin(admin.ModelAdmin):
    """The organiser's own questions on the registration form. `options` is a JSON list for the
    choice kinds and empty otherwise."""

    list_display = ['label', 'event', 'kind', 'required', 'order']
    list_filter = ['kind', 'required']
    search_fields = ['label', 'event__title']
    raw_id_fields = ['event']


@admin.register(Contribution)
class ContributionAdmin(admin.ModelAdmin):
    """A proposal and what was decided about it. Single-blind: the submitter is never shown who
    decided, which is a rule of the API and not of this page — an operator looking here is not the
    submitter."""

    list_display = ['title', 'event', 'submitter', 'kind', 'status', 'reason_code', 'decided_at']
    list_filter = ['status', 'kind', 'reason_code', 'audience']
    search_fields = ['title', 'abstract', 'submitter__username', 'review_note']
    raw_id_fields = ['event', 'submitter', 'session', 'decided_by']
    date_hierarchy = 'submitted_at'


@admin.register(ScanEvent)
class ScanEventAdmin(admin.ModelAdmin):
    """The door log — **read-only.** Every row is evidence of who was let in and when, and
    `client_nonce` is what makes an offline scanner's replay idempotent; a row edited by hand would
    make both meaningless. Deletion is what `manage.py purge_event_data` is for, which is a policy
    with a retention period behind it rather than a button."""

    list_display = ['event', 'result', 'direction', 'client_at', 'received_at', 'scanned_by', 'device_label', 'is_offline_sync']
    list_filter = ['result', 'direction', 'is_offline_sync']
    search_fields = ['token_seen', 'device_label', 'client_nonce']
    raw_id_fields = ['event', 'attendance', 'scanned_by']
    date_hierarchy = 'received_at'

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ExportLog)
class ExportLogAdmin(admin.ModelAdmin):
    """Who exported what, and how many rows. Read-only for the same reason as the door log: it is
    the record that makes a personal-data export answerable for."""

    list_display = ['event', 'user', 'kind', 'rows', 'created_at']
    list_filter = ['kind']
    search_fields = ['event__title', 'user__username']
    raw_id_fields = ['event', 'user']
    date_hierarchy = 'created_at'

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
