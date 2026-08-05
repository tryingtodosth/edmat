"""Real validation and normalization for a user-uploaded profile picture — the third of the four
gaps a whole-project security scan found (CLAUDE.md Section 17B's own "no avatar upload UI anywhere"
note is what kept `Profile.avatar` unreachable, and therefore harmless, until now).

`Profile.avatar` has existed since Phase 2 as a bare `ImageField(upload_to='avatars/')` with **none**
of the three layers `materials/validators.py` already applies to a Material upload. Building the
upload UI is exactly the moment that stops being a theoretical gap, so the checks land in the same
change as the feature, not after it.

**The core decision: never store the bytes the uploader sent.** Every accepted avatar is decoded and
**re-encoded** from scratch into one normalized format at one fixed size. This is a strictly stronger
guarantee than the content-type sniffing `materials/validators.py` does, and for a reason worth
stating plainly: sniffing answers "does this look like a real image?", which a **polyglot** file (a
valid image whose trailing bytes are also a valid archive/script, a real and well-documented attack
class) answers "yes" to just as honestly as a genuine photo does. Re-encoding doesn't ask the
question at all — it throws away every byte that isn't pixel data, so appended payloads, embedded
metadata, and format-parser trickery cannot survive into what gets served back to other users.
A Material upload can't do this (a PDF has to stay the PDF the submitter uploaded); an avatar can,
because nothing about the original file is worth keeping once the pixels are extracted.

Four real checks, in the order they have to happen:

1. **Byte-size cap** (`MAX_AVATAR_UPLOAD_BYTES`) — cheap, first, before anything decodes.
2. **Content-type sniffing** via the same `python-magic`/libmagic binding `materials/validators.py`
   already uses — kept even though step 4 makes it non-load-bearing for safety, because it produces a
   far better error message ("that's not a PNG/JPEG/WebP") than Pillow's own generic decode failure.
3. **A decoded-pixel cap** (`MAX_AVATAR_PIXELS`), checked against the header's own declared
   dimensions BEFORE any pixel data is read. This is the check that's easy to miss and the reason a
   byte-size limit alone is not enough: image compression ratios are unbounded, so a perfectly valid
   ~5 MB PNG can declare 40000x40000 and decode to **gigabytes** of resident memory — a real
   decompression-bomb DoS against the server, from a file that passes both checks above. Pillow has
   its own `MAX_IMAGE_PIXELS` warning threshold, but it defaults to ~89 MP (far past the point where
   this app would already be in trouble) and raises only a *warning* below 2x that, so this module
   sets its own explicit, much lower bound rather than relying on that default.
4. **Full re-encode** — decode, honor EXIF orientation, center-crop to a square, resize to
   `AVATAR_SIZE`, and write out a fresh WebP.

**EXIF is stripped, and that is a privacy fix, not just a security one.** A photo straight off a
phone routinely carries GPS coordinates, a capture timestamp, and the device's own serial-numbered
camera model in its EXIF block — publishing that alongside a public profile picture would leak where
the account holder physically was, to anyone who downloads the image. Pillow's own `save()` only
writes EXIF when explicitly handed it, so re-encoding drops the whole block by construction. The one
piece of EXIF that must be *honored* before being discarded is `Orientation`: a phone photo is very
often stored sideways with an orientation tag telling the viewer to rotate it, so stripping the tag
without first applying it would silently turn every such upload 90 degrees. `ImageOps.exif_transpose`
bakes the rotation into the pixels first — the tag then has nothing left to say.

**Alpha is deliberately preserved, not flattened onto white.** This app ships a real light/dark theme
(CLAUDE.md Section 13's own token-bridge), so compositing a transparent logo-style avatar onto a
white square would look correct in one theme and like a bright rectangle in the other. WebP supports
alpha natively, so the honest answer is to keep it and let the page background show through in
whichever theme the reader is actually using.
"""

from __future__ import annotations

import uuid

import magic
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.utils.translation import gettext_lazy as _
from PIL import Image, ImageOps, UnidentifiedImageError

# 5 MB. Generous on purpose — the stored result is ~30-60 KB regardless (see AVATAR_SIZE below), so
# this limit exists only to bound how much a single request can make the server read and decode, not
# to ration storage. A modern phone photo is routinely 3-8 MB, and rejecting one for being "too big"
# when the app is about to downscale it to 512px anyway would be a self-inflicted UX problem.
MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024

# 40 megapixels of DECODED image — roughly a 6300x6300 square, comfortably above any real camera an
# uploader might use (a 100 MP phone sensor is ~11000x9000, but its JPEG would have to survive the
# byte cap above first) and far below the point where decoding costs enough memory to matter. Pillow
# allocates roughly 4 bytes per pixel for RGBA, so this bound caps a single decode at ~160 MB.
MAX_AVATAR_PIXELS = 40_000_000

