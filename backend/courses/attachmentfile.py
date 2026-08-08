"""What happens to the bytes of a course attachment: an image is re-encoded, everything else is not.

`Attachment.file` already had real validation — `materials.validators.validate_material_submission_file`
gives it a byte cap, an extension whitelist, a content sniff and a zip-container check, so unlike
`Profile.avatar` before CLAUDE.md 17Q this was never an unguarded write path. What it had no answer to
was *metadata*: the file was stored as the uploader sent it, verbatim, so an image kept its EXIF block.

**That is a privacy leak with a specific victim.** Somebody photographs a whiteboard, attaches it to a
course, and the JPEG their phone produced carries the GPS coordinates of the room they were standing
in, the capture timestamp, and often the device's own serial-numbered camera model — published to
everybody who can read that course. They did not agree to that, and nothing on screen said it was
happening. The same argument `events/postimage.py` makes for an event post picture applies here with
one turn of the screw: an event at least publishes its location deliberately, in words the host chose,
whereas a course attachment never claimed to say where anybody was.

**Why re-encoding rather than stripping the EXIF block.** Deleting the tags would fix this one leak and
leave the wider class alone. Decoding the pixels and writing them out fresh discards *everything* that
is not pixel data — appended payloads, embedded colour profiles, format-parser trickery — so the
metadata strip is a property of not opting back in rather than a step somebody has to remember. This is
the same reasoning `accounts/avatar.py` states at length; read that module first.

**Aspect ratio is preserved, as in `events/postimage.py` and unlike an avatar.** An attachment is a
scan of an exam paper, a slide, a photograph of a board: content that runs to the edges, which is
exactly what a centre-crop takes the ends off.

**Non-images pass through untouched, and that branch is the point rather than an oversight.** An
attachment is just as often a PDF, a `.docx` or a `.tex` file, and none of those is something to
re-encode: there are no pixels to decode, the bytes *are* the document, and rewriting them would
corrupt the file while claiming to clean it. A PDF can carry its own metadata (an author name, a
producing application), and stripping that is a genuinely different job — a PDF rewriter, not an image
pipeline — which is named in the task's own "left open" rather than half-done here.
"""

from __future__ import annotations

from django.core.files.base import ContentFile
from PIL import Image

from imaging import (
    ALLOWED_IMAGE_TYPES,
    MAX_IMAGE_PIXELS,
    decode_for_reencode,
    encode_webp,
    is_reencodable_image,
    validate_image_upload,
)
from materials.validators import (
    MAX_MATERIAL_SUBMISSION_SIZE_BYTES,
    validate_material_submission_file,
)

# The longest edge of the STORED image, deliberately more generous than an event post's 1600.
#
# A post picture is a picture in a feed, and its bound is set by the column that renders it. An
# attachment is a document somebody opens, reads and prints — the text on it is the entire value of
# the file — so the bound has to be set by legibility instead. A phone photo of an A4 page at 2400 on
# the long edge is roughly 200 DPI, which stays readable on screen at full zoom and prints acceptably;
# at 1600 the small print in a scanned exam paper starts to go. The detail page's own 780px column is
# not the constraint here, because nobody reads an exam paper at 780px.
MAX_ATTACHMENT_IMAGE_EDGE = 2400

# 88 rather than the 82 the avatar and post pipelines use. Not taste: WebP's lossy mode at 82 puts
# visible ringing around the high-contrast glyph edges that dominate a photographed page of text,
# which is the one artefact that matters on the content this field actually receives. 88 costs some
# bytes for a materially cleaner scan. Lossless was rejected — on a photograph of a whiteboard it is
# several times larger than the original JPEG, so it would trade a real storage cost against the
# quota for an improvement nobody reading the page can see.
ATTACHMENT_IMAGE_QUALITY = 88

# One byte cap for an attachment regardless of what kind of file it is, taken from the material
# validator rather than restated. An image-specific number here would be a second limit to keep in
# step with the one the same field already enforces on a PDF, and the honest answer to "how big may an
# attachment be?" is one number. Storage is rationed by `Course.upload_quota_bytes`, not by this.
MAX_ATTACHMENT_UPLOAD_BYTES = MAX_MATERIAL_SUBMISSION_SIZE_BYTES


def validate_attachment_file(upload) -> None:
    """The field validator on `Attachment.file`, replacing the bare material one.

    Two branches, because the two kinds of file have genuinely different failure modes:

    * An image gets the image checks — and the one that matters is the **decoded-pixel budget**, which
      the material validator cannot apply because it never decodes anything. A valid ~140 KB PNG can
      declare 12000x12000 and decode to gigabytes of resident memory: a real decompression-bomb DoS
      that sails past both a byte cap and a content sniff. So closing the EXIF leak also closes that,
      on this path and on the admin path both, which is why it lives on the field rather than only in
      the serializer.
    * Everything else gets exactly the material validator, unchanged — extension whitelist, sniff, and
      the `.docx`/`.odt` container check.

    Like every field validator in this project it cannot deliver the re-encode (a validator returns
    nothing), which is why the API path calls `process_attachment_file` and does not rely on this.
    Kept as a named module-level function because `courses/migrations/0016` refers to it by path.
    """
    if is_reencodable_image(upload):
        validate_image_upload(
            upload,
            max_bytes=MAX_ATTACHMENT_UPLOAD_BYTES,
            allowed_types=ALLOWED_IMAGE_TYPES,
            max_pixels=MAX_IMAGE_PIXELS,
        )
        return
    validate_material_submission_file(upload)


def process_attachment_file(upload):
    """Validate, then re-encode an image and leave anything else exactly as it arrived.

    Returns a fresh `ContentFile` for an image and the original upload object for everything else, so
    a caller assigns the result to `Attachment.file` either way without asking which branch it took.
    """
    validate_attachment_file(upload)

    if not is_reencodable_image(upload):
        # The bytes ARE the document — see the module docstring. Handed straight back so the caller
        # stores what the uploader sent, which for a PDF is the only correct thing to store.
        return upload

    image = decode_for_reencode(upload)

    # Shrink-only and ratio-preserving. `thumbnail` does nothing at all when the image already fits,
    # which is the behaviour wanted: `ImageOps.contain` or a plain `resize` would UPSCALE a small
    # scan to the bound, adding bytes and inventing detail the source never had.
    image.thumbnail(
        (MAX_ATTACHMENT_IMAGE_EDGE, MAX_ATTACHMENT_IMAGE_EDGE),
        resample=Image.Resampling.LANCZOS,
    )

    return encode_webp(image, quality=ATTACHMENT_IMAGE_QUALITY)
