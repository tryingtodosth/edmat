from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import TaughtCourseViewSet, invite_accept, invite_preview

router = DefaultRouter()
# `taught-courses`, not `courses` — /api/courses/ is already the taxonomy's own subject list, and
# these are a genuinely different thing (see classroom/models.py's note on the name).
router.register('taught-courses', TaughtCourseViewSet, basename='taught-course')

urlpatterns = router.urls + [
    # Addressed by token rather than nested under a course: somebody following an invite has the
    # token and nothing else, which is exactly what makes a link shareable.
    path('course-invites/<str:token>/', invite_preview, name='course-invite-preview'),
    path('course-invites/<str:token>/accept/', invite_accept, name='course-invite-accept'),
]
