"""Two surfaces: the account holder's (confirm, reset, the digest switch) and the superuser's Mail
tab. The tab is SUPERUSER-only, not staff: it shows every address anybody registered with and the
text of everything mailed to the project, which is more than a moderator's job needs."""

from django.conf import settings
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from . import inbox, services
from .models import InboundEmail, OutboundEmail
from .serializers import (
    InboundEmailListSerializer,
    InboundEmailSerializer,
    OutboundEmailListSerializer,
    OutboundEmailSerializer,
)
from .transport import transport_name

LIST_LIMIT = 200


class IsSuperuser(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


# ---- the account holder ----------------------------------------------------------------------

class ConfirmEmailView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        user, reason = services.confirm(request.data.get('token', ''))
        if user is None:
            return Response({'detail': reason}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'email': user.email, 'email_confirmed': True})


class ResendConfirmationView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = 'mail_resend'

    def post(self, request):
        if not request.user.email:
            return Response({'detail': 'no_email'}, status=status.HTTP_400_BAD_REQUEST)
        if services.is_confirmed(request.user):
            return Response({'detail': 'already_confirmed'}, status=status.HTTP_409_CONFLICT)
        services.send_confirmation(request.user)
        return Response({'detail': 'sent'}, status=status.HTTP_202_ACCEPTED)


class MyMailView(APIView):
    """GET/PATCH /api/auth/me/mail/ — is my address confirmed, and do I want the digest."""

    permission_classes = [permissions.IsAuthenticated]

    def _payload(self, user):
        pref = services.preference_for(user)
        return {
            'email': user.email,
            'email_confirmed': services.is_confirmed(user),
            'notification_digest': pref.notification_digest,
        }

    def get(self, request):
        return Response(self._payload(request.user))

    def patch(self, request):
        if 'notification_digest' in request.data:
            value = request.data.get('notification_digest')
            if not isinstance(value, bool):
                return Response({'notification_digest': ['Must be true or false.']}, status=status.HTTP_400_BAD_REQUEST)
            services.set_digest(request.user, value)
        return Response(self._payload(request.user))


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'password_reset_confirm'

    def post(self, request):
        user, errors = services.reset_password(
            request.data.get('uid', ''), request.data.get('token', ''), request.data.get('password', '')
        )
        if user is None:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        return Response({'detail': 'password_changed'})


# ---- the superuser's Mail tab ------------------------------------------------------------------

class MailStatusView(APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        last = InboundEmail.objects.order_by('-fetched_at').values_list('fetched_at', flat=True).first()
        return Response({
            'transport': transport_name(),
            'from_address': settings.DEFAULT_FROM_EMAIL,
            'smtp_host': settings.EMAIL_HOST if transport_name() == 'smtp' else '',
            'imap_configured': bool(settings.EMAIL_HOST_PASSWORD),
            'imap_host': settings.EDMAT_IMAP_HOST,
            'queued': OutboundEmail.objects.filter(status=OutboundEmail.STATUS_QUEUED).count(),
            'failed': OutboundEmail.objects.filter(status=OutboundEmail.STATUS_FAILED).count(),
            'last_fetched_at': last,
        })


def _search(queryset, request, fields):
    q = (request.query_params.get('q') or '').strip()
    if q:
        condition = Q()
        for field in fields:
            condition |= Q(**{f'{field}__icontains': q})
        queryset = queryset.filter(condition)
    return queryset


class OutboundListView(APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        rows = OutboundEmail.objects.select_related('user')
        for param in ('status', 'kind'):
            value = request.query_params.get(param)
            if value:
                rows = rows.filter(**{param: value})
        rows = _search(rows, request, ['to', 'subject'])
        return Response(OutboundEmailListSerializer(rows[:LIST_LIMIT], many=True).data)


class OutboundDetailView(APIView):
    permission_classes = [IsSuperuser]

    def get(self, request, pk):
        return Response(OutboundEmailSerializer(get_object_or_404(OutboundEmail, pk=pk)).data)


class OutboundRetryView(APIView):
    permission_classes = [IsSuperuser]

    def post(self, request, pk):
        row = get_object_or_404(OutboundEmail, pk=pk)
        reason = services.retry(row)
        if reason:
            return Response({'detail': reason}, status=status.HTTP_409_CONFLICT)
        row.refresh_from_db()
        return Response(OutboundEmailSerializer(row).data, status=status.HTTP_202_ACCEPTED)


class SendTestView(APIView):
    permission_classes = [IsSuperuser]

    def post(self, request):
        to = (request.data.get('to') or request.user.email or '').strip()
        if '@' not in to:
            return Response({'to': ['An address is required.']}, status=status.HTTP_400_BAD_REQUEST)
        row = services.send_test(to, request.user)
        return Response(OutboundEmailSerializer(row).data, status=status.HTTP_202_ACCEPTED)


class InboundListView(APIView):
    permission_classes = [IsSuperuser]

    def get(self, request):
        rows = _search(InboundEmail.objects.all(), request, ['from_address', 'subject', 'to'])
        return Response(InboundEmailListSerializer(rows[:LIST_LIMIT], many=True).data)


class InboundDetailView(APIView):
    permission_classes = [IsSuperuser]

    def get(self, request, pk):
        return Response(InboundEmailSerializer(get_object_or_404(InboundEmail, pk=pk)).data)


class InboundFetchView(APIView):
    """Fetch now, inside this request. Bounded: a 20-second socket timeout and `inbox.BATCH`
    messages at most — and it is one superuser's button, not a page anybody can load."""

    permission_classes = [IsSuperuser]

    def post(self, request):
        try:
            count = inbox.fetch()
        except inbox.MailUnavailable as exc:
            return Response({'detail': exc.reason, 'error': exc.detail[:500]}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({'fetched': count})
