"""GET /api/notifications/ (own inbox, newest first) + POST .../{id}/read/ + POST
.../read-all/ — a recipient only ever sees/acts on their own notifications, enforced by
`get_queryset` filtering on `request.user`, not by trusting an id the client sent.

Plus GET /api/notifications/stream/ (below) — Phase 4's real-time delivery piece, see that view's
own doc comment for the full design (CLAUDE.md Section 18 item 9's own writeup named this exact
approach — SSE, a DB-polling loop, no Channels/Redis — as the right first step before this was built).
"""

import json
import time

from django.http import JsonResponse, StreamingHttpResponse
from rest_framework import mixins, permissions, renderers, status, viewsets
from rest_framework.authentication import TokenAuthentication
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from . import redisbus
from .models import Notification
from .serializers import NotificationSerializer


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user).select_related(
            'actor', 'actor__profile'
        )

    @action(detail=True, methods=['post'])
    def read(self, request, pk=None):
        notification = self.get_object()
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=['is_read'])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=['post'], url_path='read-all')
    def read_all(self, request):
        self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response(status=status.HTTP_204_NO_CONTENT)


class EventStreamRenderer(renderers.BaseRenderer):
    """A real, found-during-browser-verification bug fix, not a speculative addition: DRF's own
    content negotiation runs BEFORE `NotificationStreamView.get()` is ever called, matching the
    incoming request's `Accept` header against the view's own declared renderers — and the browser's
    native `EventSource` API sets `Accept: text/event-stream` on every request it makes, a real
    header no `curl` call happens to send by default (`curl`'s own default `Accept: */*` matches
    anything, which is exactly why an earlier round of manual `curl` verification against this
    endpoint looked completely correct while a REAL browser's own `EventSource` connection was
    silently failing with a 406 the whole time — confirmed by reproducing it with
    `curl -H "Accept: text/event-stream"` once the real browser test caught it). Declaring this one
    real renderer, matching that exact media type, is what makes content negotiation succeed; its
    own `render()` method is never actually called, since `NotificationStreamView.get()` returns a
    raw `StreamingHttpResponse` that bypasses DRF's render step entirely — this class exists purely
    to satisfy negotiation, not to do any real rendering work.
    """

    media_type = 'text/event-stream'
    format = 'txt'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data


class QueryParamTokenAuthentication(TokenAuthentication):
    """Reads the auth token from `?token=...` instead of the `Authorization` header — needed ONLY
    by `NotificationStreamView` below, since the browser's native `EventSource` API cannot set
    custom request headers at all (a real, permanent limitation of that API, not a workaround for
    something DRF could otherwise do — there is no header-based alternative available to a plain
    `new EventSource(url)` call).

    ⚠️ A real, honest security tradeoff, not silently accepted: a token in a URL query string can
    end up in server access logs, browser history, and (if this page ever linked out to a third
    party) a `Referer` header — none of which a header-based token risks the same way. Mitigated
    two ways, both real: (1) this authentication class is wired onto ONLY this one streaming view,
    never added to `REST_FRAMEWORK`'s global `DEFAULT_AUTHENTICATION_CLASSES` — every other endpoint
    in this app keeps requiring the real, header-based `TokenAuthentication`; (2) a real production
    deployment would very likely want a short-lived, purpose-scoped SSE ticket (minted by a real,
    header-authenticated endpoint immediately before opening the stream, valid for a few minutes)
    instead of the same long-lived bearer token used everywhere else — not built here, since this
    prototype has no session/ticket infrastructure to build it on, but flagged plainly rather than
    left as an unstated gap.
    """

    def authenticate(self, request):
        token = request.query_params.get('token')
        if not token:
            return None
        return self.authenticate_credentials(token)


# Real, stated tuning constants, not magic numbers scattered through the generator below.
SSE_POLL_INTERVAL_SECONDS = 3
# Caps how long any one connection stays open server-side — `EventSource` auto-reconnects the
# instant a stream closes (its own native, built-in behavior), so this bounds per-connection
# resource usage on Django's dev server (no async event loop here, just a thread held open per
# connection for as long as the generator keeps yielding) without costing the user anything more
# than a brief, invisible reconnect every 10 minutes.
SSE_MAX_CONNECTION_SECONDS = 600
# Under Redis pub/sub the stream is idle-blocked on a socket, so keep-alives ride the subscribe
# timeout — 15s is comfortably inside any proxy's idle window while waking the thread 5x less
# often than the 3s DB-poll cadence the fallback keeps.
SSE_KEEPALIVE_SECONDS = 15


