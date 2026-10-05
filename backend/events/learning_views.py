"""`GET /api/events/{id}/related-courses/` — the event ↔ course cross-link, through the
organisation (`prompts/06-event-takeaways.md`, `00-DESIGN.md` §2 row "event ↔ course").

Its own mixin rather than one more action on `ProgrammeMixin`, for the reason this app already
composes five of them (`RegistrationMixin`, `ContributionMixin`, `ExportMixin`, `TicketMixin`):
a programme is sessions and tracks, and this is neither — it is what happened *around* the event.

Two things about it are deliberate and both are written down here because they look like bugs:

- **It answers `[]` when `organizations` is off**, instead of 403. House rule 3 says a kill switch
  removes the links as well as the pages, and the whole-surface refusal belongs on
  `/api/organizations/…`, which `feature_gate('organizations')` already gates. This endpoint is
  *the event page's*; a neighbouring endpoint must keep working while returning nothing for the
  killed feature (the `my-schedule` precedent, `booking/views.py`). An event page that 403s
  because somebody turned organisations off is a kill switch taking down a page it was not aimed
  at. The staff bypass is spelled the same way `feature_gate` spells it, so the panel and the API
  agree about who still sees data.

- **It serialises with `courses.serializers.CourseSerializer`**, the very shape `/api/courses/`
  already answers with, rather than a narrower "summary" of its own. A second course shape here
  would be a second set of decisions about what a course discloses, kept in step with the first
  by hand — and the rows are the same rows, filtered by the same `_visible_courses`, so there is
  nothing this could narrow that the courses API does not already publish. It also means the
  frontend reuses `mapCourse` and `CourseCard` unchanged.
"""

from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from moderation.permissions import feature_gate
from moderation.services import is_feature_enabled

_EventsFeatureGate = feature_gate('events')


class LearningMixin:
    """One read action on `EventViewSet`. It reads `self.get_object()`, so the event's own
    visibility layer applies: a stranger asking about a draft gets 404 (house rule 4)."""

    @action(detail=True, methods=['get'], url_path='related-courses', permission_classes=[permissions.IsAuthenticatedOrReadOnly, _EventsFeatureGate])
    def related_courses(self, request, pk=None):
        from courses.serializers import CourseSerializer

        from .related import related_courses

        event = self.get_object()
        user = request.user
        if not is_feature_enabled('organizations') and not (
            user.is_authenticated and user.is_staff
        ):
            # Empty, 200 — see the module docstring. The panel is gone on the frontend side for the
            # same reader, so this is the belt to that braces rather than the only line.
            return Response([], status=status.HTTP_200_OK)
        rows = related_courses(event, user)
        return Response(CourseSerializer(rows, many=True, context={'request': request}).data)
