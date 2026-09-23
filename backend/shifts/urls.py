"""Explicit paths, no router.

The rota hangs off an event (`/api/events/{id}/stations/`) and off a shift
(`/api/shifts/{id}/claim/`), and a `DefaultRouter` registered on `events` here would collide with
`events/urls.py`'s own. These patterns are reached only after the events router has declined —
its detail route is `^events/(?P<pk>[^/.]+)/$`, which does not match a longer path — so the two
apps coexist without either editing the other's file. That mattered: seven conference steps were
built in parallel and a shared `urls.py` is a merge conflict every one of them would have caused.

Numeric-only ids on purpose (`<int:…>`): a stray `/api/shifts/undefined/claim/` from the frontend
is a 404 from the URL resolver rather than a 500 from `int()`.
"""

from django.urls import path, re_path

from .views import (
    CoverageView,
    EventStationsView,
    EventVolunteersView,
    MyShiftsView,
    MyVolunteeringView,
    ShiftAssignView,
    ShiftClaimView,
    ShiftConfirmView,
    ShiftDetailView,
    ShiftDoneView,
    ShiftDropView,
    ShiftNoShowView,
    StationDetailView,
    StationShiftsView,
    VolunteerRecordDetailView,
)

urlpatterns = [
    path('events/<int:event_id>/stations/', EventStationsView.as_view(), name='event-stations'),
    path('events/<int:event_id>/coverage/', CoverageView.as_view(), name='event-coverage'),
    path('events/<int:event_id>/my-shifts/', MyShiftsView.as_view(), name='event-my-shifts'),
    re_path(
        r'^events/(?P<event_id>[0-9]+)/my-shifts\.(?P<fmt>ics)$',
        MyShiftsView.as_view(),
        name='event-my-shifts-ics',
    ),
    path('events/<int:event_id>/volunteers/', EventVolunteersView.as_view(), name='event-volunteers'),
    path('stations/<int:pk>/', StationDetailView.as_view(), name='station-detail'),
    path('stations/<int:station_id>/shifts/', StationShiftsView.as_view(), name='station-shifts'),
    path('shifts/<int:pk>/', ShiftDetailView.as_view(), name='shift-detail'),
    path('shifts/<int:pk>/claim/', ShiftClaimView.as_view(), name='shift-claim'),
    path('shifts/<int:pk>/drop/', ShiftDropView.as_view(), name='shift-drop'),
    path('shifts/<int:pk>/assign/', ShiftAssignView.as_view(), name='shift-assign'),
    path('shifts/<int:pk>/confirm/', ShiftConfirmView.as_view(), name='shift-confirm'),
    path('shifts/<int:pk>/no-show/', ShiftNoShowView.as_view(), name='shift-no-show'),
    path('shifts/<int:pk>/done/', ShiftDoneView.as_view(), name='shift-done'),
    path('volunteer-records/<int:pk>/', VolunteerRecordDetailView.as_view(), name='volunteer-record'),
    path('my-volunteering/', MyVolunteeringView.as_view(), name='my-volunteering'),
]