class NotificationStreamView(APIView):
    """GET /api/notifications/stream/?token=... — real-time delivery for the notifications this app
    already creates (`notify()`, `notifications/services.py`), closing the gap CLAUDE.md Section 18
    item 9 already documented in detail: before this, a new notification was only ever discovered on
    the next explicit fetch (a page mount, opening the bell, a fresh login), never pushed. Deliberately
    Server-Sent Events over a plain DB-polling loop, not Django Channels/WebSockets — the same
    reasoning that section's own writeup already gave: SSE is a single long-lived HTTP response DRF
    can serve directly, no new infrastructure dependency (a channel layer, an ASGI server, Redis);
    Channels would be a real architectural addition disproportionate to what this app's own real
    event volume needs. One-way only (server → client), which is exactly the direction this feature
    needs — nothing about a notification ever needs the client to push data back over this
    connection.

    `notify()` itself, the `Notification` model, and every existing call site are completely
    unchanged — this hooks in as a pure READER of the same table every other notification surface
    already reads, not a new write path. What "real-time" means here, honestly: a new row becomes
    visible to a connected client within `SSE_POLL_INTERVAL_SECONDS`, not the instant it's created —
    a genuine, bounded latency, not literal push, and a real limitation of the DB-polling approach
    worth stating rather than overselling as truly instant.
    """

    authentication_classes = [QueryParamTokenAuthentication]
    permission_classes = [permissions.IsAuthenticated]
    # See EventStreamRenderer's own doc comment above for why this is required, not decorative —
    # without it, DRF's content negotiation 406s every real EventSource connection (which sends
    # `Accept: text/event-stream`) before `get()` below is ever called, while a plain `curl` call
    # (default `Accept: */*`) succeeds regardless — the exact gap that let this ship once already.
    renderer_classes = [EventStreamRenderer]

    def get(self, request):
        user = request.user
        # Only notifications created AFTER the stream opens are ever sent — the client's own initial
        # `GET /api/notifications/` (on page mount) already carries the full existing history; replaying
        # it a second time over the stream would just duplicate what's already rendered.
        last_id = (
            Notification.objects.filter(recipient=user).order_by('-id').values_list('id', flat=True).first()
            or 0
        )

        bus = redisbus.get_redis()
        if bus is not None and not redisbus.acquire_stream_slot(
            bus, user.pk, SSE_MAX_CONNECTION_SECONDS
        ):
            # The cap working, not an error path: this account already holds its two live streams
            # (redisbus.STREAM_SLOT_LIMIT — the reasoning lives there). A plain Django JsonResponse,
            # not a DRF Response, so nothing tries to negotiate this through EventStreamRenderer.
            # A browser EventSource treats a non-200 as terminal and stops reconnecting, which is
            # exactly right: the extra tab keeps working, it just isn't live.
            return JsonResponse(
                {'detail': 'Too many open notification streams for this account.'}, status=429
            )

        def emit(notification_id, payload):
            return f'id: {notification_id}\ndata: {json.dumps(payload)}\n\n'

        def pending_from_db():
            nonlocal last_id
            rows = Notification.objects.filter(
                recipient=user, id__gt=last_id
            ).select_related('actor', 'actor__profile').order_by('id')
            for notification in rows:
                payload = NotificationSerializer(notification).data
                yield emit(notification.id, payload)
                last_id = notification.id

        def event_stream_redis():
            # Pub/sub delivery: `notify()` publishes every row (redisbus.publish_notification), so
            # an idle stream BLOCKS on the socket — zero database queries, zero wakeups between
            # events, where the fallback below polls the table every few seconds per connection.
            # Subscribe FIRST, then drain the table once: anything created between the `last_id`
            # snapshot above and the subscribe arrives via that drain, anything after via pub/sub,
            # and the `id <= last_id` guard deduplicates the overlap. Keep-alives ride on the
            # subscribe timeout instead of a poll interval.
            nonlocal last_id
            pubsub = bus.pubsub(ignore_subscribe_messages=True)
            try:
                pubsub.subscribe(redisbus.channel_for(user.pk))
                yield 'retry: 3000\n\n'
                yield from pending_from_db()
                started_at = time.monotonic()
                while time.monotonic() - started_at < SSE_MAX_CONNECTION_SECONDS:
                    try:
                        message = pubsub.get_message(timeout=SSE_KEEPALIVE_SECONDS)
                    except Exception:
                        # Redis died mid-stream. Close rather than limp: EventSource reconnects in
                        # 3s and the fresh request re-decides which transport it gets.
                        return
                    if message is None:
                        yield ': keep-alive\n\n'
                        continue
                    payload = json.loads(message['data'])
                    if payload.get('id', 0) <= last_id:
                        continue
                    yield emit(payload['id'], payload)
                    last_id = payload['id']
            finally:
                try:
                    pubsub.close()
                finally:
                    redisbus.release_stream_slot(bus, user.pk)

        def event_stream_polling():
            # The pre-Redis behavior, kept verbatim as the fallback so a clone with no Redis daemon
            # still gets live-ish delivery (CLAUDE.md §17H's honest bounded latency).
            nonlocal last_id
            yield 'retry: 3000\n\n'
            started_at = time.monotonic()
            while time.monotonic() - started_at < SSE_MAX_CONNECTION_SECONDS:
                yield from pending_from_db()
                # An SSE comment line (`:`) — invisible to the client's own event handlers, its only
                # job is keeping the connection alive through anything that might otherwise treat a
                # quiet connection as dead (a proxy, a load balancer).
                yield ': keep-alive\n\n'
                time.sleep(SSE_POLL_INTERVAL_SECONDS)

        stream = event_stream_redis() if bus is not None else event_stream_polling()
        response = StreamingHttpResponse(stream, content_type='text/event-stream')
        response['Cache-Control'] = 'no-cache'
        # Meaningful only behind an nginx-style reverse proxy (tells it not to buffer the stream,
        # which would defeat the whole point of a live push) — harmless to set unconditionally, and
        # a real deployment would very likely sit behind exactly that kind of proxy.
        response['X-Accel-Buffering'] = 'no'
        return response
