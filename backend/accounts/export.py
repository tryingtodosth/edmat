"""`GET /api/auth/me/export/` — everything EdMat holds about one person, as one JSON document
(GDPR Art. 15 access + Art. 20 portability).

**Built from `accounts.erasure.REGISTRY`**, so the two answers to "what do you hold about me?" — the
copy you can download and the list of what deleting you removes — come from one table and cannot
drift. A model added without a registry entry fails `test_erasure`'s completeness test and so cannot
be missing from here either.

What it never contains:

- **Secrets**: the password hash, API tokens, sign-in codes, PKCE verifiers, browser-key hashes. They
  identify a credential, not the person, and a file people email to themselves must not carry one.
- **Other people's personal data beyond what you already saw.** A row that points at somebody else
  (the other side of a message, the tutor of a booking) names them by id and display name — what the
  app showed you — and never by email or username.
- **Working links.** A mail body is exported as logged, with `[[link]]` in place of any link.

What it does contain that a reader might not expect: private messages DECRYPTED (they are yours —
encryption at rest is against a stolen disk, not against you), and the last 90 days of your own
request-log rows from your log shard, exactly as stored (the IP truncated after 30 days).

Format: `{"format": "edmat-account-export", "version": 1, …, "sections": {"<app>.<Model>": {
"description", "relations", "fields": {name: description}, "rows": [...]}}}`. Field names are the
database column names; `fields` documents each one in English (the model's own verbose name and help
text), so the file explains itself without access to this source.
"""

from __future__ import annotations

import datetime as _dt
import decimal
import uuid
from datetime import timedelta

from django.apps import apps
from django.contrib.auth import get_user_model
from django.db.models import FileField, Q
from django.utils import timezone

from .erasure import DELETED_LABEL, REGISTRY, SHARD_FIELDS

FORMAT = 'edmat-account-export'
VERSION = 1

#: Never exported from any model: credentials and the hashes that stand in for them.
SECRET_FIELDS = {
    'password', 'key', 'code_hash', 'ticket_hash', 'browser_key_hash', 'code_verifier', 'nonce',
    'state', 'anon_ip_hash',
}

ROW_CAP = 20000
REQUEST_LOG_DAYS = 90


