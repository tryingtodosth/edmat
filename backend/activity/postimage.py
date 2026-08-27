"""The picture on an activity post: validated, stripped, re-encoded — never the uploaded bytes.

Everything about WHY is written down once already: `imaging.py` (the shared security bounds — byte
cap, magic sniff, decode-bomb budget, EXIF strip via re-encode) and `events/postimage.py` (why a
FEED picture bounds its longest edge instead of centre-cropping like an avatar: it is routinely a
whiteboard/slide/poster whose content runs to the edges). The numbers here are the same as the
event post's by the same reasoning — an activity post renders in the same ~800-CSS-pixel feed
column — but deliberately NOT imported from there: `activity` has no business depending on the
unrelated `events` app, and the two features should be tunable apart (the exact "equal today by
coincidence of taste" note events/postimage.py itself makes about the avatar's quality constant).
"""

from __future__ import annotations

from django.core.files.base import ContentFile
from PIL import Image

from imaging import (
    ALLOWED_IMAGE_TYPES,
    MAX_IMAGE_PIXELS,
    decode_for_reencode,
    encode_webp,
    validate_image_upload,
)

MAX_ACTIVITY_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_ACTIVITY_IMAGE_EDGE = 1600
ACTIVITY_IMAGE_QUALITY = 82


def validate_activity_post_image(upload) -> None:
    """A real field validator on `Post.image`, so the admin path (which assigns the file directly
    and never reaches `process_activity_post_image`) still gets size/type/bomb checks."""
    validate_image_upload(
        upload,
        max_bytes=MAX_ACTIVITY_IMAGE_UPLOAD_BYTES,
        allowed_types=ALLOWED_IMAGE_TYPES,
        max_pixels=MAX_IMAGE_PIXELS,
    )


def process_activity_post_image(upload) -> ContentFile:
    """Validate, discard the original, store a fresh aspect-preserving WebP."""
    validate_activity_post_image(upload)
    image = decode_for_reencode(upload)
    image.thumbnail(
        (MAX_ACTIVITY_IMAGE_EDGE, MAX_ACTIVITY_IMAGE_EDGE),
        resample=Image.Resampling.LANCZOS,
    )
    return encode_webp(image, quality=ACTIVITY_IMAGE_QUALITY)
