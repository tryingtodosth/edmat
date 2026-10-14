"""The account page's endpoints: download my data, delete my account, and take the deletion back.

    GET  /api/auth/me/export/          → the JSON file (`accounts/export.py`), throttled 3/day
    GET  /api/auth/me/erasure/         → what deleting would do, and whether it can be asked for
    POST /api/auth/me/erasure/         → {password, username} — switch off now, erase in 14 days
    POST /api/auth/erasure/cancel/     → {username, password} or {token} — take it back (signed out)

Its own module rather than more classes in `views.py`, which several pieces of work edit at once
(the same reason `password.py` is its own). The rules all live in `accounts/erasure.py`.

**Re-authentication: the current password, plus the username typed out.** The password proves the
person at the keyboard is the owner and not whoever found an open session; typing the username is the
"I mean it" step. An account that signs in only through Google / Apple / Microsoft / … has no
password, and is refused with `password_required`: Settings → Sign-in methods sets one (`password.py`)
— which a stolen session could do too, so the second half of the defence is the mail: every request
mails the confirmed address a link that cancels it (`erasure._mail_cancel_link`), and signing in
during the 14 days offers the same. A fresh provider round-trip as the re-authentication was the
alternative, and needs a new `intent` threaded through every provider's callback; the password path
already exists and is no weaker.
"""

from django.contrib.auth import get_user_model
from django.http import HttpResponse
from rest_framework import permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.response import Response
from rest_framework.views import APIView

from . import erasure
from .throttles import LoginRateThrottle, LoginUsernameRateThrottle

User = get_user_model()


def _iso(dt):
    return dt.isoformat() if dt else None


def _state(user) -> dict:
    live = erasure.live_request(user)
    return {
        'status': live.status if live else 'none',
        'due_at': _iso(live.due_at) if live else None,
        'grace_days': erasure.grace_days(),
    }


class AccountErasureView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'account_erasure'

    def get_throttles(self):
        # Only the POST checks a password; reading the plan should not spend the budget.
        if self.request.method == 'POST':
            return super().get_throttles()
        return []

    def get(self, request):
        user = request.user
        return Response({
            **_state(user),
            # What the confirmation asks to be typed — the frontend's profile shape has no username.
            'username': user.username,
            'refusal': erasure.self_refusal(user),
            'blockers': erasure.blockers(user),
            'children': [
                {'id': c.pk, 'display_name': getattr(getattr(c, 'profile', None), 'display_name', '') or c.username}
                for c in erasure.sole_guardian_children(user)
            ],
            'plan': erasure.preview(user),
        })

    def post(self, request):
        user = request.user
        refusal = erasure.self_refusal(user)
        if refusal:
            return Response({'reason': refusal}, status=status.HTTP_400_BAD_REQUEST)
        typed = (request.data.get('username') or '').strip()
        if typed.lower() != user.username.lower():
            return Response({'reason': 'username_mismatch'}, status=status.HTTP_400_BAD_REQUEST)
        if not user.check_password(request.data.get('password') or ''):
            return Response({'reason': 'wrong_password'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            row = erasure.request_erasure(user, requested_by=user)
        except erasure.Refusal as refused:
            return Response({'reason': refused.reason, **refused.detail}, status=refused.status)
        return Response(
            {'status': row.status, 'due_at': _iso(row.due_at), 'grace_days': erasure.grace_days()},
            status=status.HTTP_202_ACCEPTED,
        )


def _resolve(identifier: str):
    identifier = (identifier or '').strip()
    if not identifier:
        return None
    if '@' in identifier:
        return User.objects.filter(email__iexact=identifier).first()
    return User.objects.filter(username=identifier).first()


def pending_login_refusal(identifier: str, password: str):
    """For `LoginView`: when `authenticate()` said no, was it because the account is waiting to be
    erased? Only answered for the RIGHT password — the same knowledge a successful sign-in needs, so
    it tells a stranger nothing. Returns the 403 body, or None."""
    user = _resolve(identifier)
    if user is None or user.is_active or not user.check_password(password or ''):
        return None
    live = erasure.live_request(user)
    if live is None or live.status != 'pending':
        return None
    return {
        'detail': 'erasure_pending',
        'due_at': _iso(live.due_at),
        'can_cancel': not live.by_guardian,
    }


class CancelErasureView(APIView):
    """Signed out by definition — the account is switched off. Two ways in: the password (from the
    sign-in page, which offers this when the login answered `erasure_pending`) or the link in the
    notice mail. The password route signs the person straight back in; the link route only cancels,
    because a link in a mailbox is not a password."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [LoginRateThrottle, LoginUsernameRateThrottle]

    def post(self, request):
        token = request.data.get('token')
        if token:
            user, reason = erasure.user_for_cancel_token(token)
            if user is None:
                return Response({'reason': reason}, status=status.HTTP_400_BAD_REQUEST)
            refusal = erasure.cancel_refusal(user)
            if refusal:
                return Response({'reason': refusal}, status=status.HTTP_409_CONFLICT)
            erasure.cancel_erasure(user, by=user)
            return Response({'cancelled': True})

        user = _resolve(request.data.get('username', ''))
        if user is None or not user.check_password(request.data.get('password') or ''):
            return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)
        refusal = erasure.cancel_refusal(user)
        if refusal:
            return Response({'reason': refusal}, status=status.HTTP_409_CONFLICT)
        erasure.cancel_erasure(user, by=user)
        from .serializers import ProfileSerializer

        token, _created = Token.objects.get_or_create(user=user)
        return Response({
            'cancelled': True,
            'token': token.key,
            'profile': ProfileSerializer(user.profile, context={'request': request}).data,
        })


class ExportView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'account_export'

    def get(self, request):
        import json

        from django.utils import timezone

        from .export import build_export

        data = build_export(request.user, request)
        stamp = timezone.localdate().isoformat()
        response = HttpResponse(
            json.dumps(data, ensure_ascii=False, indent=1),
            content_type='application/json; charset=utf-8',
        )
        response['Content-Disposition'] = f'attachment; filename="edmat-data-{request.user.pk}-{stamp}.json"'
        response['Cache-Control'] = 'no-store'
        return response
