"""Encryption at rest for the body of a private message.

**What this defends against, stated plainly, because the difference matters.** Until now, every
private message between two people on this site sat in `postman_message.body` as readable text.
That is one file — `db.sqlite3` — on a shared university host, copied into every backup anybody
takes, readable by anybody who ends up with the file for any reason. Encrypting the body means the
file alone is no longer enough: without the key it is noise.

**What it does NOT defend against, and nothing here pretends otherwise.** The key lives on the same
server as the application, because the application has to be able to read a message back to the two
people it belongs to. Anybody who can run code as the application can read the key and therefore the
messages, and so can whoever operates the server. This is at-rest encryption, not end-to-end
encryption, and the two answer different questions.

**Why not end-to-end.** It is the stronger answer and it was not chosen, deliberately rather than by
omission. E2EE would mean keys generated in the browser and never sent here, which in turn means:
losing the browser loses every message, with no recovery this project could offer; a reported
message cannot be read by the moderator deciding on the report; and the guardian oversight
(`accounts/minors.py`) that lets a parent read what their child wrote would be unimplementable for
messages. Each of those is a product decision belonging to the person who owns this project, not a
detail to settle inside a crypto module. Until they are settled, this is the change that is a strict
improvement on plaintext with no behaviour lost.

**Why the body and not the subject.** `postman.Message.subject` is a `CharField(120)`, and the
ciphertext of an N-byte plaintext is N+28 bytes before base64 (a 12-byte nonce and a 16-byte
authentication tag), which is roughly 1.4x longer once encoded. Encrypting a subject into that same
column would mean cutting what somebody may actually type from 120 characters to about 56 bytes —
fewer in Polish, where most non-ASCII letters cost two bytes each. That is a real, daily cost, and
what it buys is small here: a subject in this app is usually a tutoring listing's own title, carried
over by the Contact link from a page that is already public. The body is where the private part is.
Widening the column is a schema change to a third-party app's table and is the honest way to do the
subject too, if it is ever wanted.

**The format.** `edmat1:<base64url(nonce || ciphertext || tag)>`, AES-256-GCM. The version prefix is
what makes every other property here work: `decrypt_text` can tell a value it wrote from a plaintext
row written before this landed (or by the Django admin, or by django-postman's own form views, both
of which bypass this app's service layer entirely), so nothing has to be migrated before this can be
switched on, and a mixed table is a normal state rather than a broken one. AES-GCM is authenticated,
so a tampered row fails to decrypt rather than decrypting to something else.
"""

from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from django.conf import settings

PREFIX = 'edmat1:'
_NONCE_BYTES = 12

# HKDF's `info` — a domain separator, so a key derived for messages is not the same key as one
# derived from the same secret for anything else this project might encrypt later.
_HKDF_INFO = b'edmat:messaging:body:v1'


class MessageDecryptionError(Exception):
    """Raised when stored ciphertext cannot be read back — a rotated key, a truncated value, a
    tampered row. Deliberately its own type, and deliberately not caught in here: the caller
    (`MessageSerializer`) turns it into a flag on the response so one unreadable message does not
    take a whole inbox down with a 500, which is what a bare `raise` or a swallowed `except` would
    each get wrong in their own direction."""


def _key() -> bytes:
    """32 bytes, from `EDMAT_MESSAGE_KEY` if it is set, otherwise derived from `SECRET_KEY`.

    The env var is the right way to run this: it can be rotated, backed up and access-controlled
    separately from the rest of the settings. The derivation is the fallback that makes a fresh
    clone work without ceremony — `setup.sh` asks nobody for a key — and it carries a real cost that
    is worth stating rather than discovering: a message encrypted under a derived key becomes
    unreadable the moment `DJANGO_SECRET_KEY` changes, because the key changed with it. Rotating the
    secret key on a deployment that has been running this way means reading the messages out first.
    """
    configured = getattr(settings, 'EDMAT_MESSAGE_KEY', '')
    if configured:
        raw = base64.urlsafe_b64decode(configured)
        if len(raw) != 32:
            raise ValueError('EDMAT_MESSAGE_KEY must decode to exactly 32 bytes (AES-256).')
        return raw
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=_HKDF_INFO,
    ).derive(settings.SECRET_KEY.encode('utf-8'))


def is_encrypted(value: str | None) -> bool:
    return bool(value) and value.startswith(PREFIX)


def encrypt_text(plaintext: str) -> str:
    """Encrypt, unless there is nothing to encrypt.

    An empty body stays empty rather than becoming a ciphertext of nothing: a row with no body
    reveals no content by being readable, and leaving it alone keeps `body == ''` meaning the same
    thing to every existing query and template that already tests for it.
    """
    if not plaintext:
        return plaintext
    nonce = os.urandom(_NONCE_BYTES)
    sealed = AESGCM(_key()).encrypt(nonce, plaintext.encode('utf-8'), None)
    return PREFIX + base64.urlsafe_b64encode(nonce + sealed).decode('ascii')


def decrypt_text(stored: str | None) -> str:
    """The inverse, and tolerant of a value this module did not write.

    A row without the prefix is returned unchanged. That is what lets encryption be switched on
    without a migration step, and what keeps a message written through the Django admin or
    django-postman's own views — neither of which passes through `messaging/services.py` — readable
    rather than appearing as an error to the two people in the conversation.
    """
    if not stored:
        return stored or ''
    if not stored.startswith(PREFIX):
        return stored
    try:
        raw = base64.urlsafe_b64decode(stored[len(PREFIX) :])
        return AESGCM(_key()).decrypt(raw[:_NONCE_BYTES], raw[_NONCE_BYTES:], None).decode('utf-8')
    except (InvalidTag, ValueError, TypeError, UnicodeDecodeError) as exc:
        raise MessageDecryptionError(str(exc)) from exc
