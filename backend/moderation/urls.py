from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    EditSuggestionViewSet,
    ExerciseSubmissionViewSet,
    FeatureFlagViewSet,
    MaterialSubmissionViewSet,
    ModerationActionView,
    ModerationQueueCountView,
    ModerationQueueView,
    NodeGovernorViewSet,
    ReportActionView,
    ReportViewSet,
    TaxonomyProposalActionView,
)

router = DefaultRouter()
router.register('exercise-submissions', ExerciseSubmissionViewSet, basename='exercise-submission')
router.register('material-submissions', MaterialSubmissionViewSet, basename='material-submission')
router.register('edit-suggestions', EditSuggestionViewSet, basename='edit-suggestion')
router.register('reports', ReportViewSet, basename='report')
router.register('feature-flags', FeatureFlagViewSet, basename='feature-flag')
# Under moderation/ (not a bare top-level prefix) to sit alongside this app's other
# moderation-namespaced endpoints (moderation/queue/, moderation/reports/...) below — this is the
# "node governor" feature's own administration surface (list/grant/revoke who governs which
# Discipline/Branch), distinct from ModerationActionView/ReportActionView (which ACT on pending items).
router.register('moderation/governors', NodeGovernorViewSet, basename='node-governor')

urlpatterns = router.urls + [
    path('moderation/queue/', ModerationQueueView.as_view(), name='moderation-queue'),
    # Before nothing in particular, but its own path so a badge never fetches the whole queue.
    path(
        'moderation/queue/count/',
        ModerationQueueCountView.as_view(),
        name='moderation-queue-count',
    ),
    # Before the generic `moderation/<kind>/<pk>/<decision>/` below, which would otherwise swallow
    # `moderation/taxonomy/...` as a kind named "taxonomy".
    path(
        'moderation/taxonomy/<str:kind>/<int:pk>/',
        TaxonomyProposalActionView.as_view(),
        name='moderation-taxonomy-action',
    ),
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