def _scalar(value):
    if isinstance(value, (_dt.datetime, _dt.date, _dt.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return None
    return value


class _Names:
    """Display names for the OTHER people rows point at, fetched once per export."""

    def __init__(self, subject_id: int):
        self.subject_id = subject_id
        self.cache: dict[int, str] = {}

    def ref(self, user_id):
        if user_id is None:
            return None
        if user_id == self.subject_id:
            return {'id': user_id, 'you': True}
        if user_id not in self.cache:
            from .models import Profile

            p = Profile.objects.filter(user_id=user_id).select_related('user').first()
            name = ''
            if p is not None:
                name = p.display_name or p.user.username
            self.cache[user_id] = name or DELETED_LABEL
        return {'id': user_id, 'display_name': self.cache[user_id]}


def _field_docs(model, exclude) -> dict:
    docs = {}
    for f in model._meta.concrete_fields:
        if f.name in SECRET_FIELDS or f.name in exclude:
            continue
        text = str(f.verbose_name)
        if f.help_text:
            text = f'{text} — {f.help_text}'
        if f.is_relation and f.related_model is get_user_model():
            text = f'{text} (a person: {{"id", "display_name"}}, or {{"id", "you": true}})'
        docs[f.attname if f.is_relation else f.name] = text
    return docs


def _row(obj, model, exclude, names: _Names, request=None) -> dict:
    User = get_user_model()
    out = {}
    for f in model._meta.concrete_fields:
        if f.name in SECRET_FIELDS or f.name in exclude:
            continue
        if f.is_relation:
            raw = getattr(obj, f.attname)
            out[f.attname] = names.ref(raw) if f.related_model is User else raw
            continue
        value = f.value_from_object(obj)
        if isinstance(f, FileField):
            out[f.name] = value.url if value else None
            if value and request is not None:
                out[f.name] = request.build_absolute_uri(value.url)
            continue
        out[f.name] = _scalar(value)
    return out


def _message_rows(user, names: _Names) -> list:
    from messaging.crypto import decrypt_text
    from postman.models import Message

    rows = []
    qs = Message.objects.filter(Q(sender=user) | Q(recipient=user)).order_by('sent_at')[:ROW_CAP]
    for msg in qs:
        try:
            body = decrypt_text(msg.body)
        except Exception:  # noqa: BLE001 — a row sealed under a rotated key is unreadable to us too
            body = None
        rows.append({
            'id': msg.pk,
            'thread_id': msg.thread_id,
            'parent_id': msg.parent_id,
            'sender': names.ref(msg.sender_id),
            'recipient': names.ref(msg.recipient_id),
            'subject': msg.subject,
            'body': body,
            'sent_at': _scalar(msg.sent_at),
            'read_at': _scalar(msg.read_at),
        })
    return rows


MESSAGE_FIELDS = {
    'id': 'Message id',
    'thread_id': 'The conversation this message belongs to (the id of its first message)',
    'parent_id': 'The message this one replies to',
    'sender': 'Who sent it',
    'recipient': 'Who received it',
    'subject': 'Subject line (stored unencrypted)',
    'body': 'Text, decrypted for this export (stored encrypted at rest); null if it can no longer be decrypted',
    'sent_at': 'When it was sent',
    'read_at': 'When the recipient first opened it',
}


def _account_section(user, request) -> dict:
    from .models import Profile

    profile = Profile.objects.filter(user=user).first()
    names = _Names(user.pk)
    account = {
        'id': user.pk,
        'username': user.username,
        'email': user.email,
        'date_joined': _scalar(user.date_joined),
        'last_login': _scalar(user.last_login),
        'is_active': user.is_active,
        'has_password': user.has_usable_password(),
    }
    return {
        'description': 'Your account and your profile, including every setting you chose',
        'relations': ['self'],
        'fields': {
            'account': 'The sign-in record: username, e-mail address, when you joined and last signed in',
            'profile': 'Everything on your profile — display name, picture, settings, preferences',
        },
        'rows': [{
            'account': account,
            'profile': _row(profile, Profile, (), names, request) if profile else None,
        }],
    }


def _shard_sections(user) -> dict:
    from telemetry.models import AuditEvent, RequestLog
    from telemetry.routers import shard_for_user

    shard = shard_for_user(user.pk)
    since = timezone.now() - timedelta(days=REQUEST_LOG_DAYS)
    out = {}
    try:
        logs = RequestLog.objects.using(shard).filter(user_id=user.pk, created_at__gte=since).order_by('created_at')[:ROW_CAP]
        out['telemetry.RequestLog'] = {
            'description': f'Requests your browser made while you were signed in, the last {REQUEST_LOG_DAYS} days — kept for security and debugging, deleted after {REQUEST_LOG_DAYS} days',
            'relations': [SHARD_FIELDS['telemetry.RequestLog']],
            'fields': {
                'created_at': 'When',
                'method': 'HTTP method',
                'path': 'Address requested',
                'query_string': 'Query string, with search terms removed',
                'status_code': 'The answer the server gave',
                'ip_address': 'IP address as stored — shortened to a network (/24 or /48) after 30 days',
                'ip_truncated': 'Whether the address has been shortened yet',
                'user_agent': 'The browser that made the request',
            },
            'rows': [
                {
                    'created_at': _scalar(r.created_at), 'method': r.method, 'path': r.path,
                    'query_string': r.query_string, 'status_code': r.status_code,
                    'ip_address': r.ip_address, 'ip_truncated': r.ip_truncated, 'user_agent': r.user_agent,
                }
                for r in logs
            ],
        }
        audit = AuditEvent.objects.using(shard).filter(actor_id=user.pk).order_by('created_at')[:ROW_CAP]
        out['telemetry.AuditEvent'] = {
            'description': 'Things you did that the service records for later review — sign-ins, password changes, moderation decisions',
            'relations': [SHARD_FIELDS['telemetry.AuditEvent']],
            'fields': {
                'created_at': 'When', 'action': 'What kind of act', 'target_type': 'What it was done to',
                'target_id': 'Which one', 'summary': 'A one-line description', 'ip_address': 'IP address at the time',
            },
            'rows': [
                {
                    'created_at': _scalar(a.created_at), 'action': a.action, 'target_type': a.target_type,
                    'target_id': a.target_id, 'summary': a.summary, 'ip_address': a.ip_address,
                }
                for a in audit
            ],
        }
    except Exception:  # noqa: BLE001 — a shard that does not exist yet holds nothing about anybody
        pass
    return out


def build_export(user, request=None) -> dict:
    names = _Names(user.pk)
    sections: dict[str, dict] = {'accounts.User': _account_section(user, request)}

    by_model: dict[str, list] = {}
    for rule in REGISTRY:
        if not rule.export or rule.model == 'accounts.Profile':
            continue
        by_model.setdefault(rule.model, []).append(rule)

    for label, rules in by_model.items():
        if label == 'postman.Message':
            sections[label] = {
                'description': 'Private messages you sent and received',
                'relations': [r.field for r in rules],
                'fields': MESSAGE_FIELDS,
                'rows': _message_rows(user, names),
            }
            continue
        model = apps.get_model(label)
        exclude = set()
        for r in rules:
            exclude.update(r.export_exclude)
        q = Q()
        for r in rules:
            q |= Q(**{r.field: user})
        rows = model._base_manager.filter(q).distinct().order_by('pk')[:ROW_CAP]
        data = [_row(obj, model, exclude, names, request) for obj in rows]
        if not data:
            continue
        sections[label] = {
            'description': str(model._meta.verbose_name_plural),
            'relations': [r.field for r in rules],
            'fields': _field_docs(model, exclude),
            'rows': data,
        }

    sections.update(_shard_sections(user))
    return {
        'format': FORMAT,
        'version': VERSION,
        'generated_at': _scalar(timezone.now()),
        'user_id': user.pk,
        'notes': [
            'Each section is one table. "relations" names the column(s) that link a row to you.',
            'A person other than you appears as {"id", "display_name"} — never with their e-mail or username.',
            'Private messages are decrypted for this file. Secrets (password hash, sign-in tokens and codes) are never included.',
            f'At most {ROW_CAP} rows per table; the request log covers the last {REQUEST_LOG_DAYS} days.',
        ],
        'sections': sections,
    }
