from rest_framework.routers import DefaultRouter

from .views import MaterialCoverageViewSet, MaterialRequirementViewSet, MaterialViewSet

router = DefaultRouter()
router.register('materials', MaterialViewSet, basename='material')
router.register('material-coverage', MaterialCoverageViewSet, basename='material-coverage')
router.register('material-requirements', MaterialRequirementViewSet, basename='material-requirement')

urlpatterns = router.urls
