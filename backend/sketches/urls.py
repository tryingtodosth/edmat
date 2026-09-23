from rest_framework.routers import DefaultRouter

from .views import SketchViewSet

router = DefaultRouter()
router.register('sketches', SketchViewSet, basename='sketch')

urlpatterns = router.urls
