from rest_framework.routers import DefaultRouter

from .views import ExerciseRequirementViewSet, ExerciseViewSet, TagViewSet

router = DefaultRouter()
router.register('exercises', ExerciseViewSet, basename='exercise')
router.register('exercise-requirements', ExerciseRequirementViewSet, basename='exercise-requirement')
router.register('tags', TagViewSet, basename='tag')

urlpatterns = router.urls
