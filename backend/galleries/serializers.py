from __future__ import annotations

from rest_framework import serializers

from .models import Gallery, GalleryImage
from .visibility import can_curate


class GalleryImageSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    uploaded_by_display_name = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = GalleryImage
        fields = [
            'id',
            'url',
            'caption',
            'order',
            'width',
            'height',
            'size_bytes',
            'original_name',
            'uploaded_by',
            'uploaded_by_display_name',
            'can_edit',
            'created_at',
        ]
        read_only_fields = fields

    def get_url(self, obj) -> str:
        """Absolute, built from the request. A relative `/media/…` resolves against whatever origin
        the PAGE is on, which in development is the Vite server rather than the API — the same trap
        comment attachments and chem drawings already record having fallen into."""
        request = self.context.get('request')
        url = obj.image.url
        return request.build_absolute_uri(url) if request else url

    def get_uploaded_by_display_name(self, obj) -> str:
        user = obj.uploaded_by
        if user is None:
            return ''
        profile = getattr(user, 'profile', None)
        return (profile.display_name if profile and profile.display_name else user.username) or ''

    def get_can_edit(self, obj) -> bool:
        """Whether THIS caller may change or remove THIS picture — their own, or anything at all if
        they curate the gallery. Answered per row so the client does not have to reimplement the
        rule and get it subtly different."""
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return False
        if obj.uploaded_by_id == user.pk:
            return True
        target = self.context.get('target')
        return can_curate(target, user) if target is not None else False


class GallerySerializer(serializers.ModelSerializer):
    images = serializers.SerializerMethodField()
    target_type = serializers.CharField(read_only=True)
    target_id = serializers.IntegerField(source='object_id', read_only=True)
    can_curate = serializers.SerializerMethodField()
    can_add = serializers.SerializerMethodField()

    class Meta:
        model = Gallery
        fields = ['id', 'target_type', 'target_id', 'images', 'can_curate', 'can_add']

    def get_images(self, obj):
        rows = [image for image in obj.images.all() if image.is_visible]
        return GalleryImageSerializer(rows, many=True, context=self.context).data

    def get_can_curate(self, obj) -> bool:
        request = self.context.get('request')
        target = self.context.get('target') or obj.target
        return can_curate(target, getattr(request, 'user', None))

    def get_can_add(self, obj) -> bool:
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated)
