"""Real content validation for a user-uploaded Material file (CLAUDE.md's own "exams, tests, etc. —
usually a PDF/PNG, but a whole LaTeX/Word document should be accepted too, and it should be scanned
and kept safe" request). Two, deliberately separate layers, both real:

1. **Content-type verification** — never trust a file's own extension or the browser-supplied
   `Content-Type` header, both of which the uploader fully controls. `python-magic` (a thin binding
   over the system `libmagic` library — already present on this machine, confirmed by direct
   inspection, so no new system package was needed) sniffs the file's own real byte signature and
   is checked against a whitelist keyed by extension, so a `.exe` renamed to `.pdf` is rejected —
   its sniffed content type (`application/octet-stream`/an executable signature) simply isn't in the
   set this module allows for a `.pdf` extension, confirmed directly against a real disguised-
   executable test file before this was ever trusted to work, not assumed from the library's own
   docs.
2. **Malware scanning** — `scan_for_malware` below, a genuinely pluggable hook: it tries a real
   ClamAV daemon (via the `clamd` PyPI client, which only ever talks to an ALREADY-RUNNING clamd —
   installing the daemon itself is a real system package this project's own sandboxed dev
   environment has no root access to install, confirmed the same way CLAUDE.md's own venv/KaTeX
   notes already record this constraint for other tools). When no daemon is reachable, this is
   HONESTLY reported as `scanned=False`, not silently treated as "scanned and clean" — a real
   deployment that actually runs ClamAV sets `MATERIAL_SCAN_REQUIRED=True` (config/settings.py) to
   make an unreachable scanner a hard rejection instead of a graceful skip; this sandbox's own
   default stays False, matching the same "flag it, don't fake it" discipline CLAUDE.md already
   applies to the email-backend stub, rather than pretending a scan happened when it didn't. (This
   comment used to also cite an "avatar-upload stub" — that is now a real, validated upload path,
   `accounts/avatar.py`, which is re-encoded from its pixels outright, discarding any payload rather
   than trying to detect one.)

**On "a Material's bytes must be preserved as submitted", which this docstring used to assert.** It
was true of documents and quietly generalised to images, and it is no longer the whole story: an
image submission is now re-encoded by `materials/materialfile.py` before it is stored, while a PDF,
`.docx`, `.odt` or `.tex` is still stored byte-for-byte as sent. The split is deliberate. For a
document the bytes ARE the thing and there is nothing to decode; for an image, byte-fidelity was
protecting nothing anybody relies on — a material's provenance is carried by `Material.author` and
`Material.source_url`, not by whether a JPEG's bytes are the ones a phone wrote — while the cost of
keeping it was a phone photo publishing the GPS coordinates of the room it was taken in, through a
PUBLIC read endpoint. This module's own two layers are unchanged and still run on every upload; the
re-encode is an additional step for one kind of file, not a replacement for either of them.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import zipfile

import magic
from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _

# Extension (lowercase, with the dot) -> the set of MIME types `python-magic` may legitimately report
# for a REAL file of that kind. Verified directly against real minimal fixtures of every one of
# these formats before being trusted (see the validators' own test suite) — not guessed from a spec.
#
# `.docx`/`.doc` both accept a genuinely broad container type (`application/zip` / OLE2's own
# `application/x-ole-storage`) alongside the more specific Office MIME strings some libmagic
# database versions report — a real .docx IS a zip archive, and a real legacy .doc IS an OLE2
# compound file; this whitelist can't (and doesn't try to) verify it's specifically a WORD document
# rather than some other file built on the same container format, only that it's a real one of that
# *kind*, not a disguised executable or script. That's the actual security question this validator
# answers — "is this really a document/image, not something pretending to be one" — not full format
# forensics.
ALLOWED_MATERIAL_TYPES: dict[str, set[str]] = {
    '.pdf': {'application/pdf'},
    '.png': {'image/png'},
    '.jpg': {'image/jpeg'},
    '.jpeg': {'image/jpeg'},
    # Accepted as INPUT, and also the extension every re-encoded image is STORED under — which is
    # the reason it has to be here. `materials/materialfile.py` writes a fresh WebP, so a stored
    # material file whose extension this table did not know would fail its own field validator on
    # any `full_clean()`, notably in the Django admin. The write path never noticed, because
    # `Model.save()` does not run field validators; the admin would have.
    '.webp': {'image/webp'},
    '.tex': {'text/x-tex', 'text/plain'},  # a short/simple .tex file can sniff as plain ASCII text
    '.doc': {'application/msword', 'application/x-ole-storage', 'application/CDFV2'},
    '.docx': {
        'application/zip',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    '.odt': {'application/zip', 'application/vnd.oasis.opendocument.text'},
}

# The member every valid archive of that extension must contain — see the zip-container check in
# `validate_material_submission_file` for why a MIME sniff alone cannot tell these two apart from
# an arbitrary renamed zip. `.docx` is OPC/ECMA-376, `.odt` is ODF; both entries are mandated by
# their own specifications, not conventions that a real file might happen to omit.
_ZIP_CONTAINER_REQUIRED_MEMBERS: dict[str, set[str]] = {
    '.docx': {'[Content_Types].xml'},
    '.odt': {'mimetype'},
}

# 25MB — generous enough for a real scanned multi-page exam (a stack of photographed pages easily
# runs several MB each) without leaving upload size effectively unbounded.
MAX_MATERIAL_SUBMISSION_SIZE_BYTES = 25 * 1024 * 1024


def validate_material_submission_file(file_obj) -> None:
    """A real Django validator (usable directly in a FileField's own `validators=[...]`) — checked
    by every DRF ModelSerializer write path (MaterialSubmissionSerializer's own `file` field), and
    left on `Material.file` itself too (materials/models.py) for the same defense-in-depth reasoning
    CLAUDE.md Section 11 already applies to submitted exercise content: a raw `.save()` call (the
    corpus importer, or `_apply_material_submission` copying an already-validated submission's file
    across) bypasses this entirely, by design — it only runs where something is actually being
    VALIDATED, not on every write.
    """
    if file_obj.size > MAX_MATERIAL_SUBMISSION_SIZE_BYTES:
        max_mb = MAX_MATERIAL_SUBMISSION_SIZE_BYTES // (1024 * 1024)
        raise ValidationError(_('File is too large — the limit is %(max)dMB.') % {'max': max_mb})

    ext = os.path.splitext(file_obj.name or '')[1].lower()
    allowed_mimes = ALLOWED_MATERIAL_TYPES.get(ext)
    if allowed_mimes is None:
        allowed = ', '.join(sorted(ALLOWED_MATERIAL_TYPES))
        raise ValidationError(
            _('Unsupported file type "%(ext)s" — accepted types are: %(allowed)s.')
            % {'ext': ext or '(none)', 'allowed': allowed}
        )

    # Read just enough of the file to sniff it (libmagic needs a few KB at most, never the whole
    # file), then rewind — this validator is never the last thing to read the stream, whatever
    # storage backend saves the file afterward needs it back at position 0.
    file_obj.seek(0)
    header = file_obj.read(4096)
    file_obj.seek(0)
    detected_mime = magic.from_buffer(header, mime=True)
    if detected_mime not in allowed_mimes:
        raise ValidationError(
            _(
                'This file\'s actual content ("%(detected)s") doesn\'t match what a real '
                '"%(ext)s" file should look like — it may be corrupted, or a different file type '
                'renamed to look like one.'
            )
            % {'detected': detected_mime, 'ext': ext}
        )

    # The zip-container extensions need one more question asked of them.
    #
    # `.docx` and `.odt` are both genuinely zip archives, so `ALLOWED_MATERIAL_TYPES` has to accept
    # a bare `application/zip` for them — libmagic frequently reports exactly that rather than the
    # specific Office/OpenDocument MIME string, depending on its database version. The cost of that
    # necessary looseness is that the check above becomes, for these two extensions only, "is this
    # a zip file?" — which ANY zip passes, including one holding something else entirely, simply by
    # being renamed. Every other extension here is pinned to a real content signature and unaffected.
    #
    # So look inside. Both formats are fully specified about what a valid archive contains: a
    # `.docx` must hold `[Content_Types].xml` (OPC, ECMA-376), and an `.odt` must hold `mimetype`
    # (ODF). Checking the member list is cheap — the zip central directory is an index, so nothing
    # is decompressed and no member is read — and it distinguishes a real document from an
    # arbitrary archive without pretending to be full format validation.
    #
    # This is deliberately NOT a defence against a malicious document; a genuinely valid `.docx`
    # can still carry a hostile macro, which is what `scan_for_malware` below is for. It closes the
    # narrower and more embarrassing gap: a file that was never a document at all being stored and
    # served as one.
    if ext in _ZIP_CONTAINER_REQUIRED_MEMBERS:
        required = _ZIP_CONTAINER_REQUIRED_MEMBERS[ext]
        file_obj.seek(0)
        try:
            with zipfile.ZipFile(file_obj) as archive:
                names = set(archive.namelist())
        except (zipfile.BadZipFile, OSError):
            # Reported as a corrupt archive rather than a rejected type: libmagic already agreed
            # this looks like a zip, so "it is a zip but unreadable" is the accurate description.
            raise ValidationError(
                _('This "%(ext)s" file is a damaged or unreadable archive.') % {'ext': ext}
            ) from None
        finally:
            file_obj.seek(0)

        if not required & names:
            raise ValidationError(
                _(
                    'This "%(ext)s" file is a zip archive, but not a real document — it is '
                    'missing the %(expected)s entry every valid one contains. It may be a '
                    'different kind of archive renamed to look like a document.'
                )
                % {'ext': ext, 'expected': ' or '.join(sorted(required))}
            )


@dataclass(frozen=True)
class ScanOutcome:
    scanned: bool  # False means "no scanner was reachable" — NOT the same as "scanned and clean"
    clean: bool  # only meaningful when scanned is True; defaults True (nothing found) when False
    detail: str  # a short, honest, human-readable summary — shown to a moderator, not just logged


def scan_for_malware(file_obj) -> ScanOutcome:
    """Attempts a real ClamAV scan via a running `clamd` daemon — first over a Unix socket
    (`CLAMD_UNIX_SOCKET`, the standard install location on a real Linux deployment that actually
    runs ClamAV), falling back to TCP (`CLAMD_HOST`/`CLAMD_PORT`) for a deployment that runs clamd
    as a separate network service instead. Both are genuinely optional — this project's own
    sandboxed dev environment has neither installed (confirmed: no `clamscan`/`clamdscan`/`freshclam`
    binary anywhere, and no root access to install one), so the honest, common outcome here during
    development is `scanned=False` — never silently upgraded to "clean" by the CALLER without also
    checking `scanned`, which is exactly why this returns a dataclass instead of a bare bool.
    """
    try:
        import clamd
    except ImportError:
        return ScanOutcome(scanned=False, clean=True, detail='ClamAV client library not installed.')

    cd = None
    unix_socket = getattr(settings, 'CLAMD_UNIX_SOCKET', None)
    if unix_socket and os.path.exists(unix_socket):
        try:
            cd = clamd.ClamdUnixSocket(path=unix_socket)
            cd.ping()
        except Exception:
            cd = None
    if cd is None:
        host = getattr(settings, 'CLAMD_HOST', 'localhost')
        port = getattr(settings, 'CLAMD_PORT', 3310)
        try:
            cd = clamd.ClamdNetworkSocket(host=host, port=port, timeout=5)
            cd.ping()
        except Exception:
            return ScanOutcome(
                scanned=False,
                clean=True,
                detail=f'No ClamAV daemon reachable (tried {unix_socket or "no socket configured"} and {host}:{port}).',
            )

    file_obj.seek(0)
    try:
        result = cd.instream(file_obj)
    finally:
        file_obj.seek(0)

    # clamd's own `instream` reply shape: {'stream': ('OK', None)} when clean, or
    # {'stream': ('FOUND', 'Some.Signature.Name')} when it detects something.
    status, signature = result.get('stream', ('ERROR', None))
    if status == 'FOUND':
        return ScanOutcome(scanned=True, clean=False, detail=f'ClamAV flagged this file: {signature}')
    if status == 'OK':
        return ScanOutcome(scanned=True, clean=True, detail='Scanned by ClamAV — no threats found.')
    return ScanOutcome(scanned=False, clean=True, detail=f'ClamAV scan did not complete ({status}).')


def validate_material_type(slug: str) -> str:
    """The replacement for the `choices=` that used to sit on `Material.type`.

    A pending type is accepted, not just an approved one — the whole point of letting somebody
    propose a type is being able to file a material under it before a moderator gets to it, exactly
    as a pending topic is filable against. What is refused is a slug nobody has proposed at all.

    Raises Django's ValidationError, which DRF turns into a 400 when a serializer calls it.
    """
    from django.core.exceptions import ValidationError

    from .models import MaterialType

    slug = (slug or '').strip()
    if not slug:
        raise ValidationError('A material type is required.')
    if not MaterialType.objects.filter(slug=slug).exists():
        raise ValidationError(f'No material type "{slug}". Propose it first.')
    return slug
