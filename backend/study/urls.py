from rest_framework.routers import DefaultRouter

from .views import ExerciseSetViewSet

router = DefaultRouter()
router.register('exercise-sets', ExerciseSetViewSet, basename='exercise-set')

urlpatterns = router.urls
