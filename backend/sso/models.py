"""Sign in with Google / Apple / Microsoft — four tables, and only one of them lives longer than half
an hour. See `sso/CLAUDE.md` for the flow; this file says what each row is FOR.

- `SsoIdentity` — "this provider's account `subject` is this EdMat account". The only long-lived
  row. No access or refresh token is ever stored: the flow reads the signed id_token once, at the
  callback, and keeps nothing that could act on the person's behalf at the provider.
- `SsoAttempt` — one press of a provider button: the `state`, PKCE verifier and `nonce` the
  callback must match. Ten minutes, single use.
- `SsoLoginCode` — what the callback hands the browser instead of a token (a token never goes in a
  URL). Two minutes, single use, and only redeemable by the tab that started the attempt.
- `SsoSignupTicket` — an identity nobody here has seen, waiting for its person to pick a username,
  answer the age question and accept the terms. Thirty minutes, single use.

**A lifecycle is one `status` field** (house rule "a lifecycle is one status field"): `pending` →
`used`. Expiry is a timestamp compared in the claiming `update()`'s WHERE clause, never a status
somebody has to remember to write. The three short-lived tables are emptied by
`manage.py sso_purge`.

**Bearer secrets are stored hashed** (`code_hash`, `ticket_hash`, `browser_key_hash`): a copy of
the database file is not a way to sign in as somebody for the two minutes a code lives. `state`
is stored as sent — it is a correlation id, worthless without the provider's own code, and it
already travels through two URLs.
"""

from django.conf import settings
from django.db import models

STATUS_PENDING = 'pending'
STATUS_USED = 'used'
STATUS_CHOICES = [(STATUS_PENDING, 'Pending'), (STATUS_USED, 'Used')]

INTENT_LOGIN = 'login'
INTENT_LINK = 'link'
INTENT_CHOICES = [(INTENT_LOGIN, 'Sign in or sign up'), (INTENT_LINK, 'Link to the signed-in account')]


