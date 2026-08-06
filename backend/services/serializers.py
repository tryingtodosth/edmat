import decimal

from rest_framework import serializers

from community.serializers import ReplyCountMixin

from taxonomy.models import Branch

from .geocoding import COORD_PRECISION
from .models import IN_PERSON_MODES, Service, ServiceReview, ServiceWatch


class CoordinateField(serializers.DecimalField):
    """A DecimalField that ROUNDS excess precision instead of rejecting it.

    DRF's own DecimalField treats more decimal places than the model allows as a validation error,
    which is the wrong behavior for a coordinate: Nominatim returns 7+ places, the model stores 6,
    and nobody typing an address has any idea either number exists. The failure this prevents was
    real, not theoretical — the frontend echoed a search result straight back and got a 400 saying
    the value it had just been handed was invalid.

    services/geocoding.py already rounds at its own boundary, so this is the second layer, covering
    any coordinate that did NOT come from a search — a pin dragged on the map, or any other client.
    Rounding is unambiguously safe here: the 7th decimal place is ~1 cm.
    """

    def to_internal_value(self, data):
        try:
            data = round(decimal.Decimal(str(data).strip()), COORD_PRECISION)
        except (decimal.InvalidOperation, ValueError, AttributeError):
            # Not a number at all — hand it to the parent, whose error message for this is already
            # the right one.
            pass
        return super().to_internal_value(data)


class ServiceSerializer(serializers.ModelSerializer):
    provider_id = serializers.IntegerField(source='provider.id', read_only=True)
    provider_username = serializers.CharField(source='provider.username', read_only=True)
    provider_display_name = serializers.SerializerMethodField()
    # Read-side: real branch objects (slug + own translated name would need the frontend's
    # existing branch-resolution, so we just expose slugs here — the frontend already has every
    # published branch's own name from GET /api/disciplines/{slug}/branches/, no need to duplicate
    # it).
    branch_slugs = serializers.SlugRelatedField(
        source='branches', slug_field='slug', many=True, read_only=True
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
            'branch_slugs',
            'hourly_rate',
            'currency',
            'is_active',
            'delivery_mode',
            'location_label',
            'location_lat',
            'location_lon',
            # Both read by the booking UI to decide what to SAY about the slots it renders, not just
            # to render them — see booking/models.py. Exposed on the public read shape because a
            # student is entitled to know which of the two meanings of "available" they are looking
            # at before they act on it.
            'availability_mode',
            'session_minutes',
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


class ServiceReviewSerializer(ReplyCountMixin, serializers.ModelSerializer):
    # Same `getattr(obj.author.profile, 'display_name', '') or obj.author.username` pattern
    # community/serializers.py's ReviewSerializer already establishes for the identical purpose.
    author_display_name = serializers.SerializerMethodField()
    reply_count = serializers.SerializerMethodField()

    class Meta:
        model = ServiceReview
        fields = [
            'id',
            'service',
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


class ServiceWriteSerializer(serializers.ModelSerializer):
    """POST/PATCH — `provider` is always the authenticated caller (set by the view, never accepted
    from the client, matching this app's own established "who's the author" convention throughout
    - Review/Comment/ExerciseSubmission never take an author from the request body either).
    `branch_slugs` (write) accepts a list of real Branch slugs, resolved here rather than requiring
    the frontend to already know numeric Branch PKs (every other course reference in this API is a
    slug, see CLAUDE.md's own note on id-format convention)."""

    branch_slugs = serializers.ListField(child=serializers.SlugField(), write_only=True, required=False)
    location_lat = CoordinateField(
        max_digits=9, decimal_places=COORD_PRECISION, required=False, allow_null=True
    )
    location_lon = CoordinateField(
        max_digits=9, decimal_places=COORD_PRECISION, required=False, allow_null=True
    )

    class Meta:
        model = Service
        fields = [
            'id',
            'title',
            'description',
            'branch_slugs',
            'hourly_rate',
            'currency',
            'is_active',
            'delivery_mode',
            'location_label',
            'location_lat',
            'location_lon',
            'availability_mode',
            'session_minutes',
        ]

    def validate_session_minutes(self, minutes):
        # A floor and a ceiling, both real rather than defensive. Below 15 minutes a session is not a
        # tutoring appointment, and the slot grid a published window slices into becomes unreadable;
        # above 8 hours nothing a weekly rule can express would ever contain one, so it would produce
        # a listing with permanently empty availability and no visible reason why.
        if not (15 <= minutes <= 480):
            raise serializers.ValidationError('A session must be between 15 minutes and 8 hours.')
        return minutes

    def validate_branch_slugs(self, slugs):
        branches = list(Branch.objects.filter(slug__in=slugs, published=True))
        found_slugs = {c.slug for c in branches}
        missing = set(slugs) - found_slugs
        if missing:
            raise serializers.ValidationError(f'Unknown branch slug(s): {", ".join(sorted(missing))}')
        return branches

    def validate(self, attrs):
        """Keeps `delivery_mode` and the location fields consistent with each other, in both
        directions — a listing that claims in-person tutoring but has no place, and a listing that
        carries a stale pin for tutoring that is now online-only, are both real states a user can
        otherwise produce just by editing an existing listing.

        Runs on PATCH too, which is why the mode is read from the instance when the request does not
        supply one: a partial update that sends only `location_lat` must still be checked against the
        mode the listing ALREADY has, not silently treated as unconstrained.
        """
        mode = attrs.get('delivery_mode') or getattr(self.instance, 'delivery_mode', 'online')

        if mode in IN_PERSON_MODES:
            lat = attrs.get('location_lat', getattr(self.instance, 'location_lat', None))
            lon = attrs.get('location_lon', getattr(self.instance, 'location_lon', None))
            if lat is None or lon is None:
                raise serializers.ValidationError(
                    {
                        'location_lat': [
                            'An in-person or hybrid listing needs a location on the map.'
                        ]
                    }
                )
        else:
            # Online-only: actively CLEAR any location rather than merely ignoring it. Leaving a
            # previous pin in place would keep rendering a map, on a listing whose tutoring no longer
            # happens anywhere in particular — worse than showing nothing, because it is wrong rather
            # than absent.
            attrs['location_label'] = ''
            attrs['location_lat'] = None
            attrs['location_lon'] = None

        return attrs

    def create(self, validated_data):
        branches = validated_data.pop('branch_slugs', [])
        service = Service.objects.create(**validated_data)
        if branches:
            service.branches.set(branches)
        return service

    def update(self, instance, validated_data):
        branches = validated_data.pop('branch_slugs', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if branches is not None:
            instance.branches.set(branches)
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
