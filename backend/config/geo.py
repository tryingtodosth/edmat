"""Which country an address is in — when, and only when, a database is installed to say so.

This exists for exactly one question: what interface language should a visitor who has never
chosen one see on their very first paint. The owner's rule is "Polish, unless they are outside
Poland". That rule needs a country, and a country needs either a third-party lookup service (which
would hand a visitor's IP to somebody else — see LEGAL.md §5, whose claim is that exactly two
external services are contacted in ordinary use) or a local database.

So it is a local database, and an OPTIONAL one. House rule 10: flag it, don't fake it. With no
database configured this module answers `None` — "I do not know" — and never a guess. It is the
caller's job to decide what "I do not know" means; `config/views.py` decides it means Polish,
because that is the honest default for this corpus and this audience rather than a deduction.

**Nothing here is stored and nothing here is logged.** A country derived from an IP is personal
data under the GDPR, and the only place an address is written down on this platform remains
`telemetry.RequestLog` (which already keeps the IP itself, and is bounded by that app's own
retention rules). This module reads an address that is already in memory for the request being
served, answers a two-letter code to the person it is about, and forgets it.

Setup, for a deployment that wants it:

    pip install geoip2                      # deliberately NOT in requirements.txt
    # download GeoLite2-Country.mmdb from MaxMind (CC BY-SA 4.0, free account)
    export EDMAT_GEOIP_DB=/srv/edmat/GeoLite2-Country.mmdb

Both halves are optional and independent: the package missing, the setting unset, the file gone or
the file corrupt all produce the same `None`, because a bare clone must never require any of it
(the same rule `EDMAT_REDIS_URL` and the ClamAV daemon already follow).
"""

import logging
import threading

from django.conf import settings

logger = logging.getLogger(__name__)

# One reader per process, opened lazily. `geoip2.database.Reader` memory-maps the file, so the
# open is cheap but not free, and it is documented as thread-safe for reads — the lock only
# guards the one-time construction. `_state` holds the reader or the sentinel below; `None` on
# its own would be indistinguishable from "not tried yet", which is how a missing database would
# get re-probed on every single request.
_UNAVAILABLE = object()
_state = None
_lock = threading.Lock()


def _reader():
    """The opened database, or `None` if there isn't one. Tries exactly once per process."""
    global _state
    if _state is not None:
        return None if _state is _UNAVAILABLE else _state
    with _lock:
        if _state is not None:
            return None if _state is _UNAVAILABLE else _state
        path = getattr(settings, 'EDMAT_GEOIP_DB', '')
        if not path:
            _state = _UNAVAILABLE
            return None
        try:
            import geoip2.database  # noqa: PLC0415 — optional extra, imported only if configured

            _state = geoip2.database.Reader(path)
        except Exception:  # noqa: BLE001 — package absent, file absent, file not a MaxMind DB
            # Reported once (this runs once per process), never per request: a misconfigured path
            # should be visible to whoever deployed it, not a line per visitor in the error log.
            logger.warning('EDMAT_GEOIP_DB is set but unusable (%s) — country lookup disabled', path)
            _state = _UNAVAILABLE
            return None
    return _state


def country_for_ip(ip: str | None) -> str | None:
    """The ISO 3166-1 alpha-2 code for `ip`, or `None` when it cannot be known.

    `None` covers every uncertainty there is, deliberately, because the caller's decision is the
    same for all of them: no database, no address, a private or loopback address (every local run
    and every test), an address the database has no row for, and a malformed one.
    """
    if not ip:
        return None
    reader = _reader()
    if reader is None:
        return None
    try:
        code = reader.country(ip).country.iso_code
    except Exception:  # noqa: BLE001 — AddressNotFoundError, ValueError on a malformed address
        return None
    return code or None
