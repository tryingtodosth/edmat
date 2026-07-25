from rest_framework.routers import DefaultRouter

from .views import ExerciseViewSet, TagViewSet

router = DefaultRouter()
router.register('exercises', ExerciseViewSet, basename='exercise')
router.register('tags', TagViewSet, basename='tag')

urlpatterns = router.urls
