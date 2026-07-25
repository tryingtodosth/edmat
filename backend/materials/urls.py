from rest_framework.routers import DefaultRouter

from .views import MaterialCoverageViewSet, MaterialViewSet

router = DefaultRouter()
router.register('materials', MaterialViewSet, basename='material')
router.register('material-coverage', MaterialCoverageViewSet, basename='material-coverage')

urlpatterns = router.urls
