from rest_framework.routers import DefaultRouter

from .views import (
    ExerciseClaimViewSet,
    ExerciseMaterialLinkViewSet,
    ExerciseRequirementViewSet,
    ExerciseViewSet,
    SolutionEntryViewSet,
    TagViewSet,
)

router = DefaultRouter()
router.register('exercises', ExerciseViewSet, basename='exercise')
router.register('exercise-requirements', ExerciseRequirementViewSet, basename='exercise-requirement')
router.register(
    'exercise-material-links', ExerciseMaterialLinkViewSet, basename='exercise-material-link'
)
router.register('exercise-claims', ExerciseClaimViewSet, basename='exercise-claim')
router.register('solution-entries', SolutionEntryViewSet, basename='solution-entry')
router.register('tags', TagViewSet, basename='tag')

urlpatterns = router.urls
