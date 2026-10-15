"""Usage analytics — AGGREGATES ONLY. Nothing in this file is personal data, and that is the design.

**Where the numbers come from.** Everything here is computed on the server from rows EdMat already
writes for other reasons: the request log (`telemetry.RequestLog`, written for security and
debugging, see that module's docstring for the legal position) and the main database. There is no
cookie, no `localStorage`, no beacon, no third party and no script on the page that exists for
analytics. A rollup (`rollup.py`, run daily by `manage.py rollup_analytics`) reads one day of the
log shards, counts, and writes the counts below. The raw rows then age out under
`enforce_log_retention` exactly as they did before this app existed; the counts stay.

**Legal basis**: GDPR art. 6(1)(f) legitimate interest — the controller is the student team, not
the University (LEGAL.md §1); ANALYTICS-LAW.md §4's (e) recommendation assumed a university
controller — and art. 5(1)(b) / art. 89(1) statistical compatibility for reusing the security log. ANALYTICS-LAW.md §3 classifies every figure here.

**What can never be in these tables**, pinned by `tests.NoPersonalColumnsTests`:

- no IP address, no User-Agent string, no referrer URL (only an external HOST), no path with a
  query string, no request id;
- no user id — `DailyActiveUsers` and `WeeklyCohort` are computed from distinct user ids DURING the
  rollup and store only the resulting counts;
- no visitor identifier of any kind. Distinct ANONYMOUS visitors are not counted at all, because
  counting them needs exactly the fingerprint `telemetry.tests.test_no_visitor_fingerprint` forbids.

**Who is left out on purpose.** Rows whose browser sent `Sec-GPC: 1` or `DNT: 1`
(`RequestLog.analytics_opt_out`) are skipped by every rollup — an Art. 21 objection, honoured by
construction. Bots (`classify.classify_user_agent`) are counted only as bots and never feed a human
metric. Minors' and staff accounts are never counted as people — active accounts, cohorts,
registrations (`rollup.counted_people`); staff REQUESTS still count as traffic.
The aggregates themselves are deleted after 25 months (`rollup.purge_aggregates`).

**Small numbers that describe people are suppressed on the way out** (`privacy.K_ANONYMITY`, below
10 reads as "<10"), in `views.py` — the tables keep the true count so a later threshold change needs
no recount. Counts about public content (how often exercise 12 was opened) are not people and are
not suppressed.
"""

from django.db import models

AUDIENCE_CHOICES = [
    ('anon', 'Anonymous'),
    ('auth', 'Signed in'),
    ('bot', 'Bot or script'),
]

DEVICE_CHOICES = [
    ('desktop', 'Desktop'),
    ('mobile', 'Mobile'),
    ('tablet', 'Tablet'),
    ('bot', 'Bot'),
]


class DailyRouteStat(models.Model):
    """One (day, route template, method, audience). `route` is the URL PATTERN the request resolved
    to, ids collapsed (`/api/exercises/:pk/`), never the literal path — so the table's size is
    bounded by the URL conf, not by the traffic, and an unresolvable path is `(unmatched)`."""

    date = models.DateField(db_index=True)
    route = models.CharField(max_length=200)
    method = models.CharField(max_length=10)
    audience = models.CharField(max_length=4, choices=AUDIENCE_CHOICES)
    requests = models.PositiveIntegerField(default=0)
    status_4xx = models.PositiveIntegerField(default=0)
    status_5xx = models.PositiveIntegerField(default=0)
    throttled = models.PositiveIntegerField(default=0)
    # Requests that carried a search parameter. Only THAT it did — the term itself was redacted
    # before it was ever logged (`telemetry.middleware.redact_query_string`) and stays unknown.
    searches = models.PositiveIntegerField(default=0)
    p50_ms = models.PositiveIntegerField(default=0)
    p95_ms = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['date', 'route', 'method', 'audience'], name='analytics_route_day_unique'
            )
        ]

    def __str__(self) -> str:
        return f'{self.date} {self.method} {self.route} [{self.audience}] ×{self.requests}'


class DailyContentView(models.Model):
    """How often a piece of content's page was opened on one day. A "view" is a successful GET of
    the object's API detail endpoint by a human (`classify.CONTENT_DETAIL_ROUTES`), because the SPA
    fetches exactly that when a page opens. `object_id` is a string: a concept or a branch is a
    slug."""

    date = models.DateField(db_index=True)
    kind = models.CharField(max_length=30)
    object_id = models.CharField(max_length=100)
    views = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['date', 'kind', 'object_id'], name='analytics_content_day_unique'
            )
        ]
        indexes = [models.Index(fields=['kind', 'date'])]

    def __str__(self) -> str:
        return f'{self.date} {self.kind}:{self.object_id} ×{self.views}'


class DailyReferrer(models.Model):
    """An EXTERNAL referring host and how many human requests named it. Host only: the path of the
    page somebody came from can be a private document, a search with their query in it, a webmail
    message — none of which is ours to keep."""

    date = models.DateField(db_index=True)
    host = models.CharField(max_length=253)
    count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['date', 'host'], name='analytics_referrer_day_unique')
        ]

    def __str__(self) -> str:
        return f'{self.date} {self.host} ×{self.count}'


