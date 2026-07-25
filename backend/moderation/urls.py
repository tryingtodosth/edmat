from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    EditSuggestionViewSet,
    ExerciseSubmissionViewSet,
    ModerationActionView,
    ModerationQueueView,
    ReportActionView,
    ReportViewSet,
)

router = DefaultRouter()
router.register('exercise-submissions', ExerciseSubmissionViewSet, basename='exercise-submission')
router.register('edit-suggestions', EditSuggestionViewSet, basename='edit-suggestion')
router.register('reports', ReportViewSet, basename='report')

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
