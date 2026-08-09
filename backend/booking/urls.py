from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AvailabilityExceptionViewSet,
    AvailabilityRuleViewSet,
    BookingViewSet,
    MyScheduleView,
    ServiceAvailabilityView,
    WeekScheduleViewSet,
    WeekTemplateViewSet,
)

router = DefaultRouter()
router.register('availability-rules', AvailabilityRuleViewSet, basename='availability-rule')
router.register(
    'availability-exceptions', AvailabilityExceptionViewSet, basename='availability-exception'
)
# Weeks that do not follow the repeating pattern, and the named shapes they can be written from.
# `week-schedules/week/` and `week-schedules/apply/` are list-level actions, so the router registers
# them ahead of the `{pk}` detail route — the same ordering footgun `exercises/random/` already
# records, and checked the same way (a URL dump, not an assumption).
router.register('week-schedules', WeekScheduleViewSet, basename='week-schedule')
router.register('week-templates', WeekTemplateViewSet, basename='week-template')
router.register('bookings', BookingViewSet, basename='booking')

urlpatterns = router.urls + [
    # Sits under `services/` because that is what the availability is OF, while the code lives in
    # this app because that is what computes it (see ServiceAvailabilityView's own doc comment).
    # No conflict with services/urls.py's own router: `services/<pk>/` cannot match a path with a
    # further segment on the end, so the two resolve independently whichever include comes first.
    path('services/<int:pk>/availability/', ServiceAvailabilityView.as_view(), name='service-availability'),
    # The caller's OWN calendar, across every listing they run and every lesson they take — see
    # MyScheduleView for why this is a separate endpoint rather than a parameter on the one above.
    path('my-schedule/', MyScheduleView.as_view(), name='my-schedule'),
]
