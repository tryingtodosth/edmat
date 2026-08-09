"""`manage.py preload_cache` — warm the anonymous-read cache with what is actually hot.

The other half of config/cachemw.py's earn-your-slot admission: ordinary traffic must prove an URL
twice (or 6–7 times when busy) before it is cached, but this command seats responses DELIBERATELY,
admission bypassed — "preload into Redis as much as possible" (the owner's ask), where "as much as
possible" is bounded by evidence, not enthusiasm:

- a base set that is hot by construction: the discipline list (each locale) and every published
  discipline's branches payload — the taxonomy every browse starts from;
- plus the top `--top` anonymous GET paths from the telemetry request log's own anonymous shard
  (`logs_anon`) over the last `--days` days — the app's real traffic record deciding, not a guess.
  Query strings are NOT replayed: telemetry redacts `?q=` for search endpoints by design (a search
  term is the visitor's content), so paths only — which also keeps this from warming one person's
  odd query into shared cache.

Every candidate is fetched through the real request stack (Django test client → full middleware,
so the response is byte-identical to what a visitor gets) as a pure anonymous GET, and only clean
200s on cachemw's own allowlist are stored, through cachemw's own `store()` — one definition of
"cacheable", not two. Entries live `EDMAT_CACHE_RESPONSE_TTL` seconds like any other, so a preload
is a head start, never a staleness extension: re-run it from cron at the TTL cadence if standing
warmth is wanted.
"""

from collections import Counter
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.test import Client
from django.utils import timezone

from config import cachemw
from taxonomy.models import Discipline
from telemetry.models import RequestLog


class Command(BaseCommand):
    help = 'Warm the anonymous-read response cache from the base set + the hottest logged paths.'

    def add_arguments(self, parser):
        parser.add_argument('--top', type=int, default=50, help='How many logged paths to consider.')
        parser.add_argument('--days', type=int, default=7, help='How far back to read the log.')

    def handle(self, *args, **options):
        candidates: list[str] = []
        for lang in ('pl', 'en'):
            candidates.append(f'/api/disciplines/?lang={lang}')
            for slug in Discipline.objects.filter(published=True).values_list('slug', flat=True):
                candidates.append(f'/api/disciplines/{slug}/branches/?lang={lang}')
        candidates.append('/api/disciplines/')
        candidates.append('/api/feature-flags/')

        since = timezone.now() - timedelta(days=options['days'])
        try:
            hot = Counter(
                RequestLog.objects.using(settings.LOG_ANON_SHARD)
                .filter(method='GET', status_code=200, created_at__gte=since, path__startswith='/api/')
                .values_list('path', flat=True)
            )
        except Exception as exc:
            # A missing/unmigrated anonymous shard (run `manage.py migrate_log_shards`) must not
            # cost the base-set preload — the log-derived half is the optional enrichment here.
            # Found live, not hypothesized: the first real run died on exactly this.
            self.stderr.write(f'log shard unreadable, preloading base set only ({exc})')
            hot = Counter()
        for path, _count in hot.most_common(options['top']):
            if path not in candidates:
                candidates.append(path)

        # The test client's default Host is `testserver`, which only the TEST runner whitelists —
        # under the real dev or deployed settings every request would 400 on DisallowedHost and
        # this command would "succeed" having stored nothing. Found live, on the first real run.
        host = next(
            (h for h in settings.ALLOWED_HOSTS if h and h != '*' and not h.startswith('.')),
            '127.0.0.1',
        )
        client = Client(SERVER_NAME=host)
        stored = gated = failed = 0
        for path in candidates:
            # The same gate ordinary traffic passes — a path the middleware would refuse to serve
            # from cache must not be seated into it either (exercise detail with its ContentView
            # side effect, random, anything off-list).
            probe = _fake_request(path)
            if not cachemw.cacheable_request(probe):
                gated += 1
                continue
            response = client.get(path)
            if response.status_code == 200 and not response.has_header('Set-Cookie'):
                cachemw.store(probe.get_full_path(), response)
                stored += 1
            else:
                # Counted apart from the gate on purpose: "the middleware would never cache this"
                # is expected, "the fetch itself failed" is a symptom worth seeing in the output.
                failed += 1

        ttl = getattr(settings, 'EDMAT_CACHE_RESPONSE_TTL', 60)
        self.stdout.write(
            f'Preloaded {stored} responses ({gated} off-list, {failed} failed fetches) — '
            f'TTL {ttl}s, so re-run on that cadence (cron) if standing warmth is wanted.'
        )


def _fake_request(path_with_query: str):
    """Just enough request to ask `cacheable_request` its question."""
    from django.test import RequestFactory

    path, _, query = path_with_query.partition('?')
    return RequestFactory().get(path, data=None, QUERY_STRING=query)
