from rest_framework import serializers

from postman.models import Message


class MessageSerializer(serializers.ModelSerializer):
    sender_id = serializers.IntegerField(read_only=True)
    sender_username = serializers.SerializerMethodField()
    sender_display_name = serializers.SerializerMethodField()
    recipient_id = serializers.IntegerField(read_only=True)
    recipient_username = serializers.SerializerMethodField()
    recipient_display_name = serializers.SerializerMethodField()
    is_read = serializers.SerializerMethodField()
    replies_count = serializers.SerializerMethodField()

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
