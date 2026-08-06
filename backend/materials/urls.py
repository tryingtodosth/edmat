from rest_framework.routers import DefaultRouter

from .views import (
    MaterialCoverageViewSet,
    MaterialRequirementViewSet,
    MaterialReviewViewSet,
    MaterialTypeViewSet,
    MaterialViewSet,
)

router = DefaultRouter()
router.register('materials', MaterialViewSet, basename='material')
router.register('material-coverage', MaterialCoverageViewSet, basename='material-coverage')
router.register('material-requirements', MaterialRequirementViewSet, basename='material-requirement')
router.register('material-reviews', MaterialReviewViewSet, basename='material-review')
router.register('material-types', MaterialTypeViewSet, basename='material-type')

urlpatterns = router.urls
