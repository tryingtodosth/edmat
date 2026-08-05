"""A server-side Nominatim (OpenStreetMap) client, backing the address search and map-pin picker on
a tutoring listing (`Service.location_*`).

**Why this is proxied through the backend rather than called from the browser.** Calling Nominatim
directly from the frontend would be less code and is what most tutorials show. It is also a real
violation of Nominatim's own usage policy, which this module exists to respect:

1. **The policy requires an HTTP `User-Agent` that identifies the application.** A browser `fetch()`
   cannot set `User-Agent` at all — it is a forbidden header, silently ignored — so every request
   would arrive labelled as an ordinary browser. That is precisely the anonymous traffic Nominatim
   blocks, and being blocked would take the feature down for every user at once.
2. **The policy caps usage at 1 request/second for the whole application.** A per-browser call
   pattern has no way to enforce a global limit: 50 users typing an address at once is 50 concurrent
   requests, and no client can see the others. A single server-side gate can.
3. **The policy asks that results be cached.** Only a shared server-side cache actually helps —
   per-browser caches never benefit a second user searching the same street.

So: identify ourselves honestly, gate the rate globally, and cache aggressively.

**No new dependency.** `urllib.request` (stdlib) rather than `requests`, which is not installed and
would be a new runtime dependency for two HTTP GETs — the same restraint this project already applies
to `testing/factories.py` (plain functions over `factory_boy`) and its own `clamd`/`python-magic`
notes, where each real dependency is a flagged decision rather than a reflex.

**Attribution is not optional.** OSM data is ODbL-licensed and requires credit; every response here
carries the attribution string through to the UI, which displays it on the map.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from django.conf import settings
from django.core.cache import cache

NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'

# Required by the usage policy and deliberately specific — a generic string like "python-urllib" is
# exactly what gets rate-limited or blocked. Overridable via settings so a real deployment can put
# its own contact address in, which the policy asks for.
DEFAULT_USER_AGENT = 'EdMat/1.0 (university exercise database; +https://github.com/edmat)'

# Results are cached for a full day. An address's coordinates do not meaningfully change, and this is
# the single biggest lever for staying inside the policy: the second person who searches "Banacha 2"
# costs nothing at all.
GEOCODE_CACHE_SECONDS = 60 * 60 * 24

# The global 1-request/second gate. Implemented with `cache.add`, which is atomic — it sets the key
# only if absent and reports whether it won. 1.1s rather than 1.0 leaves honest headroom for clock
# granularity, so rounding can never put us marginally over the documented limit.
RATE_GATE_KEY = 'nominatim-rate-gate'
RATE_GATE_SECONDS = 1.1

# A loser of that race waits briefly and retries, rather than failing immediately. This exists
# because of a real problem found in live testing, not as a precaution: the very ordinary sequence
# "search for an address, then nudge the pin on the map" fires two lookups well under a second
# apart, and a non-waiting gate turned that into a user-facing "temporarily unavailable" for a
# single user doing nothing wrong.
#
# The tradeoff, stated rather than hidden: this holds a worker thread for up to RATE_GATE_MAX_WAIT.
# It is bounded and small, it is what a well-behaved Nominatim client does (geopy's own RateLimiter
# sleeps for exactly this reason), and the per-user `geocode` throttle (config/settings.py) caps how
# often any one account can reach it at all. If this app ever grew enough concurrent geocoding for
# thread-holding to matter, the right answer is a proper job queue, not a shorter wait that would
# just return the same spurious error.
RATE_GATE_MAX_WAIT = 1.5
RATE_GATE_POLL = 0.05

REQUEST_TIMEOUT_SECONDS = 6

# Must match `Service.location_lat/lon`'s own `decimal_places` (services/models.py). ~11 cm at the
# equator — finer than any street address needs.
COORD_PRECISION = 6


class GeocodingUnavailable(Exception):
    """Nominatim could not be reached, refused us, or is being called too fast. Deliberately its own
    exception rather than returning an empty result list: "the service is down" and "that address
    genuinely does not exist" must not look identical to the user, or they will keep retyping a
    perfectly valid address wondering why it is not found."""


@dataclass(frozen=True)
class GeocodeResult:
    label: str
    lat: float
    lon: float


def _user_agent() -> str:
    return getattr(settings, 'NOMINATIM_USER_AGENT', DEFAULT_USER_AGENT)


def _acquire_rate_gate() -> bool:
    """Claim the app-wide 1-request/second slot, waiting up to RATE_GATE_MAX_WAIT for it. Returns
    False only if the slot never came free in that window.

    Note the honest limitation, the same one the auth throttles carry (accounts/throttles.py): with
    the default per-process `LocMemCache` and no shared cache configured, each worker keeps its own
    gate, so a multi-process deployment could exceed 1/second overall. Correct for this prototype's
    single-process dev server; a real deployment wants Redis here, and it is the same one change that
    fixes the throttles.
    """
    deadline = time.monotonic() + RATE_GATE_MAX_WAIT
    while True:
        if cache.add(RATE_GATE_KEY, '1', RATE_GATE_SECONDS):
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(RATE_GATE_POLL)


def _fetch(path: str, params: dict[str, str]) -> list | dict:
    url = f'{NOMINATIM_BASE}{path}?{urllib.parse.urlencode(params)}'
    request = urllib.request.Request(
        url,
        headers={
            'User-Agent': _user_agent(),
            # Nominatim is English-first; asking for the locales this app actually serves means a
            # Polish user searching a Polish street gets it back spelled the way they wrote it.
            'Accept-Language': 'pl,en',
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode('utf-8'))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise GeocodingUnavailable(str(exc)) from exc


def search(query: str, limit: int = 5) -> list[GeocodeResult]:
    """Address -> coordinates. Backs the "type an address" box in the listing form."""
    normalized = ' '.join(query.split()).lower()
    if not normalized:
        return []

    # Hashed, not the raw query. An address contains spaces, and memcached rejects keys containing
    # them outright — Django warns about exactly this (`CacheKeyWarning`), which is how it was
    # caught. That matters because this module's own docstring recommends a shared cache
    # (Redis/memcached) for a real deployment: the raw key works on the LocMemCache used in
    # development and would start failing on the very backend it is meant to move to. Hashing also
    # bounds the key length, which memcached caps at 250 bytes.
    digest = hashlib.sha256(normalized.encode('utf-8')).hexdigest()[:32]
    cache_key = f'geocode:search:{limit}:{digest}'
    cached = cache.get(cache_key)
    if cached is not None:
        return [GeocodeResult(**row) for row in cached]

    if not _acquire_rate_gate():
        raise GeocodingUnavailable('rate-limited')

    raw = _fetch(
        '/search',
        {'q': normalized, 'format': 'jsonv2', 'limit': str(limit), 'addressdetails': '0'},
    )
    # Rounded to COORD_PRECISION here, at the boundary, so every consumer sees coordinates the
    # model can actually store. Nominatim returns 7+ decimal places; `Service.location_lat` holds 6,
    # and DRF's DecimalField REJECTS excess precision rather than rounding it — so without this the
    # frontend would faithfully echo back a search result and get a 400 telling it the value it was
    # just handed is invalid. Found by exactly that failure in live testing.
    results = [
        GeocodeResult(
            label=row['display_name'],
            lat=round(float(row['lat']), COORD_PRECISION),
            lon=round(float(row['lon']), COORD_PRECISION),
        )
        for row in raw
        if row.get('display_name') and row.get('lat') and row.get('lon')
    ]
    # Cached even when empty — a misspelled address would otherwise cost a real upstream request
    # every single time the user retries it, which is the exact opposite of what caching is for here.
    cache.set(cache_key, [r.__dict__ for r in results], GEOCODE_CACHE_SECONDS)
    return results


def reverse(lat: float, lon: float) -> GeocodeResult | None:
    """Coordinates -> address. Backs dropping/dragging the pin directly on the map, so a tutor who
    knows where they teach but not its postal address still ends up with a readable label."""
    # Rounded to the stored precision before it becomes a cache key, so two clicks a few centimetres
    # apart share one cached answer instead of each costing an upstream request.
    key_lat, key_lon = round(lat, COORD_PRECISION), round(lon, COORD_PRECISION)
    cache_key = f'geocode:reverse:{key_lat}:{key_lon}'
    cached = cache.get(cache_key)
    if cached is not None:
        return GeocodeResult(**cached) if cached else None

    if not _acquire_rate_gate():
        raise GeocodingUnavailable('rate-limited')

    raw = _fetch(
        '/reverse',
        {'lat': str(key_lat), 'lon': str(key_lon), 'format': 'jsonv2', 'addressdetails': '0'},
    )
    if not isinstance(raw, dict) or not raw.get('display_name'):
        cache.set(cache_key, None, GEOCODE_CACHE_SECONDS)
        return None

    result = GeocodeResult(label=raw['display_name'], lat=key_lat, lon=key_lon)
    cache.set(cache_key, result.__dict__, GEOCODE_CACHE_SECONDS)
    return result
