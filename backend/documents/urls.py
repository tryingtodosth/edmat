from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DocumentViewSet, EventAcknowledgementsView, EventDocumentsView

router = DefaultRouter()
router.register('documents', DocumentViewSet, basename='event-document')

# The two event-scoped paths deliberately live here rather than as `@action`s on `EventViewSet`:
# `events/urls.py` stays untouched (CONFERENCE-BRIEF.md §4 rule 1), and the router registered there
# never matches `events/<id>/documents/`, so the request falls through to these.
urlpatterns = router.urls + [
    path('events/<int:event_id>/documents/', EventDocumentsView.as_view(), name='event-documents'),
    path(
        'events/<int:event_id>/acknowledgements/',
        EventAcknowledgementsView.as_view(),
        name='event-acknowledgements',
    ),
]
