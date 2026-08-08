"""Re-encode course attachment images that were stored before the upload pipeline existed.

**The decision this command embodies: yes, existing files get stripped too.** Closing the leak only for
future uploads would protect people who have not uploaded anything yet while leaving the actual
exposure standing — every image already stored is still served, with its GPS coordinates in it, to
everybody who can read that course, every time somebody opens it. The provenance of those files being
unknown argues *for* this rather than against it: not knowing means we cannot rule out that one of them
is a phone photo taken in somebody's home.

**But not automatically, and not in a data migration**, for three reasons:

* It rewrites bytes on disk, which no migration can roll back. One that failed halfway would leave both
  an inconsistent database and a directory of half-rewritten files.
* Re-encoding is lossy and changes the stored filename, so the URL changes too. That is safe here —
  `AttachmentSerializer.get_file_url` derives the link on read and nothing persists it — but doing it
  to somebody else's file is an operator's decision, taken after seeing what it would touch. Hence
  `--dry-run`, which is worth running first rather than a formality.
* A migration runs once. This wants to be re-runnable, because the honest reason to reach for it a
  second time is a bound in `attachmentfile.py` having been lowered after an incident.

**In this checkout it is a no-op: the database has zero attachments.** That is not an argument against
having it — it is the argument for the dry run. The person who has rows is on another deployment, and
they need to see the list before anything is rewritten.

**Idempotency is by property, not by marker.** A row is skipped when its file is already a WebP with an
empty EXIF block and within the edge bound — which is exactly what this command produces, so a second
run does nothing and no file is ever re-encoded lossily on top of a previous re-encode. No schema change
and no flag column to keep honest; the same spirit as `enforce_log_retention`'s `ip_truncated` guard,
without needing the column.

Non-images are skipped rather than processed. A PDF's bytes are the document — see
`courses/attachmentfile.py` — and this command will not rewrite one.
"""

from __future__ import annotations

import io

from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from PIL import Image, UnidentifiedImageError

from courses.attachmentfile import (
    MAX_ATTACHMENT_IMAGE_EDGE,
    is_reencodable_image,
    process_attachment_file,
)
from courses.models import Attachment
from imaging import WEBP_FORMAT


class Command(BaseCommand):
    help = (
        'Re-encode course attachment images so they carry no EXIF (notably GPS). '
        'Idempotent; run with --dry-run first.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what would change without rewriting anything. Worth doing first.',
        )
        parser.add_argument(
            '--course',
            type=int,
            default=None,
            help='Limit to one course id, for trying this on a small set before the whole table.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        prefix = '[dry run] ' if dry_run else ''

        # No `select_related`: nothing here reads the course, and the work per row is a decode and an
        # encode, so a join would buy nothing measurable and mislead the next reader into thinking
        # something needed it.
        rows = Attachment.objects.order_by('pk')
        if options['course'] is not None:
            rows = rows.filter(course_id=options['course'])

        stripped = 0
        skipped_not_image = 0
        skipped_already_clean = 0
        failed = 0

        for attachment in rows.iterator(chunk_size=100):
            try:
                raw = self._read(attachment)
            except OSError as exc:
                # `Attachment.size_bytes` already treats a file missing from storage as a fact of life
                # rather than an error, so a page does not fail to render because of one. Same here:
                # report it and carry on, because one lost file must not stop the rest being fixed.
                failed += 1
                self.stderr.write(f'  ! #{attachment.pk}: cannot read its file ({exc})')
                continue

            probe = ContentFile(raw, name=attachment.file.name)
            if not is_reencodable_image(probe):
                skipped_not_image += 1
                continue

            if self._already_clean(raw):
                skipped_already_clean += 1
                continue

            if dry_run:
                stripped += 1
                self.stdout.write(f'  {prefix}#{attachment.pk} {attachment.file.name}')
                continue

            try:
                self._rewrite(attachment, probe)
            except (ValidationError, UnidentifiedImageError, OSError) as exc:
                # Most likely a file stored before the decoded-pixel budget existed, i.e. one big
                # enough that re-encoding it is the very cost the budget refuses to pay. Named
                # distinctly because it is a real finding an operator has to deal with by hand, not a
                # row to quietly leave behind.
                failed += 1
                self.stderr.write(f'  ! #{attachment.pk}: left as it was ({exc})')
                continue

            stripped += 1
            self.stdout.write(f'  #{attachment.pk} {attachment.file.name}')

        self.stdout.write(
            self.style.SUCCESS(
                f'{prefix}{stripped} image(s) re-encoded, {skipped_already_clean} already clean, '
                f'{skipped_not_image} not images, {failed} left alone.'
            )
        )

    @staticmethod
    def _read(attachment) -> bytes:
        """Read once into memory rather than passing a live handle around.

        Each file is bounded by the same 25 MB cap the upload path enforces and they are processed one
        at a time, so this costs nothing worth optimising — and it removes every question about a
        `FieldFile`'s handle lifetime across the sniff, the probe and the re-encode, all three of which
        want the stream back at position 0.
        """
        with attachment.file.open('rb') as handle:
            return handle.read()

    @staticmethod
    def _already_clean(raw: bytes) -> bool:
        """The idempotency test: is this already what this command produces?

        Deliberately checks the properties rather than trusting the `.webp` extension — a file could be
        named anything, and the question that matters is whether any metadata is still in there.
        """
        try:
            image = Image.open(io.BytesIO(raw))
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            # Undecodable here means the re-encode will fail too and report itself properly. Saying
            # "not clean" sends it down that path rather than silently counting it as done.
            return False

        if image.format != WEBP_FORMAT:
            return False
        if dict(image.getexif()):
            return False
        if max(image.size) > MAX_ATTACHMENT_IMAGE_EDGE:
            return False
        return True

    @staticmethod
    def _rewrite(attachment, probe) -> None:
        """Write the re-encoded file, then delete the original.

        Deleting it is the whole point rather than tidying up: leaving the old bytes in storage would
        leave the coordinates readable at the old URL, and this command would have achieved nothing.
        The order matters — the replacement is committed first, so a failure between the two steps
        leaves a live file rather than a row pointing at nothing.
        """
        storage = attachment.file.storage
        old_name = attachment.file.name

        attachment.file = process_attachment_file(probe)
        # `update_fields` rather than a bare save: nothing else about the row is being changed, and a
        # full-row UPDATE would write back every column this process happens to be holding.
        attachment.save(update_fields=['file'])

        if old_name and old_name != attachment.file.name:
            storage.delete(old_name)
