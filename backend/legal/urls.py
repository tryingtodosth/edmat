from config.routers import NumericPkRouter

from .views import LegalNoticeViewSet

router = NumericPkRouter()
router.register('legal-notices', LegalNoticeViewSet, basename='legal-notice')

urlpatterns = router.urls
