from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import GeocodeView, ServiceViewSet, ServiceWatchViewSet

router = DefaultRouter()
router.register('services', ServiceViewSet, basename='service')
router.register('service-watches', ServiceWatchViewSet, basename='service-watch')

urlpatterns = router.urls + [
    path('geocode/', GeocodeView.as_view(), name='geocode'),
]
