"""The picture on an event post: validated, stripped, and re-encoded, exactly like an avatar.

Every layer of reasoning behind this lives in `accounts/avatar.py`'s docstring and the shared
`imaging` module — read those for *why* a user-supplied image is never stored as the bytes the
uploader sent. This module only records the two numbers that differ and the one step that does.

**Aspect ratio is preserved; an avatar's is not.** `process_avatar` centre-crops to a square because
a round 48px frame is what renders it, and a square is what that frame wants. A post picture is shown
full-width in a feed, and it is routinely a photo of a whiteboard, a slide, or a poster — the three
things a centre-crop damages most, because on all of them the content runs to the edges and the crop
takes the ends off. So this one bounds the LONGEST edge and lets the shape be whatever it is.

**Why re-encoding still applies even though nothing is cropped.** The crop was never the safety step.
The safety step is that the pixels are decoded and written out fresh, which is what discards appended
payloads, embedded metadata and format-parser trickery. A post picture needs that at least as much as
an avatar does: it is uploaded by a host and then shown to everybody who opens the event, including
people who never met them.

**EXIF is stripped here for a sharper privacy reason than on an avatar.** A phone photo of the room
an event is happening in carries the GPS coordinates of that room, and often the host's own device
serial. An event already publishes where it is, deliberately and in words the host chose — what it
should not also publish is a precise fix taken from a photo the host thought they were just
illustrating the page with.
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

# 8 MB, a little more generous than an avatar's 5. The same argument applies (this bounds what one
# request can make the server read and decode, not what it may store — the stored result is capped by
# the dimensions below regardless), but the realistic input is different: a phone photo of a
# whiteboard is exactly what somebody will attach to "here is what we covered tonight", and those run
# larger than the portrait somebody picks as a profile picture.
MAX_POST_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024

# The longest edge of the STORED image. The event page renders a post at most 800 CSS pixels wide
# (routes/events/[id]/+page.svelte caps the column there), and 2x displays are the norm, so 1600
# covers the widest real presentation at full sharpness. Going further would cost storage and
# transfer for pixels no layout ever asks for.
MAX_POST_IMAGE_EDGE = 1600

# 82, the same visually-lossless-enough point the avatar uses. Worth restating rather than importing
# the avatar's constant: these two are equal today by coincidence of taste, not because one derives
# from the other, and tying them together would mean tuning a post picture silently retunes every
# profile picture on the site.
POST_IMAGE_QUALITY = 82


def validate_post_image(upload) -> None:
    """A real Django field validator, wired onto `EventPost.image` — so the Django admin path, which
    assigns the file directly and never reaches `process_post_image`, still gets the size, type and
    decompression-bomb checks. It cannot give the admin path re-encoding, which is why the API
    deliberately does not rely on this and calls `process_post_image` instead."""
    validate_image_upload(
        upload,
        max_bytes=MAX_POST_IMAGE_UPLOAD_BYTES,
        allowed_types=ALLOWED_IMAGE_TYPES,
        max_pixels=MAX_IMAGE_PIXELS,
    )


def process_post_image(upload) -> ContentFile:
    """Validate, then throw the original away and build a fresh WebP of at most
    `MAX_POST_IMAGE_EDGE` on its longest side, with the aspect ratio intact."""
    validate_post_image(upload)

    image = decode_for_reencode(upload)

    # `thumbnail` is the shrink-only, ratio-preserving resize: it fits the image inside the box and
    # does nothing at all when it already fits. That last part matters — the alternative
    # (`ImageOps.contain`, or a plain `resize`) would UPSCALE a small picture to the box, which adds
    # bytes and invents detail that was never in the source.
    image.thumbnail(
        (MAX_POST_IMAGE_EDGE, MAX_POST_IMAGE_EDGE),
        resample=Image.Resampling.LANCZOS,
    )

    return encode_webp(image, quality=POST_IMAGE_QUALITY)
