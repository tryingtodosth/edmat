"""Ticket and scanner endpoints (CONFERENCE-BRIEF.md §3.D), mixed into `EventViewSet`.

Five surfaces, and what each one is allowed to know:

- `my-ticket` — mine, or my child's. The only place a full token is ever handed out.
- `my-ticket/rotate` — "I forwarded it to the wrong person."
- `checkin-list` — **the volunteer's view**, cached by the scanner so the door works with no
  network. It carries tokens and `Anna K.` and nothing else: no account ids, no email, no answers
  to the organiser's questions, no note. A volunteer's phone in a corridor is the least trusted
  copy of a guest list this system produces, so it holds the least.
- `scans` POST — a batch from a phone; `scans` GET — the log, organisers only.
- `badge-sheet` — organisers only, and the one place the minors' rule is applied (R1 §2.5,
  decision 9): a minor's badge prints `Anna K.` and is drawn with a coloured band, an adult's
  prints their name in full. This is a **sixth** endpoint §3.D did not list, added because the
  badge sheet cannot be built from `checkin-list` without either masking every adult's name (a
  conference badge nobody can read) or un-masking every minor's (the thing decision 9 exists to
  prevent). Said out loud here rather than quietly widening `checkin-list`.

Everything is behind BOTH `events` and `tickets` — a per-action `permission_classes` replaces the
viewset's own list entirely, so the events gate has to be named again in each one or a killed
`events` would still serve tickets. With `tickets` off, check-in by button
(`registration_views.registration_checkin`) is untouched and keeps working, which is the whole
point of a kill switch that removes a surface rather than a capability.
"""

from django.utils.dateparse import parse_datetime
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.minors import guardian_of, is_minor
from moderation.permissions import feature_gate

from .models import SEAT_HOLDING_STATUSES, ScanEvent
from .registration import expire_promotions, mask_name
from .scanning import apply_batch, ensure_ticket, inside_count, rotate_ticket, short_code

_EventsFeatureGate = feature_gate('events')
_TicketsFeatureGate = feature_gate('tickets')
_AUTH = [permissions.IsAuthenticated, _EventsFeatureGate, _TicketsFeatureGate]

#: A phone that queues all morning can still only send so much at once. A cap rather than
#: pagination: the client controls its own batch size, and a refusal that says "send fewer" is
#: something it can act on, while a silently truncated batch would lose scans.
MAX_BATCH = 200


def _display_name(user) -> str:
    profile = getattr(user, 'profile', None)
    return (getattr(profile, 'display_name', '') or user.username) if user else ''


def _badge_name(user) -> str:
    """The minors' rule, in the one place both the badge sheet and the ticket page read it from."""
    name = _display_name(user)
    return mask_name(name) if is_minor(user) else name


