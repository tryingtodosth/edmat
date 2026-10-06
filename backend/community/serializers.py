from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from .models import CommentAttachment, Comment, CommentRevision, DiscussionLocation, InlineImage, Review, SavedComment
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
        return comment_author_display(obj)


def comment_author_display(comment) -> str:
    """Who to put above a comment, account or not.

    One function for the two serializers below, because an anonymous comment
    (`community/discussions.py`) has no `author` at all and a display name that read
    `obj.author.username` would be an `AttributeError` on every one of them. The order is the
    honest one: a real account's chosen name, then its username, then what an anonymous writer
    typed, then ''. The server does not invent a name for somebody who did not give one, and ''
    reaches `CommentNode.svelte`'s existing "—" byline — the same thing it already draws for an
    author it could not resolve.
    """
    author = getattr(comment, 'author', None)
    if author is not None:
        return getattr(getattr(author, 'profile', None), 'display_name', '') or author.username
    return (getattr(comment, 'anon_name', '') or '').strip()


class CommentAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = CommentAttachment
        fields = ['id', 'kind', 'url', 'original_name', 'size_bytes']

    def get_url(self, a) -> str:
        if not a.file:
            return ''
        request = self.context.get('request')
        return request.build_absolute_uri(a.file.url) if request else a.file.url


class CommentSerializer(serializers.ModelSerializer):
    attachments = serializers.SerializerMethodField()
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
            'attachments',
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

    def get_attachments(self, comment):
        # Blanked with the body: a tombstoned or held comment shows nothing of what was on it.
        if comment.is_removed or comment.auto_hidden_at is not None:
            return []
        return CommentAttachmentSerializer(comment.attachments.all(), many=True, context=self.context).data

    def get_author_display_name(self, obj):
        if obj.is_removed or obj.auto_hidden_at is not None:
            return ''
        return comment_author_display(obj)

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        if instance.is_removed or instance.auto_hidden_at is not None:
            rep['body'] = ''
        return rep


def _user_display_name(user) -> str:
    if user is None:
        return ''
    return getattr(user.profile, 'display_name', '') or user.username


class CommentRevisionSerializer(serializers.ModelSerializer):
    """One past version of a comment's body — the masking matrix lives entirely here, in ONE
    place, rather than split between the view (which would have to decide per-row) and the
    frontend (which must never be trusted to hide what the backend already sent). See
    `CommentRevision`'s own docstring for what each tier means.

    Needs `context={'request': request}` — with none, it behaves as the least-privileged reader
    (an anonymous visitor), never as an accident of whichever caller forgot to pass one.
    """

    edited_by_display_name = serializers.SerializerMethodField()
    is_hidden_by_moderator = serializers.SerializerMethodField()
    is_sealed = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()

    class Meta:
        model = CommentRevision
        fields = [
            'id',
            'created_at',
            'edited_by_display_name',
            'body',
            'is_hidden_by_moderator',
            'is_sealed',
        ]

    def _viewer(self):
        request = self.context.get('request')
        user = getattr(request, 'user', None) if request is not None else None
        return user if user is not None and user.is_authenticated else None

    def get_edited_by_display_name(self, obj):
        return _user_display_name(obj.edited_by)

    def get_is_hidden_by_moderator(self, obj):
        return obj.hidden_by_moderator_at is not None

    def get_is_sealed(self, obj):
        return obj.sealed_at is not None

    def get_body(self, obj):
        # Sealed: nobody, ever, through this serializer — not even a superuser. See
        # CommentRevision's own docstring for where sealed content is actually read from.
        if obj.sealed_at is not None:
            return None
        # Moderator-hidden: full body to staff (they made the call and may need to review it
        # again), a placeholder to everyone else, including the comment's own author.
        if obj.hidden_by_moderator_at is not None:
            viewer = self._viewer()
            if viewer is not None and viewer.is_staff:
                return obj.body
            return None
        return obj.body


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


class InlineImageSerializer(serializers.ModelSerializer):
    """What the editor needs back from an upload: the picture's URL, and the exact tag to put into
    the body. `embed_html` is built on the model so there is one spelling of that tag."""

    author = serializers.IntegerField(source='author_id', read_only=True)
    url = serializers.SerializerMethodField()
    embed_html = serializers.SerializerMethodField()

    class Meta:
        model = InlineImage
        fields = ['id', 'author', 'url', 'alt', 'width', 'height', 'original_name', 'size_bytes', 'embed_html', 'created_at']
        read_only_fields = fields

    def get_url(self, obj) -> str:
        if not obj.image:
            return ''
        request = self.context.get('request')
        return request.build_absolute_uri(obj.image.url) if request else obj.image.url

    def get_embed_html(self, obj) -> str:
        return obj.embed_html(self.get_url(obj))


