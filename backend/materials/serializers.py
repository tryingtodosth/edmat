from django.contrib.contenttypes.models import ContentType
from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation
from taxonomy.serializers import SubtopicSerializer, TopicSerializer

from .models import Material, MaterialCoverage


def _vote_weight(user) -> int:
    """A verified contributor's vote counts double — see MaterialCoverageVote's own doc comment for
    why this is computed here, live, rather than stored on the vote."""
    return 2 if getattr(getattr(user, 'profile', None), 'is_verified_contributor', False) else 1


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
        agree_weight = sum(_vote_weight(v.voter) for v in votes if v.value == 1)
        disagree_weight = sum(_vote_weight(v.voter) for v in votes if v.value == -1)
        total_weight = agree_weight + disagree_weight

        current_user_vote = None
        request = self.context.get('request')
        if request is not None and request.user.is_authenticated:
            mine = next((v for v in votes if v.voter_id == request.user.id), None)
            current_user_vote = mine.value if mine else None

        return {
            'agree_count': sum(1 for v in votes if v.value == 1),
            'disagree_count': sum(1 for v in votes if v.value == -1),
            'agree_weight': agree_weight,
            'disagree_weight': disagree_weight,
            'net_weight': agree_weight - disagree_weight,
            'percent_agree': round(100 * agree_weight / total_weight) if total_weight else None,
            'current_user_vote': current_user_vote,
        }

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


class MaterialSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    coverage = MaterialCoverageSerializer(many=True, read_only=True)
    course_slug = serializers.SlugRelatedField(source='course', slug_field='slug', read_only=True)

    class Meta:
        model = Material
        fields = [
            'id',
            'course',
            'course_slug',
            'slug',
            'type',
            'coverage',
            'file',
            'author',
            'published',
            'featured',
            'order',
            'title',
            'description',
        ]

    def get_title(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.title if t else obj.slug

    def get_description(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.description if t else ''
