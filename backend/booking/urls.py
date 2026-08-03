from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AvailabilityExceptionViewSet,
    AvailabilityRuleViewSet,
    BookingViewSet,
    ServiceAvailabilityView,
)

router = DefaultRouter()
router.register('availability-rules', AvailabilityRuleViewSet, basename='availability-rule')
router.register(
    'availability-exceptions', AvailabilityExceptionViewSet, basename='availability-exception'
)
router.register('bookings', BookingViewSet, basename='booking')

urlpatterns = router.urls + [
    # Sits under `services/` because that is what the availability is OF, while the code lives in
    # this app because that is what computes it (see ServiceAvailabilityView's own doc comment).
    # No conflict with services/urls.py's own router: `services/<pk>/` cannot match a path with a
    # further segment on the end, so the two resolve independently whichever include comes first.
    path('services/<int:pk>/availability/', ServiceAvailabilityView.as_view(), name='service-availability'),
]
