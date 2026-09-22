from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    MaterialProjectViewSet,
    MaterialVersionViewSet,
    ProjectJoinRequestViewSet,
    invite_accept,
    invite_preview,
)

router = DefaultRouter()
router.register('material-projects', MaterialProjectViewSet, basename='material-project')
router.register('material-versions', MaterialVersionViewSet, basename='material-version')
router.register(
    'project-join-requests', ProjectJoinRequestViewSet, basename='project-join-request'
)

urlpatterns = router.urls + [
    # Addressed by bare token rather than nested under a project: somebody following an invite has
    # the token and nothing else, which is exactly what makes a link shareable. The `courses`
    # invite pair is the same shape for the same reason.
    path('project-invites/<str:token>/', invite_preview, name='project-invite-preview'),
    path('project-invites/<str:token>/accept/', invite_accept, name='project-invite-accept'),
]
