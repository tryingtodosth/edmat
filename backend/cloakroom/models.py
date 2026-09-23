"""The cloakroom desk — a coat is an ANONYMOUS BEARER TOKEN, never a person.

`CONFERENCE-BRIEF.md` §3.F, from `CONFERENCE-RESEARCH-REPORT.md` §2.1 and its decision 5. The whole
design follows from one sentence: **an item is never linked to a person.** Whoever hands over the
paper slip gets the coat. That is how every real cloakroom in the world works, and it is also the
only shape that stores nothing about the people queueing at the desk — no name, no account, no
document number. A row here is a rack, a token and four timestamps.

What that buys, and what it costs:

- **Buys**: the desk is a five-second interaction with no lookup, it works with the Wi-Fi down as
  far as the till roll goes, and an event's cloakroom log is not personal data. There is no
  "who left what" table for anybody to leak, subpoena or forget to purge.
- **Costs**: a lost slip has no fallback *inside* the system, because there is nothing to match a
  person against. That is what `returned_by_exception` is: the clerk looks at the coat, the person
  describes it, the clerk writes down the description and **the KIND of identity they were shown**
  — `student_card`, `id_document`, `account` — and never the number on it. Recording a document
  number would put back exactly the personal data the token design exists to avoid, for a case
  that happens twice a night. The lost token is then blacklisted at that desk, so somebody who
  finds the slip in the corridor cannot claim a coat that has already gone home.

**No FK to a depositor.** `deposited_by` / `returned_by` / `exception_verified_by` are the *staff
member operating the desk* — an accountability trail for the desk, which is a different question
from who owns the coat, and the one the organiser actually needs when two racks disagree.

`status` is one field, never a pair of booleans (root `CLAUDE.md`, the lifecycle shape): `stored`
→ `returned` (the normal path), `returned_by_exception` (the lost-slip path) or `unclaimed` (what
reconciliation writes for everything still hanging when the desk closes).
"""

import secrets

from django.conf import settings
from django.db import models

#: The alphabet a token is drawn from. Deliberately NOT `secrets.token_urlsafe`, which the ticket
#: token (step D) uses: that one is scanned or copied, this one is **read off a paper slip by a
#: tired person and typed into a phone at midnight**. So: upper case only, and without the four
#: glyphs that a handwritten-looking print swaps for each other — `O`/`0`, `I`/`1`/`l`. 32 symbols
#: over 8 characters is 2**40 tokens, which is not a security boundary on its own (the real one is
#: that a token is only good at one desk, for one evening, for one coat) but makes a guess at a
#: busy desk hopeless.
TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
TOKEN_LENGTH = 8

#: How many times `new_token` retries before giving up. A desk holds a few hundred coats against
#: 31**8 tokens, so a collision is a lottery win; the loop is here because "unlikely" is not "never"
#: and the DB constraint would otherwise turn it into a 500 at the counter.
TOKEN_ATTEMPTS = 12

DESK_STATUS_CHOICES = [
    ('open', 'Open — taking coats'),
    ('closed', 'Closed — reconciled'),
]

ITEM_STATUS_CHOICES = [
    ('stored', 'On the rack'),
    ('returned', 'Handed back against the token'),
    ('returned_by_exception', 'Handed back without the token, identity shown'),
    ('unclaimed', 'Still on the rack when the desk closed'),
]

#: The KIND of identity a clerk was shown on the lost-token path — never the number on it, never a
#: scan of it. `none` is the default every ordinary item carries; an exception return refuses to be
#: recorded with it (`cloakroom/rules.py`). Mirrored in `frontend/src/lib/utils/labels.ts`
#: (house rule 13 — this comment and that file name each other).
IDENTITY_KIND_CHOICES = [
    ('none', 'No identity shown'),
    ('student_card', 'Student card'),
    ('id_document', 'Identity document'),
    ('account', 'Signed-in EdMat account'),
]

MAX_RACKS = 400


