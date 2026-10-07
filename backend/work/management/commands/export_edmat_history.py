"""Write `work/edmat_history.json` from `HISTORY.md` — the project's build log as data.

    manage.py export_edmat_history

Runs where the repository is (it reads `HISTORY.md` and asks git for the dates the older headings
do not carry); the table it writes is what `seed_edmat_project` reads on a server that has neither.
Re-run it whenever `HISTORY.md` gains a section; `work.tests.EdmatHistoryTests` fails when the
table is behind the log.
"""

from collections import Counter

from django.core.management.base import BaseCommand, CommandError

from work.edmat_history import HISTORY_PATH, TABLE_PATH, build_table, write_table


class Command(BaseCommand):
    help = 'Export HISTORY.md as work/edmat_history.json, one row per section with its date.'

    def handle(self, *args, **options):
        if not HISTORY_PATH.exists():
            raise CommandError(f'{HISTORY_PATH} is not here; run this where the repository is.')
        try:
            entries = build_table()
        except Exception as exc:  # git missing, not a repository, …
            raise CommandError(f'Could not build the table: {exc}') from exc
        write_table(entries)
        sources = Counter(entry['date_source'] for entry in entries)
        undated = [entry['heading'] for entry in entries if not entry['date']]
        self.stdout.write(
            self.style.SUCCESS(
                f'Wrote {len(entries)} sections to {TABLE_PATH.name}: '
                f'{sources.get("heading", 0)} dated in the heading, {sources.get("git", 0)} from git, '
                f'{sources.get("repo-start", 0)} no later than the first commit.'
            )
        )
        for heading in undated:
            self.stdout.write(self.style.WARNING(f'  no date found: {heading}'))
