"""Staff-only, read-mostly. Everything here has a real endpoint with real rules behind it, and the
admin deliberately does not reimplement any of them.

Writing a version through this page would skip the number allocator, the payload check, the malware
scan, the quota and the projection — so the fields that carry those decisions are read-only, and the
admin is what it should be: somewhere to LOOK at what happened when something goes wrong.
"""

from django.contrib import admin

from .models import (
    MaterialProject,
    MaterialVersion,
    ProjectInvite,
    ProjectJoinRequest,
    ProjectMember,
)


class ProjectMemberInline(admin.TabularInline):
    model = ProjectMember
    extra = 0
    fields = ['user', 'role', 'added_by', 'added_at']
    readonly_fields = ['added_at']


class MaterialVersionInline(admin.TabularInline):
    model = MaterialVersion
    extra = 0
    fields = ['number', 'status', 'kind', 'title', 'created_by', 'created_at', 'published_at']
    readonly_fields = fields
    show_change_link = True

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(MaterialProject)
class MaterialProjectAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'branch', 'locale', 'seeking_coauthors', 'created_at']
    list_filter = ['seeking_coauthors', 'locale']
    search_fields = ['branch__slug', 'material__slug']
    readonly_fields = ['created_at']
    inlines = [ProjectMemberInline, MaterialVersionInline]


@admin.register(MaterialVersion)
class MaterialVersionAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'kind', 'title', 'created_by', 'scan_status', 'created_at']
    list_filter = ['status', 'kind', 'scan_status']
    search_fields = ['title']
    # Every one of these is set by a code path that also does something else — the allocator, the
    # publish claim, the decision claim, the scan, the reclaim. Editing one here would leave the row
    # saying something the rest of the system never agreed to.
    readonly_fields = [
        'project',
        'number',
        'status',
        'kind',
        'file',
        'url',
        'body',
        'based_on',
        'created_by',
        'created_at',
        'decided_by',
        'decided_at',
        'published_at',
        'scan_status',
        'scan_detail',
        'file_size',
        'file_reclaimed_at',
    ]

    def has_add_permission(self, request):
        return False


@admin.register(ProjectInvite)
class ProjectInviteAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'label', 'uses', 'max_uses', 'expires_at', 'revoked_at']
    list_filter = ['revoked_at']
    readonly_fields = ['token', 'uses', 'created_at']


@admin.register(ProjectJoinRequest)
class ProjectJoinRequestAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'status', 'created_at', 'decided_at']
    list_filter = ['status']
    readonly_fields = ['project', 'user', 'statement', 'created_at']
