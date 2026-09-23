from config.routers import NumericPkRouter

from .views import ChemDrawingViewSet

router = NumericPkRouter()
router.register('chem-drawings', ChemDrawingViewSet, basename='chem-drawing')

urlpatterns = router.urls
