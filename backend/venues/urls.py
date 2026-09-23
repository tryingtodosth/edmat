"""`/api/venues/`, `/api/rooms/`, `/api/room-bookings/`, `/api/checklist-templates/`,
`/api/checklist-instances/`, `/api/checklist-items/` and `/api/events/{id}/checklist/`.

The last one is deliberately routed from **this** app rather than registered as an `@action` on
`EventViewSet`: CONFERENCE-BRIEF.md §4 rule 1 keeps `events` free of this app's machinery, and the
one line `events` does own (the publish block) is a single function call into `venues/access.py`.
"""

from django.urls import path
from config.routers import NumericPkRouter

from .views import (
    ChecklistInstanceViewSet,
    ChecklistItemViewSet,
    ChecklistTemplateViewSet,
    EventChecklistView,
    RoomBookingViewSet,
    RoomViewSet,
    VenueViewSet,
)

router = NumericPkRouter()
router.register('venues', VenueViewSet, basename='venue')
router.register('rooms', RoomViewSet, basename='room')
router.register('room-bookings', RoomBookingViewSet, basename='room-booking')
router.register('checklist-templates', ChecklistTemplateViewSet, basename='checklist-template')
router.register('checklist-instances', ChecklistInstanceViewSet, basename='checklist-instance')
router.register('checklist-items', ChecklistItemViewSet, basename='checklist-item')

urlpatterns = router.urls + [
    path(
        'events/<int:event_id>/checklist/',
        EventChecklistView.as_view(),
        name='event-checklist',
    ),
]
