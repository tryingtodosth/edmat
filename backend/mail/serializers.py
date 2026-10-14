from rest_framework import serializers

from .models import InboundEmail, OutboundEmail


class OutboundEmailSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', default=None, read_only=True)

    class Meta:
        model = OutboundEmail
        fields = [
            'id', 'kind', 'status', 'to', 'user', 'username', 'subject', 'body', 'locale',
            'attempts', 'error', 'transport', 'created_at', 'sent_at',
        ]


class OutboundEmailListSerializer(OutboundEmailSerializer):
    class Meta(OutboundEmailSerializer.Meta):
        fields = [f for f in OutboundEmailSerializer.Meta.fields if f != 'body']


class InboundEmailSerializer(serializers.ModelSerializer):
    class Meta:
        model = InboundEmail
        fields = [
            'id', 'folder', 'message_id', 'from_address', 'to', 'subject', 'date', 'body',
            'body_truncated', 'size', 'attachments', 'fetched_at',
        ]


class InboundEmailListSerializer(InboundEmailSerializer):
    class Meta(InboundEmailSerializer.Meta):
        fields = [f for f in InboundEmailSerializer.Meta.fields if f not in ('body', 'message_id')]
