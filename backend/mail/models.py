"""Mail for no-reply@edmat.net — what went out, what came in, and two per-person facts.

See `mail/CLAUDE.md`. In one line each:

- `OutboundEmail` is the queue AND the log: a row is written before anything is sent, and its
  `status` is the one lifecycle field (house rule: one status, never two booleans).
- `InboundEmail` is a read-only copy of the mailbox's INBOX, fetched over IMAP. Text only; an
  attachment is recorded by name and size and its bytes are never stored (house rule 7).
- `ConfirmedEmail` says which address a person has proved they own. Confirmed is DERIVED —
  `row.email == user.email` — so if an address ever changes, the confirmation simply stops
  matching rather than needing somebody to remember to clear a flag.
- `MailPreference` is the one opt-in: a digest of unread notifications, off by default.
"""

from django.conf import settings
from django.db import models


class OutboundEmail(models.Model):
    KIND_CONFIRM = 'confirm_email'
    KIND_RESET = 'password_reset'
    KIND_DIGEST = 'notification_digest'
    KIND_TEST = 'test'
    KIND_DIRECT = 'direct'
    # "Your account will be deleted on …" with a link that cancels it (`accounts/erasure.py`).
    KIND_ERASURE = 'account_erasure'
    # "Somebody asked to connect <Provider> to your account" with the confirming link, and "<Provider>
    # was connected" afterwards (`sso/`, LINKING-AND-ERRORS.md §2.4 rules 2b and 5).
    KIND_SSO_LINK = 'sso_link_confirm'
    KIND_SSO_LINKED = 'sso_linked'
    KINDS = [
        (KIND_CONFIRM, 'Email confirmation'),
        (KIND_RESET, 'Password reset'),
        (KIND_DIGEST, 'Notification digest'),
        (KIND_TEST, 'Test message'),
        (KIND_ERASURE, 'Account deletion notice'),
        (KIND_SSO_LINK, 'Connect a sign-in provider (confirmation link)'),
        (KIND_SSO_LINKED, 'A sign-in provider was connected'),
        # Anything sent through Django's mail API by a path that is not this app's queue — the
        # admin, django-postman. Logged by `transport.LoggedEmailBackend` after the fact.
        (KIND_DIRECT, 'Other (sent directly)'),
    ]

    STATUS_QUEUED = 'queued'
    STATUS_SENDING = 'sending'
    STATUS_SENT = 'sent'
    STATUS_FAILED = 'failed'
    STATUS_CONSOLE = 'console'
    STATUSES = [
        (STATUS_QUEUED, 'Queued'),
        (STATUS_SENDING, 'Sending'),
        (STATUS_SENT, 'Sent'),
        (STATUS_FAILED, 'Failed'),
        # Accepted by the console or locmem transport: it never left the machine. Not "sent" —
        # a development box that says it mailed somebody is house rule 10 broken.
        (STATUS_CONSOLE, 'Not sent (no mail server configured)'),
    ]

    kind = models.CharField(max_length=32, choices=KINDS)
    status = models.CharField(max_length=16, choices=STATUSES, default=STATUS_QUEUED, db_index=True)
    to = models.CharField(max_length=320)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    subject = models.CharField(max_length=300)
    # The body AS LOGGED. For a confirmation or a reset the link is NOT here: the body carries
    # `LINK_MARKER` and `services.render_body` builds the link at the moment of sending, from the
    # user. A database copy therefore never holds a working reset link, and a superuser reading
    # the log sees "[link]" rather than a way into somebody's account.
    body = models.TextField()
    locale = models.CharField(max_length=8, default='pl')
    attempts = models.PositiveSmallIntegerField(default=0)
    error = models.TextField(blank=True)
    transport = models.CharField(max_length=16, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    LINK_MARKER = '[[link]]'

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f'{self.kind} → {self.to} ({self.status})'


class InboundEmail(models.Model):
    # IMAP's own identity for a message: a UID is only unique within one UIDVALIDITY of a folder.
    uidvalidity = models.BigIntegerField()
    uid = models.BigIntegerField()
    folder = models.CharField(max_length=64, default='INBOX')
    message_id = models.CharField(max_length=500, blank=True)
    from_address = models.CharField(max_length=500, blank=True)
    to = models.TextField(blank=True)
    subject = models.CharField(max_length=500, blank=True)
    date = models.DateTimeField(null=True, blank=True, db_index=True)
    # Plain text only. An HTML-only message is reduced to its text with bleach (strip, no tags), so
    # nothing a stranger mailed us is ever rendered as markup in the Mail tab.
    body = models.TextField(blank=True)
    body_truncated = models.BooleanField(default=False)
    size = models.PositiveIntegerField(default=0)
    # [{"filename": ..., "content_type": ..., "size": ...}] — names, never bytes.
    attachments = models.JSONField(default=list, blank=True)
    fetched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-date', '-uid']
        constraints = [
            models.UniqueConstraint(fields=['folder', 'uidvalidity', 'uid'], name='mail_inbound_unique_uid'),
        ]

    def __str__(self):
        return f'{self.from_address}: {self.subject}'


class ConfirmedEmail(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, related_name='confirmed_email', on_delete=models.CASCADE)
    email = models.CharField(max_length=320)
    confirmed_at = models.DateTimeField(auto_now=True)


class MailPreference(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, related_name='mail_preference', on_delete=models.CASCADE)
    notification_digest = models.BooleanField(default=False)
    # Where the next digest starts counting from. Set to "now" when the digest is switched on, so
    # turning it on never mails a person their whole backlog.
    digest_since = models.DateTimeField(null=True, blank=True)
