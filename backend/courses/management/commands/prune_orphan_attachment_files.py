"""Delete course-attachment files that no `Attachment` row refers to any more.

**Why these exist at all.** Until the `post_delete` receiver in `courses/models.py`, deleting an
attachment removed the row and left the file. Every one of those files is still sitting in storage
and still servable by anybody who kept the URL — including, in the case this was found through, a
photo whose EXIF carries the coordinates of the room it was taken in. The receiver stops new ones
being made; nothing but this reaches the ones already there, because the row that pointed at them is
gone and there is nothing left to enumerate them from.

**Dry run by default, and that is not politeness.** This deletes bytes with no undo, working from an
inference — "no row mentions this name" — rather than from a record of what was deleted. If it is
ever wrong, it is wrong destructively. So it prints what it would remove and does nothing until
`--delete` says otherwise.

Scoped strictly to `course-attachments/`, which is `Attachment.file`'s own `upload_to` and nothing
else's: materials live under `materials/`, submissions under their own path, avatars under
`avatars/`. A file under any other prefix is not this command's business even if it looks orphaned.
"""

from __future__ import annotations

import os

from django.conf import settings
from django.core.management.base import BaseCommand

from courses.models import Attachment

#: `Attachment.file`'s own `upload_to`. Kept as a literal rather than read off the field, because
#: this command's whole safety argument is that it touches one directory and no other, and a value
#: that follows a field definition around is one that can quietly start meaning something else.
ATTACHMENT_DIR = 'course-attachments'


class Command(BaseCommand):
    help = 'Find (and with --delete, remove) attachment files no database row refers to.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--delete',
            action='store_true',
            help='Actually remove the files. Without this, only report what would go.',
        )

    def handle(self, *args, **options):
        root = os.path.join(settings.MEDIA_ROOT, ATTACHMENT_DIR)
        if not os.path.isdir(root):
            self.stdout.write(f'No {ATTACHMENT_DIR}/ directory — nothing to do.')
            return

        # Every name any row still points at. Compared as the stored relative name rather than as an
        # absolute path, because that is what the database holds and normalising one to the other is
        # a chance to get the comparison subtly wrong.
        referenced = {
            name for name in Attachment.objects.values_list('file', flat=True) if name
        }

        orphans = []
        total_bytes = 0
        for dirpath, _dirnames, filenames in os.walk(root):
            for filename in filenames:
                absolute = os.path.join(dirpath, filename)
                relative = os.path.relpath(absolute, settings.MEDIA_ROOT)
                if relative in referenced:
                    continue
                try:
                    size = os.path.getsize(absolute)
                except OSError:
                    size = 0
                orphans.append((relative, absolute, size))
                total_bytes += size

        if not orphans:
            self.stdout.write(
                self.style.SUCCESS(f'{len(referenced)} file(s) referenced, none orphaned.')
            )
            return

        for relative, _absolute, size in sorted(orphans):
            self.stdout.write(f'  {relative}  ({size} bytes)')

        summary = f'{len(orphans)} orphaned file(s), {total_bytes} bytes'
        if not options['delete']:
            self.stdout.write(self.style.WARNING(f'{summary}. Nothing removed — pass --delete.'))
            return

        removed = 0
        for _relative, absolute, _size in orphans:
            try:
                os.remove(absolute)
                removed += 1
            except OSError as exc:
                self.stdout.write(self.style.ERROR(f'  could not remove {absolute}: {exc}'))
        self.stdout.write(self.style.SUCCESS(f'{summary}; {removed} removed.'))
