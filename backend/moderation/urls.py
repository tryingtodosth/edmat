from django.urls import path
from config.routers import NumericPkRouter

from .views import (
    EditSuggestionViewSet,
    ExerciseSubmissionViewSet,
    FeatureFlagViewSet,
    GovernorApplicationViewSet,
    ModerationActionView,
    ModerationQueueCountView,
    ModerationQueueView,
    NodeGovernorViewSet,
    ReportActionView,
    ReportViewSet,
    TaxonomyProposalActionView,
)

router = NumericPkRouter()
router.register('exercise-submissions', ExerciseSubmissionViewSet, basename='exercise-submission')
# There is no `material-submissions` route any more: a new material is a `coauthoring` project with
# a team of one, sent to `POST /api/material-projects/` and decided at
# `POST /api/material-versions/{id}/decide/` (COAUTHORING-BRIEF.md §0, the fold migration
# `coauthoring/0003_fold_material_submissions`).
router.register('edit-suggestions', EditSuggestionViewSet, basename='edit-suggestion')
router.register('reports', ReportViewSet, basename='report')
router.register('feature-flags', FeatureFlagViewSet, basename='feature-flag')
# Under moderation/ (not a bare top-level prefix) to sit alongside this app's other
# moderation-namespaced endpoints (moderation/queue/, moderation/reports/...) below — this is the
# "node governor" feature's own administration surface (list/grant/revoke who governs which
# Discipline/Branch), distinct from ModerationActionView/ReportActionView (which ACT on pending items).
router.register('moderation/governors', NodeGovernorViewSet, basename='node-governor')
router.register(
    'governor-applications', GovernorApplicationViewSet, basename='governor-application'
)

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
