from rest_framework import serializers

from moderation.services import REPORT_KIND_MODELS

from .models import LEGAL_NOTICE_STATUS_CHOICES, LegalNotice


class LegalNoticeSerializer(serializers.ModelSerializer):
    """The read shape — staff, or the notifier reading their own. `reporter` is the bare id (this
    API's own convention, `issues.IssueSerializer.reporter` does the same); there is no display-name
    field here the way Issue has one, since a legal notice is never shown to anybody but staff and
    its own notifier — nobody else ever reads this row, so there's no byline to render."""

    reporter = serializers.IntegerField(source='reporter_id', read_only=True)

    class Meta:
        model = LegalNotice
        fields = [
            'id',
            'content_url',
            'explanation',
            'good_faith_confirmed',
            'notifier_name',
            'contact_email',
            'reporter',
            'status',
            'content_kind',
            'content_object_id',
            'resolve_note',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields


class LegalNoticeCreateSerializer(serializers.Serializer):
    """POST body for filing a notice — open to anyone, guest included. `contact_email` is always
    required (see the model's own doc comment for why this differs from `issues.Issue`), and
    `good_faith_confirmed` must actually be `True`, not merely present — a form that silently sent
    `False` must not slip through as if it had been checked."""

    content_url = serializers.URLField(max_length=500)
    explanation = serializers.CharField()
    good_faith_confirmed = serializers.BooleanField()
    notifier_name = serializers.CharField(required=False, allow_blank=True, default='')
    contact_email = serializers.EmailField()

    def validate_good_faith_confirmed(self, value):
        if not value:
            raise serializers.ValidationError(
                'You must confirm this notice is accurate and made in good faith.'
            )
        return value

    def create(self, validated_data):
        request = self.context['request']
        reporter = request.user if request.user.is_authenticated else None
        return LegalNotice.objects.create(reporter=reporter, **validated_data)


class LegalNoticeResolveSerializer(serializers.Serializer):
    """`POST /api/legal-notices/{id}/resolve/` — staff only. `status` must be a real decision
    ('acted' or 'rejected'), never back to 'open' (there is no un-deciding, only a fresh decision).
    `resolve_note` is REQUIRED here — not merely encouraged — because this is the Art. 17 "statement
    of reasons": DSA does not treat "we decided" as adequate on its own, whichever way the decision
    goes. `content_kind`/`content_object_id` are optional and, when both are given, must resolve to a
    real row of a model this app already knows how to act on (`moderation.services.
    REPORT_KIND_MODELS` — the same catalog `Report`/`ReportActionView` use); see `legal/views.py` for
    what actually happens once they resolve.
    """

    status = serializers.ChoiceField(
        choices=[c for c in LEGAL_NOTICE_STATUS_CHOICES if c[0] != 'open']
    )
    resolve_note = serializers.CharField()
    content_kind = serializers.ChoiceField(
        choices=list(REPORT_KIND_MODELS.keys()), required=False, allow_blank=True, default=''
    )
    content_object_id = serializers.IntegerField(required=False, allow_null=True, default=None)

    def validate_resolve_note(self, value):
        if not value.strip():
            raise serializers.ValidationError(
                'A legal notice needs a stated reason before you can decide it — see DSA Art. 17.'
            )
        return value

    def validate(self, attrs):
        kind = attrs.get('content_kind')
        object_id = attrs.get('content_object_id')
        if bool(kind) != bool(object_id):
            raise serializers.ValidationError(
                'Give both the content kind and its id, or neither.'
            )
        if kind and object_id and attrs['status'] == 'acted':
            model = REPORT_KIND_MODELS[kind]
            if not model.objects.filter(pk=object_id).exists():
                raise serializers.ValidationError(
                    {'content_object_id': ["Nothing of that kind exists with that id."]}
                )
        return attrs