# 512x512, not the 256 an avatar's largest on-screen appearance would naively suggest. Displays with
# a 2x/3x device pixel ratio are the norm rather than the exception, so a 128 CSS-pixel avatar is
# genuinely asked to supply 256 or 384 real pixels — storing 256 would look visibly soft on most
# phones. 512 covers 3x comfortably, and the cost of the headroom is nil: a 512x512 WebP at the
# quality below lands around 30-60 KB, so this is not a storage tradeoff worth optimizing.
AVATAR_SIZE = 512

# WebP over PNG/JPEG: universally supported by every browser this app targets, encodes both
# photographic and flat/graphic avatars well (JPEG is poor at the latter and cannot carry alpha at
# all), and produces a fraction of PNG's size for photographic content. 82 is the usual
# visually-lossless-enough point for images this small.
AVATAR_FORMAT = 'WEBP'
AVATAR_EXTENSION = '.webp'
AVATAR_QUALITY = 82

# The sniffed types accepted as INPUT — deliberately narrower than everything Pillow can decode.
# Pillow supports a long tail of formats (TIFF, BMP, ICO, and more exotic ones) whose decoders see
# far less security scrutiny than these three, and nothing about a profile picture needs them.
ALLOWED_AVATAR_TYPES = {'image/png', 'image/jpeg', 'image/webp'}

# libmagic only needs the file's leading bytes to identify a format; reading the whole upload into
# memory to sniff it would defeat the point of having a size cap at all.
_SNIFF_BYTES = 2048


def _sniff_content_type(upload) -> str:
    upload.seek(0)
    head = upload.read(_SNIFF_BYTES)
    upload.seek(0)
    return magic.from_buffer(head, mime=True)


def _open_within_pixel_budget(upload) -> Image.Image:
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
    if width * height > MAX_AVATAR_PIXELS:
        raise ValidationError(
            _('That image has too many pixels (%(w)dx%(h)d). Please use a smaller one.')
            % {'w': width, 'h': height}
        )
    return image


def validate_avatar_file(upload) -> None:
    """A real Django field validator, wired onto `Profile.avatar` itself — so an upload made through
    the Django admin (which never touches `process_avatar` below, since it assigns the file directly)
    still gets the size/type/bomb checks. It cannot give the admin path re-encoding, which is why the
    API path deliberately does not rely on this and calls `process_avatar` instead."""
    size = getattr(upload, 'size', None)
    if size is not None and size > MAX_AVATAR_UPLOAD_BYTES:
        raise ValidationError(
            _('That image is %(size).1f MB. The maximum is %(max).0f MB.')
            % {'size': size / (1024 * 1024), 'max': MAX_AVATAR_UPLOAD_BYTES / (1024 * 1024)}
        )

    sniffed = _sniff_content_type(upload)
    if sniffed not in ALLOWED_AVATAR_TYPES:
        raise ValidationError(
            _('That file is not a PNG, JPEG, or WebP image (detected: %(type)s).')
            % {'type': sniffed}
        )

    image = _open_within_pixel_budget(upload)
    # `verify()` is a header/structure integrity check that reads no pixel data. It leaves the
    # instance unusable afterward by design, which is fine — nothing else needs this one.
    try:
        image.verify()
    except Exception as exc:  # Pillow raises a wide, undocumented range here, hence the broad catch
        raise ValidationError(_('That image appears to be corrupt.')) from exc
    finally:
        upload.seek(0)


def process_avatar(upload) -> ContentFile:
    """Validate, then throw the original away and build a fresh one. Returns a `ContentFile` whose
    name is a random UUID plus the normalized extension — the uploader's own filename is discarded
    entirely, exactly as `material_submission_upload_path` already does for a Material upload and for
    the same reasons (a filename is untrusted input too: path separators, a double extension like
    `avatar.webp.html`, or a collision with someone else's upload)."""
    validate_avatar_file(upload)

    image = _open_within_pixel_budget(upload)

    # Bake the EXIF rotation into the pixels before the tag is discarded with the rest of the
    # metadata — see this module's own docstring for why skipping this silently rotates phone photos.
    image = ImageOps.exif_transpose(image)

    # Keep transparency where the source genuinely has it; everything else becomes plain RGB. `P`
    # (palette) images can carry alpha via a `transparency` key rather than an alpha channel, so
    # they're routed to RGBA rather than RGB to avoid dropping it.
    if image.mode in ('RGBA', 'LA', 'P'):
        image = image.convert('RGBA')
    else:
        image = image.convert('RGB')

    # A center crop to a square, then one resize. The client-side cropper (frontend) normally means
    # the upload already arrives square, so this is usually a no-op — but it must exist regardless,
    # because the client's crop is a UX affordance, not a constraint the server can rely on: anything
    # can POST to this endpoint with any aspect ratio.
    image = ImageOps.fit(
        image,
        (AVATAR_SIZE, AVATAR_SIZE),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )

    buffer = ContentFile(b'')
    # No `exif=`/`icc_profile=` argument is passed, so neither is written — the metadata strip is a
    # property of not opting in, not a separate step that could be forgotten.
    image.save(buffer, format=AVATAR_FORMAT, quality=AVATAR_QUALITY, method=6)
    buffer.seek(0)
    buffer.name = f'{uuid.uuid4().hex}{AVATAR_EXTENSION}'
    return buffer
