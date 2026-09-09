from rest_framework.routers import DefaultRouter

from django.urls import path, re_path

from .agenda_views import MyAgendaView, SessionViewSet
from .views import EventViewSet

router = DefaultRouter()
# `events`, plainly — unlike `courses`, there is no existing `/api/events/` meaning something
# else for this to collide with.
router.register('events', EventViewSet, basename='event')
router.register('sessions', SessionViewSet, basename='session')

urlpatterns = router.urls + [
    path('my-agenda/', MyAgendaView.as_view(), name='my-agenda'),
    re_path(r'^my-agenda\.(?P<fmt>ics)$', MyAgendaView.as_view(), name='my-agenda-ics'),
]
