from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    EditSuggestionViewSet,
    ExerciseSubmissionViewSet,
    ModerationActionView,
    ModerationQueueView,
    NodeGovernorViewSet,
    ReportActionView,
    ReportViewSet,
)

router = DefaultRouter()
router.register('exercise-submissions', ExerciseSubmissionViewSet, basename='exercise-submission')
router.register('edit-suggestions', EditSuggestionViewSet, basename='edit-suggestion')
router.register('reports', ReportViewSet, basename='report')
# Under moderation/ (not a bare top-level prefix) to sit alongside this app's other
# moderation-namespaced endpoints (moderation/queue/, moderation/reports/...) below — this is the
# "node governor" feature's own administration surface (list/grant/revoke who governs which
# Field/Course), distinct from ModerationActionView/ReportActionView (which ACT on pending items).
router.register('moderation/governors', NodeGovernorViewSet, basename='node-governor')

urlpatterns = router.urls + [
    path('moderation/queue/', ModerationQueueView.as_view(), name='moderation-queue'),
    path(
        'moderation/reports/<str:kind>/<int:pk>/<str:decision>/',
        ReportActionView.as_view(),
        name='moderation-report-action',
    ),
    path(
        'moderation/<str:kind>/<int:pk>/<str:decision>/',
        ModerationActionView.as_view(),
        name='moderation-action',
    ),
]
