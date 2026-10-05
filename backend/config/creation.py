"""The creation gate — may this account FOUND something here? (prompts/07-creation-gate.md, learning
step F; prompts/00-DESIGN.md §2 "creation → verification").

Four create paths ask this one question — a course (`courses`), an event (`events`), a tutoring
listing (`services`) and an organisation (`organizations`) — and the Header's Add… menu asks it
from the other side (`GET /api/creation/`), so that a refused account never sees the button it
would be refused at (house rule 3). The rule lives here and nowhere else (CLAUDE.md boundary 2):
an endpoint that re-implements it is how two surfaces start disagreeing.

The STUB below is what the prep commit ships: it refuses nobody, so the four call sites it is
wired into change nothing until step F replaces the body. Step F owns this file, its tests
(`config/test_creation.py`) and the frontend line that shows the reason; nobody else edits it.

Shape fixed in advance (the call sites and the frontend are written against it):

    creation_block_reason(user, kind) -> str | None
        kind ∈ CREATION_KINDS. None means "go ahead". Otherwise one word, the same vocabulary the
        other refusal modules use (house rule 6): `anonymous`, `minor`, `verification_required`.
        Staff always pass. The `creation_requires_verification` flag (INVERTED: on = the
        restriction is on) is read with `is_feature_enabled`, like `age_verification`, because it
        removes a RULE from an endpoint everybody must still reach, not a whole surface.
"""

CREATION_KINDS = ('course', 'event', 'service', 'organization')


def creation_block_reason(user, kind: str) -> str | None:
    """Stub: refuses nobody. Step F writes the real body (see the module docstring)."""
    assert kind in CREATION_KINDS, kind
    return None


def creation_status(user) -> dict:
    """What the Add… menu asks: `{kind: reason-or-None}` for every kind, in one request."""
    return {kind: creation_block_reason(user, kind) for kind in CREATION_KINDS}
