"""The creation gate — may this account FOUND something here? (prompts/07-creation-gate.md, learning
step F; prompts/00-DESIGN.md §2 "creation → verification").

Four create paths ask this one question — a course (`courses`), an event (`events`), a tutoring
listing (`services`) and an organisation (`organizations`) — and the Header's Add… menu asks it
from the other side (`GET /api/creation/`), so that a refused account never sees the button it
would be refused at (house rule 3). The rule lives here and nowhere else (CLAUDE.md boundary 2):
an endpoint that re-implements it is how two surfaces start disagreeing.

Shape fixed in advance (the call sites and the frontend are written against it):

    creation_block_reason(user, kind) -> str | None
        kind ∈ CREATION_KINDS. None means "go ahead". Otherwise one word, the same vocabulary the
        other refusal modules use (house rule 6): `anonymous`, `minor`, `verification_required`.
        Staff always pass. The `creation_requires_verification` flag (INVERTED: on = the
        restriction is on) is read with `is_feature_enabled`, like `age_verification`, because it
        removes a RULE from an endpoint everybody must still reach, not a whole surface.

## Why the gate exists at all

Until the USOS connection lands (`LAUNCHCHECKLIST.md` §3a — an OAuth 1.0a client and a consumer
key from the university, neither of which engineering can unblock alone), this site has no way to
tell a real person from a fresh account. Reading, joining, enrolling, attending and booking are
all reversible and already moderated. **Founding** is not: a course, an event, a tutoring listing
and an organisation each put a name in front of strangers, carry a roster, and invite other people
to turn up somewhere. So those four are restricted to staff and verified contributors, by owner
decision (00-DESIGN.md §4.6), and the restriction is a `FeatureFlag` row rather than a deploy —
a moderator flips `creation_requires_verification` off the day USOS makes it unnecessary.

**Nothing already created is touched**, and no read, join, enrolment, attendance or booking is
touched. This module is asked on `create` only. That boundary is the whole reason the gate can be
this blunt: it costs a refused account nothing but the founding act itself.

## The order of the four answers, and why it is this order

1. **`anonymous`** first, because "sign in" is the only useful thing to say to somebody with no
   account, and because every other answer below needs a profile to read. In practice the four
   create endpoints are `IsAuthenticatedOrReadOnly`, so an anonymous POST is a 401 before this
   module is reached at all; the word exists for `GET /api/creation/`, which is `AllowAny` so that
   a signed-out header can draw the same menu as a signed-in one, and as the honest answer if a
   future create path ever is reachable anonymously.
2. **Staff pass**, matching `feature_gate`'s own `is_staff` bypass and
   `coauthoring._require_verified_contributor_for_uploads`: a moderator must be able to found
   something in order to see what the restriction does to everybody else before flipping it.
3. **`minor`**, because it is the older and narrower rule and it does not answer to this flag at
   all — an under-16 is refused whether the gate is on or off (`accounts/minors.py`: GDPR Art. 8
   as transposed in Poland). The per-app minors refusals stay exactly where they are; this one
   sits behind them and answers the same word, so which of the two fires is unobservable.
   **It does widen one thing, deliberately and named**: `courses` had no minors check before, so
   founding a course is now closed to an under-16 like hosting an event and listing tutoring
   already were. See HISTORY.md §17BR.F — it is a product decision, not a side effect nobody
   noticed, and the one line to delete if the owner wants it back.
4. **`verification_required`** last, because it is the only one of the four that a moderator can
   turn off, and the only one that will go away on its own when USOS lands.

## Why `is_feature_enabled` and not `feature_gate`

`feature_gate` is a DRF permission class: it answers 403 for a whole surface. This flag removes a
RULE from four endpoints that must keep working either way — exactly the shape `age_verification`
has on registration (`accounts/CLAUDE.md`), and exactly the shape
`material_uploads_verified_only` has on a material version (`coauthoring/services.py`). It also
means the flag is read in ONE place rather than once per view.

`is_feature_enabled` **fails OPEN**: a missing row reads as `True`. For every ordinary kill switch
that means "the feature is up"; for an inverted one it means "the restriction is on", which is the
safe direction for an anti-abuse gate and is the same reversal `material_uploads_verified_only`
documents. `moderation` migration 0047 seeds the row ON, so the failure case is theoretical.

## `is_verified_contributor` is the only signal

`Profile.is_verified_contributor` is staff-set and never client-writable
(`accounts/serializers.py` keeps it out of `ProfileUpdateSerializer`; `accounts/admin.py` is where
it is granted). `identity/standing.py: ceiling_for` is a different axis — a *ceiling* on
capability, computed from what somebody has connected, and explicitly "never authority"
(`LAUNCHCHECKLIST.md` §3). Reading it here would make a gate out of something that was built not
to be one, so this module does not import it.
"""

