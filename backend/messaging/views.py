from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils.timezone import now
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from postman.models import Message

from .serializers import MessageSerializer, ReplySerializer, SendMessageSerializer
from .services import reply_to_message, send_message

User = get_user_model()

FOLDER_METHODS = {
    'inbox': Message.objects.inbox,
    'sent': Message.objects.sent,
    'archives': Message.objects.archives,
    'trash': Message.objects.trash,
}


class MessageViewSet(viewsets.GenericViewSet):
    """A thin DRF wrapper over django-postman's own `Message` model (see messaging/services.py's own
    doc comment for why this app has no models of its own, and why a real, working reply needed its
    own hand-written thread-linking function rather than django-postman's Django-form-only reply
    flow). Authenticated-only throughout — there's no anonymous/visitor messaging path in this app.

    `GET /api/messages/?folder=inbox|sent|archives|trash` (default `inbox`) — one of
    django-postman's own real manager methods per folder, unchanged.
    `GET /api/messages/{id}/` — a single message; marks it read if the caller is its own recipient
    and it isn't already (the natural "opening a message marks it read" behavior every real
    messaging UI has), and 404s for anyone who isn't the sender or recipient.
    `POST /api/messages/` — a brand-new, top-level message.
    `POST /api/messages/{id}/reply/` — a reply within that message's own thread.
    `GET /api/messages/{id}/thread/` — every message in the same conversation, oldest first.
    `GET /api/messages/unread-count/` — for a bell-icon-style badge, matching this project's own
    existing Notification-bell precedent (notifications/views.py).
    """

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MessageSerializer

    def get_queryset(self):
        # A real, deliberately permissive union — used only by get_object() (retrieve/reply/thread),
        # which then applies its own real sender-or-recipient check below; the list action never
        # calls this, it goes straight through django-postman's own per-folder manager methods.
        user = self.request.user
        return Message.objects.filter(Q(sender=user) | Q(recipient=user))

    def list(self, request):
        folder = request.query_params.get('folder', 'inbox')
        method = FOLDER_METHODS.get(folder)
        if method is None:
            return Response(
                {'folder': [f'Must be one of: {", ".join(FOLDER_METHODS)}.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        messages = method(request.user)
        serializer = self.get_serializer(messages, many=True)
        return Response(serializer.data)

    def retrieve(self, request, pk=None):
        message = self.get_object()
        if message.recipient_id == request.user.id and message.read_at is None:
            message.read_at = now()
            message.save(update_fields=['read_at'])
        return Response(self.get_serializer(message).data)

    def create(self, request):
        serializer = SendMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            recipient = User.objects.get(pk=serializer.validated_data['recipient_id'])
        except User.DoesNotExist:
            return Response({'recipient_id': ['No such user.']}, status=status.HTTP_400_BAD_REQUEST)
        if recipient == request.user:
            return Response(
                {'recipient_id': ["You can't send a message to yourself."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        message = send_message(
            sender=request.user,
            recipient=recipient,
            subject=serializer.validated_data['subject'],
            body=serializer.validated_data.get('body', ''),
        )
        return Response(self.get_serializer(message).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def reply(self, request, pk=None):
        parent = self.get_object()
        serializer = ReplySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = reply_to_message(
            sender=request.user,
            parent=parent,
            body=serializer.validated_data['body'],
            subject=serializer.validated_data.get('subject') or None,
        )
        return Response(self.get_serializer(message).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def thread(self, request, pk=None):
        message = self.get_object()
        thread_filter = Q(thread_id=message.thread_id) if message.thread_id else Q(pk=message.pk)
        messages = Message.objects.thread(request.user, thread_filter)
        return Response(self.get_serializer(messages, many=True).data)

    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        return Response({'unread_count': Message.objects.inbox_unread_count(request.user)})
