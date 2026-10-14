"""Browser error reports — the server half of EdMat's first-party error beacon.

Built 2026-10-14 exactly as `LINKING-AND-ERRORS.md` §3.3 recommends, on the owner's condition that
it needs no consent banner: **no cookie, nothing stored on the device, no identifier**. The browser
half is `frontend/src/lib/errors/reporter.ts`; the disclosure is the "Error reports" paragraph of
`frontend/src/lib/content/privacy.ts`; the legal reading is `ANALYTICS-LAW.md` §3 row 8 (class B)
and `LINKING-AND-ERRORS.md` §3.2.

**The field allowlist is re-applied here** — the client is untrusted, so whatever it sends is
rebuilt from `ALLOWED_FIELDS` and every other key is dropped unread:

- `kind`     — `error` | `rejection` | `sveltekit`, else the report is refused;
- `message`  — control characters stripped, 500 characters;
- `stack`    — every URL in it cut to its PATH (scheme, host, query and fragment dropped), 4 KB;
- `route`    — a SvelteKit route TEMPLATE (`/exercises/[id]`); a segment of digits is replaced by
               `[n]`, so a concrete address that slipped through does not land in the table;
- `build`    — the app version, `[A-Za-z0-9._-]`, 64 characters;
- `locale`   — `pl` or `en`, else empty.

**What the server adds and what it throws away.** The browser family, OS family and device class
are read from the User-Agent by the dashboard's own classifier (`classify.classify_user_agent`);
the User-Agent string is then discarded. The IP address is used only by the throttle (DRF's cache
counter, an hour) and by the request log every request already gets (`telemetry/`, its own 30/90-
day rules) — it is never written to these tables. There is no authentication on the endpoint at
all (`authentication_classes = []`), so a token or a session cookie that rides along is never even
read, and no report can be tied to an account.

**Dropped without a trace:** a request carrying `Sec-GPC: 1` or `DNT: 1` (the browser should not
have sent it — `LINKING-AND-ERRORS.md` §3.2 item 5 — and the server honours the header anyway), a
request while the `client_errors` kill switch is off, and the cross-origin `"Script error."` that
carries nothing.

**Retention** (`purge_client_errors`, run by the nightly `rollup_analytics`): reports 30 days,
daily counts and groups 90 days after they were last seen.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from . import classify
from .models import ClientErrorGroup, ClientErrorReport, DailyClientError

MAX_BODY_BYTES = 8 * 1024
MAX_MESSAGE = 500
MAX_STACK = 4096
MAX_ROUTE = 200
MAX_BUILD = 64
MAX_FRAME = 300
SAMPLES_PER_GROUP_PER_DAY = 20

REPORT_RETENTION_DAYS = 30
COUNT_RETENTION_DAYS = 90

KINDS = ('error', 'rejection', 'sveltekit')
LOCALES = ('pl', 'en')
ALLOWED_FIELDS = ('kind', 'message', 'stack', 'route', 'build', 'locale')
UNKNOWN_ROUTE = '(unknown)'

# Every C0/C1 control character except newline and tab (a stack is multi-line).
_CONTROL = re.compile(r'[\x00-\x08\x0b-\x1f\x7f-\x9f  ‪-‮⁦-⁩]')
# A URL with a scheme (http, https, blob, webpack, chrome-extension, …), up to whitespace, a
# parenthesis or a quote — the shape a stack frame or an error message carries one in.
_URL = re.compile(r'\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s()<>"\']+')
# The `:line:column` a stack frame appends to a URL (after any query string, in a dev build).
_POSITION = re.compile(r'(?::\d+){1,2}$')
_ROUTE_OK = re.compile(r'^/[A-Za-z0-9_\-/\[\]().=+@]*$')
_BUILD_OK = re.compile(r'^[A-Za-z0-9._-]+$')
# A whole NUMBER only: `id 4711` → `id N`, but `e2e`, `Uint8Array` and `h2` are words and stay.
_DIGITS = re.compile(r'\b\d+\b')
_LINE_COL = re.compile(r':\d+(?::\d+)?(?=\)?$)')
# A Vite chunk name carries a content hash (`entry.Bx3k9_aZ.js`); the bug is the same across
# builds, so the hash is not part of the signature.
_CHUNK_HASH = re.compile(r'\.[A-Za-z0-9_-]{6,}\.(m?js)\b')


def clean_text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ''
    return _CONTROL.sub('', value)[:limit].strip()


def _path_only(match: re.Match) -> str:
    token = match.group(0)
    rest = token.split('://', 1)[1]
    position = _POSITION.search(rest)
    suffix = ''
    # Only a frame position when a path precedes it — `http://localhost:5197` is a port.
    if position and '/' in rest[: position.start()]:
        suffix = position.group(0)
        rest = rest[: position.start()]
    slash = rest.find('/')
    path = rest[slash:] if slash >= 0 else '/'
    path = re.split(r'[?#]', path, maxsplit=1)[0] or '/'
    return path + suffix


def strip_urls(text: str) -> str:
    """Every URL in `text` → its path alone, keeping a stack frame's `:line:col`.
    `https://edmat.net/_app/x.js?v=1#a:3:9` → `/_app/x.js:3:9`."""
    return _URL.sub(_path_only, text)


def clean_route(value: object) -> str:
    route = clean_text(value, MAX_ROUTE)
    if not route or not _ROUTE_OK.match(route):
        return UNKNOWN_ROUTE
    return '/'.join('[n]' if seg.isdigit() else seg for seg in route.split('/'))


def clean_build(value: object) -> str:
    build = clean_text(value, MAX_BUILD)
    return build if build and _BUILD_OK.match(build) else ''


def from_extension_only(stack: str) -> bool:
    """Every frame that names a URL is a browser extension's — not our bug, and not ours to keep."""
    frames = [line for line in stack.splitlines() if '://' in line]
    return bool(frames) and all('-extension://' in line for line in frames)


