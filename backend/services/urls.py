from django.urls import path
from config.routers import NumericPkRouter

from .views import GeocodeView, ServiceReviewViewSet, ServiceViewSet, ServiceWatchViewSet

router = NumericPkRouter()
router.register('services', ServiceViewSet, basename='service')
router.register('service-watches', ServiceWatchViewSet, basename='service-watch')
router.register('service-reviews', ServiceReviewViewSet, basename='service-review')

urlpatterns = router.urls + [
    path('geocode/', GeocodeView.as_view(), name='geocode'),
]
