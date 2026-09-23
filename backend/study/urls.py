from config.routers import NumericPkRouter

from .views import ExerciseSetViewSet

router = NumericPkRouter()
router.register('exercise-sets', ExerciseSetViewSet, basename='exercise-set')

urlpatterns = router.urls
