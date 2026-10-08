"""The admin for a body and what it stands behind.

`open_board` is the one field here with a reach beyond this page: it is what makes a body's tasks
and its open polls readable by anybody (`/about` runs on it). It is listed and filterable so that
"which bodies are public" is one question rather than a scan.
"""

from django.contrib import admin

from .models import Organization, OrganizationLink, OrganizationMember


class OrganizationMemberInline(admin.TabularInline):
    model = OrganizationMember
    extra = 0
    fields = ('user', 'role', 'added_by', 'added_at')
    raw_id_fields = ('user', 'added_by')
    readonly_fields = ('added_at',)


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'kind', 'city', 'is_active', 'open_board', 'created_at')
    list_filter = ('kind', 'is_active', 'open_board')
    search_fields = ('name', 'slug', 'city', 'description')
    prepopulated_fields = {'slug': ('name',)}
    raw_id_fields = ('created_by',)
    inlines = [OrganizationMemberInline]


@admin.register(OrganizationMember)
class OrganizationMemberAdmin(admin.ModelAdmin):
    list_display = ('organization', 'user', 'role', 'added_by', 'added_at')
    list_filter = ('role',)
    search_fields = ('organization__name', 'user__username')
    raw_id_fields = ('organization', 'user', 'added_by')


@admin.register(OrganizationLink)
class OrganizationLinkAdmin(admin.ModelAdmin):
    list_display = ('organization', 'kind', 'content_type', 'object_id', 'added_by', 'added_at')
    list_filter = ('kind', 'content_type')
    search_fields = ('organization__name',)
    raw_id_fields = ('organization', 'added_by')
