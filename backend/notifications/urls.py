from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import NotificationStreamView, NotificationViewSet

router = DefaultRouter()
router.register('notifications', NotificationViewSet, basename='notification')

# Registered as a real, explicit path BEFORE the router's own generated URLs — Django tries
# urlpatterns in list order, so this always wins the match for `/notifications/stream/` over the
# router's own `/notifications/<pk>/` detail route, the same real footgun (and the same fix)
# CLAUDE.md's own Phase 2 note already documented for `/exercises/{id}/random/` vs
# `/exercises/random/` — confirmed here the identical way, via a direct URL-pattern check, not
# assumed safe from list ordering alone.
urlpatterns = [
    path('notifications/stream/', NotificationStreamView.as_view(), name='notification-stream'),
    *router.urls,
]
