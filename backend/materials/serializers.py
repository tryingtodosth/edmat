from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation
from taxonomy.serializers import SubtopicSerializer, TopicSerializer

from .models import Material, MaterialCoverage, MaterialRequirement, MaterialReview
from .services import build_vote_summary  # see services.py's own doc comment: the one shared
# vote-tallying implementation both MaterialCoverageSerializer and MaterialRequirementSerializer
# below use, rather than each keeping its own identical copy of the same math.


class MaterialCoverageSerializer(serializers.ModelSerializer):
    """Embedded directly on MaterialSerializer (below) rather than behind a separate endpoint —
    this app's whole corpus is small enough (7 real materials, a handful of coverage rows each)
    that the per-row vote/comment aggregation this does costs nothing real, the same "don't
    optimize prematurely for a corpus this size" call this codebase already makes elsewhere
    (DEFAULT_PAGINATION_CLASS being off globally, CLAUDE.md Phase 3's own note)."""

    topic = TopicSerializer(read_only=True)
    subtopic = SubtopicSerializer(read_only=True, allow_null=True)
    vote_summary = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = MaterialCoverage
        fields = [
            'id',
            'material',
            'topic',
            'subtopic',
            'level',
            'proposed_by',
            'created_at',
            'vote_summary',
            'comment_count',
        ]

    def get_vote_summary(self, obj):
        votes = list(obj.votes.select_related('voter__profile'))
        return build_vote_summary(votes, self.context.get('request'))

    def get_comment_count(self, obj):
        content_type = ContentType.objects.get_for_model(MaterialCoverage)
        # local import — community.models never needs to know materials exists, only the reverse
        from community.models import Comment

        return Comment.objects.filter(
            content_type=content_type, object_id=obj.pk, is_removed=False
        ).count()


class MaterialCoverageCreateSerializer(serializers.ModelSerializer):
    """Used only by MaterialViewSet.coverage's POST branch — `topic`/`subtopic` accept a PK
    directly (the create form already resolved a slug/new-subtopic-name into one, see that view's
    own logic), `material`/`proposed_by` are set by the view, not the client."""

    class Meta:
        model = MaterialCoverage
        fields = ['id', 'topic', 'subtopic', 'level']


class MaterialRequirementSerializer(serializers.ModelSerializer):
    # The new votable half of "split material tags into two groups (covers/requires), each
    # votable" — the exact same `vote_summary` shape MaterialCoverageSerializer already exposes
    # (both now built from the one shared `build_vote_summary`, services.py), so the frontend can
    # sort/render either group with identical logic.
    vote_summary = serializers.SerializerMethodField()

    class Meta:
        model = MaterialRequirement
        fields = ['id', 'label', 'order', 'vote_summary']

    def get_vote_summary(self, obj):
        votes = list(obj.votes.select_related('voter__profile'))
        return build_vote_summary(votes, self.context.get('request'))


class MaterialReviewSerializer(serializers.ModelSerializer):
    # Same `getattr(obj.author.profile, 'display_name', '') or obj.author.username` pattern
    # community/serializers.py's ReviewSerializer and services/serializers.py's
    # ServiceReviewSerializer already establish for the identical purpose.
    author_display_name = serializers.SerializerMethodField()

    class Meta:
        model = MaterialReview
        fields = ['id', 'material', 'author', 'author_display_name', 'rating', 'body', 'created_at']
        read_only_fields = ['author']

    def get_author_display_name(self, obj):
        return getattr(obj.author.profile, 'display_name', '') or obj.author.username


class MaterialSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    coverage = MaterialCoverageSerializer(many=True, read_only=True)
    # Read-only here too — see the `requirements` action on MaterialViewSet (views.py) for the one
    # real write path: a governor-only bulk replace, not a per-row create/update through this
    # serializer, the same "structural metadata, not a plain CRUD field" treatment `coverage` above
    # already gets (that one via community voting, this one via the governor trust boundary). A
    # plain SerializerMethodField, not a declarative nested serializer, so a moderator-removed
    # requirement (a reported "skill tag", `MaterialRequirement.is_removed`) can be filtered out
    # for an ordinary reader — filtered in PYTHON over the already-fetched `.all()` list rather than
    # `.filter(is_removed=False)`, which would issue a fresh query and silently bypass
    # MaterialViewSet's own `prefetch_related('requirements__votes__voter__profile')` (the exact N+1
    # that prefetch was added to fix in the first place, CLAUDE.md's own moderation-load-test note).
    requirements = serializers.SerializerMethodField()
    course_slug = serializers.SlugRelatedField(source='branch', slug_field='slug', read_only=True)
    # Read-only here on purpose — Material has no create/update endpoint at all (MaterialViewSet is
    # a ReadOnlyModelViewSet), so the only way a tag is ever added/removed is the tag-hover menu's
    # own "add to different content" action (exercises.TagViewSet.apply), never through this
    # serializer's own write path. A plain SerializerMethodField, not a SlugRelatedField, for the
    # identical reason `requirements` above is one — a moderator-removed Tag (`Tag.is_removed`)
    # needs filtering out in Python, not a fresh `.filter()` query.
    tags = serializers.SerializerMethodField()
    # A plain SerializerMethodField (2 extra queries per row), matching ServiceSerializer's own
    # doc comment for the identical tradeoff — this app's real materials corpus (7 rows) is nowhere
    # near the scale (383+ exercises) that would ever need a queryset-level annotation instead.
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()
    # The real NAME to show next to a clickable submitter byline — same
    # `getattr(profile, 'display_name', '') or username` pattern ServiceSerializer.
    # get_provider_display_name already establishes, not a second design for the identical need.
    # `None` (not '') when `submitted_by` itself is null, so the frontend can tell "no real
    # submitter" apart from "a submitter with a blank display name."
    submitted_by_display_name = serializers.SerializerMethodField()

    class Meta:
        model = Material
        fields = [
            'id',
            'branch',
            'course_slug',
            'slug',
            'type',
            'coverage',
            'requirements',
            'file',
            'author',
            'source_url',
            'submitted_by',
            'submitted_by_display_name',
            'tags',
            'published',
            'featured',
            'order',
            'title',
            'description',
            'price_amount',
            'price_currency',
            'estimated_minutes',
            'average_rating',
            'review_count',
            'created_at',
        ]

    def get_requirements(self, obj):
        visible = [r for r in obj.requirements.all() if not r.is_removed]
        return MaterialRequirementSerializer(visible, many=True, context=self.context).data

    def get_tags(self, obj):
        return [t.slug for t in obj.tags.all() if not t.is_removed]

    def get_title(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.title if t else obj.slug

    def get_description(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.description if t else ''

    def get_average_rating(self, obj):
        from django.db.models import Avg

        avg = obj.reviews.aggregate(avg=Avg('rating'))['avg']
        return round(avg, 1) if avg is not None else None

    def get_review_count(self, obj):
        return obj.reviews.count()

    def get_submitted_by_display_name(self, obj):
        if obj.submitted_by_id is None:
            return None
        return getattr(obj.submitted_by.profile, 'display_name', '') or obj.submitted_by.username
