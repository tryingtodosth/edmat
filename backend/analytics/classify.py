"""Turning one request-log row into coarse categories — and nothing finer.

Every function here takes a raw value (a path, a User-Agent, a Referer) and returns a member of a
small vocabulary: a URL PATTERN, a browser family, an external host. The raw value is never
returned, so whatever the rollup keeps is bounded by this module's vocabulary rather than by what a
visitor's browser happened to send.

No third-party parser on purpose: `ua-parser`/`user-agents` ship a regex database that needs
updating to stay right, and "Chrome on Android, phone" is all a study site needs to know. The
classifier is wrong for exotic browsers in the honest direction — they read as `other`.
"""

import re
from functools import lru_cache
from urllib.parse import urlsplit

from django.conf import settings
from django.urls import Resolver404, resolve

UNMATCHED_ROUTE = '(unmatched)'

# ---- routes ------------------------------------------------------------------------------------

_NAMED_GROUP = re.compile(r'\(\?P<(?P<name>\w+)>')
_CONVERTER = re.compile(r'<(?:\w+:)?(?P<name>\w+)>')


def _collapse_named_groups(pattern: str) -> str:
    """`exercises/(?P<pk>[0-9]+)/$` → `exercises/:pk/`. Walks the parentheses by hand, because a
    group's own regex can contain parentheses and a single `re.sub` would cut it in the middle."""
    out = []
    i = 0
    while i < len(pattern):
        match = _NAMED_GROUP.match(pattern, i)
        if not match:
            out.append(pattern[i])
            i += 1
            continue
        depth = 1
        j = match.end()
        while j < len(pattern) and depth:
            if pattern[j] == '\\':
                j += 2
                continue
            if pattern[j] == '(':
                depth += 1
            elif pattern[j] == ')':
                depth -= 1
            j += 1
        out.append(f':{match.group("name")}')
        i = j
    return ''.join(out)


@lru_cache(maxsize=4096)
def route_template(path: str) -> tuple[str, str | None]:
    """The URL pattern `path` resolves to, with every id collapsed, and its URL name.

    Asks Django's own resolver rather than guessing which segments are ids, so the template is the
    route as the code declares it — `/api/exercises/:pk/` and `/api/exercises/random/` stay
    different routes. A path that resolves to nothing (a typo, a scanner probing for
    `/wp-login.php`) is `(unmatched)`: one bucket, so junk traffic cannot grow the table.
    """
    try:
        match = resolve(path)
    except Resolver404:
        return UNMATCHED_ROUTE, None
    except Exception:  # noqa: BLE001 — a malformed path must not stop a rollup
        return UNMATCHED_ROUTE, None
    pattern = _collapse_named_groups(match.route or '')
    pattern = _CONVERTER.sub(lambda m: f':{m.group("name")}', pattern)
    pattern = pattern.replace('^', '').replace('$', '')
    if pattern.startswith('media/'):
        pattern = 'media/:path'
    return '/' + pattern.lstrip('/'), match.url_name


# MIRRORED BY HAND in frontend/src/lib/components/analytics/labels.ts (house rule 13): a new key
# here needs a label there (en + pl), or the dashboard shows the raw key.
# Which successful GETs mean "a person opened this page". The SPA fetches exactly one detail
# endpoint when a content page opens, so a 200 from it is a page view. Keyed by URL NAME, so
# `/api/exercises/random/` (`exercise-random`) and `/api/exercises/bulk/` can never be mistaken for
# a view of an exercise called "random". Adding a kind is one line here; the dashboard groups by
# whatever it finds.
CONTENT_DETAIL_ROUTES = {
    'exercise-detail': 'exercise',
    'material-detail': 'material',
    'course-detail': 'course',
    'event-detail': 'event',
    'concept-detail': 'concept',
    'contest-detail': 'contest',
    'deck-detail': 'deck',
    'service-detail': 'tutoring',
    'need-detail': 'need',
    'volunteering-offer-detail': 'volunteering',
    'post-detail': 'post',
    'goal-detail': 'goal',
    'plan-detail': 'plan',
    'organization-detail': 'organization',
    'material-project-detail': 'material_project',
    'branch-detail': 'branch',
    'discipline-detail': 'discipline',
}


def content_view(path: str) -> tuple[str, str] | None:
    """`(kind, object_id)` when `path` is a content detail endpoint, else None."""
    _, url_name = route_template(path)
    kind = CONTENT_DETAIL_ROUTES.get(url_name or '')
    if kind is None:
        return None
    try:
        kwargs = resolve(path).kwargs
    except Exception:  # noqa: BLE001
        return None
    object_id = kwargs.get('pk') or kwargs.get('slug')
    if not object_id:
        return None
    return kind, str(object_id)[:100]


