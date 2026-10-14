"""`POST /api/client-errors/` — where the browser's error beacon lands (`client_errors.py` has the
contract). Anonymous, unauthenticated by construction, throttled per IP, 8 KB, always 204.

**Why no authentication class at all** (`authentication_classes = []`): the beacon is sent without
an `Authorization` header, and `navigator.sendBeacon` may carry a session cookie to the API origin.
With no authenticator nothing reads either one, so a report cannot be tied to an account even by
accident — and with no `SessionAuthentication` there is no CSRF check to fail on that cookie.

**Why 204 for nearly everything**, including a dropped report: nobody reads the answer (a beacon
cannot), and an answer that differed by whether the report was stored would only tell a prober
which filter it tripped. The exceptions are the honest refusals HTTP has words for: 413 for a body
over the cap, 429 from the throttle, 400 for a body that is not a JSON object at all.

**Why the body is read raw.** The browser sends it as `text/plain` — the one content type
`sendBeacon` can send cross-origin without a CORS preflight (which a beacon cannot answer) — so
DRF's JSON parser would refuse it; the view parses the bytes itself, after the size check.
"""

import json

from rest_framework import status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from moderation.services import is_feature_enabled
from telemetry.middleware import objects_to_analytics

from . import client_errors

FLAG = 'client_errors'


class ClientErrorIngestView(APIView):
    authentication_classes = []
    permission_classes = []
    parser_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'client_error'

    def post(self, request):
        no_content = Response(status=status.HTTP_204_NO_CONTENT)
        try:
            declared = int(request.META.get('CONTENT_LENGTH') or 0)
        except ValueError:
            declared = 0
        if declared > client_errors.MAX_BODY_BYTES:
            return Response(status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        # Sec-GPC / DNT: the browser half never sends under either signal; this is the server
        # honouring the objection anyway, for a client that did (LINKING-AND-ERRORS.md §3.2 item 5).
        if objects_to_analytics(request) or not is_feature_enabled(FLAG):
            return no_content
        body = request._request.read(client_errors.MAX_BODY_BYTES + 1)
        if len(body) > client_errors.MAX_BODY_BYTES:
            return Response(status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        try:
            raw = json.loads(body.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            return Response(status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(raw, dict):
            return Response(status=status.HTTP_400_BAD_REQUEST)
        report = client_errors.sanitize(raw)
        if report is not None:
            client_errors.record(report, request.META.get('HTTP_USER_AGENT', ''))
        return no_content
