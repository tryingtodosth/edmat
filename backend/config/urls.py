"""URL configuration — see CLAUDE.md Section 14 for the full sketch this mirrors."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('accounts.urls')),
    path('api/', include('taxonomy.urls')),
    path('api/', include('exercises.urls')),
    path('api/', include('materials.urls')),
    path('api/', include('moderation.urls')),
    path('api/', include('study.urls')),
    path('api/', include('notifications.urls')),
    path('api/', include('services.urls')),
    path('api/', include('messaging.urls')),
    path('api/', include('identity.urls')),
    path('api/', include('classroom.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
