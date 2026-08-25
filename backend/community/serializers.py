from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from .models import Comment, Review, SavedComment
from .targets import target_type_for


class ReplyCountMixin:
    """`reply_count` for any of the three review serializers — how many comments hang off this
    review. Shown so a conversation under somebody's review is visible before you click; without it
    the only way to discover a reply exists is to open every review in turn.

    Reads a bulk `{pk: count}` map out of the serializer context when the view supplied one (which
    is how the list endpoints avoid a per-row COUNT), and falls back to counting this single row
    when it did not — so a serializer used somewhere that has not been taught to prefetch still
    returns the truth rather than zero.
    """

    def get_reply_count(self, obj):
        counts = self.context.get('reply_counts')
        if counts is not None:
            return counts.get(obj.pk, 0)
        return Comment.objects.filter(
            content_type=ContentType.objects.get_for_model(obj), object_id=obj.pk
        ).count()


class ReviewSerializer(ReplyCountMixin, serializers.ModelSerializer):
    author_display_name = serializers.SerializerMethodField()
    reply_count = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = [
            'id',
            'exercise',
            'author',
            'author_display_name',
            'rating',
            'body',
            'created_at',
            'reply_count',
        ]
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
    # Whether the author has edited this since posting. A plain boolean rather than the timestamp,
    # for the same reason `is_auto_hidden` is one: a reader needs to know THAT it changed (so a
    # reply sitting under it can be read in that light), not when.
    is_edited = serializers.SerializerMethodField()
    # Up/down votes. `current_user_vote` needs a request in the context; the many thread endpoints
    # that build this serializer without one simply report None there, which is also what an
    # anonymous reader gets.
    upvotes = serializers.SerializerMethodField()
    downvotes = serializers.SerializerMethodField()
    score = serializers.SerializerMethodField()
    current_user_vote = serializers.SerializerMethodField()

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
            # Read-only here and set only by CommentViewSet.destroy — a client cannot claim its
            # comment was author-deleted, and a moderator removal correctly leaves it False.
            'removed_by_author',
            'is_edited',
            'upvotes',
            'downvotes',
            'score',
            'current_user_vote',
        ]
        read_only_fields = [
            'author',
            'content_type',
            'object_id',
            'is_removed',
            'removed_by_author',
        ]

    def _votes(self, obj):
        # `.all()` so a caller's `prefetch_related('votes')` is honoured; a caller without one pays
        # one small query per comment, which this app's thread sizes can afford.
        return list(obj.votes.all())

    def get_upvotes(self, obj):
        return sum(1 for v in self._votes(obj) if v.value == 1)

    def get_downvotes(self, obj):
        return sum(1 for v in self._votes(obj) if v.value == -1)

    def get_score(self, obj):
        return sum(v.value for v in self._votes(obj))

    def get_current_user_vote(self, obj):
        request = self.context.get('request')
        if request is None or not request.user.is_authenticated:
            return None
        mine = next((v for v in self._votes(obj) if v.voter_id == request.user.id), None)
        return mine.value if mine else None
        read_only_fields = [
            'author',
            'content_type',
            'object_id',
            'is_removed',
            'removed_by_author',
        ]

    def get_is_auto_hidden(self, obj):
        return obj.auto_hidden_at is not None

    def get_is_edited(self, obj):
        return obj.edited_at is not None

    def get_author_display_name(self, obj):
        if obj.is_removed or obj.auto_hidden_at is not None:
            return ''
        return getattr(obj.author.profile, 'display_name', '') or obj.author.username

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        if instance.is_removed or instance.auto_hidden_at is not None:
            rep['body'] = ''
        return rep


class SavedCommentSerializer(serializers.ModelSerializer):
    """One kept comment, with enough of its context to be readable away from its thread.

    A saved comment is read on a settings page, a long way from wherever it was written, so the row
    has to carry three things a bare id does not: what it says, who said it, and where it lives. The
    last is the reason `community/targets.py` exists at all — the frontend can build
    `/exercises/12` from `('exercise', '12')` and can build nothing at all from a ContentType id.
    """

    comment = CommentSerializer(read_only=True)
    target_type = serializers.SerializerMethodField()
    target_id = serializers.SerializerMethodField()

    class Meta:
        model = SavedComment
        fields = ['id', 'comment', 'target_type', 'target_id', 'note', 'created_at']

    def get_target_type(self, row) -> str:
        return target_type_for(row.comment)

    def get_target_id(self, row) -> str:
        return str(row.comment.object_id)
