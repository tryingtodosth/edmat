from rest_framework import serializers

from .models import Comment, Review


class ReviewSerializer(serializers.ModelSerializer):
    author_display_name = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = ['id', 'exercise', 'author', 'author_display_name', 'rating', 'body', 'created_at']
        read_only_fields = ['author']

    def get_author_display_name(self, obj):
        return getattr(obj.author.profile, 'display_name', '') or obj.author.username


class CommentSerializer(serializers.ModelSerializer):
    author_display_name = serializers.SerializerMethodField()
    # True the instant community reports cross moderation/services.py's own threshold, independent
    # of (and possible without) `is_removed` ever being set — the frontend needs to tell "hidden
    # automatically, pending a moderator's decision" apart from "a moderator permanently removed
    # this," since only the latter is truly final (CommentNode.svelte renders a different message
    # for each). A plain boolean, not the raw timestamp — when this was auto-hidden isn't something
    # an ordinary reader needs to know.
    is_auto_hidden = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = [
            'id',
            'content_type',
            'object_id',
            'parent',
            'author',
            'author_display_name',
            'body',
            'created_at',
            'is_removed',
            'is_auto_hidden',
        ]
        read_only_fields = ['author', 'content_type', 'object_id', 'is_removed']

    def get_is_auto_hidden(self, obj):
        return obj.auto_hidden_at is not None

    def get_author_display_name(self, obj):
        if obj.is_removed or obj.auto_hidden_at is not None:
            return ''
        return getattr(obj.author.profile, 'display_name', '') or obj.author.username

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        if instance.is_removed or instance.auto_hidden_at is not None:
            rep['body'] = ''
        return rep
