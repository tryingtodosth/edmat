"""Turning an uploaded picture into the one this site stores.

Nothing new is decided here — `imaging.py` holds the security bounds and the reasoning behind each
of them, and this module is the fourth caller to spell out the two numbers that are genuinely a
matter of taste per feature: how big an upload may be, and how large the stored picture is kept.

**The numbers, and why they are not the post picture's.** A feed picture is bounded at 1600px
because it renders in an ~800-CSS-pixel column. A gallery picture is routinely a PHOTOGRAPHED PAGE —
somebody's phone held over a handout — and the thing a reader does with it is open it and read the
handwriting, which is exactly the case 1600px starts to fail. Hence 2000px and a 10 MB ceiling on
the upload. Deliberately not imported from `activity/postimage.py` even though the code is the same
shape: they are equal by taste, not by rule, and the day one moves the other should not follow it.
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

from .models import GALLERY_IMAGE_MAX_EDGE, MAX_GALLERY_IMAGE_BYTES

GALLERY_IMAGE_QUALITY = 82


def validate_gallery_image(upload) -> None:
    """A real field validator, so the Django admin — which assigns a file straight to the field and
    never reaches `process_gallery_image` — still gets the byte cap, the content sniff and the
    decompression-bomb budget."""
    validate_image_upload(
        upload,
        max_bytes=MAX_GALLERY_IMAGE_BYTES,
        allowed_types=ALLOWED_IMAGE_TYPES,
        max_pixels=MAX_IMAGE_PIXELS,
    )


def process_gallery_image(upload) -> tuple[ContentFile, int, int]:
    """Validate, discard the original, return a fresh WebP and the size it ended up.

    `thumbnail` is shrink-only, so a picture already smaller than the bound is stored at its own
    size rather than blown up into a blurrier, larger file. The aspect ratio is kept — a gallery
    picture is a page or a diagram, and centre-cropping it square (what an avatar gets) would cut
    off the margins, which on a photographed exercise sheet is where half the working is.
    """
    validate_gallery_image(upload)
    image = decode_for_reencode(upload)
    image.thumbnail(
        (GALLERY_IMAGE_MAX_EDGE, GALLERY_IMAGE_MAX_EDGE),
        resample=Image.Resampling.LANCZOS,
    )
    content = encode_webp(image, quality=GALLERY_IMAGE_QUALITY)
    return content, image.width, image.height
