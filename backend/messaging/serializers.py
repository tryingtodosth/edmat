from rest_framework import serializers

from postman.models import Message

from .crypto import MessageDecryptionError, decrypt_text


class MessageSerializer(serializers.ModelSerializer):
    sender_id = serializers.IntegerField(read_only=True)
    sender_username = serializers.SerializerMethodField()
    sender_display_name = serializers.SerializerMethodField()
    recipient_id = serializers.IntegerField(read_only=True)
    recipient_username = serializers.SerializerMethodField()
    recipient_display_name = serializers.SerializerMethodField()
    is_read = serializers.SerializerMethodField()
    replies_count = serializers.SerializerMethodField()
    # Stored encrypted (messaging/crypto.py); decrypted here, which is the one read path this app
    # has. A message written before encryption was switched on is stored in clear and comes back
    # through the same field unchanged.
    body = serializers.SerializerMethodField()
    body_unavailable = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            'id',
            'sender_id',
            'sender_username',
            'sender_display_name',
            'recipient_id',
            'recipient_username',
            'recipient_display_name',
            'subject',
            'body',
            'sent_at',
            'read_at',
            'is_read',
            'body_unavailable',
            'parent_id',
            'thread_id',
            'replies_count',
        ]

    def _display_name(self, user):
        if user is None:
            return ''
        profile = getattr(user, 'profile', None)
        return profile.display_name if profile and profile.display_name else user.username

    def get_sender_username(self, obj):
        return obj.sender.username if obj.sender_id else ''

    def get_sender_display_name(self, obj):
        return self._display_name(obj.sender)

    def get_recipient_username(self, obj):
        return obj.recipient.username if obj.recipient_id else ''

    def get_recipient_display_name(self, obj):
        return self._display_name(obj.recipient)

    def _read_body(self, obj) -> tuple[str, bool]:
        """Decrypt once per row, not once per field that asks.

        Cached on `obj` rather than on `self`, which is the part that is easy to get wrong here and
        has been got wrong in this codebase before (see the note on `ExerciseDetailSerializer` in
        CLAUDE.md §17F): DRF's `ListSerializer` reuses ONE child serializer instance across every
        row, so `self._cache` would serve the first message's body for every message in an inbox.
        """
        cached = getattr(obj, '_edmat_body_cache', None)
        if cached is None:
            try:
                cached = (decrypt_text(obj.body), False)
            except MessageDecryptionError:
                # One unreadable row must not take a whole inbox down with a 500. The body comes
                # back empty and the flag says why, so the client can say something true about it
                # in the reader's own language rather than rendering silence or base64.
                cached = ('', True)
            obj._edmat_body_cache = cached
        return cached

    def get_body(self, obj):
        return self._read_body(obj)[0]

    def get_body_unavailable(self, obj):
        return self._read_body(obj)[1]

    def get_is_read(self, obj):
        return obj.read_at is not None

    def get_replies_count(self, obj):
        return obj.get_replies_count()


class SendMessageSerializer(serializers.Serializer):
    """POST /api/messages/ — a brand-new, top-level message. `recipient_id` is a real User pk
    (matching this API's own established id-format convention for every other user reference)."""

    recipient_id = serializers.IntegerField()
    subject = serializers.CharField(max_length=Message.SUBJECT_MAX_LENGTH)
    body = serializers.CharField(allow_blank=True, required=False, default='')


class ReplySerializer(serializers.Serializer):
    """POST /api/messages/{id}/reply/ — `subject` is optional, defaulting to `Re: {original}`
    the same way any real email/messaging client would, matching services.reply_to_message's own
    default."""

    body = serializers.CharField(allow_blank=False)
    subject = serializers.CharField(max_length=Message.SUBJECT_MAX_LENGTH, required=False, allow_blank=True)
