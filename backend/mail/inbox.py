"""The "received" half of the Mail tab: a read-only copy of no-reply@edmat.net's INBOX over IMAP.

Read-only twice over: the folder is SELECTed with `readonly=True` and bodies are fetched with
`BODY.PEEK[]`, so nothing here marks a message read, moves it or deletes it — the mailbox in OVH's
webmail looks exactly as it did. Incremental by UID: each run asks only for UIDs above the highest
one already stored for this UIDVALIDITY, so a run with nothing new costs one round trip.

What is stored is text. An HTML-only message is reduced to plain text with bleach; an attachment is
a name, a type and a size (house rule 7: the bytes somebody mailed us are never kept). A body over
`MAX_BODY` characters is cut and says so.
"""

import email
import html
import imaplib
import re
from email.header import decode_header, make_header
from email.policy import default as default_policy
from datetime import timezone as dt_timezone
from email.utils import getaddresses, parsedate_to_datetime

import bleach
from django.conf import settings
from django.db.models import Max
from django.utils import timezone

from .models import InboundEmail

MAX_BODY = 100_000
# A message larger than this is stored by its headers only — a 25 MB attachment is not worth
# pulling through one of eight request slots to show its subject line.
MAX_FETCH_BYTES = 2_000_000
BATCH = 200


class MailUnavailable(Exception):
    """Carries a reason the Mail tab can show: 'not_configured' | 'login_failed' | 'unreachable'."""

    def __init__(self, reason: str, detail: str = ''):
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


def _header(value) -> str:
    if not value:
        return ''
    try:
        return str(make_header(decode_header(str(value))))
    except Exception:  # noqa: BLE001 — a malformed header is shown as it came
        return str(value)


def _text_of(message) -> tuple[str, list]:
    attachments = []
    for part in message.walk():
        if part.is_multipart():
            continue
        disposition = part.get_content_disposition()
        filename = part.get_filename()
        if disposition == 'attachment' or (filename and disposition != 'inline'):
            payload = part.get_payload(decode=True) or b''
            attachments.append(
                {'filename': _header(filename) or '', 'content_type': part.get_content_type(), 'size': len(payload)}
            )
    body_part = message.get_body(preferencelist=('plain', 'html'))
    if body_part is None:
        return '', attachments
    try:
        content = body_part.get_content()
    except Exception:  # noqa: BLE001 — an unknown charset; fall back to bytes as latin-1
        content = (body_part.get_payload(decode=True) or b'').decode('latin-1', 'replace')
    if body_part.get_content_type() == 'text/html':
        content = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', '', content)
        content = re.sub(r'(?i)<br\s*/?>|</p>|</div>|</tr>', '\n', content)
        content = bleach.clean(content, tags=[], strip=True)
        content = re.sub(r'\n{3,}', '\n\n', content)
        content = html.unescape(content)
    return content.strip(), attachments


def _connect():
    if not settings.EMAIL_HOST_PASSWORD:
        raise MailUnavailable('not_configured')
    try:
        client = imaplib.IMAP4_SSL(settings.EDMAT_IMAP_HOST, settings.EDMAT_IMAP_PORT, timeout=20)
    except OSError as exc:
        raise MailUnavailable('unreachable', str(exc)) from exc
    try:
        client.login(settings.EMAIL_HOST_USER, settings.EMAIL_HOST_PASSWORD)
    except imaplib.IMAP4.error as exc:
        raise MailUnavailable('login_failed', str(exc)) from exc
    return client


def fetch(folder: str = 'INBOX') -> int:
    """Stores every message not yet stored (up to `BATCH` per run, oldest first). Returns how many."""
    client = _connect()
    try:
        status, _ = client.select(folder, readonly=True)
        if status != 'OK':
            raise MailUnavailable('unreachable', f'cannot open {folder}')
        uidvalidity = int((client.untagged_responses.get('UIDVALIDITY') or [b'0'])[0])
        last = (
            InboundEmail.objects.filter(folder=folder, uidvalidity=uidvalidity).aggregate(m=Max('uid'))['m'] or 0
        )
        status, data = client.uid('search', None, f'UID {last + 1}:*')
        uids = [int(u) for u in (data[0] or b'').split() if int(u) > last][:BATCH]
        stored = 0
        for uid in uids:
            status, sized = client.uid('fetch', str(uid), '(RFC822.SIZE)')
            match = re.search(rb'RFC822\.SIZE (\d+)', sized[0] if sized and sized[0] else b'')
            size = int(match.group(1)) if match else 0
            section = 'BODY.PEEK[]' if size <= MAX_FETCH_BYTES else 'BODY.PEEK[HEADER]'
            status, parts = client.uid('fetch', str(uid), f'({section})')
            raw = next((p[1] for p in parts if isinstance(p, tuple)), b'')
            message = email.message_from_bytes(raw, policy=default_policy)
            if size <= MAX_FETCH_BYTES:
                body, attachments = _text_of(message)
            else:
                body, attachments = '', [{'filename': '(message too large to fetch)', 'content_type': '', 'size': size}]
            try:
                date = parsedate_to_datetime(message['Date']) if message['Date'] else None
                if date is not None and timezone.is_naive(date):
                    date = timezone.make_aware(date, dt_timezone.utc)
            except (TypeError, ValueError):
                date = None
            to = ', '.join(addr for _, addr in getaddresses([_header(message['To']), _header(message['Cc'])]) if addr)
            InboundEmail.objects.get_or_create(
                folder=folder,
                uidvalidity=uidvalidity,
                uid=uid,
                defaults={
                    'message_id': _header(message['Message-ID'])[:500],
                    'from_address': _header(message['From'])[:500],
                    'to': to,
                    'subject': _header(message['Subject'])[:500],
                    'date': date,
                    'body': body[:MAX_BODY],
                    'body_truncated': len(body) > MAX_BODY,
                    'size': size,
                    'attachments': attachments,
                },
            )
            stored += 1
        return stored
    finally:
        try:
            client.logout()
        except Exception:  # noqa: BLE001
            pass
