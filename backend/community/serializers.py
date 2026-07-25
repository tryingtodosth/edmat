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
        ]
        read_only_fields = ['author', 'content_type', 'object_id', 'is_removed']

    def get_author_display_name(self, obj):
        if obj.is_removed:
            return ''
        return getattr(obj.author.profile, 'display_name', '') or obj.author.username

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        if instance.is_removed:
            rep['body'] = ''
        return rep
