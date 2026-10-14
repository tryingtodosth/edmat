"""Which version of the terms of use a person accepted, and when — the one place that answers it.

Two writers need this from day one: ordinary registration (`accounts.RegisterSerializer`) and the
"sign in with Google / Apple / Microsoft" signup (`sso/`), and house rule 2 of `CLAUDE.md` says a
rule more than one endpoint needs lives in one module. Both call `record_acceptance`.

**A row per acceptance, never a field overwritten** (house rule 12): when the terms change and a
person accepts the new version, the old row stays. "Which terms did this account agree to on the
day it posted that?" is a question a moderation appeal or a DSA complaint can actually ask.

`CURRENT_TERMS_VERSION` must equal `TERMS_VERSION` in `frontend/src/lib/content/terms.ts` — the
date the substance last changed, not the date of a typo fix. Say so in both files when you bump it.
"""

from __future__ import annotations

CURRENT_TERMS_VERSION = '2026-10-15'


def record_acceptance(user, *, version: str = CURRENT_TERMS_VERSION, via: str = 'register'):
    """One `TermsAcceptance` row. `via` says which door the person came in through:
    'register', 'sso:google', 'sso:apple', 'sso:microsoft', 'reaccept'."""
    from .models import TermsAcceptance

    return TermsAcceptance.objects.create(user=user, version=version, via=via[:30])


def has_accepted_current(user) -> bool:
    from .models import TermsAcceptance

    return TermsAcceptance.objects.filter(user=user, version=CURRENT_TERMS_VERSION).exists()
