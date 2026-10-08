"""URL conf for `goals`. Included from `config/urls.py` under `api/`. The node-nested list/create
is this app's own path (MANAGEMENT-BRIEF.md §2), not an `@action` on anything in `courses`,
`events`, `materials` or `organizations` — nothing in those apps moves."""

from django.urls import path

from config.routers import NumericPkRouter

from .views import GoalCriterionViewSet, GoalViewSet, NodeGoalsView

router = NumericPkRouter()
router.register('goals', GoalViewSet, basename='goal')
router.register('goal-criteria', GoalCriterionViewSet, basename='goal-criterion')

urlpatterns = router.urls + [
    path('nodes/<str:kind>/<int:pk>/goals/', NodeGoalsView.as_view(), name='node-goals'),
]