class CloakroomDesk(models.Model):
    """One counter at one event. An event may have two (north entrance, south entrance), each with
    its own racks and its own token space — which is why the token's uniqueness is *per desk*.

    `rack_labels` is a plain list of strings rather than a `Rack` model with rows, because a rack
    label is not a thing anybody queries, edits one of, or hangs anything else off: it is the
    printed number on a hook, the desk's whole layout is typed once when the desk opens, and the
    grid the clerk taps is exactly this list in order. A table would buy a join and an ordering
    column and nothing else. What is stored against a rack — the coat — is `CloakroomItem.rack_label`,
    a copy of the string, so a desk that renames its racks halfway through the evening does not
    rewrite history.
    """

    event = models.ForeignKey(
        'events.Event', related_name='cloakroom_desks', on_delete=models.CASCADE
    )
    name = models.CharField(max_length=120)
    rack_labels = models.JSONField(default=list, blank=True)
    opens_note = models.CharField(max_length=300, blank=True)

    # A lifecycle, not an `is_closed` boolean: closing is an act with a time and an author, and
    # "closed" is what `deposit_block_reason` reads. Reopening is deliberately not offered — the
    # reconciliation list is a statement about a moment.
    status = models.CharField(max_length=8, choices=DESK_STATUS_CHOICES, default='open')
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='cloakroom_desks_closed',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='cloakroom_desks_created',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']

    def __str__(self) -> str:
        return f'{self.name} — cloakroom of {self.event_id}'

    def racks(self) -> list[str]:
        """The labels, cleaned: strings, trimmed, deduplicated, order kept, capped. Read by the
        rule module and the serializer so that a hand-edited JSON field can never make the grid
        or a deposit misbehave."""
        seen, out = set(), []
        for raw in self.rack_labels or []:
            label = str(raw).strip()[:40]
            if label and label not in seen:
                seen.add(label)
                out.append(label)
        return out[:MAX_RACKS]

    def new_token(self) -> str:
        """A token nobody at this desk has held **in any status**, this evening.

        The database constraint below is narrower — unique among `stored` items — because that is
        the invariant the desk actually needs, and it lets a very small token space be reused
        across a long evening. The *generator* is stricter on purpose: a returned or blacklisted
        token that came back around would make `return_result` ambiguous (is this slip the one
        from 19:00 that already went home, or the new coat on rack 12?). Cheap to avoid, expensive
        to debug at a counter with a queue.
        """
        taken = set(self.items.values_list('token', flat=True))
        for _ in range(TOKEN_ATTEMPTS):
            token = ''.join(secrets.choice(TOKEN_ALPHABET) for _ in range(TOKEN_LENGTH))
            if token not in taken:
                return token
        raise RuntimeError('could not allocate a cloakroom token')


class CloakroomItem(models.Model):
    """A coat on a rack. **There is no FK to whoever owns it, and there never will be** — see the
    module docstring; that is the feature, not an omission."""

    desk = models.ForeignKey(CloakroomDesk, related_name='items', on_delete=models.CASCADE)
    rack_label = models.CharField(max_length=40)
    token = models.CharField(max_length=TOKEN_LENGTH)
    status = models.CharField(max_length=24, choices=ITEM_STATUS_CHOICES, default='stored')

    # What the clerk can see from the counter — "long green coat, red scarf". Free text, and the
    # ONLY description of the thing that exists anywhere. Optional on an ordinary deposit (the
    # token is the identifier), required for an exception return, where it is the whole basis of
    # the decision.
    description = models.CharField(max_length=200, blank=True)

    deposited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='cloakroom_items_taken',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    deposited_at = models.DateTimeField(auto_now_add=True)
    returned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='cloakroom_items_returned',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    returned_at = models.DateTimeField(null=True, blank=True)

    exception_note = models.CharField(max_length=300, blank=True)
    exception_identity_kind = models.CharField(
        max_length=16, choices=IDENTITY_KIND_CHOICES, default='none'
    )
    exception_verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='cloakroom_exceptions_verified',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    class Meta:
        ordering = ['-deposited_at', '-id']
        constraints = [
            # A PARTIAL unique, exactly the `ExerciseTranslation` shape the root CLAUDE.md names:
            # one live token per desk, while a desk that reuses a token after the coat has gone
            # home stays representable. A flat `unique_together` here would make the second
            # evening's rack 12 a 500 instead of a coat.
            models.UniqueConstraint(
                fields=['desk', 'token'],
                condition=models.Q(status='stored'),
                name='unique_stored_token_per_desk',
            ),
            # The same reasoning for the hook itself: one coat per rack at a time, any number of
            # coats on that rack over an evening.
            models.UniqueConstraint(
                fields=['desk', 'rack_label'],
                condition=models.Q(status='stored'),
                name='unique_stored_rack_per_desk',
            ),
        ]
        indexes = [models.Index(fields=['desk', 'token'])]

    def __str__(self) -> str:
        return f'{self.rack_label} ({self.status}) at desk {self.desk_id}'

    @property
    def is_blacklisted(self) -> bool:
        """A token whose coat left on the lost-slip path. The slip itself may still be in somebody's
        pocket, or on the floor of the corridor; it is worth nothing from the moment the exception
        return is recorded. Derived from the row rather than kept in a second blacklist table — the
        row IS the record of the decision (house rule 12)."""
        return self.status == 'returned_by_exception'
