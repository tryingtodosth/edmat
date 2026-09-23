"""The document API's shapes. Three of them: what a reader gets, what an organiser posts, and one
row of the read-receipt table."""

from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .files import process_document_upload
from .models import KIND_CHOICES, KIND_FILE, KIND_LINK, VISIBILITY_CHOICES, EventDocument


class PersonSerializer(serializers.Serializer):
    """Just enough to name somebody. Duplicated from `events/serializers.py` for the reason that
    module's own copy already gives: two independent apps, and an import in either direction would
    make one API's response shape hostage to the other's roster decisions. Eight lines."""

    id = serializers.IntegerField(source='pk', read_only=True)
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, user) -> str:
        profile = getattr(user, 'profile', None)
        return profile.display_name if profile and profile.display_name else user.username


class EventDocumentSerializer(serializers.ModelSerializer):
    uploaded_by = PersonSerializer(read_only=True)
    file_url = serializers.SerializerMethodField()
    acknowledged = serializers.SerializerMethodField()
    acknowledgement_count = serializers.SerializerMethodField()
    is_current = serializers.BooleanField(read_only=True)

    class Meta:
        model = EventDocument
        fields = [
            'id', 'event', 'title', 'kind', 'url', 'file_url', 'content_type', 'byte_size',
            'visibility', 'requires_acknowledgement', 'version', 'uploaded_by', 'replaced_by',
            'is_current', 'acknowledged', 'acknowledgement_count', 'scanned', 'scan_detail',
            'created_at',
        ]

    def get_file_url(self, document) -> str | None:
        """The PROTECTED endpoint, never `document.file.url`.

        A `/media/…` path is served by the web server with no idea who is asking, so publishing one
        here would make every tier decision in `access.py` decorative — the link would be the leak.
        Relative on purpose: `lib/api/client.ts` is what knows the API's origin, and it is also what
        carries the token this URL needs.
        """
        if document.kind != KIND_FILE or not document.file:
            return None
        return f'/documents/{document.pk}/file/'

    def get_acknowledged(self, document) -> bool:
        """Whether the person asking has read THIS version. A per-reader field rather than a
        separate call, because the button's label depends on it and a second round trip per
        document would be one per row."""
        user = getattr(self.context.get('request'), 'user', None)
        if not (user and user.is_authenticated):
            return False
        return any(
            a.user_id == user.pk and a.version == document.version
            for a in document.acknowledgements.all()
        )

    def get_acknowledgement_count(self, document) -> int:
        # Recount, never increment (house rule 5): two counts over an indexed FK are cheap and
        # cannot drift, and this one is answered straight out of the prefetch.
        return sum(1 for a in document.acknowledgements.all() if a.version == document.version)


class EventDocumentWriteSerializer(serializers.ModelSerializer):
    """What an organiser posts. Multipart with a `file`, or JSON with a `url` — one or the other,
    never both, and the refusal says which."""

    kind = serializers.ChoiceField(choices=KIND_CHOICES, default=KIND_FILE)
    visibility = serializers.ChoiceField(choices=VISIBILITY_CHOICES)
    file = serializers.FileField(required=False, write_only=True)
    url = serializers.URLField(required=False, allow_blank=True, max_length=500)

    class Meta:
        model = EventDocument
        fields = ['title', 'kind', 'file', 'url', 'visibility', 'requires_acknowledgement']

    def validate(self, attrs):
        kind = attrs.get('kind', KIND_FILE)
        has_file = bool(attrs.get('file'))
        has_url = bool(attrs.get('url'))
        if kind == KIND_FILE and not has_file:
            raise serializers.ValidationError({'file': 'Choose a file to upload.'})
        if kind == KIND_LINK and not has_url:
            raise serializers.ValidationError({'url': 'A link document needs a link.'})
        if kind == KIND_FILE and has_url:
            raise serializers.ValidationError({'url': 'A file document does not also carry a link.'})
        if kind == KIND_LINK and has_file:
            raise serializers.ValidationError({'file': 'A link document does not also carry a file.'})
        return attrs

    def validate_file(self, upload):
        """The whole of house rule 7 happens here, before anything is written: the upload is
        decoded and re-encoded (an image) or capped, sniffed and scanned (a PDF), and what comes
        back is what gets stored. The processed result rides on the serializer rather than in
        `validated_data` because it is not a field anybody sent."""
        try:
            self._processed = process_document_upload(upload)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return upload

    def build(self, *, event, user, version=1):
        """Turn validated input into an unsaved row. Not `create()`: the view owns whether this is a
        first upload or a replacement, and a replacement has to write two rows in one breath."""
        data = self.validated_data
        processed = getattr(self, '_processed', None)
        document = EventDocument(
            event=event,
            title=data['title'],
            kind=data.get('kind', KIND_FILE),
            url=data.get('url', ''),
            visibility=data['visibility'],
            requires_acknowledgement=data.get('requires_acknowledgement', False),
            version=version,
            uploaded_by=user,
            content_type=processed.content_type if processed else '',
            byte_size=processed.byte_size if processed else 0,
            scanned=processed.scanned if processed else False,
            scan_detail=processed.scan_detail if processed else '',
        )
        if processed:
            # `content_type` is set above FIRST because `document_upload_path` reads it to decide the
            # stored extension, and `upload_to` runs at save time.
            document.file = processed.content
        return document


class DocumentAcknowledgementRowSerializer(serializers.Serializer):
    """One cell of the organiser's read-receipt table: a person, and what they have read."""

    user = PersonSerializer(read_only=True)
    document_id = serializers.IntegerField(read_only=True)
    version = serializers.IntegerField(read_only=True)
    acknowledged_at = serializers.DateTimeField(read_only=True, allow_null=True)
    outstanding = serializers.BooleanField(read_only=True)

