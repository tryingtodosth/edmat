"""`/api/auth/sso/…` — HTTP in, `services.py` calls, HTTP out. See `sso/CLAUDE.md` for the flow.

The kill switch (`social_login`) is read with a plain `is_feature_enabled()` rather than
`feature_gate`, for the reason the age gate is (`accounts/CLAUDE.md`): these endpoints are anonymous,
`feature_gate`'s staff bypass means nothing to somebody who is not signed in yet, and off has to
mean *absent* — the providers list empty and every flow endpoint 404 — not 403. The callback is the
exception: a browser already half-way through a round trip when the switch flips is redirected to
the done page with `flag_off`, because a bare JSON 404 is the one thing that would tell it nothing.

Managing what is already linked (list, unlink) is NOT gated: a kill switch hides a feature, it does
not hold a person's own sign-in methods hostage.
"""

from __future__ import annotations

from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.minors import is_minor
from accounts.serializers import ProfileSerializer

from . import providers, services
from .models import INTENT_LINK, INTENT_LOGIN, SsoIdentity

NOT_FOUND = Response(status=status.HTTP_404_NOT_FOUND)


def _enabled_provider(provider_id: str):
    if not providers.flag_on():
        return None
    provider = providers.get(provider_id)
    if provider is None or not provider.is_configured():
        return None
    return provider


def _session_payload(user, request) -> dict:
    token, _created = Token.objects.get_or_create(user=user)
    return {'token': token.key, 'profile': ProfileSerializer(user.profile, context={'request': request}).data}


def _identity_payload(identity: SsoIdentity) -> dict:
    return {
        'id': identity.pk,
        'provider': identity.provider,
        'email': identity.email,
        'email_verified': identity.email_verified,
        'linked_at': identity.linked_at,
        'last_login_at': identity.last_login_at,
    }


class ProvidersView(APIView):
    """GET /api/auth/sso/providers/ — the buttons to draw. Empty while the flag is off."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({'providers': [{'id': p.id, 'label': p.label} for p in providers.enabled_providers()]})


class StartView(APIView):
    """POST /api/auth/sso/<provider>/start/ {intent, next} → {authorization_url, browser_key}."""

    permission_classes = [permissions.AllowAny]
    throttle_scope = 'sso_start'

    def post(self, request, provider_id):
        provider = _enabled_provider(provider_id)
        if provider is None:
            return NOT_FOUND
        intent = request.data.get('intent') or INTENT_LOGIN
        if intent not in (INTENT_LOGIN, INTENT_LINK):
            return Response({'intent': ['invalid']}, status=status.HTTP_400_BAD_REQUEST)
        if intent == INTENT_LINK:
            if not request.user.is_authenticated:
                return Response({'detail': 'not_signed_in'}, status=status.HTTP_401_UNAUTHORIZED)
            # A child's account is a guardian's to run (accounts/minors.py), and is made without an
            # address on purpose; attaching an outside account to it is not the child's call.
            if is_minor(request.user):
                return Response({'detail': 'minor'}, status=status.HTTP_403_FORBIDDEN)
        services.purge()
        url, browser_key = services.start(
            provider,
            intent=intent,
            user=request.user if intent == INTENT_LINK else None,
            next_path=request.data.get('next') or '',
            redirect_uri=services.callback_url(provider, request),
        )
        return Response({'authorization_url': url, 'browser_key': browser_key})


class CallbackView(APIView):
    """GET (or POST, for a form_post provider) /api/auth/sso/<provider>/callback/ → a redirect to
    the SPA. Never a token in a URL: what it carries is a two-minute single-use code or a ticket,
    each useless without the browser key held by the tab that started the attempt.

    No authentication classes at all: this is a top-level navigation from the provider, it carries
    no token, and with SessionAuthentication out of the way there is no CSRF check to trip on
    Apple's cross-site POST. The `state` is what authenticates the request."""

    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]
    parser_classes = [FormParser, MultiPartParser]
    throttle_scope = 'sso_callback'

    def _handle(self, request, provider_id, params):
        provider = providers.get(provider_id)
        if provider is None:
            return HttpResponseRedirect(services.error_url('not_configured'))
        if not providers.flag_on():
            return HttpResponseRedirect(services.error_url('flag_off', provider))
        if not provider.is_configured():
            return HttpResponseRedirect(services.error_url('not_configured', provider))
        # The answer must arrive the way this provider sends it — a query for Google and Microsoft,
        # a form POST for Apple. Anything else did not come from the provider.
        expected = 'POST' if provider.response_mode == 'form_post' else 'GET'
        if request.method != expected:
            return HttpResponseRedirect(services.error_url('state_invalid', provider))
        return HttpResponseRedirect(services.finish_callback(provider, params))

    def get(self, request, provider_id):
        return self._handle(request, provider_id, request.query_params.dict())

    def post(self, request, provider_id):
        return self._handle(request, provider_id, request.data.dict() if hasattr(request.data, 'dict') else dict(request.data))


