from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor_display_name = serializers.SerializerMethodField()
    exercise_id = serializers.PrimaryKeyRelatedField(source='exercise', read_only=True)
    material_id = serializers.PrimaryKeyRelatedField(source='material', read_only=True)
    course_id = serializers.PrimaryKeyRelatedField(source='course', read_only=True)
    event_id = serializers.PrimaryKeyRelatedField(source='event', read_only=True)
    post_id = serializers.PrimaryKeyRelatedField(source='post', read_only=True)
    # The SLUG, not the pk, and that is the whole reason this field exists: `/concepts/[slug]` is
    # the route, and a numeric id cannot be turned into one client-side. Null when the notification
    # is not about a concept, or when the concept has since been deleted (`SET_NULL`); the frontend
    # falls back to `/concepts` rather than building a link it cannot resolve.
    concept_slug = serializers.SerializerMethodField()

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
            'course_id',
            'event_id',
            'post_id',
            'issue_id',
            # The co-authoring project a notification is about, when it has no material yet
            # (notifications/models.py). Named for the raw column rather than with an `_id` alias
            # like its neighbours because that is the key the frontend's own mapper already reads
            # (`mappers.ts` → `materialProjectId`), and the wire name is the contract.
            'material_project',
            'concept_slug',
            'note',
            'is_read',
            'created_at',
        ]
        read_only_fields = fields

    def get_actor_display_name(self, obj):
        if obj.actor is None:
            return ''
        return getattr(obj.actor.profile, 'display_name', '') or obj.actor.username

    def get_concept_slug(self, obj):
        return obj.concept.slug if obj.concept_id else None
