"""Pictures and small PDFs on comments (AUDIENCE-BRIEF.md §6). At most three per comment, added by
the author after the comment exists — the many comment endpoints stay JSON, and one multipart
route here serves them all.

A picture is never the bytes that were uploaded: it goes through `imaging` exactly like a post
picture (re-encoded WebP, aspect kept, EXIF gone). A PDF cannot be re-encoded, so it gets what a
material upload gets: libmagic sniffing, the size cap, and the ClamAV scan when a daemon exists
(`materials.validators`). Stored under a random name; the original name is kept only for display.
"""

import uuid

from django.core.exceptions import ValidationError
from PIL import Image

from imaging import (
    ALLOWED_IMAGE_TYPES,
    MAX_IMAGE_PIXELS,
    decode_for_reencode,
    encode_webp,
    sniff_content_type,
    validate_image_upload,
)
from materials.validators import MAX_MATERIAL_SUBMISSION_SIZE_BYTES, scan_for_malware

MAX_ATTACHMENTS_PER_COMMENT = 3
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
MAX_ATTACHMENT_IMAGE_EDGE = 1600
ATTACHMENT_IMAGE_QUALITY = 82


def attachment_upload_path(instance, filename: str) -> str:
    ext = '.webp' if instance.kind == 'image' else '.pdf'
    return f'comment-attachments/{uuid.uuid4().hex}{ext}'


def process_attachment(upload):
    """Returns `(kind, content_file, original_name, size)` or raises ValidationError."""
    size = getattr(upload, 'size', 0) or 0
    if size > MAX_ATTACHMENT_BYTES:
        raise ValidationError({'file': ['Up to 5 MB.']})
    if size > MAX_MATERIAL_SUBMISSION_SIZE_BYTES:
        raise ValidationError({'file': ['Too large.']})
    sniffed = sniff_content_type(upload)
    name = (getattr(upload, 'name', '') or 'file')[:120]
    if sniffed in ALLOWED_IMAGE_TYPES:
        validate_image_upload(upload, max_bytes=MAX_ATTACHMENT_BYTES, allowed_types=ALLOWED_IMAGE_TYPES, max_pixels=MAX_IMAGE_PIXELS)
        image = decode_for_reencode(upload)
        image.thumbnail((MAX_ATTACHMENT_IMAGE_EDGE, MAX_ATTACHMENT_IMAGE_EDGE), resample=Image.Resampling.LANCZOS)
        content = encode_webp(image, quality=ATTACHMENT_IMAGE_QUALITY)
        return 'image', content, name, content.size
    if sniffed == 'application/pdf':
        outcome = scan_for_malware(upload)
        if outcome.scanned and not outcome.clean:
            raise ValidationError({'file': ['The scanner flagged this file.']})
        upload.seek(0)
        from django.core.files.base import ContentFile

        content = ContentFile(upload.read())
        return 'pdf', content, name, content.size
    raise ValidationError({'file': [f'Only a picture (PNG, JPEG, WebP) or a PDF; this is {sniffed}.']})


def used_upload_bytes(user) -> int:
    """Everything this person has uploaded that counts against their allowance: material
    submissions, comment attachments, and pictures embedded in content.

    One function because more than one endpoint asks the question (house rule: a rule two
    endpoints need lives in one module). When pictures moved out of the attachment row and into
    the body, an endpoint that still counted only attachments would have handed out storage the
    other one thought it was still guarding."""
    from concepts.models import ConceptAsset

    from .models import CommentAttachment, InlineImage

    attachments = sum(
        CommentAttachment.objects.filter(comment__author=user).values_list('size_bytes', flat=True)
    )
    inline = sum(InlineImage.objects.filter(author=user).values_list('size_bytes', flat=True))
    # A picture or a PDF placed as a block in a concept article (concepts/). Counted here, by this
    # docstring's own rule: `concepts.services.store_asset` weighs the incoming file against the
    # same allowance, and an endpoint that counted only the older three would hand out storage the
    # others still think they are guarding. A local import — `community` is imported BY `concepts`.
    concept_assets = sum(
        ConceptAsset.objects.filter(uploaded_by=user).values_list('size_bytes', flat=True)
    )
    return user.profile.material_upload_bytes + attachments + inline + concept_assets
