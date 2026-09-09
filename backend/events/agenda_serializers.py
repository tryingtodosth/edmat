"""The programme half of the events API (AUDIENCE-BRIEF.md §3.1–3.2): staff, tracks, sessions
with their speakers and links, bookmarks. Kept beside `serializers.py` rather than inside it,
which is already 500 lines of event/attendance/post shapes."""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation
from exercises.models import Exercise
from materials.models import Material
from study.models import ExerciseSet

from .models import (
    LINK_ROLE_CHOICES,
    EventStaff,
    Session,
    SessionLink,
    SessionSpeaker,
    Track,
)
from .serializers import PersonSerializer

User = get_user_model()


class EventStaffSerializer(serializers.ModelSerializer):
    user = PersonSerializer(read_only=True)
    is_host = serializers.SerializerMethodField()

    class Meta:
        model = EventStaff
        fields = ['id', 'user', 'role', 'is_host', 'added_at']

    def get_is_host(self, row) -> bool:
        return row.user_id == row.event.host_id


class TrackSerializer(serializers.ModelSerializer):
    class Meta:
        model = Track
        fields = ['id', 'name', 'colour', 'order']

    def validate_colour(self, value):
        value = (value or '').strip()
        if value and not (len(value) == 7 and value[0] == '#' and all(c in '0123456789abcdefABCDEF' for c in value[1:])):
            raise serializers.ValidationError('A colour is #rrggbb.')
        return value.lower()


class SessionSpeakerSerializer(serializers.ModelSerializer):
    """`user_id` in, `user` out. A speaker with an account gets a link to their profile; one
    without is a name on the programme, exactly as printed."""

    user = PersonSerializer(read_only=True)
    user_id = serializers.PrimaryKeyRelatedField(
        source='user', queryset=User.objects.all(), required=False, allow_null=True, write_only=True
    )

    class Meta:
        model = SessionSpeaker
        fields = ['id', 'user', 'user_id', 'name', 'affiliation', 'bio', 'order']
        read_only_fields = ['id', 'order']
        extra_kwargs = {'name': {'required': False, 'allow_blank': True}}

    def validate(self, attrs):
        user = attrs.get('user')
        if not (attrs.get('name') or '').strip():
            if user is None:
                raise serializers.ValidationError({'name': 'A speaker needs a name.'})
            profile = getattr(user, 'profile', None)
            attrs['name'] = (getattr(profile, 'display_name', '') or user.username)
        return attrs


class SessionLinkSerializer(serializers.ModelSerializer):
    """Exactly one target in; the same target plus a resolved `title` out, so the programme can
    print "Slides — Analiza II skrypt" without a lookup per link."""

    kind = serializers.CharField(read_only=True)
    title = serializers.SerializerMethodField()
    material = serializers.PrimaryKeyRelatedField(queryset=Material.objects.filter(published=True), required=False, allow_null=True)
    exercise = serializers.PrimaryKeyRelatedField(queryset=Exercise.objects.filter(published=True), required=False, allow_null=True)
    exercise_set = serializers.SlugRelatedField(slug_field='slug', queryset=ExerciseSet.objects.all(), required=False, allow_null=True)

    class Meta:
        model = SessionLink
        fields = ['id', 'kind', 'title', 'material', 'exercise', 'exercise_set', 'url', 'role', 'label', 'note', 'order']
        read_only_fields = ['id', 'order']

    def validate(self, attrs):
        targets = [bool(attrs.get('material')), bool(attrs.get('exercise')), bool(attrs.get('exercise_set')), bool((attrs.get('url') or '').strip())]
        if sum(targets) != 1:
            raise serializers.ValidationError('A link points at exactly one thing: a material, an exercise, a set, or an address.')
        attrs['url'] = (attrs.get('url') or '').strip()
        if attrs.get('role') not in dict(LINK_ROLE_CHOICES):
            attrs['role'] = 'other'
        return attrs

    def get_title(self, link) -> str:
        if link.label:
            return link.label
        locale = request_locale(self.context)
        if link.material_id:
            t = resolve_translation(link.material.translations, locale)
            return t.title if t else str(link.material_id)
        if link.exercise_id:
            t = resolve_translation(link.exercise.translations.filter(status='published'), locale)
            return t.title if t else f'#{link.exercise_id}'
        if link.exercise_set_id:
            return link.exercise_set.name
        return link.url


class SessionSerializer(serializers.ModelSerializer):
    """Reads and writes one programme block. `speakers`/`links` are nested lists replaced whole on
    every write — the shape `EventPost.links` already uses; an organiser edits a session as one
    thing, and a per-speaker endpoint would be four routes for what one form submits."""

    speakers = SessionSpeakerSerializer(many=True, required=False)
    links = SessionLinkSerializer(many=True, required=False)
    track = serializers.PrimaryKeyRelatedField(queryset=Track.objects.all(), required=False, allow_null=True)
    ends_at = serializers.DateTimeField(read_only=True)
    bookmark_count = serializers.SerializerMethodField()
    is_bookmarked = serializers.SerializerMethodField()
    registered_count = serializers.SerializerMethodField()
    is_registered = serializers.SerializerMethodField()

    class Meta:
        model = Session
        fields = [
            'id', 'event', 'track', 'kind', 'title', 'abstract', 'starts_at', 'duration_minutes',
            'ends_at', 'location_text', 'online_url', 'capacity', 'order', 'speakers', 'links',
            'bookmark_count', 'is_bookmarked', 'registered_count', 'is_registered', 'updated_at',
        ]
        read_only_fields = ['id', 'event', 'updated_at']

    def get_bookmark_count(self, session) -> int:
        cached = getattr(session, 'bookmark_rows', None)
        return len(cached) if cached is not None else session.bookmarks.count()

    def get_is_bookmarked(self, session) -> bool:
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not (user and user.is_authenticated):
            return False
        cached = getattr(session, 'bookmark_rows', None)
        if cached is not None:
            return any(b.user_id == user.pk for b in cached)
        return session.bookmarks.filter(user=user).exists()

    def get_registered_count(self, session) -> int:
        return session.registrations.count() if session.capacity else 0

    def get_is_registered(self, session) -> bool:
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not (user and user.is_authenticated) or not session.capacity:
            return False
        return session.registrations.filter(attendance__attendee=user).exists()

    def validate(self, attrs):
        event = self.context['event']
        probe = Session(**{k: v for k, v in attrs.items() if k not in ('speakers', 'links')})
        if self.instance is not None:
            for f in ('starts_at', 'duration_minutes', 'track'):
                if f not in attrs:
                    setattr(probe, f, getattr(self.instance, f))
        probe.event = event
        probe.clean()
        return attrs

    def _replace_children(self, session, speakers, links):
        if speakers is not None:
            session.speakers.all().delete()
            for i, row in enumerate(speakers):
                SessionSpeaker.objects.create(session=session, order=i, **row)
        if links is not None:
            session.links.all().delete()
            for i, row in enumerate(links):
                SessionLink.objects.create(session=session, order=i, **row)

    def create(self, validated):
        speakers = validated.pop('speakers', None)
        links = validated.pop('links', None)
        session = Session.objects.create(event=self.context['event'], **validated)
        self._replace_children(session, speakers, links)
        return session

    def update(self, session, validated):
        speakers = validated.pop('speakers', None)
        links = validated.pop('links', None)
        for k, v in validated.items():
            setattr(session, k, v)
        session.save()
        self._replace_children(session, speakers, links)
        return session