class ExchangeView(APIView):
    """POST /api/auth/sso/exchange/ {code, browser_key} → {kind:'login', token, profile, next} or
    {kind:'link', identity, next}."""

    permission_classes = [permissions.AllowAny]
    parser_classes = [JSONParser]
    throttle_scope = 'sso_exchange'

    def post(self, request):
        if not providers.flag_on():
            return NOT_FOUND
        try:
            kind, obj, row = services.redeem_code(
                str(request.data.get('code') or ''), str(request.data.get('browser_key') or ''), request.user
            )
        except services.Refusal as refusal:
            code = status.HTTP_409_CONFLICT if refusal.code == 'already_linked' else status.HTTP_400_BAD_REQUEST
            return Response({'detail': refusal.code}, status=code)
        if kind == 'login':
            return Response({'kind': 'login', 'next': row.next_path, **_session_payload(obj, request)})
        from telemetry.audit import record_audit

        record_audit(request, action='password_change', target_type='sso_identity', target_id=obj.pk,
                     summary=f'Linked {obj.provider} sign-in', detail={'provider': obj.provider})
        services.notify_linked(request.user, obj.provider)
        return Response({'kind': 'link', 'next': row.next_path, 'identity': _identity_payload(obj)})


class TicketView(APIView):
    """POST /api/auth/sso/ticket/ {ticket, browser_key} → what the complete page pre-fills. A POST,
    so neither secret lands in a URL the API logs or a proxy keeps."""

    permission_classes = [permissions.AllowAny]
    parser_classes = [JSONParser]
    throttle_scope = 'sso_exchange'

    def post(self, request):
        if not providers.flag_on():
            return NOT_FOUND
        row = services.pending_ticket(str(request.data.get('ticket') or ''), str(request.data.get('browser_key') or ''))
        if row is None:
            return Response({'detail': 'ticket_invalid'}, status=status.HTTP_400_BAD_REQUEST)
        from moderation.services import is_feature_enabled

        return Response({
            'provider': row.provider,
            'email': row.email,
            'email_verified': row.email_verified,
            'suggested_name': row.suggested_name,
            'suggested_username': services.suggest_username(row.email, row.suggested_name),
            'asks_age': is_feature_enabled('age_verification'),
            'expires_at': row.expires_at,
        })


class CompleteSignupView(APIView):
    """POST /api/auth/sso/complete/ {ticket, browser_key, username, display_name, birth_year,
    accept_terms, preferred_locale} → 201 {token, profile, next}."""

    permission_classes = [permissions.AllowAny]
    parser_classes = [JSONParser]
    # The same budget as /register: it is the same act, creating an account.
    throttle_scope = 'register'

    def post(self, request):
        if not providers.flag_on():
            return NOT_FOUND
        data = request.data
        ticket = str(data.get('ticket') or '')
        row = services.pending_ticket(ticket, str(data.get('browser_key') or ''))
        next_path = row.next_path if row else ''
        user, errors = services.complete_signup(
            ticket=ticket,
            browser_key=str(data.get('browser_key') or ''),
            username=str(data.get('username') or ''),
            display_name=str(data.get('display_name') or ''),
            birth_year=data.get('birth_year'),
            accept_terms=data.get('accept_terms'),
            preferred_locale=str(data.get('preferred_locale') or 'pl'),
        )
        if errors:
            conflict = errors.get('detail') in ('email_in_use', 'already_linked')
            return Response(errors, status=status.HTTP_409_CONFLICT if conflict else status.HTTP_400_BAD_REQUEST)
        return Response({'next': next_path, **_session_payload(user, request)}, status=status.HTTP_201_CREATED)