def sanitize(raw: object) -> dict | None:
    """The allowlisted report, or None when it is not one worth keeping."""
    if not isinstance(raw, dict):
        return None
    data = {key: raw.get(key) for key in ALLOWED_FIELDS}
    kind = data['kind'] if data['kind'] in KINDS else None
    message = strip_urls(clean_text(data['message'], MAX_MESSAGE * 2))[:MAX_MESSAGE]
    if kind is None or not message:
        return None
    raw_stack = clean_text(data['stack'], MAX_STACK * 2)
    if from_extension_only(raw_stack):
        return None
    stack = strip_urls(raw_stack)[:MAX_STACK]
    if message == 'Script error.' and not stack:
        return None
    return {
        'kind': kind,
        'message': message,
        'stack': stack,
        'route': clean_route(data['route']),
        'build': clean_build(data['build']),
        'locale': data['locale'] if data['locale'] in LOCALES else '',
    }


def normalise_message(message: str) -> str:
    return _DIGITS.sub('N', message)[:MAX_MESSAGE]


_FRAME = re.compile(r'^\s*at\s|@')


def top_frames(stack: str, count: int = 3, message: str = '') -> list[str]:
    """The first `count` stack FRAMES — V8's `at f (/_app/x.js:1:2)` or Firefox/Safari's
    `f@/_app/x.js:1:2` — with line/column and chunk hash removed. The stack's first line (V8 repeats
    the message there) is not a frame, even when the message names a path."""
    frames = []
    head = message.split(': ', 1)[-1][:40]
    for line in stack.splitlines():
        line = line.strip()
        if not line or '/' not in line or not _FRAME.search(line):
            continue
        if head and head in line and not line.startswith('at '):
            continue
        line = _CHUNK_HASH.sub(r'.\1', _LINE_COL.sub('', line.rstrip(')'))).removeprefix('at ')
        if line.count('(') > line.count(')'):
            line += ')'  # `f (/_app/x.js:1:2)` → `f (/_app/x.js)`, not `f (/_app/x.js`
        frames.append(line[:MAX_FRAME])
        if len(frames) == count:
            break
    return frames


def signature_of(report: dict) -> tuple[str, str]:
    frames = top_frames(report['stack'], message=report['message'])
    basis = '\n'.join([report['kind'], normalise_message(report['message']), *frames])
    return hashlib.sha256(basis.encode()).hexdigest()[:32], (frames[0] if frames else '')


def record(report: dict, user_agent: str) -> ClientErrorGroup:
    """Count one sanitised report and keep it as a sample if the day's cap allows. `user_agent` is
    classified and forgotten — nothing below receives it."""
    browser, os_family, device = classify.classify_user_agent((user_agent or '')[:512])
    now = timezone.now()
    today = now.astimezone(dt.timezone.utc).date()
    signature, frame = signature_of(report)

    group = ClientErrorGroup.objects.filter(signature=signature).first()
    if group is None:
        try:
            with transaction.atomic():
                group = ClientErrorGroup.objects.create(
                    signature=signature,
                    kind=report['kind'],
                    message=normalise_message(report['message']),
                    top_frame=frame,
                    first_seen=now,
                    last_seen=now,
                )
        except IntegrityError:
            group = ClientErrorGroup.objects.get(signature=signature)
    else:
        ClientErrorGroup.objects.filter(pk=group.pk).update(last_seen=now)

    key = {
        'date': today,
        'group': group,
        'route': report['route'],
        'build': report['build'],
        'browser': browser,
    }
    if not DailyClientError.objects.filter(**key).update(count=F('count') + 1):
        try:
            with transaction.atomic():
                DailyClientError.objects.create(**key, count=1)
        except IntegrityError:
            DailyClientError.objects.filter(**key).update(count=F('count') + 1)

    start = dt.datetime.combine(today, dt.time.min, tzinfo=dt.timezone.utc)
    if (
        ClientErrorReport.objects.filter(group=group, received_at__gte=start).count()
        < SAMPLES_PER_GROUP_PER_DAY
    ):
        ClientErrorReport.objects.create(
            group=group,
            received_at=now,
            browser=browser,
            os=os_family,
            device=device,
            **report,
        )
    return group


def purge_client_errors(now: dt.datetime | None = None) -> int:
    """Reports older than 30 days; daily counts older than 90; groups not seen for 90 days (their
    remaining rows go with them). Returns how many rows went."""
    now = now or timezone.now()
    report_cutoff = now - dt.timedelta(days=REPORT_RETENTION_DAYS)
    count_cutoff = now - dt.timedelta(days=COUNT_RETENTION_DAYS)
    deleted = ClientErrorReport.objects.filter(received_at__lt=report_cutoff).delete()[0]
    deleted += DailyClientError.objects.filter(
        date__lt=count_cutoff.astimezone(dt.timezone.utc).date()
    ).delete()[0]
    deleted += ClientErrorGroup.objects.filter(last_seen__lt=count_cutoff).delete()[0]
    return deleted
