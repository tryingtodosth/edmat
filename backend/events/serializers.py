import re

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from django.utils import timezone
from rest_framework import serializers
from rest_framework.fields import empty

from taxonomy.models import Branch, Discipline

from .models import (
    ATTENDING_STATUSES,
    MAX_POST_LINKS,
    PUBLIC_STATUSES,
    PUBLIC_VISIBILITY,
    Event,
    EventAttendance,
    EventPost,
    EventPostLink,
)
from .postimage import process_post_image


class PersonSerializer(serializers.Serializer):
    """Just enough to name somebody, identical in shape to `classroom.ParticipantSerializer`.

    Duplicated rather than imported across app boundaries on purpose: `classroom` and `events` are
    independent apps, and an import in this direction would make the event API's own response shape
    hostage to a change somebody makes for a course roster. It is eight lines, and the alternative is
    a shared "who is this person" app that does not exist yet and that neither app is asking for.
    """

    id = serializers.IntegerField(source='pk', read_only=True)
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, user) -> str:
        profile = getattr(user, 'profile', None)
        return profile.display_name if profile and profile.display_name else user.username


class EventSummarySerializer(serializers.ModelSerializer):
    """Just enough to name a sub-event or a parent event, the same "minimal reference" shape
    `PersonSerializer` already establishes for a user. A sub-event's own full detail is a real,
    independently-loadable Event — this is only what a listing needs to link to it."""

    host = PersonSerializer(read_only=True)
    ends_at = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = Event
        fields = [
            'id',
            'host',
            'title',
            'status',
            'visibility',
            'starts_at',
            'event_time',
            'ends_at',
            'location_kind',
        ]


class EventAttendanceSerializer(serializers.ModelSerializer):
    attendee = PersonSerializer(read_only=True)

    class Meta:
        model = EventAttendance
        fields = ['id', 'attendee', 'status', 'note', 'responded_at']


class EventSerializer(serializers.ModelSerializer):
    host = PersonSerializer(read_only=True)
    subject_slugs = serializers.SlugRelatedField(
        source='subjects', slug_field='slug', many=True, read_only=True
    )
    discipline_slug = serializers.SlugRelatedField(source='discipline', slug_field='slug', read_only=True)

    ends_at = serializers.DateTimeField(read_only=True, allow_null=True)
    is_past = serializers.BooleanField(read_only=True)
    going_count = serializers.SerializerMethodField()
    seats_left = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)

    # The viewer's own relationship to this event, all resolved server-side. The client should never
    # work out "may I answer this?" for itself — a client that computes a permission is a client that
    # can compute it wrongly, which is the same reasoning `CourseSerializer` records for
    # `can_enrol`.
    my_attendance = serializers.SerializerMethodField()
    is_host = serializers.SerializerMethodField()
    can_respond = serializers.SerializerMethodField()
    response_block_reason = serializers.SerializerMethodField()
    # Present for the host, absent (0) for everybody else — a decline is between the person who made
    # it and the person running the event.
    declined_count = serializers.SerializerMethodField()
    # How many updates the host has posted. On the READ shape rather than only on the posts endpoint,
    # because without it the feature is invisible from a listing: somebody scanning a grid of events
    # has no way to tell the one whose room moved this morning from the one nobody has touched since
    # announcing it, and would have to open each in turn to find out.
    post_count = serializers.SerializerMethodField()

    # The bigger event this one belongs to, and the smaller ones it contains — both resolved
    # server-side through the same `_visible_to` OR-logic every other listing already uses, so a
    # private sub-event never leaks through its public parent's own detail response, and a viewer
    # who cannot see the parent at all simply gets `null` rather than a dangling reference.
    parent = serializers.SerializerMethodField()
    sub_events = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            'id',
            'host',
            'title',
            'summary',
            'description',
            'subject_slugs',
            'discipline_slug',
            'status',
            'visibility',
            'starts_at',
            'event_time',
            'ends_at',
            'duration_minutes',
            'location_kind',
            'location_text',
            'online_url',
            'capacity',
            'language',
            'going_count',
            'declined_count',
            'post_count',
            'seats_left',
            'is_full',
            'is_past',
            'my_attendance',
            'is_host',
            'can_respond',
            'response_block_reason',
            'parent',
            'sub_events',
            'created_at',
        ]

    def _visible(self, candidate, user):
        if candidate is None:
            return False
        if candidate.status in PUBLIC_STATUSES and candidate.visibility in PUBLIC_VISIBILITY:
            return True
        return bool(user and user.is_authenticated and candidate.host_id == user.pk)

    def get_parent(self, event):
        user = self._user()
        if event.parent_id is None or not self._visible(event.parent, user):
            return None
        return EventSummarySerializer(event.parent, context=self.context).data

    def get_sub_events(self, event):
        user = self._user()
        children = [child for child in event.sub_events.all() if self._visible(child, user)]
        return EventSummarySerializer(children, many=True, context=self.context).data

    def _user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None)

    def get_going_count(self, event) -> int:
        return event.going_count()

    def get_declined_count(self, event) -> int:
        user = self._user()
        if user and user.is_authenticated and event.host_id == user.pk:
            return event.declined_count()
        return 0

    def get_post_count(self, event) -> int:
        # `counted_posts` is `EventViewSet.get_queryset`'s own `to_attr` prefetch, so a listing
        # answers this from memory instead of firing one COUNT per row. The fallback is not dead
        # code: this serializer is also handed events that never came through that queryset — the
        # ones `create`, `attend` and `cancel` build from a write serializer — and those have no
        # prefetch to read.
        counted = getattr(event, 'counted_posts', None)
        if counted is not None:
            return len(counted)
        return event.posts.count()

    def get_is_host(self, event) -> bool:
        user = self._user()
        return bool(user and user.is_authenticated and event.host_id == user.pk)

    def get_my_attendance(self, event) -> str | None:
        user = self._user()
        if not (user and user.is_authenticated):
            return None
        row = event.attendances.filter(attendee=user).first()
        return row.status if row else None

    def get_can_respond(self, event) -> bool:
        return event.response_block_reason(self._user()) is None

    def get_response_block_reason(self, event) -> str | None:
        return event.response_block_reason(self._user())