# ---- search ------------------------------------------------------------------------------------

_SEARCH_MARK = re.compile(r'(?:^|&)(?:q|search|query)=')


def is_search(query_string: str) -> bool:
    """A search parameter was present. Its value was redacted before logging and is not wanted."""
    return bool(query_string) and bool(_SEARCH_MARK.search(query_string))


# ---- referrers ---------------------------------------------------------------------------------


def _own_hosts() -> frozenset[str]:
    hosts = {'localhost', '127.0.0.1', 'testserver', '[::1]'}
    for host in getattr(settings, 'ALLOWED_HOSTS', []) or []:
        if host and host != '*':
            hosts.add(host.lstrip('.').lower())
    public = getattr(settings, 'EDMAT_PUBLIC_HOST', '')
    if public:
        hosts.add(public.lower())
    for origin in list(getattr(settings, 'CORS_ALLOWED_ORIGINS', []) or []) + [
        getattr(settings, 'EDMAT_SITE_URL', '')
    ]:
        host = urlsplit(origin).hostname
        if host:
            hosts.add(host.lower())
    return frozenset(hosts)


def external_referrer_host(referer: str, own_hosts: frozenset[str] | None = None) -> str | None:
    """The host of a Referer from OUTSIDE EdMat, lower-cased with a leading `www.` dropped — or None.

    The path and query are thrown away here, before anything is counted: a referring URL can be a
    private document, a webmail message or a search with somebody's query in it."""
    if not referer:
        return None
    try:
        host = urlsplit(referer).hostname
    except ValueError:
        return None
    if not host:
        return None
    host = host.lower().rstrip('.')
    own = own_hosts if own_hosts is not None else _own_hosts()
    if host in own or any(host.endswith('.' + h) for h in own if '.' in h):
        return None
    if host.startswith('www.'):
        host = host[4:]
    return host[:253]


# ---- clients -----------------------------------------------------------------------------------

_BOT = re.compile(
    r'bot\b|bot/|crawl|spider|slurp|archiver|scrap|fetch|monitor|uptime|pingdom|headless|'
    r'phantomjs|lighthouse|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|'
    r'curl/|wget/|python-|httpx|aiohttp|go-http-client|java/|okhttp|libwww|node-fetch|axios/|'
    r'postman|insomnia|^mozilla/5\.0$',
    re.IGNORECASE,
)

# Order matters: every Chromium browser also says "Chrome", and Chrome also says "Safari".
_BROWSERS = (
    ('edge', re.compile(r'Edg(?:e|A|iOS)?/')),
    ('opera', re.compile(r'OPR/|Opera')),
    ('samsung', re.compile(r'SamsungBrowser/')),
    ('firefox', re.compile(r'Firefox/|FxiOS/')),
    ('chrome', re.compile(r'Chrome/|CriOS/|Chromium/')),
    ('safari', re.compile(r'Version/[\d.]+.*Safari/|Mobile/\w+ Safari')),
)

_OSES = (
    ('ios', re.compile(r'iPhone|iPad|iPod')),
    ('android', re.compile(r'Android')),
    ('windows', re.compile(r'Windows')),
    ('chromeos', re.compile(r'CrOS')),
    ('macos', re.compile(r'Macintosh|Mac OS X')),
    ('linux', re.compile(r'Linux|X11')),
)

BROWSER_FAMILIES = tuple(name for name, _ in _BROWSERS) + ('other',)
OS_FAMILIES = tuple(name for name, _ in _OSES) + ('other',)


@lru_cache(maxsize=4096)
def classify_user_agent(user_agent: str) -> tuple[str, str, str]:
    """`(browser, os, device)` from a fixed vocabulary. A missing or bot-like UA is a bot:
    `('bot', 'other', 'bot')`. Device is `tablet`, `mobile` or `desktop`."""
    ua = (user_agent or '').strip()
    # Every real browser since the 1990s opens with `Mozilla/` (Opera's old engine with `Opera/`);
    # anything else — `node`, `undici`, an SDK naming itself — is a program, not a person.
    if not ua or not ua.startswith(('Mozilla/', 'Opera/')) or _BOT.search(ua):
        return 'bot', 'other', 'bot'
    browser = next((name for name, rx in _BROWSERS if rx.search(ua)), 'other')
    os_family = next((name for name, rx in _OSES if rx.search(ua)), 'other')
    if 'iPad' in ua or 'Tablet' in ua or (os_family == 'android' and 'Mobile' not in ua):
        device = 'tablet'
    elif 'Mobi' in ua or 'iPhone' in ua or 'iPod' in ua:
        device = 'mobile'
    else:
        device = 'desktop'
    return browser, os_family, device
