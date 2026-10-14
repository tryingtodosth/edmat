"""Read-only admin pages for the rollups. They are derived tables (house rule 5): a count somebody
edited by hand would be the one number on the dashboard nothing can explain, so add and change are
off, and deletion is `rollup_analytics` recounting the day — never a button (backend/CLAUDE.md,
"The Django admin")."""

from django.contrib import admin

from .models import (
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
