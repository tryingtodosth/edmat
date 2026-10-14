"""Apply the retention rules in `accounts/retention.py`: view history and the mail log after 12
months, an anonymous commenter's IP hash after 30 days. Nightly, from `deploy/cron/edmat-retention`.

    manage.py enforce_data_retention [--dry-run]
"""

from django.core.management.base import BaseCommand

from accounts.retention import DAYS, enforce


class Command(BaseCommand):
    help = 'Delete or blank personal data past its retention period (accounts/retention.py).'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Count; change nothing.')

    def handle(self, *args, **opts):
        result = enforce(dry_run=opts['dry_run'])
        verb = 'would affect' if opts['dry_run'] else 'affected'
        for name, n in result.items():
            self.stdout.write(f'{name} (> {DAYS[name]} days): {verb} {n}')
