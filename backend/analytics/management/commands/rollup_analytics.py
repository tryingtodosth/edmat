"""`manage.py rollup_analytics [--date YYYY-MM-DD] [--days N]` — recount the analytics aggregates.

Default: yesterday and today (`--days 2` ending today), so a nightly run finishes yesterday for good
and gives today a first figure. The production cron (`deploy/cron/edmat-analytics`) uses `--days 3`
and runs BEFORE `enforce_log_retention`: a day can only be recomputed while its raw rows exist, and
retention deletes them after 90 days (see `analytics/rollup.py`). Re-running any day is safe — it
is a delete-and-recount, never an increment. After the rollup, aggregate rows older than 25 months
are deleted (`--keep-months`), the retention the privacy policy states for them. Then the browser
error reports' own retention runs (`analytics.client_errors.purge_client_errors`): reports older than
30 days, daily error counts and groups older than 90 — fixed, as the privacy policy states them.
"""

import datetime as dt

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from analytics.client_errors import purge_client_errors
from analytics.rollup import AGGREGATE_RETENTION_MONTHS, purge_aggregates, rollup_range


class Command(BaseCommand):
    help = 'Recompute the daily analytics aggregates from the request-log shards (idempotent).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--date',
            help='The LAST day to roll up (YYYY-MM-DD, a Polish calendar day). Default: today.',
        )
        parser.add_argument(
            '--days',
            type=int,
            default=2,
            help='How many days ending at --date to recompute. Default 2 (yesterday and today).',
        )

        parser.add_argument(
            '--keep-months',
            type=int,
            default=AGGREGATE_RETENTION_MONTHS,
            help='Aggregate rows older than this many months are deleted after the rollup '
            f'(default {AGGREGATE_RETENTION_MONTHS}, the published retention).',
        )

    def handle(self, *args, **options):
        if options['date']:
            try:
                last = dt.date.fromisoformat(options['date'])
            except ValueError as exc:
                raise CommandError(f'--date must be YYYY-MM-DD, got {options["date"]!r}') from exc
        else:
            last = timezone.localdate()
        days = options['days']
        if days < 1 or days > 400:
            raise CommandError('--days must be between 1 and 400')

        summaries = rollup_range(last, days)
        today = timezone.localdate()
        purged = purge_aggregates(today, options['keep_months'])
        purged_errors = purge_client_errors()
        for s in summaries:
            self.stdout.write(
                f'  {s["date"]}: {s["rows"]} rows read, {s["skipped_opt_out"]} skipped (GPC/DNT), '
                f'{s["routes"]} route buckets, {s["views"]} content views, '
                f'{s["active_users"]} active accounts'
            )
        self.stdout.write(
            self.style.SUCCESS(
                f'Rolled up {len(summaries)} day(s) ending {last.isoformat()}; '
                f'{purged} aggregate row(s) older than {options["keep_months"]} months deleted; '
                f'{purged_errors} browser error row(s) past their 30/90-day retention deleted.'
            )
        )
