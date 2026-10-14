"""Erase every account whose deletion grace period has ended (`accounts/erasure.py`).

    manage.py erase_due_accounts               # every request past its 14 days
    manage.py erase_due_accounts --dry-run     # list them, change nothing
    manage.py erase_due_accounts --now --user 42
                                               # erase one pending request today, grace or not —
                                               # for tests, and for an operator acting on a written
                                               # request that asked for no grace period

Idempotent: a run that dies half-way leaves its request `erasing`, and the next run finishes it.
Run nightly from `deploy/cron/edmat-retention`.
"""

from django.core.management.base import BaseCommand, CommandError

from accounts.erasure import run_due


class Command(BaseCommand):
    help = 'Erase accounts whose 14-day deletion grace period has ended.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='List what is due; change nothing.')
        parser.add_argument('--now', action='store_true', help='Ignore the grace period (needs --user).')
        parser.add_argument('--user', type=int, default=None, help='Only this user id.')

    def handle(self, *args, **opts):
        if opts['now'] and opts['user'] is None:
            raise CommandError('--now skips the grace period for ONE account; name it with --user.')
        results = run_due(ignore_grace=opts['now'], only_user_id=opts['user'], dry_run=opts['dry_run'])
        if not results:
            self.stdout.write('Nothing due.')
        for r in results:
            if r.get('dry_run'):
                self.stdout.write(f"due: user {r['user_id']} (request {r['erasure']})")
            else:
                self.stdout.write(f"erased: user {r['user_id']} (request {r['erasure']}, {r['rows']} rows touched)")
