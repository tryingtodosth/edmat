"""Serializers for polls."""

from rest_framework import serializers

from config.sanitize import sanitize_content
from .models import Ballot, Poll, PollOption


class PollOptionSerializer(serializers.ModelSerializer):
    """A poll option — `poll`, `text`, `order`. No vote count here: counts are only ever answered
    by `/api/polls/{id}/results/`, which is the one place `rules.can_see_results` is checked
    (house rule 4 — results are hidden until close for non-managers; embedding a live tally in
    the plain poll representation would leak it to anyone who can merely see the poll)."""

    class Meta:
        model = PollOption
        fields = ['id', 'text', 'order']


class PollSerializer(serializers.ModelSerializer):
    """A poll with its options. `has_voted` needs `context={'request': request}`."""

    options = PollOptionSerializer(many=True, read_only=True)
    has_voted = serializers.SerializerMethodField()

    class Meta:
        model = Poll
        fields = [
            'id',
            'question',
            'description',
            'mode',
            'anonymous',
            'eligibility',
            'opens_at',
            'closes_at',
            'status',
            'decision_note',
            'closed_by_id',
            'closed_at',
            'created_by_id',
            'created_at',
            'options',
            'content_type_id',
            'object_id',
            'has_voted',
        ]
        read_only_fields = [
            'id',
            'status',
            'closed_by_id',
            'closed_at',
            'created_by_id',
            'created_at',
            'content_type_id',
            'object_id',
            'has_voted',
        ]

    def validate_description(self, value):
        """Sanitize description on write."""
        return sanitize_content(value) if value else value

    def get_has_voted(self, obj):
        """Whether the requesting user has already cast a ballot — so a reload does not offer the
        vote form again. False for an anonymous reader, never a leak of WHO (the ballot list stays
        manager-only); this is "did *I* vote", not "who voted"."""
        request = self.context.get('request')
        user = getattr(request, 'user', None) if request else None
        if not user or not user.is_authenticated:
            return False
        return obj.ballots.filter(user=user).exists()


class PollCreateSerializer(serializers.ModelSerializer):
    """Create a new poll (draft status)."""

    class Meta:
        model = Poll
        fields = ['question', 'description', 'mode', 'anonymous', 'eligibility', 'opens_at', 'closes_at']

    def validate_description(self, value):
        """Sanitize description on write."""
        return sanitize_content(value) if value else value


class PollUpdateSerializer(serializers.ModelSerializer):
    """Update a poll (draft only)."""

    class Meta:
        model = Poll
        fields = ['question', 'description', 'mode', 'anonymous', 'eligibility', 'opens_at', 'closes_at']

    def validate_description(self, value):
        """Sanitize description on write."""
        return sanitize_content(value) if value else value


class PollOptionCreateSerializer(serializers.ModelSerializer):
    """Add an option to a poll (draft only)."""

    class Meta:
        model = PollOption
        fields = ['text', 'order']


class BallotSerializer(serializers.ModelSerializer):
    """A ballot record (who voted) — visible only to managers."""

    class Meta:
        model = Ballot
        fields = ['id', 'user_id', 'cast_at']


class PollVoteSerializer(serializers.Serializer):
    """Vote in a poll."""

    options = serializers.ListField(child=serializers.IntegerField())