class TicketMixin:
    def _ticket_row(self, event, request):
        """Whose ticket this request is about: mine, or — with `?attendee=<id>` — my child's.

        A guardian needs their child's ticket because the child may have no phone, and because the
        guardian is who registered them. `guardian_of` is asked rather than re-derived
        (`accounts/minors.py` is the rule module); anybody else asking for somebody else's ticket
        gets a 403, not a 404, because the row plainly exists and pretending otherwise would send
        a parent hunting for a registration they can see on the roster.
        """
        wanted = request.query_params.get('attendee')
        if not wanted and isinstance(getattr(request, 'data', None), dict):
            wanted = request.data.get('attendee')
        if wanted:
            row = event.attendances.filter(attendee_id=wanted).select_related('attendee', 'attendee__profile').first()
            if row is None:
                return None, Response(status=status.HTTP_404_NOT_FOUND)
            if row.attendee_id != request.user.pk and not guardian_of(request.user, row.attendee):
                return None, Response({'detail': 'not_yours'}, status=status.HTTP_403_FORBIDDEN)
        else:
            row = event.attendances.filter(attendee=request.user).select_related('attendee', 'attendee__profile').first()
            if row is None:
                return None, Response({'detail': 'not_registered'}, status=status.HTTP_404_NOT_FOUND)
        return row, None

    def _ticket_payload(self, event, row):
        return {
            'token': row.ticket_token or '',
            'short_code': short_code(row.ticket_token or ''),
            'status': row.status,
            'badge_name': _badge_name(row.attendee),
            'is_minor': is_minor(row.attendee),
            'checked_in_at': row.checked_in_at,
            'checked_out_at': row.checked_out_at,
            'inside': row.is_inside,
            'event': {
                'id': str(event.pk),
                'title': event.title,
                'starts_at': event.starts_at,
                'ends_at': event.ends_at,
                'runs_until': event.runs_until,
                'location_kind': event.location_kind,
                'location_text': event.location_text,
                'online_url': event.online_url,
            },
        }

    @action(detail=True, methods=['get'], url_path='my-ticket', permission_classes=_AUTH)
    def my_ticket(self, request, pk=None):
        """The ticket, for the person holding the seat. A row that holds no seat has no ticket and
        says which refusal it is (`pending`, `waitlisted`, `not_going`) rather than 404-ing — the
        difference between "wait for the organiser" and "you are not coming" is the whole message.
        """
        event = self.get_object()
        expire_promotions(event, request.user)
        row, refused = self._ticket_row(event, request)
        if refused:
            return refused
        if row.status not in SEAT_HOLDING_STATUSES:
            return Response({'detail': row.status, **self._ticket_payload(event, row)},
                            status=status.HTTP_409_CONFLICT)
        ensure_ticket(row)
        return Response(self._ticket_payload(event, row))

    @action(detail=True, methods=['post'], url_path='my-ticket/rotate', permission_classes=_AUTH)
    def my_ticket_rotate(self, request, pk=None):
        event = self.get_object()
        row, refused = self._ticket_row(event, request)
        if refused:
            return refused
        if row.status not in SEAT_HOLDING_STATUSES:
            return Response({'detail': row.status}, status=status.HTTP_409_CONFLICT)
        rotate_ticket(row)
        return Response(self._ticket_payload(event, row))

    @action(detail=True, methods=['get'], url_path='checkin-list', permission_classes=_AUTH)
    def checkin_list(self, request, pk=None):
        """What the scanner caches. Staff only, and deliberately thin (see the module docstring).

        Rows with no ticket are left out entirely rather than sent with an empty token: the
        scanner's only two questions are "which token is this" and "what do I call them", and a
        person with neither is not somebody the door can do anything about.
        """
        event = self.get_object()
        if not event.is_staff_member(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        expire_promotions(event, request.user)
        rows = event.attendances.filter(ticket_token__isnull=False).select_related(
            'attendee', 'attendee__profile'
        ).order_by('created_at', 'id')
        return Response([
            {
                'token': row.ticket_token,
                'short_code': short_code(row.ticket_token),
                'name': mask_name(_display_name(row.attendee)),
                'status': row.status,
                'checked_in_at': row.checked_in_at,
                'checked_out_at': row.checked_out_at,
                'inside': row.is_inside,
            }
            for row in rows
        ])

    @action(detail=True, methods=['get', 'post'], url_path='scans', permission_classes=_AUTH)
    def scans(self, request, pk=None):
        event = self.get_object()
        if request.method == 'POST':
            return self._post_scans(event, request)
        return self._scan_log(event, request)

    def _post_scans(self, event, request):
        """A phone's queue. Any staff member may scan — that is what the volunteer role is for,
        exactly as the check-in button already works."""
        if not event.is_staff_member(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        payload = request.data
        raw = payload.get('scans') if isinstance(payload, dict) else payload
        if not isinstance(raw, list):
            return Response({'detail': 'scans must be a list.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(raw) > MAX_BATCH:
            return Response({'detail': 'batch_too_large', 'max': MAX_BATCH},
                            status=status.HTTP_400_BAD_REQUEST)
        cleaned = []
        for item in raw:
            if not isinstance(item, dict):
                return Response({'detail': 'each scan must be an object.'}, status=status.HTTP_400_BAD_REQUEST)
            nonce = str(item.get('client_nonce') or '').strip()
            if not nonce:
                return Response({'detail': 'every scan needs a client_nonce.'}, status=status.HTTP_400_BAD_REQUEST)
            client_at = item.get('client_at')
            if isinstance(client_at, str):
                client_at = parse_datetime(client_at)
                if client_at is not None and timezone.is_naive(client_at):
                    client_at = timezone.make_aware(client_at)
            cleaned.append({**item, 'client_nonce': nonce, 'client_at': client_at})
        rows = apply_batch(event, request.user, cleaned)
        return Response({
            'results': [self._scan_result(row) for row in rows],
            'counts': self._counts(event),
        })

    def _scan_log(self, event, request):
        """The log. **Organisers only** — a volunteer scans, an organiser reviews. Names are masked
        here too: an organiser can already read the full roster on the registrations panel, so the
        log adds nothing by repeating it and would otherwise be a second, longer-lived copy of the
        same personal data in a table nobody ever edits (house rule 12 makes it append-only, which
        cuts both ways)."""
        if not event.can_organise(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        limit = 200
        rows = ScanEvent.objects.filter(event=event).select_related(
            'attendance__attendee', 'attendance__attendee__profile', 'scanned_by', 'scanned_by__profile'
        )[:limit]
        return Response({
            'counts': self._counts(event),
            'scans': [self._scan_result(row, with_who=True) for row in rows],
        })

    def _counts(self, event) -> dict:
        """`COUNT`s, never a running total (house rule 5). `entries` and `exits` count the scans
        that CHANGED something, so a refused or duplicated scan never inflates them, and `inside`
        is recomputed from the attendance rows rather than derived as entries − exits, which would
        drift the first time a button check-in happened beside a scanned one."""
        base = ScanEvent.objects.filter(event=event)
        return {
            'entries': base.filter(direction='entry', result='admitted').count(),
            'exits': base.filter(direction='exit', result='exited').count(),
            'inside': inside_count(event),
            'refused': base.filter(result__in=['not_going', 'unknown']).count(),
            'collisions': base.filter(result='collision').count(),
        }

    def _scan_result(self, row, with_who=False) -> dict:
        out = {
            'client_nonce': row.client_nonce,
            'result': row.result,
            'direction': row.direction,
            'token': row.token_seen,
            'name': mask_name(_display_name(row.attendance.attendee)) if row.attendance_id else '',
            'client_at': row.client_at,
            'received_at': row.received_at,
            'is_offline_sync': row.is_offline_sync,
            'device_label': row.device_label,
        }
        if with_who:
            out['scanned_by'] = mask_name(_display_name(row.scanned_by)) if row.scanned_by_id else ''
        return out

    @action(detail=True, methods=['get'], url_path='badge-sheet', permission_classes=_AUTH)
    def badge_sheet(self, request, pk=None):
        """What gets printed and hung round necks. Organisers only, and the minors' rule is applied
        here rather than in the page, so a badge sheet fetched by any other client obeys it too."""
        event = self.get_object()
        if not event.can_organise(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        expire_promotions(event, request.user)
        rows = event.attendances.filter(status='going').select_related(
            'attendee', 'attendee__profile'
        ).order_by('created_at', 'id')
        return Response({
            'event_title': event.title,
            'badges': [
                {
                    'name': _badge_name(row.attendee),
                    'is_minor': is_minor(row.attendee),
                    'short_code': short_code(row.ticket_token or ''),
                }
                for row in rows
            ],
        })
