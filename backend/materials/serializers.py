from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from community.serializers import ReplyCountMixin

from config.i18n_utils import request_locale, resolve_translation
from taxonomy.serializers import SubtopicSerializer, TopicSerializer

from .models import Material, MaterialCoverage, MaterialRequirement, MaterialReview, MaterialType
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
    importance_summary = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()

    class Meta:
        model = MaterialCoverage
        fields = [
            'id',
            'material',
            'kind',
            'topic',
            'subtopic',
            'level',
            'proposed_by',
            'created_at',
            'vote_summary',
            'importance_summary',
            'comment_count',
        ]

    def get_vote_summary(self, obj):
        votes = list(obj.votes.select_related('voter__profile'))
        return build_vote_summary(votes, self.context.get('request'))

    def get_importance_summary(self, obj):
        votes = list(obj.importance_votes.select_related('voter__profile'))
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
        fields = ['id', 'kind', 'topic', 'subtopic', 'level']


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


class MaterialReviewSerializer(ReplyCountMixin, serializers.ModelSerializer):
    # Same `getattr(obj.author.profile, 'display_name', '') or obj.author.username` pattern
    # community/serializers.py's ReviewSerializer and services/serializers.py's
    # ServiceReviewSerializer already establish for the identical purpose.
    author_display_name = serializers.SerializerMethodField()
    reply_count = serializers.SerializerMethodField()

    class Meta:
        model = MaterialReview
        fields = [
            'id',
            'material',
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
    branch_slug = serializers.SlugRelatedField(source='branch', slug_field='slug', read_only=True)
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
    # The co-authoring project this material is the published projection of, or null for one that
    # has none yet (COAUTHORING-BRIEF.md §2). Read through `getattr` with a default on purpose,
    # and it is not a defensive habit: `project` is a REVERSE one-to-one, whose descriptor raises
    # `RelatedObjectDoesNotExist` — a subclass of `AttributeError`, which is exactly what makes
    # `getattr(obj, 'project', None)` the correct spelling — when no row points here. The same
    # line also answers correctly before the `coauthoring` app exists at all, when `Material` has
    # no `project` attribute whatsoever, which is what lets this ship ahead of it.
    #
    # A plain id, not a nested project: the material page fetches the project itself when it needs
    # one, and embedding it here would put a members list and a version history into every row of
    # every listing.
    #
    # **N+1, named rather than left to be discovered.** While no `project` relation exists this
    # costs nothing (the attribute is simply absent). The moment `coauthoring` lands it becomes one
    # query per row on every material listing, and the fix is `select_related('project')` in the
    # TWO places that build a material list — `MaterialViewSet.queryset` (materials/views.py) and
    # the branch tab's own copy in `taxonomy/views.py`'s `BranchViewSet.materials`, which has
    # drifted from the first one before and carries a comment saying so. A reverse one-to-one is
    # `select_related`-able from this side, so that is all it takes.
    project_id = serializers.SerializerMethodField()
    # "The text you are reading is older than the document it describes."
    #
    # A co-authored material's versions carry title/description in the PROJECT's locale only, and
    # publishing one rewrites that one `MaterialTranslation` row. Every OTHER locale's row keeps
    # whatever it said, which may now describe a document that has moved on — so this compares the
    # translation the reader actually resolved to against the published version's own
    # `published_at`, and says so when it is behind.
    #
    # Deliberately a HINT and not a hiding rule (the content-language rule in root CLAUDE.md is
    # about which items a LIST shows; this is about one item a reader already has open). Translating
    # a material is not versioned at all — COAUTHORING-BRIEF.md §9 names that as left open — and
    # this field is the whole of what the app says about it.
    #
    # False, never null, when there is no project, no published version, or the reader is already
    # reading the project's own locale: three different ways of "there is nothing to warn about",
    # and a reader does not need them told apart.
    translation_stale = serializers.SerializerMethodField()

    class Meta:
        model = Material
        fields = [
            'id',
            'branch',
            'branch_slug',
            'slug',
            'type',
            'audience',
            'coverage',
            'requirements',
            'file',
            'url',
            # The material's own written text, when it is that shape rather than a file or a link
            # (materials/models.py's `Material.body`). Read-only here like every other field on
            # this serializer — `MaterialViewSet` is a ReadOnlyModelViewSet, and the only writer is
            # a published version's projection (`coauthoring.services.sync_material`).
            'body',
            'project_id',
            'author',
            'source_url',
            'submitted_by',
            'submitted_by_display_name',
            'translation_stale',
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

    def get_project_id(self, obj):
        project = getattr(obj, 'project', None)
        return project.pk if project is not None else None

    def get_translation_stale(self, obj):
        # `getattr(..., None)` for the same reason `get_project_id` above documents: `project` is a
        # reverse one-to-one whose descriptor raises `RelatedObjectDoesNotExist` (an AttributeError
        # subclass) when nothing points here.
        project = getattr(obj, 'project', None)
        if project is None:
            return False
        published = project.published_version
        if published is None or published.published_at is None:
            return False
        translation = resolve_translation(obj.translations, request_locale(self.context))
        if translation is None or translation.locale == project.locale:
            return False
        updated = getattr(translation, 'updated_at', None)
        return bool(updated is not None and updated < published.published_at)


class MaterialTypeSerializer(serializers.ModelSerializer):
    """The vocabulary `Material.type` draws from, name resolved for the reader's own locale.

    `status` is on the wire for the same reason the taxonomy serializers expose theirs: the browse
    and picker UIs group anything pending under "Others" rather than pretending it is settled, and
    they cannot do that from a name alone.
    """

    name = serializers.SerializerMethodField()

    class Meta:
        model = MaterialType
        fields = ['id', 'slug', 'order', 'status', 'name']

    def get_name(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        # The slug is the honest fallback for a type proposed in a language nobody has translated
        # yet — better than an empty label, and it is what the proposer typed a slug of anyway.
        return t.name if t else obj.slug
