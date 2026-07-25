from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Profile

User = get_user_model()


class ProfileSerializer(serializers.ModelSerializer):
    # A real, found-before-ever-being-called bug: `id` here must be the USER's own pk, not
    # Profile's own auto pk — every other reference to "a user" throughout this API (Review.author,
    # Comment.author, ExerciseSubmission.submitted_by, ExerciseTranslation.translated_by/reviewed_by)
    # is a User pk, and Profile.pk only happens to equal User.pk by accident of insertion order (the
    # post_save signal that creates a Profile runs immediately after each User is created) — nothing
    # actually guarantees the two sequences stay aligned (a User created without ever getting a
    # Profile, e.g. via a raw QuerySet.create() bypassing signals, would desync them permanently).
    id = serializers.IntegerField(source='user.id', read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    email = serializers.EmailField(source='user.email', read_only=True)
    is_moderator = serializers.BooleanField(source='user.is_staff', read_only=True)

    class Meta:
        model = Profile
        fields = [
            'id',
            'username',
            'email',
            'display_name',
            'avatar',
            'preferred_locale',
            'is_verified_contributor',
            'is_moderator',
            'joined_at',
        ]


class PublicProfileSerializer(ProfileSerializer):
    """GET /api/users/{id}/ — resolves a review/comment/translation author's display name for
    anyone, not just the account owner. Deliberately blanks `email` even though the field is still
    present in the response shape (the frontend's own `User` type requires it) — nothing in the UI
    reads another user's email (only `authStore.user.email`, the CURRENT user's own, is ever
    rendered), so there's no reason for a public endpoint to leak it."""

    email = serializers.SerializerMethodField()

    def get_email(self, obj):
        return ''


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    display_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    preferred_locale = serializers.CharField(max_length=8, required=False, default='en')

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError('That username is already taken.')
        return value

    def validate_email(self, value):
        # Django's own User.email carries no unique constraint by default — enforced here instead,
        # mirroring lib/state/mockData.svelte.ts's own findUserByEmail duplicate-check from Phase 1
        # (the frontend's 'emailTaken' error path predates this endpoint and expects this to hold).
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('That email is already registered.')
        return value

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
        )
        display_name = validated_data.get('display_name', '')
        preferred_locale = validated_data.get('preferred_locale', 'en')
        user.profile.display_name = display_name
        user.profile.preferred_locale = preferred_locale
        user.profile.save(update_fields=['display_name', 'preferred_locale'])
        return user