class EventWriteSerializer(serializers.ModelSerializer):
    """Writes take slugs, not primary keys, for the taxonomy relations — the client already knows a
    subject by its slug everywhere else in this API, and making it look up an integer id first would
    be a round trip for nothing. Same shape `CourseWriteSerializer` uses."""

    subject_slugs = serializers.SlugRelatedField(
        source='subjects',
        slug_field='slug',
        many=True,
        required=False,
        queryset=Branch.objects.all(),
    )
    discipline_slug = serializers.SlugRelatedField(
        source='discipline',
        slug_field='slug',
        required=False,
        allow_null=True,
        queryset=Discipline.objects.all(),
    )
    parent = serializers.PrimaryKeyRelatedField(
        required=False, allow_null=True, queryset=Event.objects.all()
    )

    class Meta:
        model = Event
        fields = [
            'title',
            'summary',
            'description',
            'subject_slugs',
            'discipline_slug',
            'status',
            'visibility',
            'starts_at',
            'event_time',
            'duration_minutes',
            'location_kind',
            'location_text',
            'online_url',
            'capacity',
            'language',
            'parent',
        ]

    def validate(self, attrs):
        """Runs the model's own `clean()` rather than restating its rules here.

        Restating them is how the API and the admin drift apart: somebody adds a rule in one place,
        and the other silently keeps accepting what it always did. Building an unsaved instance from
        the merged attributes is the only way to check a PATCH against the fields it is *not*
        changing — validating `location_kind='hybrid'` alone would otherwise pass on an event whose
        stored `online_url` is empty.
        """
        merged = {
            field: attrs.get(field, getattr(self.instance, field, None))
            for field in ('location_kind', 'location_text', 'online_url', 'duration_minutes')
        }
        probe = Event(**{k: v for k, v in merged.items() if v is not None})
        # `full_clean` would also demand the fields this probe deliberately does not carry (title,
        # starts_at, host), so only the cross-field rules are run.
        probe.clean()
        return attrs

    def validate_parent(self, value):
        """Three refusals, all enforced here rather than left to the model's own `clean()` alone —
        that one is a structural backstop (the admin, a seed command), this one is the honest,
        specific reason a request gets back rather than a bare 400."""
        if value is None:
            return value
        if self.instance is not None and value.pk == self.instance.pk:
            raise serializers.ValidationError('An event cannot be part of itself.')
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not (user and user.is_authenticated and value.host_id == user.pk):
            raise serializers.ValidationError('Only the parent event’s own host may add to it.')
        if value.parent_id is not None:
            raise serializers.ValidationError(
                'An event that is itself part of another cannot hold sub-events too.'
            )
        return value

    def validate_status(self, value):
        """Cancelling is a decision with consequences — it notifies everybody who said they were
        coming — so it goes through its own endpoint rather than being a value somebody can PATCH in
        passing. Un-cancelling is refused for the same reason in reverse: telling forty people it is
        back on is not something to do by editing a dropdown."""
        if value == 'cancelled':
            raise serializers.ValidationError('Use the cancel action to call an event off.')
        if self.instance and self.instance.status == 'cancelled':
            raise serializers.ValidationError('A cancelled event cannot be reopened.')
        return value


