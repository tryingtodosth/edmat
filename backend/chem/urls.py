from rest_framework.routers import DefaultRouter

from .views import ChemDrawingViewSet

router = DefaultRouter()
router.register('chem-drawings', ChemDrawingViewSet, basename='chem-drawing')

urlpatterns = router.urls
