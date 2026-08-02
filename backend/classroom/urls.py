from rest_framework.routers import DefaultRouter

from .views import TaughtCourseViewSet

router = DefaultRouter()
# `taught-courses`, not `courses` — /api/courses/ is already the taxonomy's own subject list, and
# these are a genuinely different thing (see classroom/models.py's note on the name).
router.register('taught-courses', TaughtCourseViewSet, basename='taught-course')

urlpatterns = router.urls
