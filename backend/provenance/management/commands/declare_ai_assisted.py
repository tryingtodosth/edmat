"""`manage.py declare_ai_assisted --author <username> [--note "…"] [--by <staff>] [--kinds …] [--dry-run]`

Make the author's own "AI-assisted" mark (`provenance.AuthorMark`, `assisted=True`) on everything
one account wrote: by default its exercises (the statement) and its hints and solutions; comments
and reviews on request. Written 2026-10-21 for the owner's "as for the content created by me
(user todoonet) mark it as ai assisted". One upsert per target, through the same table the item
page's own control writes, so the chip and the summary read exactly as if the author had clicked.

`--by` defaults to the author: the row is then the author's own disclosure. A staff member marking
on somebody's behalf passes `--by <staff>`, and the row records that (`declared_by`), as the
endpoint does. Marking a solution recounts its exercise's `verified` (`provenance/signals.py`).
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from provenance.models import AuthorMark
from provenance.targets import PROVENANCE_KIND_MODELS

DEFAULT_KINDS = ('exercise', 'solution_entry')


class _Rollback(Exception):
    pass


class Command(BaseCommand):
    help = "Make the author's AI-assisted mark on everything one account wrote."

    def add_arguments(self, parser):
        parser.add_argument('--author', required=True, help='The account whose content is marked.')
        parser.add_argument('--by', help='Who declares it (default: the author themselves).')
        parser.add_argument('--note', default='', help='The note shown with the mark (optional).')
        parser.add_argument(
            '--kinds',
            default=','.join(DEFAULT_KINDS),
            help=f'Comma-separated subset of {", ".join(PROVENANCE_KIND_MODELS)}. Default: {",".join(DEFAULT_KINDS)}.',
        )
        parser.add_argument('--dry-run', action='store_true', help='Count, change nothing.')

    def handle(self, *args, **options):
        User = get_user_model()
        try:
            author = User.objects.get(username=options['author'])
        except User.DoesNotExist as exc:
            raise CommandError(f'no account {options["author"]!r}') from exc
        declared_by = author
        if options['by']:
            try:
                declared_by = User.objects.get(username=options['by'])
            except User.DoesNotExist as exc:
                raise CommandError(f'no account {options["by"]!r}') from exc
            if declared_by != author and not declared_by.is_staff:
                raise CommandError(f'{declared_by.username} is neither the author nor staff.')
        kinds = [k.strip() for k in options['kinds'].split(',') if k.strip()]
        bad = [k for k in kinds if k not in PROVENANCE_KIND_MODELS]
        if bad:
            raise CommandError(f'unknown kind(s) {bad}; choose from {list(PROVENANCE_KIND_MODELS)}')
        note = (options['note'] or '').strip()

        created = updated = unchanged = 0
        try:
            with transaction.atomic():
                for kind in kinds:
                    model, field = PROVENANCE_KIND_MODELS[kind]
                    ct = ContentType.objects.get_for_model(model)
                    ids = list(model.objects.filter(**{field: author}).order_by('pk').values_list('pk', flat=True))
                    k_created = k_updated = k_unchanged = 0
                    for pk in ids:
                        existing = AuthorMark.objects.filter(content_type=ct, object_id=pk).first()
                        if existing is not None and existing.assisted and existing.note == note:
                            k_unchanged += 1
                            continue
                        _, was_created = AuthorMark.objects.update_or_create(
                            content_type=ct,
                            object_id=pk,
                            defaults={'assisted': True, 'note': note, 'declared_by': declared_by},
                        )
                        if was_created:
                            k_created += 1
                        else:
                            k_updated += 1
                    self.stdout.write(
                        f'{kind}: {len(ids)} by {author.username}; {k_created} marked, '
                        f'{k_updated} re-marked, {k_unchanged} already marked'
                    )
                    created += k_created
                    updated += k_updated
                    unchanged += k_unchanged
                if options['dry_run']:
                    raise _Rollback
        except _Rollback:
            self.stdout.write('--dry-run: rolling the transaction back.')
        self.stdout.write(f'{created} marked, {updated} re-marked, {unchanged} already marked.')
