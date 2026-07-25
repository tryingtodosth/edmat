from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import EditSuggestionViewSet, ExerciseSubmissionViewSet, ModerationActionView, ModerationQueueView

router = DefaultRouter()
router.register('exercise-submissions', ExerciseSubmissionViewSet, basename='exercise-submission')
router.register('edit-suggestions', EditSuggestionViewSet, basename='edit-suggestion')

urlpatterns = router.urls + [
    path('moderation/queue/', ModerationQueueView.as_view(), name='moderation-queue'),
    path(
        'moderation/<str:kind>/<int:pk>/<str:decision>/',
        ModerationActionView.as_view(),
        name='moderation-action',
    ),
]
