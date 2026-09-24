"""Serializers for polls."""

from rest_framework import serializers

from config.sanitize import sanitize_content
from .models import Ballot, Poll, PollOption, Vote


class PollOptionSerializer(serializers.ModelSerializer):
    """A poll option with vote count."""

    count = serializers.SerializerMethodField()

    class Meta:
        model = PollOption
        fields = ['id', 'text', 'order', 'count']

    def get_count(self, obj):
        """Recount votes for this option (house rule 5)."""
        return obj.votes.count()


class PollSerializer(serializers.ModelSerializer):
    """A poll with its options."""

    options = PollOptionSerializer(many=True, read_only=True)

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
        ]

    def validate_description(self, value):
        """Sanitize description on write."""
        return sanitize_content(value) if value else value


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


class VoteSerializer(serializers.ModelSerializer):
    """A vote (read-only from results endpoint)."""

    class Meta:
        model = Vote
        fields = ['id', 'option_id']


class BallotSerializer(serializers.ModelSerializer):
    """A ballot record (who voted) — visible only to managers."""

    class Meta:
        model = Ballot
        fields = ['id', 'user_id', 'cast_at']


class PollResultsSerializer(serializers.Serializer):
    """Results of a poll (readonly)."""

    options = serializers.SerializerMethodField()
    ballots = serializers.SerializerMethodField()
    eligible_count = serializers.IntegerField()

    def get_options(self, obj):
        """Poll options with vote counts."""
        poll = obj['poll']
        return [
            {'id': opt.id, 'text': opt.text, 'count': opt.votes.count()}
            for opt in poll.options.all().order_by('order')
        ]

    def get_ballots(self, obj):
        """List of who voted (ballots) — visible to managers only."""
        request = self.context.get('request')
        user = request.user if request else None
        poll = obj['poll']

        if not user or not poll.created_by or user.id != poll.created_by.id:
            from config.nodes import can_manage_node, resolve_node

            node = resolve_node(poll.content_type.app_label, poll.object_id)
            if not (node and can_manage_node(user, node)):
                return []

        return BallotSerializer(poll.ballots.all().order_by('-cast_at'), many=True).data


class PollVoteSerializer(serializers.Serializer):
    """Vote in a poll."""

    options = serializers.ListField(child=serializers.IntegerField())
