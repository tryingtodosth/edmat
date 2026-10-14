"""Usage analytics — AGGREGATES ONLY. Nothing in this file is personal data, and that is the design.

**Where the numbers come from.** Everything here is computed on the server from rows EdMat already
writes for other reasons: the request log (`telemetry.RequestLog`, written for security and
debugging, see that module's docstring for the legal position) and the main database. There is no
cookie, no `localStorage`, no beacon, no third party and no script on the page that exists for
analytics. A rollup (`rollup.py`, run daily by `manage.py rollup_analytics`) reads one day of the
log shards, counts, and writes the counts below. The raw rows then age out under
`enforce_log_retention` exactly as they did before this app existed; the counts stay.

**Legal basis**: GDPR art. 6(1)(e) public task (UW is a public university), with 6(1)(f) as the
fallback analysis — see ANALYTICS-LAW.md §4 — and art. 5(1)(b) / art. 89(1) statistical
compatibility for reusing the security log. ANALYTICS-LAW.md §3 classifies every figure here.

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
metric. Minors' accounts are never counted as active accounts or in a cohort (`rollup.adult_accounts`).
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
