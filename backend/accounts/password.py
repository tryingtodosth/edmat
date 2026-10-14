"""`GET/POST /api/auth/me/password/` — set a first password, or change the one you have.

Two jobs, one rule. An account that signs in only through Google / Apple / GitHub / Facebook
(`sso/`) has no usable password: it may SET one without being asked for a current password it does
not have — that is what lets it unlink its last provider afterwards (`sso/services.py:
unlink_refusal`). An account WITH a password must give the current one to change it: a session left
open on a shared computer must not be enough to lock the owner out.

Its own module rather than another class in `views.py`, which several pieces of work edit at once.
Refusals carry their reason (house rule 6): `current_password_required`, `current_password_wrong`,
or Django's own validator messages under `new_password`. Every success writes an `AuditEvent`
(`action='password_change'`), the same action an SSO link or unlink writes.

The account keeps its API token (DRF has one per user — rotating it would sign out the very session
that just proved the current password). A password reset by email is the path that signs everybody
out (`mail/services.py: reset_password`).
"""

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView


class PasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'password_change'

    def get(self, request):
        return Response({'has_password': request.user.has_usable_password()})

    def post(self, request):
        user = request.user
        had_password = user.has_usable_password()
        current = request.data.get('current_password') or ''
        new = request.data.get('new_password') or ''
        if had_password:
            if not current:
                return Response({'current_password': ['current_password_required']}, status=status.HTTP_400_BAD_REQUEST)
            if not user.check_password(current):
                return Response({'current_password': ['current_password_wrong']}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(new, str) or not new:
            return Response({'new_password': ['new_password_required']}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_password(new, user)
        except ValidationError as exc:
            return Response({'new_password': list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(new)
        user.save(update_fields=['password'])

        from telemetry.audit import record_audit

        record_audit(
            request,
            action='password_change',
            target_type='user',
            target_id=user.pk,
            summary='Password changed' if had_password else 'First password set',
            detail={'had_password': had_password},
        )
        return Response({'has_password': True})
