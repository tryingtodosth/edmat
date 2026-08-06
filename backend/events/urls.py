from rest_framework.routers import DefaultRouter

from .views import EventViewSet

router = DefaultRouter()
# `events`, plainly — unlike `courses`, there is no existing `/api/events/` meaning something
# else for this to collide with.
router.register('events', EventViewSet, basename='event')

urlpatterns = router.urls
