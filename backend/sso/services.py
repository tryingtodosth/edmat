"""The flow, start to finish. Views translate HTTP to these calls and back; nothing else in the
project creates an `SsoIdentity`, mints a code or a ticket, or decides what a callback means.

    start()            button pressed → SsoAttempt → the provider's authorization URL
    finish_callback()  provider redirects back → verified identity → a frontend URL to redirect to:
                         known identity          → /auth/sso/done?code=…    (sign in)
                         intent=link             → /auth/sso/done?code=…    (attach on redemption)
                         unknown, email in use   → /auth/sso/link?ticket=…  (prove the account:
                                                   its password, or a link to its confirmed
                                                   address; a child's account → error=minor)
                         unknown, new email      → /auth/sso/complete?ticket=…
                         anything wrong          → /auth/sso/done?error=<code>
    redeem_code()      the done page's POST → {token, profile} or the linked identity
    complete_signup()  the complete page's POST → a new account
    unlink()           Settings → Sign-in methods → Unlink

**Every single-use row is claimed by ONE WHERE-anchored `update()`** — status, expiry and (for a
code or ticket) the browser key all in the WHERE — so two racing requests cannot both win
(`backend/CLAUDE.md`, SQLite rule 1).

**The browser key** is the login-CSRF defence. The tab that pressed the button keeps a random key
in sessionStorage; the attempt stores its hash; the code or ticket the callback produces inherits
that hash, and is redeemable only with the key. A callback URL forwarded to somebody else — the
classic way to sign a victim into the attacker's account, or to attach the victim's Google account
to the attacker's EdMat account — lands in a tab that does not hold the key, and the code is dead.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
import urllib.parse
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from . import http
from .models import (
    INTENT_LINK,
    INTENT_LOGIN,
    STATUS_PENDING,
    STATUS_USED,
    SsoAttempt,
    SsoIdentity,
    SsoLinkTicket,
    SsoLoginCode,
    SsoSignupTicket,
)
from .providers import Provider
from .tokens import TokenRejected, verify_id_token

log = logging.getLogger(__name__)
User = get_user_model()

ATTEMPT_TTL = timedelta(minutes=10)
CODE_TTL = timedelta(minutes=2)
TICKET_TTL = timedelta(minutes=30)

# Every word a redirect to /auth/sso/done can carry. Mirrored, one sentence each, in
# frontend/src/lib/utils/labels.ts (SSO_ERROR_LABELS) — said in both files (house rule 13).
ERROR_CODES = (
    'cancelled',
    'state_invalid',
    'state_expired',
    'provider_error',
    'email_missing',
    'email_in_use',
    'already_linked',
    'account_inactive',
    'minor',
    'flag_off',
    'not_configured',
)


class Refusal(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


# ---- small pieces ---------------------------------------------------------------------------------

def _digest(value: str) -> str:
    return hashlib.sha256((value or '').encode('utf-8')).hexdigest()


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode('ascii')).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b'=').decode('ascii')


def safe_next(path) -> str:
    """A same-origin path or ''. Mirrors frontend/src/lib/utils/returnTo.ts: a full URL, a
    protocol-relative `//host` or a backslash trick is refused, so a crafted start request cannot
    bounce a fresh session off to another site."""
    if not isinstance(path, str) or not path.startswith('/') or path.startswith('//') or path.startswith('/\\'):
        return ''
    if any(c in path for c in '\r\n\t') or len(path) > 500:
        return ''
    return path


def callback_url(provider: Provider, request) -> str:
    """The redirect_uri registered with the provider. `EDMAT_SSO_API_URL` when set (production:
    https://edmat.net/api — it must match the console byte for byte); otherwise, in development
    only, whatever origin this request reached."""
    base = (getattr(settings, 'EDMAT_SSO_API_URL', '') or '').rstrip('/')
    if not base:
        base = request.build_absolute_uri('/api').rstrip('/')
    return f'{base}/auth/sso/{provider.id}/callback/'


def frontend_url(path: str, **params) -> str:
    query = urllib.parse.urlencode({k: v for k, v in params.items() if v})
    return f'{settings.EDMAT_SITE_URL}{path}' + (f'?{query}' if query else '')


def error_url(code: str, provider: Provider | None = None) -> str:
    return frontend_url('/auth/sso/done', error=code, provider=provider.id if provider else '')


# ---- start ---------------------------------------------------------------------------------------

def start(provider: Provider, *, intent: str, user, next_path: str, redirect_uri: str) -> tuple[str, str]:
    """Returns (authorization_url, browser_key). The key goes to the tab and nowhere else."""
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64) if provider.pkce else ''
    browser_key = secrets.token_urlsafe(32)
    SsoAttempt.objects.create(
        state=state,
        provider=provider.id,
        intent=INTENT_LINK if intent == INTENT_LINK else INTENT_LOGIN,
        user=user if intent == INTENT_LINK else None,
        code_verifier=verifier,
        nonce=nonce,
        redirect_uri=redirect_uri,
        next_path=safe_next(next_path),
        browser_key_hash=_digest(browser_key),
        expires_at=timezone.now() + ATTEMPT_TTL,
    )
    params = {
        'response_type': 'code',
        'client_id': provider.client_id(),
        'redirect_uri': redirect_uri,
        'state': state,
        'nonce': nonce,
        **provider.authorize_params(),
    }
    if provider.pkce:
        params['code_challenge'] = _pkce_challenge(verifier)
        params['code_challenge_method'] = 'S256'
    return f'{provider.endpoint("authorize")}?{urllib.parse.urlencode(params)}', browser_key


# ---- the callback ----------------------------------------------------------------------------------

def _claim_attempt(provider: Provider, state: str) -> SsoAttempt:
    if not state or len(state) > 64:
        raise Refusal('state_invalid')
    now = timezone.now()
    claimed = SsoAttempt.objects.filter(
        state=state, provider=provider.id, status=STATUS_PENDING, expires_at__gt=now
    ).update(status=STATUS_USED, used_at=now)
    if not claimed:
        row = SsoAttempt.objects.filter(state=state, provider=provider.id).only('status').first()
        # Pending but not claimable can only mean expired; used means a replay; absent means forged.
        raise Refusal('state_expired' if row is not None and row.status == STATUS_PENDING else 'state_invalid')
    return SsoAttempt.objects.get(state=state)


def _exchange_code(provider: Provider, attempt: SsoAttempt, code: str) -> dict:
    """The code for claims: a verified id_token (OIDC), or — for a provider with none (GitHub,
    Facebook) — the profile read from its API with the access token, which is then dropped."""
    data = {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': attempt.redirect_uri,
        'client_id': provider.client_id(),
        'client_secret': provider.client_secret(),
    }
    if provider.pkce:
        data['code_verifier'] = attempt.code_verifier
    try:
        response = provider.request_token(data)
    except http.ProviderHttpError as exc:
        log.warning('sso %s: token request failed: %s', provider.id, exc)
        raise Refusal('provider_error') from exc
    if provider.protocol != 'oidc':
        access_token = response.get('access_token')
        if not access_token or not isinstance(access_token, str):
            log.warning('sso %s: no access token in the token response', provider.id)
            raise Refusal('provider_error')
        try:
            claims = provider.fetch_identity(access_token)
        except (http.ProviderHttpError, ValueError, TypeError, AttributeError) as exc:
            log.warning('sso %s: identity request failed: %s', provider.id, exc)
            raise Refusal('provider_error') from exc
        if not provider.issuer_ok(claims) or not str(claims.get('sub') or '').strip():
            raise Refusal('provider_error')
        return claims
    try:
        return verify_id_token(provider, response.get('id_token'), nonce=attempt.nonce)
    except TokenRejected as exc:
        log.warning('sso %s: id_token rejected: %s', provider.id, exc)
        raise Refusal('provider_error') from exc


def _mint_code(*, kind: str, user, provider: Provider, attempt: SsoAttempt, key: dict, email: str, verified: bool) -> str:
    code = secrets.token_urlsafe(32)
    SsoLoginCode.objects.create(
        code_hash=_digest(code),
        kind=kind,
        user=user,
        provider=provider.id,
        **key,
        email=email,
        email_verified=verified,
        next_path=attempt.next_path,
        browser_key_hash=attempt.browser_key_hash,
        expires_at=timezone.now() + CODE_TTL,
    )
    return code


def finish_callback(provider: Provider, params: dict) -> str:
    """Everything after the provider sends the browser back. Returns the frontend URL to redirect
    to; never raises for anything a visitor can cause."""
    try:
        attempt = _claim_attempt(provider, params.get('state') or '')
        if params.get('error'):
            # Google and Microsoft say `access_denied`; Apple `user_cancelled_authorize`.
            cancelled = params['error'] in ('access_denied', 'user_cancelled_authorize', 'user_cancelled_login')
            if not cancelled:
                log.info('sso %s: provider returned error %s', provider.id, params.get('error'))
            raise Refusal('cancelled' if cancelled else 'provider_error')
        code = params.get('code') or ''
        if not code:
            raise Refusal('provider_error')
        claims = _exchange_code(provider, attempt, code)
        return _route_identity(provider, attempt, claims, params)
    except Refusal as refusal:
        return error_url(refusal.code, provider)


def _route_identity(provider: Provider, attempt: SsoAttempt, claims: dict, params: dict) -> str:
    # (provider, issuer, subject) is the identity — never the email (sso/CLAUDE.md).
    key = provider.identity_key(claims)
    email = (claims.get('email') or '').strip()[:320]
    verified = bool(email) and provider.email_verified(claims)
    identity = SsoIdentity.objects.filter(
        provider=provider.id, issuer=key['issuer'], subject=key['subject']
    ).select_related('user').first()

    if attempt.intent == INTENT_LINK:
        if attempt.user_id is None or not attempt.user.is_active:
            raise Refusal('state_invalid')
        if identity is not None and identity.user_id != attempt.user_id:
            raise Refusal('already_linked')
        code = _mint_code(kind=SsoLoginCode.KIND_LINK, user=attempt.user, provider=provider, attempt=attempt,
                          key=key, email=email, verified=verified)
        return frontend_url('/auth/sso/done', code=code)

    if identity is not None:
        if not identity.user.is_active:
            raise Refusal('account_inactive')
        code = _mint_code(kind=SsoLoginCode.KIND_LOGIN, user=identity.user, provider=provider, attempt=attempt,
                          key=key, email=email, verified=verified)
        return frontend_url('/auth/sso/done', code=code)

    if not email:
        raise Refusal('email_missing')
    # Never adopt an existing account by its address, verified or not: that is the account-takeover
    # route this whole flow is shaped to avoid. The match only PROPOSES a link; the person must
    # prove the account is theirs (LINKING-AND-ERRORS.md §2.4) — see offer_link below.
    matches = list(User.objects.filter(email__iexact=email).select_related('profile')[:2])
    if matches:
        return _offer_link(provider, attempt, key, email, verified, matches)
    ticket = secrets.token_urlsafe(32)
    SsoSignupTicket.objects.create(
        ticket_hash=_digest(ticket),
        provider=provider.id,
        **key,
        email=email,
        email_verified=verified,
        suggested_name=provider.suggested_name(claims, params),
        next_path=attempt.next_path,
        browser_key_hash=attempt.browser_key_hash,
        expires_at=timezone.now() + TICKET_TTL,
    )
    return frontend_url('/auth/sso/complete', ticket=ticket)


# ---- confirm-and-link: an address an account already uses (LINKING-AND-ERRORS.md §2.4) ---------------

LINK_TTL = timedelta(minutes=30)
LINK_MAX_PASSWORD_FAILURES = 5
LINK_MAIL_SALT = 'sso.link-by-mail'


def guardian_managed(user) -> bool:
    """A child's account, or any account a guardian runs (accounts/minors.py). Never linked through
    this flow: it is the guardian's to run, and it has no self-chosen password or address."""
    from accounts.minors import is_minor
    from accounts.models import Guardianship

    if getattr(getattr(user, 'profile', None), 'is_minor', False) or is_minor(user):
        return True
    return Guardianship.objects.filter(child=user, revoked_at__isnull=True).exists()


def link_methods(user) -> list[str]:
    """How this account can prove it is the person's: its password, and/or a link to its address —
    the latter ONLY when that address is confirmed, because an unconfirmed address was never proven
    by anybody (pre-account-takeover, attack 1 of the USENIX paper)."""
    from mail.services import is_confirmed

    methods = []
    if user.has_usable_password():
        methods.append('password')
    if user.email and is_confirmed(user):
        methods.append('email')
    return methods


def _offer_link(provider: Provider, attempt: SsoAttempt, key: dict, email: str, verified: bool, matches) -> str:
    if len(matches) > 1:
        # Two accounts share the address (legacy data): there is no single account to propose.
        raise Refusal('email_in_use')
    user = matches[0]
    if guardian_managed(user):
        raise Refusal('minor')
    if not user.is_active:
        raise Refusal('account_inactive')
    if not link_methods(user):
        # No password and no confirmed address: nothing the person could prove. The done page points
        # at "Forgotten your password?", which proves the mailbox and sets a password.
        raise Refusal('email_in_use')
    ticket = secrets.token_urlsafe(32)
    SsoLinkTicket.objects.create(
        ticket_hash=_digest(ticket),
        browser_key_hash=attempt.browser_key_hash,
        user=user,
        provider=provider.id,
        **key,
        email=email,
        email_verified=verified,
        next_path=attempt.next_path,
        expires_at=timezone.now() + LINK_TTL,
    )
    return frontend_url('/auth/sso/link', ticket=ticket)


def pending_link_ticket(ticket: str, browser_key: str) -> SsoLinkTicket | None:
    if not ticket or not browser_key:
        return None
    row = SsoLinkTicket.objects.filter(
        ticket_hash=_digest(ticket), status=STATUS_PENDING, expires_at__gt=timezone.now()
    ).select_related('user__profile').first()
    if row is None or not hmac.compare_digest(row.browser_key_hash, _digest(browser_key)):
        return None
    return row


def _finish_link(row: SsoLinkTicket):
    """The proof passed: claim the ticket, attach the identity. Returns (user, identity)."""
    claimed = SsoLinkTicket.objects.filter(
        pk=row.pk, status=STATUS_PENDING, expires_at__gt=timezone.now()
    ).update(status=STATUS_USED)
    if not claimed:
        raise Refusal('ticket_invalid')
    user = User.objects.select_related('profile').get(pk=row.user_id)
    if guardian_managed(user):
        raise Refusal('minor')
    if not user.is_active:
        raise Refusal('account_inactive')
    try:
        with transaction.atomic():
            identity, _created = SsoIdentity.objects.get_or_create(
                provider=row.provider, issuer=row.issuer, subject=row.subject,
                defaults={'user': user, 'email': row.email, 'email_verified': row.email_verified,
                          'tenant_id': row.tenant_id, 'object_id': row.object_id},
            )
    except IntegrityError as exc:
        raise Refusal('already_linked') from exc
    if identity.user_id != user.pk:
        raise Refusal('already_linked')
    SsoIdentity.objects.filter(pk=identity.pk).update(last_login_at=timezone.now())
    return user, identity


def confirm_link_by_password(ticket: str, browser_key: str, password: str):
    row = pending_link_ticket(ticket, browser_key)
    if row is None:
        raise Refusal('ticket_invalid')
    if 'password' not in link_methods(row.user):
        raise Refusal('method_unavailable')
    if row.password_failures >= LINK_MAX_PASSWORD_FAILURES:
        raise Refusal('too_many_attempts')
    if not password or not row.user.check_password(password):
        SsoLinkTicket.objects.filter(pk=row.pk).update(password_failures=F('password_failures') + 1)
        raise Refusal('password_wrong')
    return (*_finish_link(row), row)


def request_link_mail(ticket: str, browser_key: str) -> SsoLinkTicket:
    """Queues the confirmation link to the account's own (confirmed) address. A new nonce per press,
    so only the newest link works. The logged body carries `[[link]]`; mail.build_link asks
    `mail_link_token` for the link at the moment of sending."""
    from mail.models import OutboundEmail
    from mail.services import _locale, _name, queue
    from mail.texts import text

    row = pending_link_ticket(ticket, browser_key)
    if row is None:
        raise Refusal('ticket_invalid')
    user = row.user
    if 'email' not in link_methods(user):
        raise Refusal('method_unavailable')
    SsoLinkTicket.objects.filter(pk=row.pk, status=STATUS_PENDING).update(
        mail_nonce=secrets.token_hex(16), mail_requested_at=timezone.now()
    )
    locale = _locale(user)
    label = _provider_label(row.provider)
    queue(
        OutboundEmail.KIND_SSO_LINK,
        user.email,
        text(locale, 'sso_link_subject', provider=label),
        text(locale, 'sso_link_body', name=_name(user), username=user.username, provider=label),
        user=user,
        locale=locale,
    )
    return row


def mail_link_token(user) -> str | None:
    """The signed token for the newest pending link ticket of this account that asked for a mail —
    deterministic, so a retried send builds the same link. Signed with the server's key: the database
    alone (which holds the nonce) is not enough to forge it."""
    from django.core.signing import Signer

    row = (
        SsoLinkTicket.objects.filter(user=user, status=STATUS_PENDING, expires_at__gt=timezone.now())
        .exclude(mail_nonce='')
        .order_by('-mail_requested_at', '-pk')
        .first()
    )
    if row is None:
        return None
    return Signer(salt=LINK_MAIL_SALT).sign_object({'t': row.pk, 'n': row.mail_nonce})


def confirm_link_by_mail(token: str, browser_key: str):
    from django.core.signing import BadSignature, Signer

    try:
        data = Signer(salt=LINK_MAIL_SALT).unsign_object(token or '')
    except (BadSignature, ValueError, TypeError):
        raise Refusal('link_invalid') from None
    if not isinstance(data, dict):
        raise Refusal('link_invalid')
    row = SsoLinkTicket.objects.filter(
        pk=data.get('t'), status=STATUS_PENDING, expires_at__gt=timezone.now()
    ).exclude(mail_nonce='').first()
    if row is None or not hmac.compare_digest(row.mail_nonce, str(data.get('n') or '')):
        raise Refusal('link_invalid')
    # The click must happen in the browser that started the sign-in (sso/CLAUDE.md, rule 2).
    if not browser_key or not hmac.compare_digest(row.browser_key_hash, _digest(browser_key)):
        raise Refusal('link_other_browser')
    if 'email' not in link_methods(row.user):
        raise Refusal('method_unavailable')
    return (*_finish_link(row), row)


def _provider_label(provider_id: str) -> str:
    from .providers import get

    provider = get(provider_id)
    return provider.label if provider else provider_id


def notify_linked(user, provider_id: str) -> None:
    """Rule 5: after ANY link — confirm-and-link or Settings — mail the account. Only to a
    confirmed address: an unconfirmed one may be somebody else's, typed by mistake."""
    from django.utils import formats

    from mail.models import OutboundEmail
    from mail.services import _locale, _name, is_confirmed, queue
    from mail.texts import text

    if not user.email or not is_confirmed(user):
        return
    locale = _locale(user)
    label = _provider_label(provider_id)
    date = formats.date_format(timezone.localtime(), 'Y-m-d H:i')
    queue(
        OutboundEmail.KIND_SSO_LINKED,
        user.email,
        text(locale, 'sso_linked_subject', provider=label),
        text(locale, 'sso_linked_body', name=_name(user), username=user.username, provider=label,
             date=date, site=settings.EDMAT_SITE_URL),
        user=user,
        locale=locale,
    )


# ---- the done page: redeeming a code ------------------------------------------------------------------

def _pending_code(code: str, browser_key: str):
    if not code or not browser_key:
        return None
    return SsoLoginCode.objects.filter(
        code_hash=_digest(code), status=STATUS_PENDING, expires_at__gt=timezone.now()
    ).select_related('user').first()


def redeem_code(code: str, browser_key: str, request_user):
    """Returns ('login', user, row) or ('link', identity, row); raises Refusal."""
    row = _pending_code(code, browser_key)
    # compare_digest, so the key check does not leak how many leading characters matched.
    if row is None or not hmac.compare_digest(row.browser_key_hash, _digest(browser_key)):
        raise Refusal('code_invalid')
    if row.kind == SsoLoginCode.KIND_LINK:
        # The identity is attached to the account that pressed "Link", and only while that same
        # account is the one redeeming — a session that changed hands in between gets nothing.
        if not (request_user and request_user.is_authenticated and request_user.pk == row.user_id):
            raise Refusal('wrong_account')
    claimed = SsoLoginCode.objects.filter(
        pk=row.pk, status=STATUS_PENDING, expires_at__gt=timezone.now(), browser_key_hash=_digest(browser_key)
    ).update(status=STATUS_USED)
    if not claimed:
        raise Refusal('code_invalid')
    if not row.user.is_active:
        raise Refusal('account_inactive')

    if row.kind == SsoLoginCode.KIND_LOGIN:
        SsoIdentity.objects.filter(provider=row.provider, issuer=row.issuer, subject=row.subject, user=row.user).update(
            last_login_at=timezone.now()
        )
        return 'login', row.user, row

    try:
        with transaction.atomic():
            identity, _created = SsoIdentity.objects.get_or_create(
                provider=row.provider,
                issuer=row.issuer,
                subject=row.subject,
                defaults={'user': row.user, 'email': row.email, 'email_verified': row.email_verified,
                          'tenant_id': row.tenant_id, 'object_id': row.object_id},
            )
    except IntegrityError as exc:
        raise Refusal('already_linked') from exc
    if identity.user_id != row.user_id:
        raise Refusal('already_linked')
    return 'link', identity, row


# ---- the complete page: a new account --------------------------------------------------------------------

def pending_ticket(ticket: str, browser_key: str) -> SsoSignupTicket | None:
    if not ticket or not browser_key:
        return None
    row = SsoSignupTicket.objects.filter(
        ticket_hash=_digest(ticket), status=STATUS_PENDING, expires_at__gt=timezone.now()
    ).first()
    if row is None or not hmac.compare_digest(row.browser_key_hash, _digest(browser_key)):
        return None
    return row


def suggest_username(email: str, name: str = '') -> str:
    base = (email.split('@')[0] if email else '') or name or 'user'
    base = ''.join(c for c in base.lower() if c.isalnum() or c in '._-')[:30] or 'user'
    if not User.objects.filter(username__iexact=base).exists():
        return base
    for _ in range(20):
        candidate = f'{base}-{secrets.token_hex(2)}'
        if not User.objects.filter(username__iexact=candidate).exists():
            return candidate
    return f'{base}-{secrets.token_hex(4)}'


def _parse_birth_year(value):
    if value in (None, ''):
        return None
    try:
        year = int(str(value).strip())
    except (TypeError, ValueError):
        raise ValueError('invalid') from None
    if not 1900 <= year <= 2100:
        raise ValueError('invalid')
    return year


def complete_signup(*, ticket: str, browser_key: str, username: str, display_name: str, birth_year,
                    accept_terms, preferred_locale: str):
    """Returns (user, None) or (None, errors) where `errors` is the `{field: [codes]}` shape every
    other 400 in this API uses. A `detail` key means the ticket itself is no good."""
    from accounts.minors import self_registration_refusal
    from moderation.services import is_feature_enabled

    row = pending_ticket(ticket, browser_key)
    if row is None:
        return None, {'detail': 'ticket_invalid'}

    errors: dict[str, list[str]] = {}
    if accept_terms is not True and str(accept_terms).lower() != 'true':
        # The same reason word /register answers with (accounts/serializers.py).
        errors['accept_terms'] = ['terms_required']

    # The age question, asked exactly as /register asks it (accounts/minors.py). Required here while
    # the flag is on, because a signup that skipped the question would be a way round it.
    try:
        year = _parse_birth_year(birth_year)
    except ValueError:
        errors['birth_year'] = ['invalid']
    else:
        if is_feature_enabled('age_verification') and year is None:
            errors['birth_year'] = ['required']
        elif self_registration_refusal(year):
            errors['birth_year'] = ['guardian_required']

    username = (username or '').strip()
    if not username:
        errors['username'] = ['required']
    elif len(username) > 150:
        errors['username'] = ['too_long']
    else:
        try:
            UnicodeUsernameValidator()(username)
        except ValidationError:
            errors['username'] = ['invalid']
        else:
            if User.objects.filter(username__iexact=username).exists():
                errors['username'] = ['taken']
    if errors:
        return None, errors

    if User.objects.filter(email__iexact=row.email).exists():
        return None, {'detail': 'email_in_use'}
    if SsoIdentity.objects.filter(provider=row.provider, issuer=row.issuer, subject=row.subject).exists():
        return None, {'detail': 'already_linked'}

    claimed = SsoSignupTicket.objects.filter(
        pk=row.pk, status=STATUS_PENDING, expires_at__gt=timezone.now()
    ).update(status=STATUS_USED)
    if not claimed:
        return None, {'detail': 'ticket_invalid'}
    try:
        with transaction.atomic():
            # No password argument → `set_unusable_password()`: this account signs in through its
            # provider until the person sets one through "Forgotten your password?".
            user = User.objects.create_user(username=username, email=row.email)
            SsoIdentity.objects.create(
                user=user, provider=row.provider, issuer=row.issuer, subject=row.subject,
                tenant_id=row.tenant_id, object_id=row.object_id,
                email=row.email, email_verified=row.email_verified, last_login_at=timezone.now(),
            )
    except IntegrityError:
        # Somebody took the username (or linked the identity) between the check and the insert.
        # The ticket goes back to pending so the person can pick another name without starting over.
        SsoSignupTicket.objects.filter(pk=row.pk).update(status=STATUS_PENDING)
        return None, {'username': ['taken']}

    profile = user.profile
    profile.display_name = (display_name or '').strip()[:100]
    profile.preferred_locale = (preferred_locale or 'pl')[:8]
    profile.save(update_fields=['display_name', 'preferred_locale'])

    from legal.terms import record_acceptance
    from mail.models import ConfirmedEmail
    from mail.services import send_confirmation

    record_acceptance(user, via=f'sso:{row.provider}')
    if row.email_verified:
        # The provider vouched for the address, which is what a confirmation link would prove.
        ConfirmedEmail.objects.update_or_create(user=user, defaults={'email': user.email})
    else:
        send_confirmation(user)
    return user, None


# ---- Settings: unlinking ----------------------------------------------------------------------------

def unlink_refusal(user, identity: SsoIdentity) -> str | None:
    """Why this identity may not be removed, or None. The one rule: an account must keep SOME way
    in — a usable password or another linked provider."""
    if user.has_usable_password():
        return None
    if SsoIdentity.objects.filter(user=user).exclude(pk=identity.pk).exists():
        return None
    return 'set_password_first'


# ---- retention ---------------------------------------------------------------------------------------

def purge(now=None, *, grace: timedelta = timedelta(hours=1)) -> dict:
    """Deletes every attempt, code and ticket that expired more than `grace` ago — used or not.
    None of them is a record of a decision (house rule 12): the decision is the `SsoIdentity` row,
    the account and the `TermsAcceptance`. A ticket holds an email address and a name for a person
    who may never have finished signing up, so it must not outlive its half hour by much."""
    cutoff = (now or timezone.now()) - grace
    return {
        'attempts': SsoAttempt.objects.filter(expires_at__lt=cutoff).delete()[0],
        'codes': SsoLoginCode.objects.filter(expires_at__lt=cutoff).delete()[0],
        'tickets': SsoSignupTicket.objects.filter(expires_at__lt=cutoff).delete()[0],
        'link_tickets': SsoLinkTicket.objects.filter(expires_at__lt=cutoff).delete()[0],
    }
