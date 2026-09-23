from config.routers import NumericPkRouter

from .views import SketchViewSet

router = NumericPkRouter()
router.register('sketches', SketchViewSet, basename='sketch')

urlpatterns = router.urls
