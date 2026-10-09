"""What happens to an uploaded attachment between the request and the disk.

House rule 7: **never store the bytes that were uploaded** — and the rule's own text already carves
out the case it cannot apply to: *"What cannot be re-encoded (a PDF) gets the sniff, the size cap
and a ClamAV scan when a daemon exists."* There are now four paths, and which one a file takes is
decided by what it IS, never by what it was called:

- **An image is re-encoded from its pixels** through the shared `imaging.py` bounds — byte cap,
  sniff, a decoded-pixel budget checked against the HEADER before any pixel is read, then decode,
  EXIF-transpose and a fresh WebP. Nothing of the upload survives, which is why a polyglot (a valid
  PNG whose trailing bytes are also a zip) is not a question this path has to answer: it discards
  every byte that is not pixel data. The EXIF strip is a privacy fix as much as a security one.
- **Text is not stored as a file at all.** A `.md` or a `.txt` is decoded, length-capped and kept in
  a TEXT column, where it renders through the same pipeline as every other body on this site. House
  rule 7 does not apply because there is nothing left to store: the bytes become characters.
- **A PDF cannot be re-encoded**, so it gets the three things that can be done to it, all of them
  already written: the 25 MB cap and the libmagic sniff from `materials.validators`, and a ClamAV
  pass that reports `scanned=False` honestly when no daemon is reachable (house rule 10).
- **An office document takes the PDF's path**, by the owner's explicit decision of 2026-10-08 when
  the rule-7 question was put to them. `.docx`/`.xlsx`/`.pptx`/`.odt` are sniffed, capped, scanned
  and stored under a random name, and are **never rendered** — the endpoint serves them as a
  download. They additionally get the zip-container check `materials/validators.py` already
  carries: all four are genuinely zip archives, so libmagic can only answer "it is a zip", and the
  member list is what tells a real document from an arbitrary archive renamed to look like one.

**The legacy Office formats are refused by name.** `.doc`, `.xls`, `.ppt` are OLE compound files
whose whole point was embedded macros; `materials/validators.py` accepts `.doc` and this module
deliberately does not, because that table is the corpus's and predates the question. A refusal that
says which formats it wanted is worth more than a whitelist somebody has to guess at.

**Deliberately NOT reached for:** `validate_material_submission_file`'s extension table as a whole.
It keys the allowed signatures off the uploader's own extension, which is right for a material
(whose file is stored and served under the name it came with) and wrong here, where the extension is
discarded and the stored name is random. What IS reused is its size constant, its libmagic call, its
zip-container member table and its scanner — the four pieces that are genuinely the same question.
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass

import magic
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.utils.translation import gettext_lazy as _

from imaging import (
    decode_for_reencode,
    encode_webp,
    is_reencodable_image,
    sniff_content_type,
    validate_image_upload,
)
from materials.validators import MAX_MATERIAL_SUBMISSION_SIZE_BYTES, scan_for_malware

PDF_TYPE = 'application/pdf'
TEXT_TYPES = {'text/plain', 'text/markdown', 'text/x-markdown'}

#: media type -> the extension the bytes are STORED under. The stored name is random; this is only
#: its suffix, and it is what `attachment_upload_path` reads.
STORED_EXTENSIONS = {
    PDF_TYPE: '.pdf',
    'image/webp': '.webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.oasis.opendocument.text': '.odt',
}

#: The office formats, and the member every valid archive of that kind must contain. All four are
#: mandated by their own specifications (`[Content_Types].xml` is OPC/ECMA-376, `mimetype` is ODF),
#: not conventions a real file might happen to omit.
OFFICE_REQUIRED_MEMBERS = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {'[Content_Types].xml'},
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {'[Content_Types].xml'},
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': {'[Content_Types].xml'},
    'application/vnd.oasis.opendocument.text': {'mimetype'},
}
OFFICE_TYPES = frozenset(OFFICE_REQUIRED_MEMBERS)

#: What the uploader's extension is allowed to claim for an office document, and the one member
#: check that settles it. libmagic reports `application/zip` for all four as often as not, so the
#: extension is the only hint about WHICH of them this is — and it is a hint, checked against the
#: archive, never trusted on its own.
OFFICE_BY_EXTENSION = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odt': 'application/vnd.oasis.opendocument.text',
}
#: Refused by name, with their own sentence. OLE compound documents; the macro formats.
LEGACY_OFFICE_EXTENSIONS = {'.doc', '.xls', '.ppt', '.docm', '.xlsm', '.pptm'}
TEXT_EXTENSIONS = {'.md', '.markdown', '.txt'}

MAX_ATTACHMENT_BYTES = MAX_MATERIAL_SUBMISSION_SIZE_BYTES
# Images are re-encoded, so the stored size is ours, not the uploader's; the INPUT cap is what
# bounds the decode, and `imaging` wants it separately from the pixel budget.
MAX_IMAGE_BYTES = 12 * 1024 * 1024
#: Text becomes a column, so its cap is the column's — see `models.MAX_TEXT_LENGTH`. The byte cap
#: below it is what stops a 25 MB file being decoded before the length is known.
MAX_TEXT_BYTES = 1 * 1024 * 1024
# High enough that a photographed page stays readable, low enough that a fifty-page handout
# photographed one page at a time does not become the storage story.
WEBP_QUALITY = 82


def extension_for(media_type: str) -> str:
    """The suffix the stored file carries. `.bin` for anything unrecognised rather than nothing at
    all: a file with no extension is one a web server guesses about."""
    return STORED_EXTENSIONS.get(media_type or '', '.bin')


@dataclass(frozen=True)
class ProcessedFile:
    content: ContentFile
    media_type: str
    byte_size: int
    scanned: bool
    scan_detail: str


@dataclass(frozen=True)
class ProcessedText:
    body: str
    media_type: str


def _extension_of(name: str) -> str:
    name = (name or '').lower()
    return name[name.rfind('.'):] if '.' in name else ''


def looks_like_text(upload) -> bool:
    """Whether this upload should take the TEXT path. The extension decides, because that is the
    only thing that distinguishes "a note the person wants rendered" from "a file the person wants
    back byte for byte" — both are `text/plain` to libmagic, and a `.tex` is deliberately not here:
    it belongs to the corpus as a material."""
    return _extension_of(getattr(upload, 'name', '')) in TEXT_EXTENSIONS


def process_text_upload(upload) -> ProcessedText:
    """A `.md` or a `.txt` becomes characters, not bytes."""
    size = getattr(upload, 'size', None)
    if size is not None and size > MAX_TEXT_BYTES:
        raise ValidationError(
            _('That text file is %(size).1f MB. The maximum for text is %(max).0f MB.')
            % {'size': size / (1024 * 1024), 'max': MAX_TEXT_BYTES / (1024 * 1024)}
        )
    upload.seek(0)
    raw = upload.read()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        # Said as what it is. A file that is not UTF-8 is either not text or is text in an encoding
        # nobody can guess correctly, and guessing is how mojibake gets stored for ever.
        raise ValidationError(
            _('That file is not UTF-8 text. Save it as UTF-8 and try again.')
        ) from None
    from .models import MAX_TEXT_LENGTH

    if len(text) > MAX_TEXT_LENGTH:
        raise ValidationError(
            _('That text is %(len)d characters. The maximum is %(max)d.')
            % {'len': len(text), 'max': MAX_TEXT_LENGTH}
        )
    extension = _extension_of(getattr(upload, 'name', ''))
    return ProcessedText(body=text, media_type='text/markdown' if extension != '.txt' else 'text/plain')


def process_file_upload(upload) -> ProcessedFile:
    """Validate, transform and hand back what should be stored. Raises Django's `ValidationError`,
    which DRF turns into a 400 with the message on the offending field."""
    size = getattr(upload, 'size', None)
    if size is not None and size > MAX_ATTACHMENT_BYTES:
        raise ValidationError(
            _('That file is %(size).1f MB. The maximum is %(max).0f MB.')
            % {'size': size / (1024 * 1024), 'max': MAX_ATTACHMENT_BYTES / (1024 * 1024)}
        )

    extension = _extension_of(getattr(upload, 'name', ''))
    if extension in LEGACY_OFFICE_EXTENSIONS:
        raise ValidationError(
            _(
                'The older Office formats (.doc, .xls, .ppt and the macro-enabled ones) are not '
                'accepted. Save it as .docx, .xlsx, .pptx, .odt or PDF.'
            )
        )

    sniffed = sniff_content_type(upload)

    # `is_reencodable_image` takes the UPLOAD, not the sniffed string — it does its own sniff, which
    # is what keeps the one answer to "is this an image we re-encode" in `imaging.py` rather than in
    # each caller. (Passing it `sniffed` is an `AttributeError` on `.seek`, which is how this was
    # found.)
    if is_reencodable_image(upload):
        validate_image_upload(upload, max_bytes=MAX_IMAGE_BYTES)
        image = decode_for_reencode(upload)
        content = encode_webp(image, quality=WEBP_QUALITY)
        return ProcessedFile(
            content=content,
            media_type='image/webp',
            byte_size=content.size,
            # Nothing of the upload survives a re-encode, so there is nothing for a scanner to find.
            # Said as a sentence rather than left as a bare `True`, which would read as "a scanner
            # looked at it" (house rule 10).
            scanned=True,
            scan_detail='re-encoded from pixels; no original bytes stored',
        )

    if sniffed == PDF_TYPE:
        return _store_as_is(upload, PDF_TYPE)

    office_type = _office_type_of(upload, sniffed, extension)
    if office_type:
        return _store_as_is(upload, office_type)

    raise ValidationError(
        _(
            'That file type is not accepted here. Attach a PDF, an image, a .docx/.xlsx/.pptx/.odt, '
            'or a .md/.txt — or paste a link instead.'
        )
    )


def _office_type_of(upload, sniffed: str, extension: str) -> str | None:
    """Which office format this is, or None.

    libmagic answers `application/zip` for all four as often as it answers the specific string, so
    the extension is what says WHICH — and it is a hint, settled against the archive's own member
    list. An arbitrary zip renamed `.docx` fails here; a real one passes. This is deliberately not a
    defence against a hostile macro inside a genuinely valid document, which is what the scan below
    is for. It closes the narrower and more embarrassing gap: a file that was never a document at
    all being stored and served as one.
    """
    wanted = OFFICE_BY_EXTENSION.get(extension)
    if wanted is None:
        return None
    if sniffed not in ('application/zip', wanted) and sniffed not in OFFICE_TYPES:
        raise ValidationError(
            _('This file does not look like a %(ext)s. It may be corrupted, or renamed.')
            % {'ext': extension}
        )
    required = OFFICE_REQUIRED_MEMBERS[wanted]
    upload.seek(0)
    try:
        with zipfile.ZipFile(upload) as archive:
            names = set(archive.namelist())
    except (zipfile.BadZipFile, OSError):
        raise ValidationError(
            _('This "%(ext)s" file is a damaged or unreadable archive.') % {'ext': extension}
        ) from None
    finally:
        upload.seek(0)
    if not required & names:
        raise ValidationError(
            _('This "%(ext)s" file is an archive, but not a document.') % {'ext': extension}
        )
    return wanted


def _store_as_is(upload, media_type: str) -> ProcessedFile:
    """The bytes are kept — under a random name, with the type decided here and not by the uploader,
    and only after the scanner has had its say.

    `scan_for_malware` returns a dataclass and not a bool on purpose: `scanned=False` means no
    scanner was reachable and must never be silently upgraded to "clean" (house rule 10). A
    deployment that runs clamd sets `MATERIAL_SCAN_REQUIRED=True` and the honest skip becomes a hard
    refusal — which is the setting the owner should turn on before office documents are accepted
    from anybody but the people running the thing.
    """
    upload.seek(0)
    outcome = scan_for_malware(upload)
    if outcome.scanned and not outcome.clean:
        raise ValidationError(
            _('That file was rejected by the virus scanner: %(d)s') % {'d': outcome.detail}
        )
    if not outcome.scanned and getattr(settings, 'MATERIAL_SCAN_REQUIRED', False):
        raise ValidationError(
            _('That file could not be virus-scanned, and this deployment requires a scan.')
        )

    upload.seek(0)
    raw = upload.read()
    upload.seek(0)
    content = ContentFile(raw)
    # The name is replaced by `attachment_upload_path` at save time anyway; setting one here keeps
    # Django's own FileField machinery from having to invent one.
    content.name = f'attachment{extension_for(media_type)}'
    return ProcessedFile(
        content=content,
        media_type=media_type,
        byte_size=len(raw),
        scanned=outcome.scanned,
        scan_detail=outcome.detail[:300],
    )
