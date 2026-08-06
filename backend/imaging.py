"""The image checks every user-uploaded picture in this project goes through, in one place.

Extracted from `accounts/avatar.py`, which is where all of this was written and which still holds the
long-form reasoning for *why* each layer exists — read that module's docstring first; this one only
records why the code moved.

**Why shared rather than copied.** `events/postimage.py` needed the same four layers for an event
post's picture, and the honest options were a second copy or this module. A copy is the wrong answer
specifically because these are security bounds: the decompression-bomb budget below is the kind of
number somebody lowers once, in one place, after an incident — and a second copy is how the avatar
path gets the fix and the event path silently does not. `courses/models.py` already imports
`materials.validators.validate_material_submission_file` across an app boundary for exactly this
reason, so the precedent for sharing a validator here is the project's own.

What deliberately did NOT move is the *shape* of the output. An avatar is centre-cropped to a square
because a round 48px frame is what renders it; a post picture keeps its aspect ratio because it is
shown full-width in a feed and cropping somebody's slide to a square would cut the slide in half.
Those are presentation decisions belonging to the feature, so each caller does its own final resize
and only the validate/decode/encode primitives live here.

A plain top-level module rather than a Django app: it has no models, no migrations and no URLs, and
making it an app would put an empty `migrations/` directory in the tree and one more entry in
`INSTALLED_APPS` to buy nothing. `config/` is already a non-app package in this backend.
"""

from __future__ import annotations

import uuid

import magic
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.utils.translation import gettext_lazy as _
from PIL import Image, ImageOps, UnidentifiedImageError

# 40 megapixels of DECODED image — see `accounts/avatar.py` for the full argument. The short version:
# a byte-size cap alone does not bound decode cost, because compression ratios are unbounded, so a
# valid ~5 MB PNG can declare 40000x40000 and decode to gigabytes of resident memory. Pillow's own
# `MAX_IMAGE_PIXELS` defaults to ~89 MP and only warns below 2x that, which is far past the point
# where this app would already be in trouble.
MAX_IMAGE_PIXELS = 40_000_000

# The sniffed types accepted as INPUT, deliberately narrower than everything Pillow can decode: the
# long tail of formats (TIFF, BMP, ICO, and more exotic ones) have decoders that see far less
# security scrutiny than these three, and no feature here needs them.
ALLOWED_IMAGE_TYPES = frozenset({'image/png', 'image/jpeg', 'image/webp'})

# WebP for every stored result: universally supported by the browsers this app targets, handles both
# photographic and flat/graphic content well, and carries alpha (which JPEG cannot).
WEBP_FORMAT = 'WEBP'
WEBP_EXTENSION = '.webp'

# libmagic only needs the leading bytes to identify a format; reading the whole upload to sniff it
# would defeat the point of having a size cap at all.
_SNIFF_BYTES = 2048


def sniff_content_type(upload) -> str:
    upload.seek(0)
    head = upload.read(_SNIFF_BYTES)
    upload.seek(0)
    return magic.from_buffer(head, mime=True)


def open_within_pixel_budget(upload, max_pixels: int = MAX_IMAGE_PIXELS) -> Image.Image:
    """`Image.open` is lazy — it parses the header and stops, so `.size` is available here WITHOUT
    any pixel data having been decoded yet. That laziness is the whole reason the bomb check can
    happen at all: checking dimensions after a full decode would mean the damage is already done."""
    upload.seek(0)
    try:
        image = Image.open(upload)
    except Image.DecompressionBombError as exc:  # Pillow's own outer bound, far above ours
        raise ValidationError(_('That image is too large to process.')) from exc
    except (UnidentifiedImageError, OSError) as exc:
        raise ValidationError(_('That file could not be read as an image.')) from exc

    width, height = image.size
    if width * height > max_pixels:
        raise ValidationError(
            _('That image has too many pixels (%(w)dx%(h)d). Please use a smaller one.')
            % {'w': width, 'h': height}
        )
    return image


def validate_image_upload(
    upload,
    *,
    max_bytes: int,
    allowed_types: frozenset[str] | set[str] = ALLOWED_IMAGE_TYPES,
    max_pixels: int = MAX_IMAGE_PIXELS,
) -> None:
    """The three cheap layers, in the order they have to happen: byte cap before anything decodes,
    then a content-type sniff (kept for its far better error message even though the re-encode makes
    it non-load-bearing for safety), then the declared-dimension bomb check.

    Usable directly as a Django field validator via `functools.partial`, which is how it stays
    enforced on the admin path that never calls the API's own processing function.
    """
    size = getattr(upload, 'size', None)
    if size is not None and size > max_bytes:
        raise ValidationError(
            _('That image is %(size).1f MB. The maximum is %(max).0f MB.')
            % {'size': size / (1024 * 1024), 'max': max_bytes / (1024 * 1024)}
        )

    sniffed = sniff_content_type(upload)
    if sniffed not in allowed_types:
        raise ValidationError(
            _('That file is not a PNG, JPEG, or WebP image (detected: %(type)s).')
            % {'type': sniffed}
        )

    image = open_within_pixel_budget(upload, max_pixels)
    # `verify()` is a header/structure integrity check that reads no pixel data. It leaves the
    # instance unusable afterward by design, which is fine — nothing else needs this one.
    try:
        image.verify()
    except Exception as exc:  # Pillow raises a wide, undocumented range here, hence the broad catch
        raise ValidationError(_('That image appears to be corrupt.')) from exc
    finally:
        upload.seek(0)


def decode_for_reencode(upload, *, max_pixels: int = MAX_IMAGE_PIXELS) -> Image.Image:
    """Open, bake in the EXIF rotation, and normalize the colour mode — everything common to both
    callers' re-encode, stopping short of the resize, which is the part they genuinely differ on.

    Applying `exif_transpose` before the metadata is dropped is the step that is easy to miss and
    silently rotates every phone photo 90 degrees when it is: the tag says "display this sideways",
    and stripping it without first honouring it throws away the instruction while keeping the
    sideways pixels.
    """
    image = open_within_pixel_budget(upload, max_pixels)
    image = ImageOps.exif_transpose(image)
    # Keep transparency where the source genuinely has it; everything else becomes plain RGB. `P`
    # (palette) images can carry alpha via a `transparency` key rather than an alpha channel, so
    # they are routed to RGBA rather than RGB to avoid dropping it.
    if image.mode in ('RGBA', 'LA', 'P'):
        return image.convert('RGBA')
    return image.convert('RGB')


def encode_webp(image: Image.Image, *, quality: int) -> ContentFile:
    """Write a fresh WebP under a random name.

    The uploader's own filename is discarded entirely — a filename is untrusted input too (path
    separators, a double extension like `picture.webp.html`, or a collision with somebody else's
    upload), which is the same reason `material_submission_upload_path` generates its own.

    No `exif=`/`icc_profile=` argument is passed, so neither is written: the metadata strip is a
    property of not opting in, rather than a separate step somebody could forget.
    """
    buffer = ContentFile(b'')
    image.save(buffer, format=WEBP_FORMAT, quality=quality, method=6)
    buffer.seek(0)
    buffer.name = f'{uuid.uuid4().hex}{WEBP_EXTENSION}'
    return buffer
