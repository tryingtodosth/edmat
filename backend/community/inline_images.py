"""A picture that sits IN a sentence rather than under it.

The insert strip's "Picture" used to hand its file to the comment form, which uploaded it as a
`CommentAttachment` once the comment existed — a thumbnail in a row beneath the text. That is the
right shape for a document and the wrong one for a picture somebody is writing *about*: "the
apparatus looks like this <picture>, and the tap on the left is what leaks". So a picture now goes
where a chemistry drawing already went (chem/models.py, which argues the same case): it is
uploaded on its own, immediately, and the editor puts the returned `<img>` into the body. The
attachment row is now for PDFs alone.

What is stored is never what was uploaded (house rule 7): the bytes go through exactly the
pipeline `attachments.py` already uses for a comment picture — the header-checked decode budget,
a decode, a bound on the longest edge, and a re-encode to WebP that discards EXIF and anything
else that was not pixel data. There is no PDF branch here on purpose; a PDF cannot be re-encoded,
and a PDF is not something you put in the middle of a sentence.

The stored width and height are the re-encoded picture's, and they are what `embed_html` writes
into the tag, so a reader's layout does not jump while the picture loads.
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

# The same 5 MB a comment attachment gets: the bound is on what may be *sent*, and what is kept is
# the re-encode, which is very much smaller.
MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024
# A picture inside a paragraph, on the widest reading column this site has. The same bound the
# attachment pipeline and a chemistry raster use.
MAX_INLINE_IMAGE_EDGE = 1600
INLINE_IMAGE_QUALITY = 82
# The alt text: read aloud instead of the picture, and shown if the picture never arrives.
MAX_ALT_LENGTH = 300


def inline_image_upload_path(instance, filename: str) -> str:
    """A random name, always. The uploader's own filename is untrusted input and is kept only as
    `original_name`, for showing back to the person who picked it."""
    return f'inline-images/{uuid.uuid4().hex}.webp'


def process_inline_image(upload):
    """Returns `(content, width, height, original_name, size)` or raises ValidationError.

    Deliberately narrower than `process_attachment`: a picture, or a refusal naming what was sent
    instead. Nothing here trusts the browser's declared type — `sniff_content_type` reads the
    bytes, and the decode budget is checked against the header before a single pixel is read.
    """
    size = getattr(upload, 'size', 0) or 0
    if size > MAX_INLINE_IMAGE_BYTES:
        raise ValidationError({'file': ['Up to 5 MB.']})
    sniffed = sniff_content_type(upload)
    if sniffed not in ALLOWED_IMAGE_TYPES:
        raise ValidationError({'file': [f'Only a picture (PNG, JPEG, WebP); this is {sniffed}.']})
    name = (getattr(upload, 'name', '') or 'picture')[:120]
    validate_image_upload(
        upload,
        max_bytes=MAX_INLINE_IMAGE_BYTES,
        allowed_types=ALLOWED_IMAGE_TYPES,
        max_pixels=MAX_IMAGE_PIXELS,
    )
    image = decode_for_reencode(upload)
    image.thumbnail((MAX_INLINE_IMAGE_EDGE, MAX_INLINE_IMAGE_EDGE), resample=Image.Resampling.LANCZOS)
    content = encode_webp(image, quality=INLINE_IMAGE_QUALITY)
    return content, image.width, image.height, name, content.size
