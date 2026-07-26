from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import DonationLink, Profile

User = get_user_model()


class DonationLinkSerializer(serializers.ModelSerializer):
    # A resolved, always-non-blank display name — `label` itself stays optional on write (blank
    # means "just use the platform's own name"), so every reader (the owner's own settings list, a
    # visitor's public profile) gets something real to show without independently reimplementing
    # the "blank label falls back to get_platform_display()" rule model.py's own __str__ already
    # encodes once.
    display_label = serializers.SerializerMethodField()

    class Meta:
        model = DonationLink
        fields = ['id', 'platform', 'label', 'display_label', 'url', 'order']

    def get_display_label(self, obj):
        return obj.label or obj.get_platform_display()


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
    donation_links = DonationLinkSerializer(many=True, read_only=True)

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
            'show_profile_publicly',
            'notify_on_comment_reply',
            'notify_on_moderation_decision',
            'notify_on_content_action',
            'donation_links',
        ]


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """PATCH /api/auth/me/ — the deliberately narrow, write-side counterpart to `ProfileSerializer`
    above: only what an account holder is actually allowed to self-edit. `id`/`email`/`is_moderator`/
    `is_verified_contributor`/`joined_at` all stay whatever they already are, same as
    `RegisterSerializer` never lets a caller set `is_verified_contributor`/`is_moderator` either —
    both are moderator-granted, not self-service."""

    class Meta:
        model = Profile
        fields = [
            'display_name',
            'preferred_locale',
            'show_profile_publicly',
            'notify_on_comment_reply',
            'notify_on_moderation_decision',
            'notify_on_content_action',
        ]


class PublicProfileSerializer(serializers.ModelSerializer):
    """GET /api/users/{id}/ — resolves a review/comment/translation author's display name for
    anyone, not just the account owner. Deliberately its own serializer, not a `ProfileSerializer`
    subclass (Phase 3's original version was) — the notification-preference fields
    (`notify_on_*`) are a stranger's own private settings, not a public endpoint's business to leak,
    and simply never appear in this serializer's `Meta.fields` at all rather than needing an
    exclude-after-the-fact.

    `display_name`/`avatar` are ALWAYS returned regardless of `show_profile_publicly` — every
    comment/review/submission byline throughout the app resolves its author through this same
    endpoint and needs USABLE data to render at all; privacy here only withholds the EXTRA info a
    dedicated visit to a user's own `/users/{id}` profile page surfaces (joined date, role badges),
    never basic public attribution (CLAUDE.md's own "privacy affects the profile page's extra info,
    not attribution everywhere" call). `email` is blanked unconditionally either way — nothing in
    the UI ever reads another user's email (only `authStore.user.email`, the CURRENT user's own)."""

    id = serializers.IntegerField(source='user.id', read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    email = serializers.SerializerMethodField()
    is_moderator = serializers.BooleanField(source='user.is_staff', read_only=True)
    is_profile_public = serializers.BooleanField(source='show_profile_publicly', read_only=True)
    donation_links = DonationLinkSerializer(many=True, read_only=True)

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
            'is_profile_public',
            'donation_links',
        ]

    def get_email(self, obj):
        return ''

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        if not instance.show_profile_publicly:
            rep['joined_at'] = None
            rep['is_verified_contributor'] = False
            rep['is_moderator'] = False
        return rep


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
