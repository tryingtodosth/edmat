import base64
import binascii
import io
import json
import re

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile
from PIL import Image
from rest_framework import serializers

from imaging import ALLOWED_IMAGE_TYPES, MAX_IMAGE_PIXELS, decode_for_reencode, encode_webp, validate_image_upload

from .models import FORMAT_CHOICES, MAX_LABEL_LENGTH, MAX_SOURCE_BYTES, ChemDrawing
from .svg import sanitize_svg, svg_size

# The longest edge of a stored raster (Ketcher's PNG export, should a client send one). A structure is line art
# shown inline in a paragraph; 1600 is the same bound a comment picture gets, and a drawing
# never needs more.
MAX_RASTER_EDGE = 1600
RASTER_QUALITY = 90
MAX_RASTER_UPLOAD_BYTES = 8 * 1024 * 1024

_DATA_URL = re.compile(r'^data:(image/(?:png|webp|jpeg));base64,(.+)$', re.S)


def validate_source_shape(source_format: str, source: str) -> None:
    """The cheapest check that tells "a document this editor can reopen" from garbage — never a
    chemistry check (there is no cheminformatics library on the server, deliberately)."""
    if len(source.encode('utf-8', 'ignore')) > MAX_SOURCE_BYTES:
        raise serializers.ValidationError('The drawing source is too large.')
    if source_format == 'ket':
        try:
            parsed = json.loads(source)
        except ValueError as e:
            raise serializers.ValidationError(f'Not valid JSON: {e}') from e
        if not isinstance(parsed, dict):
            raise serializers.ValidationError('The drawing source must be a JSON object.')
        if 'root' not in parsed:
            raise serializers.ValidationError('This does not look like KET JSON.')
    elif source_format == 'mol':
        # A reaction comes out of Ketcher's Molfile export as an RXN file (`$RXN` header, one
        # molfile block per reactant/product) — the same family, accepted under the same name.
        if 'V2000' not in source and 'V3000' not in source and not source.lstrip().startswith('$RXN'):
            raise serializers.ValidationError('This does not look like an MDL Molfile or RXN file.')


class ChemDrawingSerializer(serializers.ModelSerializer):
    author = serializers.IntegerField(source='author_id', read_only=True)
    image_url = serializers.SerializerMethodField()
    embed_html = serializers.SerializerMethodField()

    class Meta:
        model = ChemDrawing
        fields = [
            'id', 'author', 'source_format', 'source', 'label',
            'image_url', 'image_kind', 'width', 'height', 'embed_html', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_image_url(self, obj) -> str:
        if not obj.image:
            return ''
        request = self.context.get('request')
        return request.build_absolute_uri(obj.image.url) if request else obj.image.url

    def get_embed_html(self, obj) -> str:
        return obj.embed_html(self.get_image_url(obj))


class ChemDrawingWriteSerializer(serializers.Serializer):
    """`image` is either an SVG document (what the app sends — Ketcher's vector export) or a
    `data:image/png;base64,…` URL (Ketcher's PNG export, for a client that prefers it). One JSON
    body rather than multipart: the picture of a hand-drawn structure is a few tens of kilobytes,
    and one request shape keeps the client to one call."""

    source_format = serializers.ChoiceField(choices=FORMAT_CHOICES)
    source = serializers.CharField()
    label = serializers.CharField(required=False, allow_blank=True, max_length=MAX_LABEL_LENGTH)
    image = serializers.CharField()

    def validate(self, attrs):
        validate_source_shape(attrs['source_format'], attrs['source'])
        attrs['_picture'] = self._prepare_picture(attrs['image'])
        return attrs

    def _prepare_picture(self, image: str):
        stripped = image.lstrip()
        m = _DATA_URL.match(stripped)
        if m:
            try:
                raw = base64.b64decode(m.group(2), validate=True)
            except (binascii.Error, ValueError) as e:
                raise serializers.ValidationError({'image': 'The picture is not valid base64.'}) from e
            if len(raw) > MAX_RASTER_UPLOAD_BYTES:
                raise serializers.ValidationError({'image': 'The picture is too large.'})
            upload = io.BytesIO(raw)
            upload.size = len(raw)
            try:
                validate_image_upload(upload, max_bytes=MAX_RASTER_UPLOAD_BYTES, allowed_types=ALLOWED_IMAGE_TYPES, max_pixels=MAX_IMAGE_PIXELS)
                pil = decode_for_reencode(upload)
            except DjangoValidationError as e:
                raise serializers.ValidationError({'image': e.messages}) from e
            pil.thumbnail((MAX_RASTER_EDGE, MAX_RASTER_EDGE), resample=Image.Resampling.LANCZOS)
            content = encode_webp(pil, quality=RASTER_QUALITY)
            return {'kind': 'raster', 'content': content, 'width': pil.width, 'height': pil.height}
        if stripped.startswith('<') and '<svg' in stripped[:2000]:
            try:
                clean = sanitize_svg(stripped)
            except DjangoValidationError as e:
                raise serializers.ValidationError({'image': e.messages}) from e
            w, h = svg_size(clean)
            return {'kind': 'svg', 'content': ContentFile(clean.encode('utf-8')), 'width': w, 'height': h}
        raise serializers.ValidationError({'image': 'Send an SVG document or a PNG/WebP data URL.'})

    def _apply(self, drawing: ChemDrawing, attrs) -> ChemDrawing:
        picture = attrs['_picture']
        drawing.source_format = attrs['source_format']
        drawing.source = attrs['source']
        drawing.label = attrs.get('label', '')[:MAX_LABEL_LENGTH]
        drawing.image_kind = picture['kind']
        drawing.width = picture['width']
        drawing.height = picture['height']
        # A replaced picture gets a fresh random name and the old file goes — Django's FileField
        # never cleans up on its own, and a stale file that nothing references is an orphan forever.
        if drawing.pk and drawing.image:
            drawing.image.delete(save=False)
        drawing.image.save('drawing', picture['content'], save=False)
        drawing.save()
        return drawing

    def create(self, validated_data):
        drawing = ChemDrawing(author=self.context['request'].user)
        return self._apply(drawing, validated_data)

    def update(self, instance, validated_data):
        return self._apply(instance, validated_data)
