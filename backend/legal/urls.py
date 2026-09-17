from rest_framework.routers import DefaultRouter

from .views import LegalNoticeViewSet

router = DefaultRouter()
router.register('legal-notices', LegalNoticeViewSet, basename='legal-notice')

urlpatterns = router.urls