class PostLinksField(serializers.Field):
    """The links on a post, accepted in whichever shape the request could actually carry them.

    This field exists because a post is submitted two different ways and only one of them can express
    a list. A post with a picture must be `multipart/form-data`, and multipart has no arrays — every
    value is a string. A post without one is ordinary JSON, where a list is the obvious shape. Making
    the client pick one encoding for both would mean either sending JSON-inside-a-form-field (a
    string that has to be parsed by hand, and whose parse errors surface as nonsense) or uploading the
    picture in a second request (which leaves a post visible without its image in between).

    So three shapes are read, and all three normalize to the same list:

    - a real JSON list, `["https://a", "https://b"]`;
    - repeated form fields, `links=https://a&links=https://b`, which is how a browser's own FormData
      sends a repeated input and needs `getlist` to see (see `get_value`);
    - one string holding several, separated by newlines or commas — what a textarea produces, and
      what a single form field degrades to.

    Whitespace-only entries are dropped rather than rejected: a trailing newline in a textarea is not
    a mistake anybody should be shown an error for.
    """

    #: Newlines or commas. A space is deliberately NOT a separator — it is legal inside a URL's query
    #: string (encoded, but real-world links arrive with raw spaces often enough), and splitting on it
    #: would quietly tear one link into two invalid ones.
    _SEPARATORS = re.compile(r'[\n\r,]+')

    default_error_messages = {
        'too_many': f'A post may carry at most {MAX_POST_LINKS} links.',
        'not_a_url': '“{value}” is not a valid link.',
        'wrong_type': 'Links must be a list of URLs.',
    }

    def get_value(self, dictionary):
        """Read repeated form keys rather than only the last one.

        DRF's default implementation is `dictionary.get(field_name)`, which on a `QueryDict` returns
        the LAST value for a repeated key — so a form posting three links would silently keep one.
        `getlist` is the only way to see all of them, and it exists only on QueryDict, hence the
        guard.
        """
        if hasattr(dictionary, 'getlist'):
            values = dictionary.getlist(self.field_name)
            if not values:
                return empty
            # A single form field is handed on as a plain string so `to_internal_value` can apply the
            # separator split to it; several are already the list this field wants.
            return values[0] if len(values) == 1 else values
        return dictionary.get(self.field_name, empty)

    def to_internal_value(self, data):
        if isinstance(data, str):
            candidates = self._SEPARATORS.split(data)
        elif isinstance(data, (list, tuple)):
            # Flattened, because a repeated form field can itself hold a multi-line value — a client
            # that sends both shapes at once is odd but not wrong, and this reads it the obvious way.
            candidates = [
                part for item in data for part in self._SEPARATORS.split(str(item))
            ]
        else:
            self.fail('wrong_type')

        urls = []
        validate = URLValidator()
        for candidate in candidates:
            url = candidate.strip()
            if not url:
                continue
            try:
                validate(url)
            except DjangoValidationError:
                self.fail('not_a_url', value=url[:100])
            # Deduplicated, preserving the order the host wrote them in. The same link twice is a
            # copy-paste slip rather than an intention, and rendering it twice looks like a bug in
            # the page.
            if url not in urls:
                urls.append(url)

        if len(urls) > MAX_POST_LINKS:
            self.fail('too_many')
        return urls

    def to_representation(self, links):
        return [link.url for link in links.all()]


