"""Move `courses.Attachment` and `documents.EventDocument` into the one attachments table.

    manage.py absorb_legacy_attachments              # say what would happen, change nothing
    manage.py absorb_legacy_attachments --apply      # do it

**A command and not a data migration, deliberately.** The owner chose "one table, supersede the
others" on 2026-10-08; this is the half of that decision which touches live rows, and it is the half
somebody should be awake for. A migration runs itself on the next deploy, in whatever order the
deploy happens to reach it, with no dry run and no eyes on the result — which is exactly the wrong
shape for a step whose whole risk is in the data rather than in the schema. Run it, read what it
says, and run it again with `--apply`.

**Idempotent**, by the legacy row's own id: every attachment it writes records where it came from in
`description`'s provenance line, and a second run skips anything already absorbed. So a half-finished
run is safe to repeat.

**The files are not copied.** A `FileField` holds a path, and the new row is given the same one — so
the bytes stay exactly where they are and nothing is duplicated on disk. The consequence, stated
rather than discovered: while both rows exist, deleting EITHER deletes the shared file (both models
have a `post_delete` that removes it). That is why `--apply` does not delete the legacy rows, and
why the follow-up that does should run `--verify` first.

What is carried over, and what is not:

- **Tiers.** `attendees → members`, `organisers → managers`; `public`, `staff` and `venue` keep their
  names. That mapping is why this is a rename and not a reinterpretation.
- **Acknowledgements**, pinned to the same version — the whole point of them.
- **The supersession chain.** Done in a second pass, because a row's replacement may be absorbed
  after it is.
- **Ratings** on a course attachment, into `attachments.AttachmentReview`.
- **NOT** `courses.Attachment`'s own discussion thread. A thread is addressed by
  `(content_type, object_id)` and moving it is a `community` change, not this one; the command says
  how many it is leaving behind.
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand
from django.db import transaction

from attachments.models import Acknowledgement, Attachment, AttachmentReview

#: `documents` tier -> this table's tier. The two the ladder renamed; the rest keep their names.
TIER_MAP = {'attendees': 'members', 'organisers': 'managers'}

#: Written into `description` so a second run can tell what it has already done, and so a person
#: reading a row in the admin can see where it came from.
PROVENANCE = 'absorbed:{source}:{pk}'


def _already(source: str, pk: int) -> bool:
    return Attachment.objects.filter(description__contains=PROVENANCE.format(source=source, pk=pk)).exists()


def _note(existing: str, source: str, pk: int) -> str:
    mark = PROVENANCE.format(source=source, pk=pk)
    return f'{existing}\n\n<!-- {mark} -->' if existing else f'<!-- {mark} -->'


class Command(BaseCommand):
    help = 'Move course attachments and event documents into the one attachments table.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Actually write. Without it, nothing changes.')
        parser.add_argument(
            '--verify',
            action='store_true',
            help='Check that every legacy row has a counterpart, and say which do not. Changes nothing.',
        )

    def handle(self, *args, **options):
        from courses.models import Attachment as CourseAttachment
        from documents.models import EventDocument

        if options['verify']:
            return self._verify(CourseAttachment, EventDocument)

        apply = options['apply']
        written = {'course': 0, 'event': 0, 'acks': 0, 'reviews': 0, 'skipped': 0}
        threads_left = 0
        pairs: dict[int, int] = {}  # old EventDocument pk -> new Attachment pk, for the chain pass

        with transaction.atomic():
            course_ct = ContentType.objects.get_for_model(CourseAttachment.course.field.related_model)
            for old in CourseAttachment.objects.select_related('course').all():
                if _already('course-attachment', old.pk):
                    written['skipped'] += 1
                    continue
                if apply:
                    new = Attachment.objects.create(
                        content_type=course_ct,
                        object_id=old.course_id,
                        kind='file',
                        title=old.title,
                        description=_note(old.description, 'course-attachment', old.pk),
                        # The same path: the bytes stay where they are, nothing is duplicated.
                        file=old.file.name,
                        media_type='',
                        original_name='',
                        byte_size=old.size_bytes,
                        # A course attachment was visible to anybody in the room, which is this
                        # ladder's `members` exactly.
                        visibility='members',
                        uploaded_by=old.uploaded_by,
                    )
                    for review in old.reviews.all():
                        AttachmentReview.objects.create(
                            attachment=new, author=review.author, rating=review.rating,
                            body=review.body,
                        )
                        written['reviews'] += 1
                written['course'] += 1
                threads_left += 1

            event_ct = ContentType.objects.get_for_model(EventDocument.event.field.related_model)
            for old in EventDocument.objects.select_related('event').all():
                if _already('event-document', old.pk):
                    written['skipped'] += 1
                    continue
                if apply:
                    new = Attachment.objects.create(
                        content_type=event_ct,
                        object_id=old.event_id,
                        kind=old.kind,
                        title=old.title,
                        description=_note('', 'event-document', old.pk),
                        file=old.file.name if old.file else '',
                        url=old.url,
                        media_type=old.content_type,
                        byte_size=old.byte_size,
                        visibility=TIER_MAP.get(old.visibility, old.visibility),
                        requires_acknowledgement=old.requires_acknowledgement,
                        version=old.version,
                        removed_at=old.removed_at,
                        removed_by=old.removed_by,
                        scanned=old.scanned,
                        scan_detail=old.scan_detail,
                        uploaded_by=old.uploaded_by,
                    )
                    pairs[old.pk] = new.pk
                    for ack in old.acknowledgements.all():
                        Acknowledgement.objects.create(
                            attachment=new, user=ack.user, version=ack.version
                        )
                        written['acks'] += 1
                written['event'] += 1

            # The chain, second pass: a row's replacement may have been written after it was.
            if apply:
                for old in EventDocument.objects.exclude(replaced_by__isnull=True):
                    here, there = pairs.get(old.pk), pairs.get(old.replaced_by_id)
                    if here and there:
                        Attachment.objects.filter(pk=here).update(replaced_by_id=there)

            if not apply:
                transaction.set_rollback(True)

        verb = 'Absorbed' if apply else 'Would absorb'
        self.stdout.write(
            self.style.SUCCESS(
                f'{verb} {written["course"]} course attachment(s) and {written["event"]} event '
                f'document(s); {written["acks"]} acknowledgement(s), {written["reviews"]} rating(s). '
                f'{written["skipped"]} already done.'
            )
        )
        if threads_left:
            self.stdout.write(
                f'  {threads_left} course attachment(s) have a discussion thread addressed to the '
                f'OLD row. Moving a thread is a `community` change and is not this command’s job; '
                f'until it happens, those threads stay reachable at the old attachment’s page.'
            )
        if not apply:
            self.stdout.write('  Nothing was written. Re-run with --apply.')

    def _verify(self, CourseAttachment, EventDocument):
        missing = []
        for old in CourseAttachment.objects.all():
            if not _already('course-attachment', old.pk):
                missing.append(f'courses.Attachment {old.pk} ({old.title})')
        for old in EventDocument.objects.all():
            if not _already('event-document', old.pk):
                missing.append(f'documents.EventDocument {old.pk} ({old.title})')
        if missing:
            self.stdout.write(self.style.WARNING(f'{len(missing)} legacy row(s) NOT absorbed:'))
            for line in missing[:50]:
                self.stdout.write(f'  {line}')
            self.stdout.write(
                '  Do not delete the legacy tables while any of these are listed: the new rows '
                'share their files, so deleting a legacy row takes the bytes with it.'
            )
        else:
            self.stdout.write(self.style.SUCCESS('Every legacy row has a counterpart.'))
