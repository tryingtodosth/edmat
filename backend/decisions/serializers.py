"""Serializers for polls."""

from rest_framework import serializers

from config.sanitize import sanitize_content
from .models import Ballot, Poll, PollOption
from translations.serializers import PlainTextWriteMixin, TranslatedTextMixin


class PollOptionSerializer(TranslatedTextMixin, serializers.ModelSerializer):
    """A poll option — `poll`, `text`, `order`. No vote count here: counts are only ever answered
    by `/api/polls/{id}/results/`, which is the one place `rules.can_see_results` is checked
    (house rule 4 — results are hidden until close for non-managers; embedding a live tally in
    the plain poll representation would leak it to anyone who can merely see the poll)."""

    # Bilingual management text (translations/, 2026-10-08). The ONE target with a heading and no
    # body: an option is a line of text, so `translated_body_field` is None and the mixin leaves
    # whatever `body` a version carries unread. Translated at all because the EdMat seed's own
    # options were written glued — "Liczba 0–1, głosy ją przesuwają / A number 0–1, moved by
    # votes" — which is the thing this app exists to undo.
    translated_heading_field = 'text'
    translated_body_field = None
    language = serializers.SerializerMethodField()
    text_versions = serializers.SerializerMethodField()

    class Meta:
        model = PollOption
        fields = ['id', 'text', 'order', 'language', 'text_versions']


class PollSerializer(TranslatedTextMixin, serializers.ModelSerializer):
    """A poll with its options. `has_voted` needs `context={'request': request}`."""
    # Bilingual management text (translations/, 2026-10-08): `question`/`description` answer in the
    # reader's `?lang=`, and `language`/`text_versions` say which language that actually is, what
    # else exists and whether a newer version is waiting in another one. The mixin does all of it.
    translated_heading_field = 'question'
    translated_body_field = 'description'
    language = serializers.SerializerMethodField()
    text_versions = serializers.SerializerMethodField()

    options = PollOptionSerializer(many=True, read_only=True)
    #: Where this poll hangs and where the reader stands on it (`config.nodes.node_ref`), the way
    #: every other board row's serializer answers it. Added 2026-10-10 because `/polls/[id]` had no
    #: `NodeRef` at all — the page says so in its own docstring — and a surface that cannot ask
    #: "may you add something here" cannot draw an attachments panel.
    node = serializers.SerializerMethodField()
    has_voted = serializers.SerializerMethodField()
    can_vote = serializers.SerializerMethodField()
    can_see_results = serializers.SerializerMethodField()

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
            'node',
            'has_voted',
            'can_vote',
            'can_see_results',

            'language',
            'text_versions',
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
            'node',
            'has_voted',
            'can_vote',
            'can_see_results',
        ]

    def validate_description(self, value):
        """Sanitize description on write."""
        return sanitize_content(value) if value else value

    def get_node(self, poll) -> dict | None:
        """The same `{kind, id, title, isStaff, canManage, …}` every other board row answers with
        (`config.nodes.node_ref`), so a page holding only a poll can still ask where this reader
        stands — which is what `/polls/[id]` needs to draw its attachments panel."""
        from config import nodes

        from . import rules

        # A list endpoint already knows the node — it resolved it to scope the query — so it puts it
        # in the context and this costs nothing per row. Without that, `poll_node` follows the
        # generic FK once per poll, which on a board of five polls is ten queries for one answer.
        node = self.context.get('node') or rules.poll_node(poll)
        if node is None:
            return None
        request = self.context.get('request')
        return nodes.node_ref(node, getattr(request, 'user', None) if request else None)

    def get_has_voted(self, obj):
        """Whether the requesting user has already cast a ballot — so a reload does not offer the
        vote form again. False for an anonymous reader, never a leak of WHO (the ballot list stays
        manager-only); this is "did *I* vote", not "who voted"."""
        request = self.context.get('request')
        user = getattr(request, 'user', None) if request else None
        if not user or not user.is_authenticated:
            return False
        return obj.ballots.filter(user=user).exists()

    def _reader(self):
        request = self.context.get('request')
        return getattr(request, 'user', None) if request else None

    def get_can_vote(self, obj) -> bool:
        """Whether the vote form should be drawn for this reader: the poll is open now and the
        reader is eligible and has not voted — the same answer `rules.vote_block_reason` gives
        before the option check, asked once here so an open board (where strangers read the poll)
        does not draw a form the API will refuse (house rule 6: say why, or do not offer)."""
        from . import rules

        user = self._reader()
        if not user or not user.is_authenticated:
            return False
        return rules.vote_block_reason(user, obj, [-1]) == rules.UNKNOWN_OPTION

    def get_can_see_results(self, obj) -> bool:
        from . import rules

        return rules.can_see_results(self._reader(), obj)


class PollCreateSerializer(serializers.ModelSerializer):
    """Create a new poll (draft status)."""

    class Meta:
        model = Poll
        fields = ['question', 'description', 'mode', 'anonymous', 'eligibility', 'opens_at', 'closes_at']

    def validate_description(self, value):
        """Sanitize description on write."""
        return sanitize_content(value) if value else value


class PollUpdateSerializer(PlainTextWriteMixin, serializers.ModelSerializer):
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
