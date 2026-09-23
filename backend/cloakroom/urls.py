"""Routes. The desk is addressed by its own pk everywhere except the one place a client does not
know it yet — the list on an event page — which is why that one URL is event-nested and lives here
rather than as an `@action` on `EventViewSet` (`CONFERENCE-BRIEF.md` §4 rule 1)."""

from django.urls import path
from config.routers import NumericPkRouter

from .views import CloakroomDeskViewSet, EventCloakroomDesksView

router = NumericPkRouter()
router.register('cloakroom-desks', CloakroomDeskViewSet, basename='cloakroom-desk')

urlpatterns = router.urls + [
    path(
        'events/<int:event_id>/cloakroom-desks/',
        EventCloakroomDesksView.as_view(),
        name='event-cloakroom-desks',
    ),
]
