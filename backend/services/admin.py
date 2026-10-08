"""The admin for tutoring listings.

The app is still called `services` and the API is still `/api/services/` — only the Polish URL is
`/korki` (root CLAUDE.md, "Frontend routes"). `is_active` rather than a delete is the lifecycle, so
it is the first filter.
"""

from django.contrib import admin

from .models import Service, ServiceReview, ServiceWatch


@admin.register(Service)
class ServiceAdmin(admin.ModelAdmin):
    list_display = (
        'title',
        'provider',
        'audience',
        'delivery_mode',
        'hourly_rate',
        'currency',
        'is_active',
        'updated_at',
    )
    list_filter = ('is_active', 'delivery_mode', 'audience', 'language', 'availability_mode')
    search_fields = ('title', 'description', 'provider__username', 'location_label')
    raw_id_fields = ('provider',)
    filter_horizontal = ('branches',)


@admin.register(ServiceReview)
class ServiceReviewAdmin(admin.ModelAdmin):
    list_display = ('service', 'author', 'rating', 'is_removed', 'created_at')
    list_filter = ('rating', 'is_removed')
    search_fields = ('body', 'service__title', 'author__username')
    raw_id_fields = ('service', 'author')


@admin.register(ServiceWatch)
class ServiceWatchAdmin(admin.ModelAdmin):
    list_display = ('user', 'service', 'created_at')
    search_fields = ('user__username', 'service__title')
    raw_id_fields = ('user', 'service')