class SsoIdentity(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sso_identities')
    provider = models.CharField(max_length=20)
    # The identity key is (provider, issuer, subject) — never the email (ANALYTICS-LAW.md §7.2).
    # `issuer` matters for Microsoft: in a multi-tenant app the `iss` names the person's tenant and
    # `sub` is pairwise per application, so (iss, sub) is the documented stable pair. For Google and
    # Apple it is constant (Google's two spellings are normalised to one — providers.py).
    issuer = models.CharField(max_length=255)
    # The provider's stable id for the person (`sub`). Never the email: an address can be
    # reassigned, a `sub` cannot.
    subject = models.CharField(max_length=255)
    # Microsoft only: the tenant (`tid`) and the object id (`oid`, stable across apps within one
    # tenant). Kept so a later move between app registrations can re-key without asking everybody to
    # link again; blank for every other provider.
    tenant_id = models.CharField(max_length=64, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    # What the provider said the address was on the day the identity was linked, and whether it
    # vouched for it. Shown in Settings so a person can tell two Google accounts apart; never used
    # to find an account (that is what `subject` is for).
    email = models.CharField(max_length=320, blank=True)
    email_verified = models.BooleanField(default=False)
    linked_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['provider', 'linked_at']
        constraints = [
            models.UniqueConstraint(fields=['provider', 'issuer', 'subject'], name='sso_identity_provider_issuer_subject_unique'),
        ]

    def __str__(self) -> str:
        return f'{self.provider}:{self.issuer}:{self.subject} -> user {self.user_id}'


class SsoAttempt(models.Model):
    state = models.CharField(max_length=64, unique=True)
    provider = models.CharField(max_length=20)
    intent = models.CharField(max_length=10, choices=INTENT_CHOICES, default=INTENT_LOGIN)
    # Only for `intent='link'`: the account the identity will be attached to. Fixed when the
    # button is pressed, so whoever finishes the round trip cannot choose a different account.
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name='+')
    code_verifier = models.CharField(max_length=128, blank=True)
    nonce = models.CharField(max_length=64)
    # Exactly the redirect_uri sent to the provider — the token request must repeat it byte for byte.
    redirect_uri = models.CharField(max_length=500)
    # A same-origin path (validated at start) to land on afterwards.
    next_path = models.CharField(max_length=500, blank=True)
    # SHA-256 of the key the starting tab keeps in sessionStorage. The code or ticket this attempt
    # produces is redeemable only alongside that key — the login-CSRF defence (sso/CLAUDE.md).
    browser_key_hash = models.CharField(max_length=64)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return f'{self.provider} {self.intent} attempt [{self.status}]'


class SsoLoginCode(models.Model):
    KIND_LOGIN = 'login'
    KIND_LINK = 'link'
    KIND_CHOICES = [(KIND_LOGIN, 'Sign in'), (KIND_LINK, 'Link')]

    code_hash = models.CharField(max_length=64, unique=True)
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')
    provider = models.CharField(max_length=20)
    # For `kind='link'` the identity to attach on redemption; for a login, the identity used.
    issuer = models.CharField(max_length=255)
    subject = models.CharField(max_length=255)
    tenant_id = models.CharField(max_length=64, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    email = models.CharField(max_length=320, blank=True)
    email_verified = models.BooleanField(default=False)
    next_path = models.CharField(max_length=500, blank=True)
    browser_key_hash = models.CharField(max_length=64)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    def __str__(self) -> str:
        return f'{self.provider} {self.kind} code for user {self.user_id} [{self.status}]'


class SsoSignupTicket(models.Model):
    ticket_hash = models.CharField(max_length=64, unique=True)
    provider = models.CharField(max_length=20)
    issuer = models.CharField(max_length=255)
    subject = models.CharField(max_length=255)
    tenant_id = models.CharField(max_length=64, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    email = models.CharField(max_length=320)
    email_verified = models.BooleanField(default=False)
    # A suggestion for the display name, from the provider's `name` (Apple: from the one-time
    # `user` form field). The person sees it and can change it; it is stored only if they keep it.
    suggested_name = models.CharField(max_length=100, blank=True)
    next_path = models.CharField(max_length=500, blank=True)
    browser_key_hash = models.CharField(max_length=64)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    def __str__(self) -> str:
        return f'{self.provider} signup ticket [{self.status}]'


class SsoLinkTicket(models.Model):
    """An unknown provider identity whose address an EdMat account already uses, waiting for the
    person to PROVE that account is theirs (its password, or a link mailed to its confirmed
    address) before the identity is attached. `LINKING-AND-ERRORS.md` §2.4: never a silent link —
    the email match only PROPOSES; the proof decides. Thirty minutes, single use.

    The target account is fixed by the callback (whoever finishes cannot choose another), and the
    ticket is bound to the starting tab's browser key like every other SSO secret — so a mailed link
    clicked by the mailbox owner in some OTHER browser links nothing (the attack: somebody signs in
    with a provider identity carrying your address and hopes you click the confirmation)."""

    ticket_hash = models.CharField(max_length=64, unique=True)
    browser_key_hash = models.CharField(max_length=64)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')
    provider = models.CharField(max_length=20)
    issuer = models.CharField(max_length=255)
    subject = models.CharField(max_length=255)
    tenant_id = models.CharField(max_length=64, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    # What the provider said — kept for the identity row, never used to find the account again.
    email = models.CharField(max_length=320, blank=True)
    email_verified = models.BooleanField(default=False)
    next_path = models.CharField(max_length=500, blank=True)
    # Wrong passwords against THIS ticket; at MAX the ticket is dead (on top of the login throttle).
    password_failures = models.PositiveSmallIntegerField(default=0)
    # Set when "email me a link" is pressed; a fresh one per press, so only the newest link works.
    # Not a secret on its own: the mailed token is it, SIGNED with the server's key (sso/services.py).
    mail_nonce = models.CharField(max_length=32, blank=True)
    mail_requested_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(db_index=True)

    def __str__(self) -> str:
        return f'{self.provider} link ticket for user {self.user_id} [{self.status}]'
