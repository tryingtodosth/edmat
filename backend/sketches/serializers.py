import base64
import binascii
import io
import json
import re

from django.core.exceptions import ValidationError as DjangoValidationError
from PIL import Image
from rest_framework import serializers

from imaging import (
    ALLOWED_IMAGE_TYPES,
    MAX_IMAGE_PIXELS,
    decode_for_reencode,
    encode_webp,
    validate_image_upload,
)

from .models import MAX_LABEL_LENGTH, MAX_SOURCE_BYTES, Sketch

# The longest edge of the stored picture. A whiteboard is line art shown inline in a paragraph;
# 1600 is the bound a comment picture and a chem raster already get, and a sketch never needs more.
MAX_RASTER_EDGE = 1600
RASTER_QUALITY = 90
# The byte cap on what arrives, checked BEFORE anything is decoded (house rule 7's first layer).
# A 1600px PNG of strokes is a few hundred kilobytes; 8 MB is the same headroom `chem/` allows.
MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024

_DATA_URL = re.compile(r'^data:(image/(?:png|webp|jpeg));base64,(.+)$', re.S)


def validate_source_shape(source: str) -> None:
    """The cheapest check that tells "a document this editor can reopen" from garbage. Never a
    drawing check: there is no drawing engine on the server, deliberately. An Excalidraw scene is
    a JSON object with an `elements` array; `appState` and `files` are optional and are not
    inspected."""
    if len(source.encode('utf-8', 'ignore')) > MAX_SOURCE_BYTES:
        raise serializers.ValidationError('The sketch is too large.')
    try:
        parsed = json.loads(source)
    except ValueError as e:
        raise serializers.ValidationError(f'Not valid JSON: {e}') from e
    if not isinstance(parsed, dict):
        raise serializers.ValidationError('The sketch source must be a JSON object.')
    if not isinstance(parsed.get('elements'), list):
        raise serializers.ValidationError('This does not look like an Excalidraw scene.')


class SketchSerializer(serializers.ModelSerializer):
    author = serializers.IntegerField(source='author_id', read_only=True)
    image_url = serializers.SerializerMethodField()
    embed_html = serializers.SerializerMethodField()

    class Meta:
        model = Sketch
        fields = [
            'id', 'author', 'source', 'label',
            'image_url', 'width', 'height', 'embed_html', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_image_url(self, obj) -> str:
        if not obj.image:
            return ''
        request = self.context.get('request')
        return request.build_absolute_uri(obj.image.url) if request else obj.image.url

    def get_embed_html(self, obj) -> str:
        return obj.embed_html(self.get_image_url(obj))


class SketchWriteSerializer(serializers.Serializer):
    """`image` is a `data:image/png;base64,…` URL — what Excalidraw's `exportToBlob` produces,
    read back as a data URL by the host component. One JSON body rather than multipart, like
    `chem/`: the client already has the scene JSON to send in the same request, and one request
    shape keeps it to one call."""

    source = serializers.CharField()
    label = serializers.CharField(required=False, allow_blank=True, max_length=MAX_LABEL_LENGTH)
    image = serializers.CharField()

    def validate(self, attrs):
        validate_source_shape(attrs['source'])
        attrs['_picture'] = self._prepare_picture(attrs['image'])
        return attrs

    def _prepare_picture(self, image: str):
        """Byte cap → sniff → declared-dimension budget → decode → re-encode as WebP. Every layer
        lives in `imaging.py` (house rule 7); nothing here stores a byte the browser sent. A
        polyglot — a valid PNG whose trailing bytes are also something else — does not survive,
        because re-encoding keeps only pixels."""
        m = _DATA_URL.match(image.lstrip())
        if not m:
            raise serializers.ValidationError({'image': 'Send the drawing as a PNG or WebP data URL.'})
        try:
            raw = base64.b64decode(m.group(2), validate=True)
        except (binascii.Error, ValueError) as e:
            raise serializers.ValidationError({'image': 'The picture is not valid base64.'}) from e
        if len(raw) > MAX_IMAGE_UPLOAD_BYTES:
            raise serializers.ValidationError({'image': 'The picture is too large.'})
        upload = io.BytesIO(raw)
        upload.size = len(raw)
        try:
            validate_image_upload(
                upload,
                max_bytes=MAX_IMAGE_UPLOAD_BYTES,
                allowed_types=ALLOWED_IMAGE_TYPES,
                max_pixels=MAX_IMAGE_PIXELS,
            )
            pil = decode_for_reencode(upload)
        except DjangoValidationError as e:
            raise serializers.ValidationError({'image': e.messages}) from e
        pil.thumbnail((MAX_RASTER_EDGE, MAX_RASTER_EDGE), resample=Image.Resampling.LANCZOS)
        return {'content': encode_webp(pil, quality=RASTER_QUALITY), 'width': pil.width, 'height': pil.height}

    def _apply(self, sketch: Sketch, attrs) -> Sketch:
        picture = attrs['_picture']
        sketch.source = attrs['source']
        sketch.label = attrs.get('label', '')[:MAX_LABEL_LENGTH]
        sketch.width = picture['width']
        sketch.height = picture['height']
        # A replaced picture gets a fresh random name and the old file goes — Django's FileField
        # never cleans up on its own, and a stale file nothing references is an orphan forever.
        if sketch.pk and sketch.image:
            sketch.image.delete(save=False)
        sketch.image.save('sketch', picture['content'], save=False)
        sketch.save()
        return sketch

    def create(self, validated_data):
        return self._apply(Sketch(author=self.context['request'].user), validated_data)

    def update(self, instance, validated_data):
        return self._apply(instance, validated_data)