class DailyClient(models.Model):
    """Requests per (browser family, OS family, device class) — the coarse output of an in-house
    classifier (`classify.classify_user_agent`). The User-Agent string itself is never stored
    here; families are a short fixed vocabulary."""

    date = models.DateField(db_index=True)
    browser = models.CharField(max_length=20)
    os = models.CharField(max_length=20)
    device = models.CharField(max_length=8, choices=DEVICE_CHOICES)
    count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['date', 'browser', 'os', 'device'], name='analytics_client_day_unique'
            )
        ]

    def __str__(self) -> str:
        return f'{self.date} {self.browser}/{self.os}/{self.device} ×{self.count}'


class DailyActiveUsers(models.Model):
    """How many DISTINCT signed-in accounts made at least one request on a day. Only the count is
    stored; the ids it was counted from are gone when the rollup returns."""

    date = models.DateField(unique=True)
    users = models.PositiveIntegerField(default=0)

    def __str__(self) -> str:
        return f'{self.date}: {self.users} active'


class WeeklyCohort(models.Model):
    """Retention: of the accounts that signed up in ISO week `cohort_week`, how many were active in
    ISO week `week` (both stored as that week's Monday). Counts only."""

    week = models.DateField(db_index=True)
    cohort_week = models.DateField()
    users = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['week', 'cohort_week'], name='analytics_cohort_unique')
        ]

    def __str__(self) -> str:
        return f'week {self.week}, cohort {self.cohort_week}: {self.users}'


class RollupRun(models.Model):
    """When each day was last rolled up — so the dashboard can say how fresh its numbers are, and
    say plainly when a day was never rolled up instead of drawing it as a day with no traffic."""

    date = models.DateField(unique=True)
    rows_read = models.PositiveIntegerField(default=0)
    rows_skipped_opt_out = models.PositiveIntegerField(default=0)
    finished_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f'{self.date} rolled up at {self.finished_at:%Y-%m-%d %H:%M}'


# ---- browser error reports (2026-10-14, LINKING-AND-ERRORS.md §3.3) ------------------------------
#
# The one thing in this app that starts in the browser. It is NOT analytics: it exists to find and
# fix faults, it is sent only when something actually broke, and it is built so that nothing in it
# identifies a person — no IP, no account, no User-Agent string, no page address, no cookie and
# nothing stored on the device (`client_errors.py` has the whole contract). It lives here because
# the staff dashboard does, and in the default database because it is not a request log.
#
# "signature", not "fingerprint": it is a hash of the ERROR (normalised message + top frames), the
# same for every visitor who hits the same bug — never a function of the visitor. The word
# `fingerprint` is banned as a column name in this app (`tests.NoPersonalColumnsTests`) and stays so.

# MIRRORED BY HAND in frontend/src/lib/components/analytics/labels.ts (`ERROR_KIND`, house rule 13).
CLIENT_ERROR_KIND_CHOICES = [
    ('error', 'Uncaught error'),
    ('rejection', 'Unhandled promise rejection'),
    ('sveltekit', 'Error during load or render'),
]


class ClientErrorGroup(models.Model):
    """One distinct bug: every report whose normalised message and top frames hash to `signature`.
    `message` is the NORMALISED message (numbers replaced by `N`), so a group's label carries no
    number that came from one visitor's data. Deleted 90 days after it was last seen."""

    signature = models.CharField(max_length=32, unique=True)
    kind = models.CharField(max_length=10, choices=CLIENT_ERROR_KIND_CHOICES)
    message = models.CharField(max_length=500)
    top_frame = models.CharField(max_length=300, blank=True)
    first_seen = models.DateTimeField()
    last_seen = models.DateTimeField(db_index=True)

    def __str__(self) -> str:
        return f'{self.kind}: {self.message[:80]}'


class DailyClientError(models.Model):
    """How many reports of one group arrived on one (Polish) calendar day, from one route template, build and
    browser family. Kept 90 days. This count IS the record (the reports themselves are capped and
    expire after 30 days), so it is incremented on arrival with one WHERE-anchored `update()` —
    the one counter in this app that is not a recount, because there is nothing to recount it from."""

    date = models.DateField(db_index=True)
    group = models.ForeignKey(ClientErrorGroup, on_delete=models.CASCADE, related_name='days')
    route = models.CharField(max_length=200)
    build = models.CharField(max_length=64)
    browser = models.CharField(max_length=20)
    count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['date', 'group', 'route', 'build', 'browser'],
                name='analytics_client_error_day_unique',
            )
        ]

    def __str__(self) -> str:
        return f'{self.date} {self.group_id} {self.route} ×{self.count}'


class ClientErrorReport(models.Model):
    """One report as it arrived, after the server re-applied the field allowlist. A sample, not a
    log: at most `client_errors.SAMPLES_PER_GROUP_PER_DAY` are kept per group per day, and every one
    is deleted 30 days after it arrived. Browser/OS/device are the classifier's families; the
    User-Agent they were read from is not stored."""

    group = models.ForeignKey(ClientErrorGroup, on_delete=models.CASCADE, related_name='reports')
    received_at = models.DateTimeField(db_index=True)
    kind = models.CharField(max_length=10, choices=CLIENT_ERROR_KIND_CHOICES)
    message = models.CharField(max_length=500)
    stack = models.TextField(blank=True)
    route = models.CharField(max_length=200)
    build = models.CharField(max_length=64)
    locale = models.CharField(max_length=2, blank=True)
    browser = models.CharField(max_length=20)
    os = models.CharField(max_length=20)
    device = models.CharField(max_length=8, choices=DEVICE_CHOICES)

    def __str__(self) -> str:
        return f'{self.received_at:%Y-%m-%d %H:%M} {self.message[:60]}'
