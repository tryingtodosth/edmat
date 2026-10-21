"""URL configuration — see CLAUDE.md Section 14 for the full sketch this mirrors."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.contrib.sitemaps.views import sitemap
from django.urls import include, path

from config.sitemaps import SITEMAPS
from config.views import (
    CreationStatusView,
    LocaleHintView,
    NodeRefView,
    NodeStaffView,
    PeopleSuggestionsView,
)

urlpatterns = [
    path('admin/', admin.site.urls),
    # The first-visit interface-language hint (config/views.py). Routed here rather than from an
    # app's urls.py because it belongs to no app — it is about the visitor's very first paint, not
    # about anything the platform stores.
    path('api/locale-hint/', LocaleHintView.as_view(), name='locale-hint'),
    # The management node seam (MANAGEMENT-BRIEF.md §2, config/nodes.py): what a course, event,
    # material or organisation is and where the caller stands on it, and its roster for a picker.
    # Here rather than in any one of the six management apps because all six ask it.
    # The people this account already works with, for every "add a person" picker (config/views.py).
    # Not gated: a staff panel keeps its picker when contests are off.
    path('api/people/suggestions/', PeopleSuggestionsView.as_view(), name='people-suggestions'),
    path('api/nodes/<str:kind>/<int:pk>/', NodeRefView.as_view(), name='node-ref'),
    path('api/nodes/<str:kind>/<int:pk>/staff/', NodeStaffView.as_view(), name='node-staff'),
    # The creation gate's read side (config/creation.py, learning step F): what the Add… menu may
    # draw for this account. Here because the rule belongs to no one app and four apps ask it.
    path('api/creation/', CreationStatusView.as_view(), name='creation-status'),
    # Deliberately at the root, not under `/api/`: this is the URL a crawler is told to fetch, and
    # Apache rewrites exactly this path through to Django (everything else at the root is the
    # SvelteKit build served off disk). The URLs it emits are frontend routes — see config/sitemaps.py.
    #
    # robots.txt is NOT served here. It is four fixed lines with no database in it, so it ships as a
    # static file in the frontend build and never touches a WSGI process.
    path('sitemap.xml', sitemap, {'sitemaps': SITEMAPS}, name='django.contrib.sitemaps.views.sitemap'),
    path('api/', include('accounts.urls')),
    path('api/', include('mail.urls')),
    path('api/', include('analytics.urls')),
    path('api/', include('sso.urls')),
    path('api/', include('taxonomy.urls')),
    path('api/', include('exercises.urls')),
    path('api/', include('community.urls')),
    path('api/', include('activity.urls')),
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
    path('api/', include('issues.urls')),
    path('api/', include('legal.urls')),
    path('api/', include('chem.urls')),
    path('api/', include('sketches.urls')),
    path('api/', include('galleries.urls')),
    path('api/', include('coauthoring.urls')),
    path('api/', include('materials_coop.urls')),
    path('api/', include('concepts.urls')),
    path('api/', include('cloakroom.urls')),
    path('api/', include('venues.urls')),
    path('api/', include('documents.urls')),
    # After `events.urls`, and that order is load-bearing: the rota's paths hang off an event
    # (`events/<id>/stations/`), which the events router's own detail pattern declines because it
    # ends at the id. See shifts/urls.py.
    path('api/', include('shifts.urls')),
    # The six management modules (MANAGEMENT-BRIEF.md §0), included EMPTY by the prep commit so that
    # no step edits this file; each app's urls.py fills its own router and its nested
    # `nodes/<kind>/<pk>/<thing>/` paths.
    path('api/', include('organizations.urls')),
    path('api/', include('tasks.urls')),
    path('api/', include('needs.urls')),
    path('api/', include('plans.urls')),
    path('api/', include('decisions.urls')),
    path('api/', include('work.urls')),
    # Goals and their definitions of done (goals/urls.py, 2026-10-08) — the seventh management
    # module, hung off a node through config/nodes.py like the six above it.
    path('api/', include('goals.urls')),
    # The learning cycle (prompts/00-DESIGN.md §3), included EMPTY by the prep commit.
    path('api/', include('flashcards.urls')),
    # The "AI-assisted" mark on content (provenance/urls.py) — `ai-assistance/`, named for the
    # question it answers rather than for the app.
    path('api/', include('provenance.urls')),
    # Each item's content licence and its history (licensing/urls.py, 2026-10-14).
    path('api/', include('licensing.urls')),
    # Writing a management row's text in every language at once (translations/urls.py).
    path('api/', include('translations.urls')),
    # Attachments on anything (attachments/urls.py, 2026-10-08). ONE pattern covers all nine target
    # kinds, because the kind is a word in `attachments/targets.py` and not a route each app adds.
    # Included LAST of the `api/` group on purpose: its `<str:kind>/<int:pk>/attachments/` is a
    # broad pattern, and every app's own routes must get the first look.
    # Contests (CONTESTS-BRIEF.md §2): the prep registers `contest-presets/`; step A fills the router.
    path('api/', include('contests.urls')),
    path('api/', include('attachments.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
