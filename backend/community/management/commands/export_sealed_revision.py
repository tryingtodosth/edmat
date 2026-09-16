"""The only intended way to read a SEALED CommentRevision's body outside Django admin (see
CommentRevision's own docstring for why nothing in the running API ever serves one) — a narrow,
offline, forensic tool for handing one specific revision to whoever actually needs to review it
(e.g. authorities), not the production web app rendering potentially illegal content back through
its own Markdown/KaTeX/sanitizer pipeline. Deliberately does not touch `sealed_at`/`sealed_by` —
running this leaves the revision exactly as sealed as it was.
"""

from django.core.management.base import BaseCommand, CommandError

from community.models import CommentRevision


class Command(BaseCommand):
    help = 'Prints one sealed CommentRevision (id, comment, editor, seal note, and body) to stdout.'

    def add_arguments(self, parser):
        parser.add_argument('revision_id', type=int)

    def handle(self, *args, **options):
        try:
            revision = CommentRevision.objects.select_related(
                'comment', 'edited_by', 'sealed_by'
            ).get(pk=options['revision_id'])
        except CommentRevision.DoesNotExist:
            raise CommandError(f'No CommentRevision with id {options["revision_id"]}.')
        if revision.sealed_at is None:
            raise CommandError(
                'This revision is not sealed — read it through the ordinary API instead.'
            )

        self.stdout.write(f'CommentRevision {revision.pk} (on comment {revision.comment_id})')
        self.stdout.write(f'Edited by: {revision.edited_by} at {revision.created_at}')
        self.stdout.write(f'Sealed by: {revision.sealed_by} at {revision.sealed_at}')
        self.stdout.write(f'Seal note: {revision.seal_note}')
        self.stdout.write('--- body ---')
        self.stdout.write(revision.body)