class IdentitiesView(APIView):
    """GET /api/auth/sso/identities/ → my linked providers, and whether I have a password."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        rows = SsoIdentity.objects.filter(user=request.user)
        return Response({
            'identities': [_identity_payload(i) for i in rows],
            'has_password': request.user.has_usable_password(),
        })


class IdentityDetailView(APIView):
    """DELETE /api/auth/sso/identities/<id>/ → 204, or 409 {detail:'set_password_first'}.

    The identity row is deleted outright — it is a credential, not a record of a decision — and the
    fact of the unlink is kept as an `AuditEvent` in the person's own log shard."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk):
        identity = get_object_or_404(SsoIdentity, pk=pk, user=request.user)
        reason = services.unlink_refusal(request.user, identity)
        if reason:
            return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)
        provider_id, identity_pk = identity.provider, identity.pk
        identity.delete()
        from telemetry.audit import record_audit

        record_audit(request, action='password_change', target_type='sso_identity', target_id=identity_pk,
                     summary=f'Unlinked {provider_id} sign-in', detail={'provider': provider_id})
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---- confirm-and-link (LINKING-AND-ERRORS.md §2.4) -----------------------------------------------------

def _linked_session(request, user, identity, row) -> Response:
    """The proof passed and the identity is attached: audit it, mail the account (rule 5), and hand
    back the same {token, profile} LoginView does — in a POST body, never a URL."""
    from telemetry.audit import record_audit

    record_audit(request, action='password_change', target_type='sso_identity', target_id=identity.pk,
                 summary=f'Linked {identity.provider} sign-in (confirmed at sign-in)',
                 detail={'provider': identity.provider, 'via': 'confirm_and_link'})
    services.notify_linked(user, identity.provider)
    return Response({'kind': 'login', 'next': row.next_path, **_session_payload(user, request)})


def _refusal(refusal) -> Response:
    conflict = refusal.code in ('already_linked',)
    return Response({'detail': refusal.code}, status=status.HTTP_409_CONFLICT if conflict else status.HTTP_400_BAD_REQUEST)


class LinkTicketView(APIView):
    """POST /api/auth/sso/link/ticket/ {ticket, browser_key} → {provider, email, methods, expires_at}.
    Says no more than the done page's old `email_in_use` did, plus which proofs this account
    supports — which is the whole point of the page."""

    permission_classes = [permissions.AllowAny]
    parser_classes = [JSONParser]
    throttle_scope = 'sso_exchange'

    def post(self, request):
        if not providers.flag_on():
            return NOT_FOUND
        row = services.pending_link_ticket(str(request.data.get('ticket') or ''), str(request.data.get('browser_key') or ''))
        if row is None:
            return Response({'detail': 'ticket_invalid'}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            'provider': row.provider,
            'email': row.email,
            'methods': services.link_methods(row.user),
            'mail_requested': bool(row.mail_nonce),
            'expires_at': row.expires_at,
        })


class LinkPasswordView(APIView):
    """POST /api/auth/sso/link/password/ {ticket, browser_key, password}. Throttled exactly like
    /login (per IP), plus five wrong passwords kill the ticket."""

    permission_classes = [permissions.AllowAny]
    parser_classes = [JSONParser]

    def get_throttles(self):
        from accounts.throttles import LoginRateThrottle

        return [LoginRateThrottle()]

    def post(self, request):
        if not providers.flag_on():
            return NOT_FOUND
        try:
            user, identity, row = services.confirm_link_by_password(
                str(request.data.get('ticket') or ''), str(request.data.get('browser_key') or ''),
                str(request.data.get('password') or ''),
            )
        except services.Refusal as refusal:
            return _refusal(refusal)
        return _linked_session(request, user, identity, row)


class LinkEmailView(APIView):
    """POST /api/auth/sso/link/email/ {ticket, browser_key} → 202. Mails the confirmation link to
    the account's own confirmed address. Throttled like the confirmation-mail resend."""

    permission_classes = [permissions.AllowAny]
    parser_classes = [JSONParser]
    throttle_scope = 'mail_resend'

    def post(self, request):
        if not providers.flag_on():
            return NOT_FOUND
        try:
            services.request_link_mail(str(request.data.get('ticket') or ''), str(request.data.get('browser_key') or ''))
        except services.Refusal as refusal:
            return _refusal(refusal)
        return Response({'sent': True}, status=status.HTTP_202_ACCEPTED)


class LinkEmailConfirmView(APIView):
    """POST /api/auth/sso/link/email/confirm/ {token, browser_key} — the mailed link's landing page
    posts here. Works only in the browser that started the sign-in (`link_other_browser`)."""

    permission_classes = [permissions.AllowAny]
    parser_classes = [JSONParser]
    throttle_scope = 'sso_exchange'

    def post(self, request):
        if not providers.flag_on():
            return NOT_FOUND
        try:
            user, identity, row = services.confirm_link_by_mail(
                str(request.data.get('token') or ''), str(request.data.get('browser_key') or '')
            )
        except services.Refusal as refusal:
            return _refusal(refusal)
        return _linked_session(request, user, identity, row)
