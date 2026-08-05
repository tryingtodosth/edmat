"""Brute-force protection for the auth endpoints — the fourth gap the whole-project security scan
found, and the one with the shortest path from "missing" to "someone's account is compromised":
before this, `POST /api/auth/login/` accepted unlimited password guesses against any account, from
anywhere, at whatever rate the attacker's own bandwidth allowed.

**Two throttles on login, not one, because they stop genuinely different attacks.** DRF's own
`AnonRateThrottle` keys on client IP, which is the right key for "one host hammering the login
endpoint" — and completely useless against the attack that actually matters here, credential
stuffing, where a leaked username/password list is replayed against one account from a large pool of
distributed IPs, never tripping any single IP's own counter. `LoginUsernameRateThrottle` closes that
by keying on the submitted identifier instead, so an account is protected no matter how many hosts
the guessing is spread across. Neither throttle subsumes the other, so both are applied.

**The honest limitation, stated rather than papered over:** an identifier-keyed throttle is itself a
denial-of-service lever — someone who knows a victim's email can deliberately burn that account's
own budget and lock the real owner out for the window. That's why the per-username rate below is
deliberately much looser than the per-IP one: it's sized to stop a systematic password search
(thousands of attempts), not to make a handful of genuine typos expensive. The real fix for this
tension is a lockout that only counts FAILED attempts and clears on success, which DRF's own
throttle framework has no notion of — it counts requests, not outcomes. Named here as a real
follow-up rather than left as an unstated weakness.

**Both depend on Django's cache, which is a real deployment consideration.** `config/settings.py`
configures no `CACHES` at all, so Django's default `LocMemCache` applies — per-process, meaning a
multi-worker deployment gives each worker its own independent counter and the effective rate is
multiplied by the worker count. Fine for this prototype's single-process dev server; a real
deployment wants a shared cache (Redis/Memcached) for these limits to mean what they say. Flagged
in `config/settings.py` alongside the rates themselves, too.
"""

from __future__ import annotations

import hashlib

from rest_framework.throttling import SimpleRateThrottle


class LoginRateThrottle(SimpleRateThrottle):
    """Per-IP. Deliberately its own scope rather than reusing the global `anon` budget — an ordinary
    anonymous visitor browsing exercises should never share a counter with password attempts, in
    either direction (browsing shouldn't consume login budget, and login attempts shouldn't be
    hidden inside a much larger browsing allowance)."""

    scope = 'login'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class LoginUsernameRateThrottle(SimpleRateThrottle):
    """Per-identifier, IP-independent — the credential-stuffing case above.

    The identifier is normalized (trimmed, lowercased) so that `Kasia@Example.com ` and
    `kasia@example.com` share one budget rather than each getting a fresh one, which would make the
    whole throttle trivially bypassable by varying capitalization. It is then hashed, so what lands
    in the cache (and therefore, in a real deployment, in a shared Redis any operator can read) is an
    opaque digest rather than a plaintext list of every email address anyone has tried to log in as.
    """

    scope = 'login_username'

    def get_cache_key(self, request, view):
        identifier = (request.data.get('username') or '').strip().lower()
        if not identifier:
            # Nothing to key on — a malformed request with no identifier at all. Returning `None`
            # tells DRF to skip this throttle entirely; the per-IP one above still applies, so this
            # is not an exemption an attacker can steer into.
            return None
        digest = hashlib.sha256(identifier.encode('utf-8')).hexdigest()
        return self.cache_format % {'scope': self.scope, 'ident': digest}
