"""Read-only admin pages for the rollups. They are derived tables (house rule 5): a count somebody
edited by hand would be the one number on the dashboard nothing can explain, so add and change are
off, and deletion is `rollup_analytics` recounting the day — never a button (backend/CLAUDE.md,
"The Django admin")."""

from django.contrib import admin

from .models import (
    ClientErrorGroup,
    ClientErrorReport,
    DailyClientError,
    DailyActiveUsers,
    DailyClient,
    DailyContentView,
    DailyReferrer,
    DailyRouteStat,
    RollupRun,
    WeeklyCohort,
)


class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(DailyRouteStat)
class DailyRouteStatAdmin(ReadOnlyAdmin):
    list_display = ('date', 'method', 'route', 'audience', 'requests', 'status_5xx', 'p95_ms')
    list_filter = ('audience', 'method')
    date_hierarchy = 'date'


@admin.register(DailyContentView)
class DailyContentViewAdmin(ReadOnlyAdmin):
    list_display = ('date', 'kind', 'object_id', 'views')
    list_filter = ('kind',)
    date_hierarchy = 'date'


@admin.register(DailyReferrer)
class DailyReferrerAdmin(ReadOnlyAdmin):
    list_display = ('date', 'host', 'count')
    date_hierarchy = 'date'


@admin.register(DailyClient)
class DailyClientAdmin(ReadOnlyAdmin):
    list_display = ('date', 'browser', 'os', 'device', 'count')
    list_filter = ('device', 'browser')
    date_hierarchy = 'date'


@admin.register(DailyActiveUsers)
class DailyActiveUsersAdmin(ReadOnlyAdmin):
    list_display = ('date', 'users')


@admin.register(WeeklyCohort)
class WeeklyCohortAdmin(ReadOnlyAdmin):
    list_display = ('week', 'cohort_week', 'users')


@admin.register(RollupRun)
class RollupRunAdmin(ReadOnlyAdmin):
    list_display = ('date', 'rows_read', 'rows_skipped_opt_out', 'finished_at')


# Browser error reports (client_errors.py). Read-only like the rollups: a report is evidence, and
# deletion is the 30/90-day purge in `rollup_analytics`, never a button.
@admin.register(ClientErrorGroup)
class ClientErrorGroupAdmin(ReadOnlyAdmin):
    list_display = ('kind', 'message', 'first_seen', 'last_seen')
    list_filter = ('kind',)
    search_fields = ('message',)


@admin.register(DailyClientError)
class DailyClientErrorAdmin(ReadOnlyAdmin):
    list_display = ('date', 'group', 'route', 'build', 'browser', 'count')
    list_filter = ('browser',)
    raw_id_fields = ('group',)
    date_hierarchy = 'date'


@admin.register(ClientErrorReport)
class ClientErrorReportAdmin(ReadOnlyAdmin):
    list_display = ('received_at', 'kind', 'message', 'route', 'build', 'browser', 'os', 'device')
    list_filter = ('kind', 'browser', 'device')
    raw_id_fields = ('group',)
