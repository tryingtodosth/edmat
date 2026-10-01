"""URL conf for `needs` (MANAGEMENT-BRIEF.md §3.C). Included from `config/urls.py` under `api/` by
the prep commit. The node-nested list/create is this app's own path (MANAGEMENT-BRIEF.md §2), not
an `@action` on anything in `courses`/`events`/`materials` — nothing in those apps moves."""

from django.urls import path

from config.routers import NumericPkRouter

from .views import (
    NeedApplicationViewSet,
    NeedViewSet,
    NodeNeedsView,
    VolunteeringOfferViewSet,
)

router = NumericPkRouter()
router.register('needs', NeedViewSet, basename='need')
router.register('need-applications', NeedApplicationViewSet, basename='need-application')
# The supply side (2026-10-01). Its own prefix rather than a mode on `/api/needs/`: an
# offer and a need share a vocabulary, not a shape — no node, no roster, no decision.
router.register('volunteering-offers', VolunteeringOfferViewSet, basename='volunteering-offer')

urlpatterns = router.urls + [
    path('nodes/<str:kind>/<int:pk>/needs/', NodeNeedsView.as_view(), name='node-needs'),
]
