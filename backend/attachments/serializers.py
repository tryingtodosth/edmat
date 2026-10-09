"""The attachment API's shapes: what a reader gets, what a writer posts, and one row of the ledger.

The reader's shape is deliberately one serializer for all five kinds rather than five. A caller
switches on `kind` and reads the one payload field that kind owns (`file_url`, `body`, `url`,
`sketch`, `chem_drawing`); the others are null. The alternative — a polymorphic serializer — would
move that switch into the API and give the frontend five shapes to map instead of one.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .files import looks_like_text, process_file_upload, process_text_upload
from .models import (
    KIND_CHEM,
    KIND_CHOICES,
    KIND_FILE,
    KIND_LINK,
    KIND_SKETCH,
    KIND_TEXT,
    MAX_TEXT_LENGTH,
    VISIBILITY_CHOICES,
    Attachment,
)


class PersonSerializer(serializers.Serializer):
    """Just enough to name somebody. Duplicated from `documents/serializers.py` for the reason that
    module's own copy already gives: two independent apps, and an import in either direction makes
    one API's response shape hostage to the other's roster decisions. Eight lines."""

    id = serializers.IntegerField(source='pk', read_only=True)
    display_name = serializers.SerializerMethodField()

    def get_display_name(self, user) -> str:
        profile = getattr(user, 'profile', None)
        return profile.display_name if profile and profile.display_name else user.username


class AttachmentSerializer(serializers.ModelSerializer):
    uploaded_by = PersonSerializer(read_only=True)
    file_url = serializers.SerializerMethodField()
    sketch_image_url = serializers.SerializerMethodField()
    chem_image_url = serializers.SerializerMethodField()
    acknowledged = serializers.SerializerMethodField()
    acknowledgement_count = serializers.SerializerMethodField()
    is_current = serializers.BooleanField(read_only=True)
    target_kind = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = [
            'id', 'target_kind', 'object_id', 'kind', 'title', 'description',
            'body', 'url', 'file_url', 'sketch', 'sketch_image_url', 'chem_drawing',
            'chem_image_url', 'media_type', 'original_name', 'byte_size',
            'visibility', 'requires_acknowledgement', 'version', 'uploaded_by', 'replaced_by',
            'is_current', 'acknowledged', 'acknowledgement_count', 'scanned', 'scan_detail',
            'order', 'created_at',
        ]

    def get_target_kind(self, attachment) -> str | None:
        from . import targets

        return targets.kind_of(attachment.target) if attachment.target else None

    def get_file_url(self, attachment) -> str | None:
        """The PROTECTED endpoint, never `attachment.file.url`.

        A `/media/…` path is served by the web server with no idea who is asking, so publishing one
        here would make every tier decision in `access.py` decorative — the link would be the leak.
        Relative on purpose: `lib/api/client.ts` is what knows the API's origin, and it is also what
        carries the token this URL needs.
        """
        if attachment.kind != KIND_FILE or not attachment.file:
            return None
        return f'/attachments/{attachment.pk}/file/'

    def get_sketch_image_url(self, attachment) -> str | None:
        sketch = attachment.sketch
        return getattr(getattr(sketch, 'image', None), 'url', None) if sketch else None

    def get_chem_image_url(self, attachment) -> str | None:
        drawing = attachment.chem_drawing
        return getattr(getattr(drawing, 'image', None), 'url', None) if drawing else None

    def get_acknowledged(self, attachment) -> bool:
        """Whether the person asking has read THIS version. A per-reader field rather than a second
        call, because the button's label depends on it and a round trip per row would be one per
        row."""
        user = getattr(self.context.get('request'), 'user', None)
        if not (user and user.is_authenticated):
            return False
        return any(
            ack.user_id == user.pk and ack.version == attachment.version
            for ack in attachment.acknowledgements.all()
        )

    def get_acknowledgement_count(self, attachment) -> int:
        return sum(1 for ack in attachment.acknowledgements.all() if ack.version == attachment.version)


class AttachmentWriteSerializer(serializers.Serializer):
    """What a writer posts. Multipart for a file, JSON for everything else.

    **`kind` is not taken on trust for a file.** An upload whose name ends `.md` takes the text
    path whatever the caller said, because what the bytes ARE is a question for `files.py` and not
    for the client — the same discipline `media_type` follows.
    """

    kind = serializers.ChoiceField(choices=[k for k, _ in KIND_CHOICES], default=KIND_FILE)
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    visibility = serializers.ChoiceField(
        choices=[v for v, _ in VISIBILITY_CHOICES], required=False, default='members'
    )
    requires_acknowledgement = serializers.BooleanField(required=False, default=False)
    order = serializers.IntegerField(required=False, default=0, min_value=0, max_value=32767)

    file = serializers.FileField(required=False)
    body = serializers.CharField(required=False, allow_blank=True, max_length=MAX_TEXT_LENGTH)
    url = serializers.URLField(required=False, allow_blank=True, max_length=500)
    sketch = serializers.IntegerField(required=False, allow_null=True)
    chem_drawing = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, data):
        kind = data.get('kind', KIND_FILE)
        if kind in (KIND_FILE, KIND_TEXT) and not data.get('file') and not (data.get('body') or '').strip():
            raise serializers.ValidationError({'file': 'Attach a file, or write the text.'})
        if kind == KIND_LINK and not data.get('url'):
            raise serializers.ValidationError({'url': 'A link attachment needs a link.'})
        if kind == KIND_SKETCH and not data.get('sketch'):
            raise serializers.ValidationError({'sketch': 'Choose a sketch.'})
        if kind == KIND_CHEM and not data.get('chem_drawing'):
            raise serializers.ValidationError({'chem_drawing': 'Choose a drawing.'})
        return data

    def build(self, *, target, user) -> Attachment:
        """Turn the validated payload into an unsaved row, running the file through `files.py`.

        Raises DRF's `ValidationError`, so every refusal from the pipeline — too big, not UTF-8, a
        renamed zip, the legacy Office formats — reaches the caller as a 400 with its own sentence
        rather than as a 500.
        """
        from django.contrib.contenttypes.models import ContentType

        data = self.validated_data
        kind = data.get('kind', KIND_FILE)
        upload = data.get('file')

        row = Attachment(
            content_type=ContentType.objects.get_for_model(target, for_concrete_model=False),
            object_id=target.pk,
            title=data['title'],
            description=data.get('description', ''),
            visibility=data.get('visibility', 'members'),
            requires_acknowledgement=data.get('requires_acknowledgement', False),
            order=data.get('order', 0),
            uploaded_by=user if getattr(user, 'is_authenticated', False) else None,
        )

        try:
            if upload is not None and looks_like_text(upload):
                # The caller said `file`; the bytes say "a note". `files.py` decides, not the client.
                processed = process_text_upload(upload)
                row.kind = KIND_TEXT
                row.body = processed.body
                row.media_type = processed.media_type
                row.original_name = (getattr(upload, 'name', '') or '')[:120]
            elif upload is not None:
                processed = process_file_upload(upload)
                row.kind = KIND_FILE
                row.file = processed.content
                row.media_type = processed.media_type
                row.byte_size = processed.byte_size
                row.scanned = processed.scanned
                row.scan_detail = processed.scan_detail
                row.original_name = (getattr(upload, 'name', '') or '')[:120]
            elif kind == KIND_TEXT or (data.get('body') or '').strip():
                row.kind = KIND_TEXT
                row.body = data.get('body', '')
                row.media_type = 'text/markdown'
            elif kind == KIND_LINK:
                row.kind = KIND_LINK
                row.url = data['url']
            elif kind == KIND_SKETCH:
                row.kind = KIND_SKETCH
                row.sketch_id = data['sketch']
            elif kind == KIND_CHEM:
                row.kind = KIND_CHEM
                row.chem_drawing_id = data['chem_drawing']
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'file': exc.messages}) from exc
        return row


class AcknowledgementSerializer(serializers.Serializer):
    """One row of the ledger — who read what, at which version, and when."""

    user = PersonSerializer(read_only=True)
    attachment = serializers.IntegerField(source='attachment_id', read_only=True)
    version = serializers.IntegerField(read_only=True)
    acknowledged_at = serializers.DateTimeField(read_only=True)


class AttachmentReviewSerializer(serializers.ModelSerializer):
    author = PersonSerializer(read_only=True)

    class Meta:
        from .models import AttachmentReview as _Review

        model = _Review
        fields = ['id', 'attachment', 'author', 'rating', 'body', 'created_at']
        read_only_fields = ['attachment', 'author', 'created_at']