#: House rule 13 — this module is MIRRORED on the frontend, and both halves say so.
#: `frontend/src/lib/types/creation.ts` carries `CREATION_KINDS` and the three words as types;
#: `frontend/src/lib/utils/labels.ts` carries one sentence per word and one per kind. A fifth kind
#: or a fourth word is a change in all three files, and a reader of any one of them is told that.
# `contest` (2026-10-09, CONTESTS-BRIEF.md): founding a contest promises a prize to strangers under
# KC art. 919–921, which is the most consequential founding act on the site — so it is the fifth
# kind, gated the same way, and `contests/views.py: ContestViewSet.create` asks it (step A).
CREATION_KINDS = ('course', 'event', 'service', 'organization', 'contest')

#: The flag that governs the third refusal. INVERTED: `is_enabled=True` means the RESTRICTION is
#: on. Seeded ON by `moderation` migration 0047; the day USOS lands a moderator turns it off and
#: this module stops refusing anybody who is not a minor.
FLAG_KEY = 'creation_requires_verification'


def creation_block_reason(user, kind: str) -> str | None:
    """Why this account may not found a `kind` here — or `None`.

    `anonymous` · `minor` · `verification_required`. One word, never a boolean (house rule 6): the
    frontend has a different sentence for each, and "you have to be 16" and "ask a moderator to
    verify you" are the same refusal to a boolean and completely different to a person.

    `kind` is asserted rather than validated because every caller is in this repository and passes
    a literal — a typo is a programming error, not a request to refuse.

    The imports are function-local, the way `organizations/access.py: found_block_reason` and
    `moderation/services.is_feature_enabled` already do it: this module is imported at the top of
    four views and of `config/views.py`, and pulling `moderation.models` in at import time from
    `config/` is how an app-registry import cycle starts.
    """
    assert kind in CREATION_KINDS, kind

    if not (user and getattr(user, 'is_authenticated', False)):
        return 'anonymous'

    if getattr(user, 'is_staff', False):
        return None

    from accounts.minors import is_minor

    if is_minor(user):
        return 'minor'

    from moderation.services import is_feature_enabled

    if not is_feature_enabled(FLAG_KEY):
        return None

    profile = getattr(user, 'profile', None)
    if profile is not None and profile.is_verified_contributor:
        return None
    return 'verification_required'


def creation_status(user) -> dict:
    """What the Add… menu asks: `{kind: reason-or-None}` for every kind, in one request.

    Deliberately four calls to `creation_block_reason` rather than one answer fanned out over four
    keys, even though today's rule is kind-independent and this therefore reads the same flag row
    four times. The flag read is one indexed lookup on a 32-row table and the Header asks this once
    per signed-in session; the cost of the alternative is that the first per-kind rule (a brief's
    own "Left open" names per-kind flags) would be correct at the four create paths and silently
    wrong in the menu — which is precisely the disagreement this module exists to prevent.
    """
    return {kind: creation_block_reason(user, kind) for kind in CREATION_KINDS}
