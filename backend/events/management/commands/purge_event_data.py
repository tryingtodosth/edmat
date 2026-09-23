"""Retention for events, enforced — CONFERENCE-BRIEF.md §3.G.

A retention period nobody runs is not a retention period; it is a sentence in a privacy policy that
is not true. `telemetry/management/commands/enforce_log_retention.py` says the same thing about
traffic logs and is the shape this follows: a window, a `--dry-run`, and a printed report of what
actually changed rather than a silent success.

What it touches and what it refuses to touch is the whole design, and it lives in
`events/exports.py: purge_event_data()` — the rule module, not this file, so that the integration
work §5 describes (teaching it `ScanEvent` and `CloakroomItem`) has one place to happen. Run it
from cron once this deployment has a cron; nothing schedules it today, which is stated honestly in
`LEGAL.md` §8 rather than implied to be automatic.
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from events.exports import DEFAULT_RETENTION_DAYS, RETENTION_NOTE, purge_event_data


class Command(BaseCommand):
    help = (
        'Blank the perishable half of registrations for events that ended more than N days ago: '
        'the accessibility note, free-text answers, and who tapped check-in. Never touches who '
        'attended, or the programme.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--older-than-days',
            type=int,
            default=DEFAULT_RETENTION_DAYS,
            help=f'Events that ended this many days ago or more (default {DEFAULT_RETENTION_DAYS}).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what would change and write nothing. Worth doing on the first real run.',
        )

    def handle(self, *args, **options):
        days = options['older_than_days']
        if days < 0:
            self.stderr.write('--older-than-days cannot be negative.')
            return
        dry_run = options['dry_run']
        report = purge_event_data(older_than_days=days, dry_run=dry_run)
        prefix = '[dry run] ' if dry_run else ''

        self.stdout.write(
            f'{prefix}Events that ended before '
            f'{timezone.localtime(report["cutoff"]).isoformat(timespec="minutes")} '
            f'({days} days): {len(report["events"])} with something to purge.'
        )
        for row in report['events']:
            self.stdout.write(
                f'  #{row["id"]} {row["title"][:48]!r} '
                f'(ended {timezone.localtime(row["ended"]).date()}): '
                f'{row["accessibility_blanked"]} accessibility notes, '
                f'{row["answers_blanked"]} free-text answers, '
                f'{row["checkins_unlinked"]} check-ins unlinked'
            )
        line = (
            f'{prefix}{report["accessibility_blanked"]} accessibility notes and '
            f'{report["answers_blanked"]} free-text answers blanked, '
            f'{report["checkins_unlinked"]} check-ins unlinked.'
        )
        self.stdout.write(self.style.SUCCESS(line) if not dry_run else line)
        if report['events'] and dry_run:
            self.stdout.write('Nothing was written. Re-run without --dry-run to apply it.')
        self.stdout.write('')
        self.stdout.write(RETENTION_NOTE)
