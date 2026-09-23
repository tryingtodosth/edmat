from django.urls import path
from config.routers import NumericPkRouter

from .views import CourseClaimViewSet, CourseViewSet, invite_accept, invite_preview

router = NumericPkRouter()
# `courses`, plainly. This used to read `taught-courses` because /api/courses/ belonged to the
# taxonomy's przedmiot list; that list is now /api/branches/, and a course here is what everybody
# means by the word.
router.register('courses', CourseViewSet, basename='course')
router.register('course-claims', CourseClaimViewSet, basename='course-claim')

urlpatterns = router.urls + [
    # Addressed by token rather than nested under a course: somebody following an invite has the
    # token and nothing else, which is exactly what makes a link shareable.
    path('course-invites/<str:token>/', invite_preview, name='course-invite-preview'),
    path('course-invites/<str:token>/accept/', invite_accept, name='course-invite-accept'),
]
