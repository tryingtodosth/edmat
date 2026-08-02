from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor_display_name = serializers.SerializerMethodField()
    exercise_id = serializers.PrimaryKeyRelatedField(source='exercise', read_only=True)
    material_id = serializers.PrimaryKeyRelatedField(source='material', read_only=True)
    taught_course_id = serializers.PrimaryKeyRelatedField(source='taught_course', read_only=True)

    class Meta:
        model = Notification
        fields = [
            'id',
            'type',
            'actor',
            'actor_display_name',
            'target_label',
            'exercise_id',
            'material_id',
            'taught_course_id',
            'note',
            'is_read',
            'created_at',
        ]
        read_only_fields = fields

    def get_actor_display_name(self, obj):
        if obj.actor is None:
            return ''
        return getattr(obj.actor.profile, 'display_name', '') or obj.actor.username
