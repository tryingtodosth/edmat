"""What happens to an uploaded event document between the request and the disk.

House rule 7: **never store the bytes that were uploaded.** Two paths, and the split is the one the
rest of this project already made (`materials/validators.py`'s own docstring argues it at length):

- **An image is re-encoded from its pixels** through the shared `backend/imaging.py` bounds — byte
  cap, sniff, a decoded-pixel budget checked against the HEADER before any pixel is read, then
  decode, EXIF-transpose and a fresh WebP. Nothing of the upload survives, which is why a polyglot
  (a valid PNG whose trailing bytes are also a zip or a script) is not a question this path has to
  answer: it discards every byte that is not pixel data, and the appended payload goes with them.
  The EXIF strip is a privacy fix as much as a security one — a photo of the venue carries the
  venue's GPS.
- **A PDF cannot be re-encoded**, so it gets the three things that can be done to it, all of them
  already written: the 25 MB cap and the libmagic sniff from `materials.validators`, and a ClamAV
  pass that reports `scanned=False` honestly when no daemon is reachable (house rule 10). A
  deployment that runs clamd sets `MATERIAL_SCAN_REQUIRED=True` and the honest skip becomes a hard
  refusal.

Everything else is refused, by name, before either path runs — a `.txt`, a `.docx`, a `.zip`, an
executable called `plan.pdf`. This step accepts PDF and images only (CONFERENCE-BRIEF.md §3.C), and
a refusal that says which of the two it wanted is worth more than a whitelist the person has to
guess at.

Deliberately NOT reached for: `validate_material_submission_file`'s extension table. It keys the
allowed signatures off the uploader's own extension, which is right for a material (whose file is
stored and served under the name it came with) and wrong here, where the extension is discarded and
the stored name is random. What IS reused is its size constant, its sniff behaviour via the same
libmagic call and its scanner — the three pieces that are genuinely the same question.
"""

from __future__ import annotations

from dataclasses import dataclass

import magic
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.utils.translation import gettext_lazy as _

from imaging import (
    ALLOWED_IMAGE_TYPES,
    decode_for_reencode,
    encode_webp,
    is_reencodable_image,
    sniff_content_type,
    validate_image_upload,
)
from materials.validators import MAX_MATERIAL_SUBMISSION_SIZE_BYTES, scan_for_malware

PDF_TYPE = 'application/pdf'
# The same 25 MB the rest of the project uses for an uploaded document — a scanned multi-page fire
# plan is genuinely several MB, and a second number here would be one more thing to lower twice
# after an incident.
MAX_DOCUMENT_BYTES = MAX_MATERIAL_SUBMISSION_SIZE_BYTES
# Images are re-encoded, so the stored size is ours, not the uploader's; the INPUT cap is what
# bounds the decode, and `imaging` wants it separately from the pixel budget.
MAX_IMAGE_BYTES = 12 * 1024 * 1024
# High enough that a photographed page stays readable, low enough that a fifty-page handout
# photographed one page at a time does not become the storage story. Matches the event-post picture
# quality for the same reason: what is uploaded here is usually a slide or a scan, not a portrait.
WEBP_QUALITY = 82


@dataclass(frozen=True)
class ProcessedDocument:
    content: ContentFile
    content_type: str
    byte_size: int
    scanned: bool
    scan_detail: str


def process_document_upload(upload) -> ProcessedDocument:
    """Validate, transform and hand back what should be stored. Raises Django's `ValidationError`,
    which DRF turns into a 400 with the message on the offending field."""
    size = getattr(upload, 'size', None)
    if size is not None and size > MAX_DOCUMENT_BYTES:
        raise ValidationError(
            _('That file is %(size).1f MB. The maximum is %(max).0f MB.')
            % {'size': size / (1024 * 1024), 'max': MAX_DOCUMENT_BYTES / (1024 * 1024)}
        )

    sniffed = sniff_content_type(upload)
    if sniffed not in ALLOWED_IMAGE_TYPES and sniffed != PDF_TYPE:
        raise ValidationError(
            _(
                'An event document has to be a PDF or a PNG/JPEG/WebP image. This file is '
                '%(type)s — if it is a document, export it as a PDF first.'
            )
            % {'type': sniffed}
        )

    if is_reencodable_image(upload):
        return _reencode_image(upload)
    return _accept_pdf(upload)


def _reencode_image(upload) -> ProcessedDocument:
    validate_image_upload(upload, max_bytes=MAX_IMAGE_BYTES)
    content = encode_webp(decode_for_reencode(upload), quality=WEBP_QUALITY)
    return ProcessedDocument(
        content=content,
        content_type='image/webp',
        byte_size=content.size,
        # Nothing was scanned, and saying so is not a gap: the picture stored here was drawn from
        # decoded pixels by this process, so there is no uploaded byte left for a scanner to find.
        scanned=False,
        scan_detail='Re-encoded from its pixels — the uploaded bytes were discarded.',
    )


def _accept_pdf(upload) -> ProcessedDocument:
    # A second, cheap sanity read of the header now that we know which branch we are on: the sniff
    # above answered "what is this", this asserts the file still begins like the thing it claimed
    # to be after any seek the caller may have done.
    upload.seek(0)
    header = upload.read(4096)
    upload.seek(0)
    if magic.from_buffer(header, mime=True) != PDF_TYPE:
        raise ValidationError(_('That file is not a readable PDF.'))

    outcome = scan_for_malware(upload)
    if outcome.scanned and not outcome.clean:
        raise ValidationError(_('That file was rejected by the virus scanner: %(d)s') % {'d': outcome.detail})
    if not outcome.scanned and getattr(settings, 'MATERIAL_SCAN_REQUIRED', False):
        raise ValidationError(
            _('That file could not be virus-scanned, and this deployment requires a scan.')
        )

    upload.seek(0)
    data = upload.read()
    upload.seek(0)
    content = ContentFile(data)
    # The name is replaced by `document_upload_path` at save time anyway; setting one here keeps
    # Django's own FileField machinery from having to invent one.
    content.name = 'document.pdf'
    return ProcessedDocument(
        content=content,
        content_type=PDF_TYPE,
        byte_size=len(data),
        scanned=outcome.scanned,
        scan_detail=outcome.detail[:300],
    )
