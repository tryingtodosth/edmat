"""The admin for the help-wanted board and the offers beside it.

`Need.status` is **read-only**: `fulfilled` is recounted from the accepted applications by
`needs.rules.recount` and nothing else writes it. `VolunteeringOffer.status` is a real choice its
author makes, so that one is editable — the two look alike and are not the same kind of field.
"""

from django.contrib import admin

from .models import Need, NeedApplication, VolunteeringOffer


class NeedApplicationInline(admin.TabularInline):
    model = NeedApplication
    extra = 0
    fields = ('user', 'status', 'message', 'decided_by', 'decided_at')
    raw_id_fields = ('user', 'decided_by')


@admin.register(Need)
class NeedAdmin(admin.ModelAdmin):
    list_display = (
        'title',
        'kind',
        'status',
        'wanted_count',
        'deadline',
        'is_remote',
        'content_type',
        'object_id',
    )
    list_filter = ('status', 'kind', 'skill_level', 'is_remote', 'content_type')
    search_fields = ('title', 'description')
    raw_id_fields = ('created_by',)
    readonly_fields = ('status', 'created_at', 'updated_at')
    inlines = [NeedApplicationInline]


@admin.register(NeedApplication)
class NeedApplicationAdmin(admin.ModelAdmin):
    list_display = ('need', 'user', 'status', 'decided_by', 'decided_at', 'created_at')
    list_filter = ('status',)
    search_fields = ('need__title', 'user__username', 'message')
    raw_id_fields = ('need', 'user', 'decided_by')


@admin.register(VolunteeringOffer)
class VolunteeringOfferAdmin(admin.ModelAdmin):
    list_display = ('title', 'volunteer', 'kind', 'status', 'hours_per_week', 'is_remote', 'updated_at')
    list_filter = ('status', 'kind', 'skill_level', 'is_remote', 'language')
    search_fields = ('title', 'description', 'volunteer__username', 'location_text')
    raw_id_fields = ('volunteer',)
