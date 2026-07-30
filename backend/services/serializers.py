from rest_framework import serializers

from taxonomy.models import Course

from .models import Service, ServiceReview, ServiceWatch


class ServiceSerializer(serializers.ModelSerializer):
    provider_id = serializers.IntegerField(source='provider.id', read_only=True)
    provider_username = serializers.CharField(source='provider.username', read_only=True)
    provider_display_name = serializers.SerializerMethodField()
    # Read-side: real course objects (slug + own translated name would need the frontend's
    # existing course-resolution, so we just expose slugs here — the frontend already has every
    # published course's own name from GET /api/fields/{slug}/courses/, no need to duplicate it).
    course_slugs = serializers.SlugRelatedField(
        source='courses', slug_field='slug', many=True, read_only=True
    )
    # A plain SerializerMethodField (2 extra queries per row), not a queryset-level annotation the
    # way ExerciseListSerializer's own average_rating/review_count need to be at real corpus scale
    # (383+ exercises) — a services browse page is a small, course-scoped or "my listings" set, not
    # a page that has ever needed that same optimization; revisit only if that stops being true.
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()

    class Meta:
        model = Service
        fields = [
            'id',
            'provider_id',
            'provider_username',
            'provider_display_name',
            'title',
            'description',
            'course_slugs',
            'hourly_rate',
            'currency',
            'is_active',
            'average_rating',
            'review_count',
            'created_at',
            'updated_at',
        ]

    def get_provider_display_name(self, obj):
        profile = getattr(obj.provider, 'profile', None)
        return (profile.display_name if profile and profile.display_name else obj.provider.username)

    def get_average_rating(self, obj):
        from django.db.models import Avg

        avg = obj.reviews.filter(is_removed=False).aggregate(avg=Avg('rating'))['avg']
        return round(avg, 1) if avg is not None else None

    def get_review_count(self, obj):
        return obj.reviews.filter(is_removed=False).count()


class ServiceReviewSerializer(serializers.ModelSerializer):
    # Same `getattr(obj.author.profile, 'display_name', '') or obj.author.username` pattern
    # community/serializers.py's ReviewSerializer already establishes for the identical purpose.
    author_display_name = serializers.SerializerMethodField()

    class Meta:
        model = ServiceReview
        fields = ['id', 'service', 'author', 'author_display_name', 'rating', 'body', 'created_at']
        read_only_fields = ['author']

    def get_author_display_name(self, obj):
        return getattr(obj.author.profile, 'display_name', '') or obj.author.username


class ServiceWriteSerializer(serializers.ModelSerializer):
    """POST/PATCH — `provider` is always the authenticated caller (set by the view, never accepted
    from the client, matching this app's own established "who's the author" convention throughout
    - Review/Comment/ExerciseSubmission never take an author from the request body either).
    `course_slugs` (write) accepts a list of real Course slugs, resolved here rather than requiring
    the frontend to already know numeric Course PKs (every other course reference in this API is a
    slug, see CLAUDE.md's own note on id-format convention)."""

    course_slugs = serializers.ListField(child=serializers.SlugField(), write_only=True, required=False)

    class Meta:
        model = Service
        fields = ['id', 'title', 'description', 'course_slugs', 'hourly_rate', 'currency', 'is_active']

    def validate_course_slugs(self, slugs):
        courses = list(Course.objects.filter(slug__in=slugs, published=True))
        found_slugs = {c.slug for c in courses}
        missing = set(slugs) - found_slugs
        if missing:
            raise serializers.ValidationError(f'Unknown course slug(s): {", ".join(sorted(missing))}')
        return courses

    def create(self, validated_data):
        courses = validated_data.pop('course_slugs', [])
        service = Service.objects.create(**validated_data)
        if courses:
            service.courses.set(courses)
        return service

    def update(self, instance, validated_data):
        courses = validated_data.pop('course_slugs', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if courses is not None:
            instance.courses.set(courses)
        return instance


class ServiceWatchSerializer(serializers.ModelSerializer):
    """"Add to watchlist to compare certain listings" — `service` is the only real write input
    (`user`/`created_at` are always the caller/server, matching this app's own established
    "never trust an author/owner field from the client" convention). The full nested `Service`
    representation is embedded on read (via `to_representation` below) so the watchlist page can
    render/compare real listings directly from this one response, without a second N-request
    fan-out for each watched id."""

    class Meta:
        model = ServiceWatch
        fields = ['id', 'service', 'created_at']

    def validate(self, attrs):
        # A real, found-by-a-failing-test bug: without this pre-check, a duplicate watch attempt
        # fell straight through to the DB's own `unique_together` constraint and surfaced as a raw
        # 500 IntegrityError instead of a clean 400 — the same "check .exists() first" pattern
        # NodeGovernorSerializer/ReportCreateSerializer already establish elsewhere in this app for
        # the identical class of "would violate a unique constraint" case.
        request = self.context.get('request')
        if request is not None and request.user.is_authenticated:
            if ServiceWatch.objects.filter(user=request.user, service=attrs['service']).exists():
                raise serializers.ValidationError({'detail': ['You already have this listing on your watchlist.']})
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['service'] = ServiceSerializer(instance.service, context=self.context).data
        return data
