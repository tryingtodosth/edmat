from rest_framework.routers import DefaultRouter

from .views import ServiceViewSet, ServiceWatchViewSet

router = DefaultRouter()
router.register('services', ServiceViewSet, basename='service')
router.register('service-watches', ServiceWatchViewSet, basename='service-watch')

urlpatterns = router.urls
