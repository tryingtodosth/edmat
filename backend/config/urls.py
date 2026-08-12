"""URL configuration — see CLAUDE.md Section 14 for the full sketch this mirrors."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.sitemaps.views import sitemap
from django.urls import include, path

from config.sitemaps import SITEMAPS

urlpatterns = [
    path('admin/', admin.site.urls),
    # Deliberately at the root, not under `/api/`: this is the URL a crawler is told to fetch, and
    # Apache rewrites exactly this path through to Django (everything else at the root is the
    # SvelteKit build served off disk). The URLs it emits are frontend routes — see config/sitemaps.py.
    #
    # robots.txt is NOT served here. It is four fixed lines with no database in it, so it ships as a
    # static file in the frontend build and never touches a WSGI process.
    path('sitemap.xml', sitemap, {'sitemaps': SITEMAPS}, name='django.contrib.sitemaps.views.sitemap'),
    path('api/', include('accounts.urls')),
    path('api/', include('taxonomy.urls')),
    path('api/', include('exercises.urls')),
    path('api/', include('community.urls')),
    path('api/', include('materials.urls')),
    path('api/', include('moderation.urls')),
    path('api/', include('study.urls')),
    path('api/', include('notifications.urls')),
    path('api/', include('services.urls')),
    path('api/', include('messaging.urls')),
    path('api/', include('identity.urls')),
    path('api/', include('courses.urls')),
    path('api/', include('booking.urls')),
    path('api/', include('events.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
