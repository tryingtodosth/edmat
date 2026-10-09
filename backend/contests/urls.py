"""URL conf for `contests`. Included from `config/urls.py` under `api/`, BEFORE `attachments.urls`
whose catch-all must stay last.

The prep registered one path, `contest-presets/`, so that the preset wizard and the presets registry
met at an address neither had to add. Step A registers the six viewsets and the two plain views
below; `people-suggestions/` is spelled before the router's own `contests/` detail route for the
reason `config/routers.py` exists at all — a router's detail segment is `[0-9]+` here, so
`contests/people-suggestions/` could not be mistaken for a contest id even if the order were wrong,
and it is spelled first anyway so that a reader does not have to know that.
"""

from django.urls import path

from config.routers import NumericPkRouter

from .views import (
    ContestComplaintViewSet,
    ContestPresetsView,
    ContestProblemViewSet,
    ContestRegistrationViewSet,
    ContestStaffViewSet,
    ContestStageViewSet,
    ContestSubmissionViewSet,
    ContestViewSet,
    PeopleSuggestionsView,
)

router = NumericPkRouter()
router.register('contests', ContestViewSet, basename='contest')
router.register('contest-staff', ContestStaffViewSet, basename='contest-staff')
router.register('contest-stages', ContestStageViewSet, basename='contest-stage')
router.register('contest-problems', ContestProblemViewSet, basename='contest-problem')
router.register(
    'contest-registrations', ContestRegistrationViewSet, basename='contest-registration'
)
router.register('contest-submissions', ContestSubmissionViewSet, basename='contest-submission')
router.register('contest-complaints', ContestComplaintViewSet, basename='contest-complaint')

urlpatterns = [
    path(
        'contests/people-suggestions/',
        PeopleSuggestionsView.as_view(),
        name='contest-people-suggestions',
    ),
    path('contest-presets/', ContestPresetsView.as_view(), name='contest-presets'),
] + router.urls
