"""`/api/galleries/` and `/api/gallery-images/`.

Reading is as public as the content the gallery hangs off; adding a picture needs an account;
ordering, captioning somebody else's picture and taking one down need the person who looks after
that piece of content.
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from django.db import transaction
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from accounts.minors import hold_for_review, is_minor
from config.audience import MINOR_AUDIENCES
from moderation.permissions import feature_gate

from .imagefile import process_gallery_image
from .models import (
    GALLERY_TARGET_MODELS,
    MAX_IMAGES_PER_GALLERY,
    Gallery,
    GalleryImage,
    gallery_image_upload_path,
)
from .serializers import GalleryImageSerializer, GallerySerializer
from .visibility import can_curate, target_is_readable

_GalleriesGate = feature_gate('galleries')


def _resolve_target(target_type: str, target_id):
    """(model, instance) for a `target_type` this app allows, or (None, None). Never raises on bad
    input — every caller turns the miss into a 404, and a client sending nonsense should not be able
    to produce a 500."""
    key = GALLERY_TARGET_MODELS.get(target_type)
    if key is None:
        return None, None
    try:
        content_type = ContentType.objects.get_by_natural_key(*key)
    except ContentType.DoesNotExist:
        return None, None
    model = content_type.model_class()
    try:
        return model, model.objects.filter(pk=int(target_id)).first()
    except (TypeError, ValueError):
        return model, None


class GalleryViewSet(viewsets.GenericViewSet):
    permission_classes = [_GalleriesGate]
    serializer_class = GallerySerializer

    def get_queryset(self):
        return Gallery.objects.all()

    @action(detail=False, methods=['get'], url_path='for-target')
    def for_target(self, request):
        """The gallery for one piece of content — the only read this feature needs.

        A gallery that does not exist yet answers with an empty one (`id: null`) rather than a 404,
        because "this material has no pictures" and "there is no such material" are different
        things and only the first should render a page with an upload button on it.
        """
        target_type = request.query_params.get('target_type', '')
        model, target = _resolve_target(target_type, request.query_params.get('target_id'))
        if model is None or target is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not target_is_readable(target, request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)

        content_type = ContentType.objects.get_for_model(model)
        gallery = (
            Gallery.objects.filter(content_type=content_type, object_id=target.pk)
            .prefetch_related('images__uploaded_by__profile')
            .first()
        )
        context = {'request': request, 'target': target}
        if gallery is None:
            return Response(
                {
                    'id': None,
                    'target_type': target_type,
                    'target_id': target.pk,
                    'images': [],
                    'can_curate': can_curate(target, request.user),
                    'can_add': bool(request.user and request.user.is_authenticated),
                }
            )
        return Response(GallerySerializer(gallery, context=context).data)

    @action(detail=True, methods=['put'], url_path='order')
    def order(self, request, pk=None):
        """Put the pictures in an order — the curator's job, and the reason this feature has a
        curator at all.

        A full list of ids rather than one move at a time: that is the shape a drag-and-drop list
        naturally submits, and it cannot leave two pictures claiming the same position the way a
        sequence of single moves can.
        """
        gallery = self.get_queryset().filter(pk=pk).first()
        if gallery is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        target = gallery.target
        if not target_is_readable(target, request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not can_curate(target, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)

        ids = request.data.get('image_ids')
        if not isinstance(ids, list):
            return Response(
                {'image_ids': ['Send the full list of image ids, in the order you want them.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        rows = {image.pk: image for image in gallery.images.all()}
        try:
            wanted = [int(value) for value in ids]
        except (TypeError, ValueError):
            return Response({'image_ids': ['Ids must be numbers.']}, status=status.HTTP_400_BAD_REQUEST)
        if set(wanted) != set(rows) or len(wanted) != len(rows):
            # Refusing a partial list rather than appending the rest: a client that sent one is
            # working from a stale gallery, and quietly inventing positions for what it forgot is
            # how two people reordering at once produce an order neither chose.
            return Response(
                {'image_ids': ['Send every image in this gallery exactly once.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            for position, image_id in enumerate(wanted):
                image = rows[image_id]
                if image.order != position:
                    image.order = position
                    image.save(update_fields=['order'])
        gallery.refresh_from_db()
        return Response(
            GallerySerializer(gallery, context={'request': request, 'target': target}).data
        )


class GalleryImageViewSet(
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [_GalleriesGate, permissions.IsAuthenticated]
    serializer_class = GalleryImageSerializer
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'gallery_image'

    def get_queryset(self):
        return GalleryImage.objects.select_related('gallery', 'uploaded_by__profile')

    def create(self, request, *args, **kwargs):
        """Add one picture to the gallery for a piece of content, creating the gallery if this is
        the first one."""
        target_type = request.data.get('target_type', '')
        model, target = _resolve_target(target_type, request.data.get('target_id'))
        if model is None or target is None or not target_is_readable(target, request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)

        upload = request.FILES.get('image')
        if upload is None:
            return Response({'image': ['An image is required.']}, status=status.HTTP_400_BAD_REQUEST)

        content_type = ContentType.objects.get_for_model(model)
        gallery, _ = Gallery.objects.get_or_create(content_type=content_type, object_id=target.pk)
        if gallery.images.count() >= MAX_IMAGES_PER_GALLERY:
            return Response({'detail': 'too_many'}, status=status.HTTP_409_CONFLICT)

        try:
            content, width, height = process_gallery_image(upload)
        except ValidationError as exc:
            detail = exc.message_dict if hasattr(exc, 'message_dict') else {'image': exc.messages}
            return Response(detail, status=status.HTTP_400_BAD_REQUEST)

        size = content.size
        profile = request.user.profile
        quota = profile.material_upload_quota_bytes
        if quota:
            # The same allowance comment attachments and material submissions are charged against —
            # one account, one budget, however the bytes got there. Summed live for the same reason
            # `Profile.material_upload_bytes` is: a counter that drifts is invisibly wrong.
            used = profile.material_upload_bytes + sum(
                GalleryImage.objects.filter(uploaded_by=request.user).values_list(
                    'size_bytes', flat=True
                )
            )
            if used + size > quota:
                return Response({'detail': 'quota'}, status=status.HTTP_409_CONFLICT)

        original_name = (getattr(upload, 'name', '') or '')[:255]
        row = GalleryImage(
            gallery=gallery,
            caption=(request.data.get('caption') or '')[:300],
            order=gallery.images.count(),
            uploaded_by=request.user,
            original_name=original_name,
            width=width,
            height=height,
            size_bytes=size,
        )
        row.image.save(gallery_image_upload_path(row, original_name), content, save=True)

        # A picture on content aimed at children, or from a child's own account, waits for a
        # moderator — the same rule and the same queue as a picture on a comment (§17AP).
        target_audience = getattr(target, 'audience', None)
        if is_minor(request.user) or target_audience in MINOR_AUDIENCES:
            row.auto_hidden_at = None  # `hold_for_review` sets it; be explicit that it starts clear
            hold_for_review(row, request.user)

        return Response(
            GalleryImageSerializer(row, context={'request': request, 'target': target}).data,
            status=status.HTTP_201_CREATED,
        )

    def _may_edit(self, image, user) -> bool:
        return image.uploaded_by_id == user.pk or can_curate(image.gallery.target, user)

    def update(self, request, *args, **kwargs):
        """Only the caption is editable. Replacing the picture would change what a reader already
        saw under a caption somebody else may have written; adding a new one and removing the old is
        the honest version of that, and costs one extra click."""
        image = self.get_object()
        if not self._may_edit(image, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        image.caption = (request.data.get('caption') or '')[:300]
        image.save(update_fields=['caption'])
        return Response(
            GalleryImageSerializer(
                image, context={'request': request, 'target': image.gallery.target}
            ).data
        )

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        image = self.get_object()
        if not self._may_edit(image, request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)
        image.image.delete(save=False)
        image.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
