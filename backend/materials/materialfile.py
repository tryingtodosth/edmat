"""What happens to the bytes of a submitted material: an image is re-encoded, a document is not.

**The promise this changes, and why it gives.** `validators.py` used to say, as an aside contrasting
itself with the avatar pipeline, that "a Material's bytes must be preserved as submitted, so the only
options are sniffing and scanning". That was written about documents and quietly generalised to
images, and it is worth being precise about what the preservation was ever protecting:

* For a **document** — a PDF of an exam paper, a `.docx`, a `.tex` — the bytes ARE the thing. There
  is nothing to decode and re-encode, and rewriting them would corrupt the file while claiming to
  clean it. That half of the promise is kept exactly, and this module returns such an upload
  untouched.
* For an **image**, byte-fidelity was protecting nothing anybody relies on. A material's provenance
  is carried by `Material.author` and `Material.source_url` — real, declared fields added for exactly
  that purpose — not by whether a JPEG's bytes are the ones a phone wrote. Nobody verifies where a
  scan came from by reading its EXIF.

Meanwhile the cost of keeping it was concrete and fell on the uploader: a phone photo of a whiteboard
carries the GPS coordinates of the room it was taken in, and `MaterialViewSet` is a **public** read
endpoint, so a material is published to the whole site rather than to one course's roster. That is
strictly wider exposure than the course attachment this pipeline mirrors, for the same bytes.

So the two halves are separated rather than the promise being kept or broken wholesale: documents
keep their bytes, images keep their pixels. `validators.py`'s own aside has been corrected to say so
rather than left contradicting this file.

**Why re-encoding rather than deleting the EXIF block** is the argument `accounts/avatar.py` makes at
length and `courses/attachmentfile.py` repeats: decoding the pixels and writing them out fresh
discards everything that is not pixel data — appended payloads, embedded colour profiles,
format-parser trickery — so the strip is a property of not opting back in rather than a step somebody
has to remember. Read either of those first; this module is deliberately the thin one.
"""

from __future__ import annotations

from PIL import Image

from imaging import decode_for_reencode, encode_webp, is_reencodable_image

#: The longest edge a stored material image keeps. The same 2400 a course attachment uses, and for
#: the same reason: this is a document somebody prints, so the bound is legibility at roughly 200 DPI
#: on A4 rather than the width of a rendering column. Deliberately its own constant rather than an
#: import from `courses`, which would make materials depend on courses to answer a question about
#: materials — the two agreeing today is not a reason to couple them.
MAX_MATERIAL_IMAGE_EDGE = 2400

#: WebP rings around glyph edges below about 85, and a photographed page is mostly glyph edges.
MATERIAL_IMAGE_QUALITY = 88


def process_material_file(upload):
    """Re-encode an image; return anything else exactly as it arrived.

    Returns a fresh `ContentFile` for an image and the original upload object otherwise, so a caller
    assigns the result either way without asking which branch it took.

    Deliberately does NOT re-run `validate_material_submission_file`: this is called from a
    serializer's `validate_file`, and DRF has already run the field's own validators on the original
    upload by then. The attachment pipeline re-runs its validator because it REPLACED the field's
    one; this adds to it rather than replacing it.
    """
    if not is_reencodable_image(upload):
        # The bytes ARE the document — see the module docstring. Handed straight back, which for a
        # PDF is the only correct thing to store.
        return upload

    image = decode_for_reencode(upload)

    # Shrink-only: `thumbnail` does nothing when the image already fits, where `ImageOps.contain` or
    # a plain `resize` would UPSCALE a small scan to the bound, adding bytes and inventing detail the
    # source never had.
    image.thumbnail(
        (MAX_MATERIAL_IMAGE_EDGE, MAX_MATERIAL_IMAGE_EDGE),
        resample=Image.Resampling.LANCZOS,
    )
    return encode_webp(image, quality=MATERIAL_IMAGE_QUALITY)