class DiscussionLocationSerializer(serializers.ModelSerializer):
    """A location as a MODERATOR sees it — the row's own fields, not the effective policy.

    Deliberately not the same shape the reading endpoint returns. A moderator editing this row has
    to see what the row itself says, including the difference between "this section is set to
    `staff`" and "this section inherits `staff` from its page" — a serializer that quietly folded
    the page's ceiling in would make the second look like the first, and the moderator would then
    be unable to tell which row to change. `discussions.effective_policy` is the other shape, and
    the reader's endpoint is where it belongs.
    """

    key = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    held_count = serializers.SerializerMethodField()
    updated_by_display_name = serializers.SerializerMethodField()
    # Spelled out because `Meta.unique_together` on (page, section) makes DRF's own
    # `UniqueTogetherValidator` require EVERY field in the constraint — so creating a page-level
    # row, whose whole point is an empty section, came back 400 "this field is required" for a
    # field the model has `blank=True` on. `default=''` is what the validator needs to see.
    section = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')

    class Meta:
        model = DiscussionLocation
        fields = [
            'id',
            'key',
            'page',
            'section',
            'is_enabled',
            'audience',
            'moderated',
            'comment_count',
            'held_count',
            'updated_at',
            'updated_by_display_name',
        ]
        read_only_fields = ['updated_at']

    def get_key(self, row) -> str:
        from .discussions import location_key

        return location_key(row.page, row.section)

    def _comments(self, row):
        """Recounted on every read, never stored (house rule 5): two COUNTs over an indexed FK are
        cheap, and a counter that misses one code path — a moderator removing a comment, the author
        deleting it, an auto-hide — is wrong forever."""
        content_type = ContentType.objects.get_for_model(DiscussionLocation)
        return Comment.objects.filter(content_type=content_type, object_id=row.pk)

    def get_comment_count(self, row) -> int:
        return self._comments(row).filter(is_removed=False, auto_hidden_at__isnull=True).count()

    def get_held_count(self, row) -> int:
        """Waiting for a moderator — held or auto-hidden, not yet removed. This is the number that
        makes the list worth looking at: a location with five of these is one somebody has to go
        and read, and it is the honest cost of having set that location to `anyone`."""
        return self._comments(row).filter(is_removed=False, auto_hidden_at__isnull=False).count()

    def get_updated_by_display_name(self, row) -> str:
        return _user_display_name(row.updated_by)

    def validate_audience(self, value):
        from .discussions import AUDIENCE_CHOICES

        legal = {key for key, _label in AUDIENCE_CHOICES}
        if value not in legal:
            raise serializers.ValidationError(f'Unknown audience. One of: {", ".join(sorted(legal))}.')
        return value

    def validate(self, attrs):
        """The key's shape is checked here rather than in the view, because a moderator CREATING a
        location is the one caller who types a page and section by hand — every other path parses
        them out of a key the frontend built."""
        from .discussions import PAGE_RE, SECTION_RE

        page = (attrs.get('page') or getattr(self.instance, 'page', '') or '').strip()
        section = (attrs.get('section') or getattr(self.instance, 'section', '') or '').strip()
        if not PAGE_RE.match(page):
            raise serializers.ValidationError(
                {'page': ['A page is `about` or `about/<segment>` or `about/<segment>/<segment>`.']}
            )
        if section and not SECTION_RE.match(section):
            raise serializers.ValidationError(
                {'section': ['A section is lowercase letters, digits and hyphens; empty means the whole page.']}
            )
        attrs['page'] = page
        attrs['section'] = section
        return attrs


class DiscussionCommentDraftSerializer(serializers.Serializer):
    """What a reader may send when writing under a standing page.

    Its own serializer rather than `CommentSerializer`, because the two accept different things: a
    comment here may carry `anon_name` and may have no author at all, and it may NOT carry the
    attachment and inline-image machinery a thread on an exercise has. Keeping it separate is what
    stops this endpoint from inheriting a field it has no rule for.
    """

    body = serializers.CharField(max_length=8000, allow_blank=False, trim_whitespace=True)
    parent = serializers.PrimaryKeyRelatedField(
        queryset=Comment.objects.all(), required=False, allow_null=True
    )
    #: Only read for a writer with no account; a signed-in comment is bylined by the account, and
    #: silently accepting a different name on it would let somebody sign a comment as anybody.
    anon_name = serializers.CharField(max_length=40, required=False, allow_blank=True)
