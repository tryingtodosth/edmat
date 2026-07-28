from rest_framework import serializers

from taxonomy.models import Course

from .models import Service


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
            'created_at',
            'updated_at',
        ]

    def get_provider_display_name(self, obj):
        profile = getattr(obj.provider, 'profile', None)
        return (profile.display_name if profile and profile.display_name else obj.provider.username)


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
