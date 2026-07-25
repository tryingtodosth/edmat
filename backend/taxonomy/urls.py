from rest_framework.routers import DefaultRouter

from .views import CourseViewSet, FieldViewSet

router = DefaultRouter()
router.register('fields', FieldViewSet, basename='field')
router.register('courses', CourseViewSet, basename='course')

urlpatterns = router.urls