class EventPostSerializer(serializers.ModelSerializer):
    author = PersonSerializer(read_only=True)
    links = PostLinksField(read_only=True)
    image_url = serializers.SerializerMethodField()
    is_edited = serializers.BooleanField(read_only=True)

    class Meta:
        model = EventPost
        fields = [
            'id',
            'author',
            'body',
            'image_url',
            'links',
            'created_at',
            'edited_at',
            'is_edited',
        ]

    def get_image_url(self, post) -> str:
        """Absolute when a request is in context, so a client on another origin can load it.

        Deliberately not the raw storage name, matching `AttachmentSerializer.get_file_url`: that is a
        path, not a link, and every other file in this API is handed over as a URL.
        """
        if not post.image:
            return ''
        request = self.context.get('request')
        url = post.image.url
        return request.build_absolute_uri(url) if request else url


class EventPostWriteSerializer(serializers.ModelSerializer):
    """Create and edit, both. No `can_edit` is returned alongside the read shape on purpose: only the
    host may write a post, and `EventSerializer.is_host` already answers that for the whole page —
    a second field carrying the same bit is one that can disagree with the first."""

    links = PostLinksField(required=False)
    # `allow_null` so a PATCH can genuinely remove a picture. Without it the only expressible states
    # would be "set a new one" and "leave it alone", and a host who attached the wrong photo would
    # have to delete the whole post to be rid of it.
    image = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = EventPost
        fields = ['body', 'image', 'links']

    def validate(self, attrs):
        """Runs the model's own `clean()` rather than restating its rule here — the same choice
        `EventWriteSerializer.validate` records, and for the same reason: a rule stated twice is one
        that drifts."""
        body = attrs.get('body', getattr(self.instance, 'body', ''))
        # `attrs` carries the image only when this request set it. Absent means "leave what is
        # stored", which for a PATCH is the existing file and for a create is nothing.
        if 'image' in attrs:
            image = attrs['image']
        else:
            image = getattr(self.instance, 'image', None)

        probe = EventPost(body=body or '')
        if image:
            probe.image = image
        probe.clean()
        return attrs

    def _write_links(self, post, urls):
        """Replace the whole set rather than diffing it.

        A post carries at most `MAX_POST_LINKS` rows, so the delete-and-recreate costs two queries
        against a handful of rows, and it is the only approach that gets reordering right for free —
        a diff would have to detect that the same three URLs came back in a different order and
        renumber them, which is more code to be wrong in than the thing it saves.
        """
        post.links.all().delete()
        EventPostLink.objects.bulk_create(
            [EventPostLink(post=post, url=url, position=index) for index, url in enumerate(urls)]
        )

    def create(self, validated_data):
        links = validated_data.pop('links', [])
        upload = validated_data.pop('image', None)
        post = EventPost(**validated_data)
        if upload is not None:
            # The uploaded bytes are never what gets stored — see `postimage.py`.
            post.image = process_post_image(upload)
        post.save()
        self._write_links(post, links)
        return post

    def update(self, instance, validated_data):
        links = validated_data.pop('links', None)
        # `pop` with a sentinel rather than a default, because `None` is a real value here: it means
        # "remove the picture", which must be told apart from "this request did not mention it".
        has_image = 'image' in validated_data
        upload = validated_data.pop('image', None)

        for field, value in validated_data.items():
            setattr(instance, field, value)
        if has_image:
            instance.image = process_post_image(upload) if upload is not None else None
        # Stamped here rather than by `auto_now`, so it stays null for a post nobody has edited —
        # see `EventPost.edited_at` for why "edited" has to be a fact rather than an inference.
        instance.edited_at = timezone.now()
        instance.save()

        if links is not None:
            self._write_links(instance, links)
        return instance


class AttendanceWriteSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=['going', 'not_going'])
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


#: Re-exported so views can talk about "a seat" without importing the model constant separately.
__all__ = [
    'ATTENDING_STATUSES',
    'AttendanceWriteSerializer',
    'EventAttendanceSerializer',
    'EventPostSerializer',
    'EventPostWriteSerializer',
    'EventSerializer',
    'EventWriteSerializer',
    'PersonSerializer',
    'PostLinksField',
]
