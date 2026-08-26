from rest_framework import serializers

from .models import ISSUE_KIND_CHOICES, ISSUE_STATUS_CHOICES, Issue

# What the client may capture about where it was. An allowlist rather than "any JSON", so a
# caller cannot stash arbitrary data on the record under the name of context.
CONTEXT_KEYS = ('path', 'page_title', 'locale', 'viewport', 'user_agent')


class IssueSerializer(serializers.ModelSerializer):
    """The read shape. `reporter_display_name` is empty for an anonymous or guest report — there is
    no name to show, and that is the truth rather than a placeholder — while `contact_email` is
    staff-only: it is how to reach a guest, not something the issues page publishes."""

    reporter = serializers.IntegerField(source='reporter_id', read_only=True)
    reporter_display_name = serializers.SerializerMethodField()
    contact_email = serializers.SerializerMethodField()
    comment_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Issue
        fields = [
            'id',
            'kind',
            'title',
            'body',
            'context',
            'reporter',
            'reporter_display_name',
            'contact_email',
            'is_public',
            'status',
            'staff_note',
            'comment_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def get_reporter_display_name(self, obj) -> str:
        user = obj.reporter
        if user is None:
            return ''
        return getattr(getattr(user, 'profile', None), 'display_name', '') or user.username

    def get_contact_email(self, obj) -> str:
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated and user.is_staff:
            return obj.contact_email
        return ''


class IssueCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=ISSUE_KIND_CHOICES, default='bug')
    title = serializers.CharField(max_length=200)
    body = serializers.CharField(required=False, allow_blank=True, default='')
    context = serializers.DictField(required=False, default=dict)
    anonymous = serializers.BooleanField(required=False, default=False)
    contact_email = serializers.EmailField(required=False, allow_blank=True, default='')
    is_public = serializers.BooleanField(required=False, default=False)

    def validate_context(self, value):
        cleaned = {}
        for key in CONTEXT_KEYS:
            raw = value.get(key)
            if raw is None:
                continue
            cleaned[key] = str(raw)[:500]
        return cleaned

    def create(self, validated_data):
        request = self.context['request']
        anonymous = validated_data.pop('anonymous')
        reporter = None
        contact_email = validated_data.pop('contact_email')
        if anonymous:
            # Not stored at all — see models.py. An email left on an anonymous report would
            # identify the person the box just promised not to.
            contact_email = ''
        elif request.user.is_authenticated:
            reporter = request.user
        return Issue.objects.create(reporter=reporter, contact_email=contact_email, **validated_data)


class IssueStaffUpdateSerializer(serializers.ModelSerializer):
    """What staff may change: the status (with a note), and pulling a report back out of the
    public list. Never the reporter's words — a report is theirs — and never publishing something
    the reporter did not allow."""

    status = serializers.ChoiceField(choices=ISSUE_STATUS_CHOICES, required=False)

    class Meta:
        model = Issue
        fields = ['status', 'staff_note', 'is_public']

    def validate_is_public(self, value):
        if value and not self.instance.is_public:
            raise serializers.ValidationError(
                'Only the reporter can allow a report to be published.'
            )
        return value
