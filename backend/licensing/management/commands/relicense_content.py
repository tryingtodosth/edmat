"""`manage.py relicense_content --to <key> --by <staff username> --note "<why>" [--author <username>] [--dry-run]`

Move every piece of POSTED content the caller may relicense to one licence, through the same rules
the item page's "change licence" control asks (`licensing/rules.py`, house boundary #2), recording
a `LicenceChange` row per item (house rule 12). Written 2026-10-21 for the owner's "add CC BY-SA 4.0
to all currently posted content".

What "may relicense" means here is exactly what the rules say, and this command adds no authority:

- content whose rights were `unknown` — the staff exception (the holder cleared them; `--note`
  says on what basis, and every row carries that note);
- content the caller authored (`targets.Kind.authors`);
- NOT content another person wrote and kept `edmat-only`: `/terms` § 9 point 2 gave the operator
  an operating licence, not the right to grant the world one. Those items are listed by id at the
  end with the reason `licence_other_contributors`; their authors can widen them from the item page.

Narrowing is refused like everywhere else (CC grants are irrevocable), and an item already at a
licence at least as open as `--to` (CC BY under a CC BY-SA run) is left alone and counted, not
refused. `--dry-run` does the whole walk inside a transaction and rolls it back, printing exactly
what a real run would do. Only visible content is touched: unpublished, removed or auto-hidden items
are not "posted" and keep whatever they have.

`--author <username>` (2026-10-22, owner: "cc-by-nc-4.0 for Marysia's work — update her content with
this licence") narrows the walk to items that account is an author of (`Kind.authors`, the same
set the rules ask), plus the unattributed hints/solutions on that account's own exercises (the
corpus's originals, `_belongs_to`) — one contributor's content to one licence, while the rest is left
to a separate run. It adds no authority either: the same rules decide each item.
"""

from __future__ import annotations

from collections import Counter, defaultdict

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from licensing.licences import LICENCES, UNKNOWN, at_least_as_open
from licensing.rules import change_licence
from licensing.targets import LICENSED_KINDS, kind_for


class _Rollback(Exception):
    pass


def _posted(kind_name: str):
    """Every item of one kind a reader could open today, in id order, as a queryset that only
    narrows what `Kind.visible` would refuse anyway (the object check still runs on each)."""
    kind = kind_for(kind_name)
    qs = kind.model.objects.all().order_by('pk')
    if kind_name == 'exercise':
        qs = qs.filter(published=True)
    elif kind_name == 'solution_entry':
        qs = qs.filter(status='published', exercise__published=True).select_related('exercise')
    elif kind_name == 'material':
        qs = qs.filter(published=True)
    elif kind_name == 'concept_article':
        qs = qs.filter(is_removed=False)
    return kind, qs


def _belongs_to(kind_name, kind, obj, author_id) -> bool:
    """`--author`'s walk: what the account authored, plus — for a hint or solution — an entry with NO
    author on an exercise the account submitted. Those are the corpus's own originals, which came in
    with the exercise as one piece of work (the 2026-10-14 data migration classified them the same
    way, `licensing/CLAUDE.md`); leaving them out would let a later sweep give the solutions of a
    BY-NC exercise a different, irrevocable licence. An entry somebody ELSE wrote is never included."""
    if author_id in kind.authors(obj):
        return True
    return kind_name == 'solution_entry' and obj.author_id is None and obj.exercise.submitted_by_id == author_id


class Command(BaseCommand):
    help = 'Relicense every posted item the caller may relicense, through the licensing rules.'

    def add_arguments(self, parser):
        parser.add_argument('--to', required=True, help='The licence key, e.g. cc-by-sa-4.0.')
        parser.add_argument('--by', required=True, help='The staff account the changes are made as.')
        parser.add_argument(
            '--note',
            default='',
            help='Why — on what basis the rights were cleared. Recorded on every change; required.',
        )
        parser.add_argument(
            '--kinds',
            default=','.join(LICENSED_KINDS),
            help=f'Comma-separated subset of {", ".join(LICENSED_KINDS)}. Default: all four.',
        )
        parser.add_argument(
            '--author',
            default='',
            help='Only the items this account is an author of (exercises it submitted, solutions it '
            'wrote, its materials, concept articles it started).',
        )
        parser.add_argument('--dry-run', action='store_true', help='Walk, report, change nothing.')
        parser.add_argument(
            '--list-limit',
            type=int,
            default=40,
            help='How many refused ids to print per kind and reason (default 40).',
        )

    def handle(self, *args, **options):
        to = options['to']
        if to not in LICENCES:
            raise CommandError(f'--to must be one of {", ".join(LICENCES)}; got {to!r}')
        if to == UNKNOWN:
            raise CommandError('--to unknown marks a rights question on ONE item; use the item page.')
        if not LICENCES[to].public_reuse:
            raise CommandError(f'{to!r} grants the public nothing; there is nothing to move content to.')
        note = (options['note'] or '').strip()
        if not note:
            raise CommandError('--note is required: say on what basis the rights were cleared.')
        kinds = [k.strip() for k in options['kinds'].split(',') if k.strip()]
        unknown_kinds = [k for k in kinds if k not in LICENSED_KINDS]
        if unknown_kinds:
            raise CommandError(f'unknown kind(s) {unknown_kinds}; choose from {LICENSED_KINDS}')
        try:
            user = get_user_model().objects.get(username=options['by'])
        except get_user_model().DoesNotExist as exc:
            raise CommandError(f'no account {options["by"]!r}') from exc
        if not user.is_staff:
            raise CommandError(f'{user.username} is not staff; this command acts with staff authority.')

        author_id = None
        if options['author']:
            try:
                author_id = get_user_model().objects.get(username=options['author']).pk
            except get_user_model().DoesNotExist as exc:
                raise CommandError(f'no account {options["author"]!r}') from exc

        dry = options['dry_run']
        limit = options['list_limit']
        totals = Counter()
        try:
            with transaction.atomic():
                for kind_name in kinds:
                    self._run_kind(kind_name, to, user, note, limit, totals, author_id)
                if dry:
                    raise _Rollback
        except _Rollback:
            self.stdout.write('--dry-run: rolling the transaction back.')

        self.stdout.write(
            f'{totals["changed"]} changed to {to}, {totals["already"]} already at least as open, '
            f'{totals["refused"]} refused, across {len(kinds)} kind(s).'
        )

    def _run_kind(self, kind_name, to, user, note, limit, totals, author_id=None):
        kind, qs = _posted(kind_name)
        changed = Counter()
        already = 0
        refused: dict[str, list[int]] = defaultdict(list)
        for obj in qs.iterator(chunk_size=500):
            if not kind.visible(obj):
                continue
            if author_id is not None and not _belongs_to(kind_name, kind, obj, author_id):
                continue
            old = obj.licence
            if at_least_as_open(old, to):
                already += 1
                continue
            reason = change_licence(obj, to, user, note)
            if reason:
                refused[reason].append(obj.pk)
            else:
                changed[old] += 1
        n_changed = sum(changed.values())
        n_refused = sum(len(v) for v in refused.values())
        totals['changed'] += n_changed
        totals['already'] += already
        totals['refused'] += n_refused
        moved = ', '.join(f'{n} from {old}' for old, n in sorted(changed.items())) or 'none'
        self.stdout.write(f'{kind_name}: {n_changed} changed ({moved}); {already} already as open or more; {n_refused} refused')
        for reason, ids in sorted(refused.items()):
            shown = ', '.join(str(i) for i in ids[:limit]) + (' …' if len(ids) > limit else '')
            self.stdout.write(f'  {reason} ({len(ids)}): {shown}')
