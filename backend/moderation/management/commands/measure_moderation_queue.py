"""Phase 4 hardening: the real, mechanical measurement half of the moderation-queue load test —
`seed_moderation_load_test` populates a real, large backlog; this command measures the ACTUAL SQL
query count and wall-clock cost of building the moderator-facing queue against it, rather than
trusting `moderation/services.py`'s own `build_report_queue()` docstring (which used to claim
"N+1 queries — fine at this app's real scale" as an assumption; this command is what refuted that
and drove the real fix, see that function's own updated docstring) on faith. Kept as a real,
reusable command (not a one-off script) for the same reason the KaTeX sweep's own `dump_text_fields`
was — worth re-running after any future change to the queue-building logic, not just once.

Imports `build_moderation_queue_payload` — the SAME function `ModerationQueueView.get()` actually
calls — rather than hand-copying its query-building logic a second time; a duplicated copy is
exactly what would let a future optimization (or regression) drift between what this command
measures and what a real request actually runs.

Uses `CaptureQueriesContext`, which forces query logging for its own duration regardless of
`settings.DEBUG` — the standard, correct tool for this, not a `DEBUG=True` workaround.
"""

import time

from django.core.management.base import BaseCommand
from django.db import connection
from django.test.utils import CaptureQueriesContext

from moderation.services import build_moderation_queue_payload, build_report_queue

# A synchronous Django dev-server request comfortably under this reads as "fine" for a
# moderator-only, low-traffic admin page — this app has never claimed to be optimizing for
# high-concurrency throughput anywhere (Section 13's own "prototype... not attempted here" caveat
# on PostgreSQL/production deployment already sets that expectation). Not a hard SLA, a real,
# stated threshold this command's own verdict is measured against rather than left to eyeballing.
FINE_THRESHOLD_MS = 1000
# A query count this high on ONE request is worth flagging even if the wall-clock time is still
# acceptable on a fast local SQLite disk — it would degrade far worse the moment this app runs
# against a real networked database with real per-round-trip latency, which local SQLite entirely
# hides.
CONCERNING_QUERY_COUNT = 300


class Command(BaseCommand):
    help = 'Measures build_report_queue() and the full moderation queue response under real seeded load.'

    def handle(self, *args, **options):
        self._measure('build_report_queue() alone', build_report_queue)
        self._measure(
            'full ModerationQueueView.get() response (as actually built today)',
            build_moderation_queue_payload,
        )

    def _measure(self, label: str, fn):
        with CaptureQueriesContext(connection) as ctx:
            start = time.perf_counter()
            result = fn()
            elapsed_ms = (time.perf_counter() - start) * 1000
        query_count = len(ctx.captured_queries)
        row_count = len(result) if isinstance(result, list) else sum(len(v) for v in result.values())

        verdict = 'FINE' if elapsed_ms < FINE_THRESHOLD_MS and query_count < CONCERNING_QUERY_COUNT else 'CONCERNING'
        self.stdout.write(f'\n=== {label} ===')
        self.stdout.write(f'  rows returned: {row_count}')
        self.stdout.write(f'  SQL queries:   {query_count}')
        self.stdout.write(f'  wall time:     {elapsed_ms:.1f} ms')
        self.stdout.write(
            self.style.SUCCESS(f'  verdict: {verdict}')
            if verdict == 'FINE'
            else self.style.WARNING(f'  verdict: {verdict}')
        )
