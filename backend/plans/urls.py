"""URL conf for `plans` (MANAGEMENT-BRIEF.md §3.D). Included from `config/urls.py` under `api/` by
the prep commit, with an empty router, so that an unbuilt step answers 404 rather than breaking the
import. Register viewsets on `router` and add nested `path()`s to `urlpatterns`."""

from django.urls import path

from config.routers import NumericPkRouter

from .views import NodePlansView, PlanStepViewSet, PlanSuggestionViewSet, PlanViewSet

router = NumericPkRouter()
router.register('plans', PlanViewSet, basename='plan')
router.register('plan-steps', PlanStepViewSet, basename='plan-step')
router.register('plan-suggestions', PlanSuggestionViewSet, basename='plan-suggestion')

urlpatterns = router.urls + [
    path('nodes/<str:kind>/<int:pk>/plans/', NodePlansView.as_view(), name='node-plans'),
]
