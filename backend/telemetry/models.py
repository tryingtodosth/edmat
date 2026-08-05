"""What EdMat records about how the site is used — and, just as deliberately, what it does not.

**Everything here is collected without a consent banner, and that is a legal position, not an
oversight.** The cookie rule (ePrivacy Art. 5(3)) governs storing or reading information on the
visitor's own device. Nothing in this module touches the visitor's device: the browser sends a
request, the server writes down what arrived. That is ordinary processing of personal data, governed
by the GDPR instead, and its lawful basis is legitimate interest (Art. 6(1)(f)) — Recital 49 names
network and information security explicitly. So the obligations that apply are transparency,
minimisation and retention, all of which are met here and stated in the privacy policy, rather than
consent.

**The line this must never cross.** It is the PURPOSE that decides, not the field. A `User-Agent`
written to a log so a 500 can be reproduced is fine. The same string hashed together with the IP and
`Accept-Language` into a stable identifier for a returning anonymous visitor is device fingerprinting,
which the EDPB's Guidelines 2/2023 place squarely back inside Art. 5(3) — consent required, no cookie
involved. Nothing here may ever derive a persistent visitor identifier, and there is a test asserting
it (`test_no_visitor_fingerprint`).

Two models, because they answer to different rules and must not share a retention policy:

- `RequestLog` — traffic. Mostly anonymous, high volume, short life, security and debugging only.
- `AuditEvent` — what an identified person DID: moderation decisions, tier changes, uploads. Kept far
  longer, because an appeal that cannot be reconstructed is not an appeal.

Merging them would force the strictest rule onto everything and quietly turn a 90-day traffic log
into a permanent record of who read what.
"""

from django.conf import settings
from django.db import models


class RequestLog(models.Model):
    """One HTTP request. Written by `telemetry.middleware.RequestLogMiddleware`.

    `user_id` is a plain integer, not a ForeignKey, on purpose: this row lives in a DIFFERENT SQLite
    file from `auth_user`, and SQLite cannot enforce — or join — a foreign key across files. A real
    FK here would be a constraint the database is silently unable to keep. Resolving a user is the
    reader's job, and is deliberately a little inconvenient, because most reads of this table should
    never need it at all.
    """

    # --- who (as coarsely as the purpose allows) ---
    user_id = models.PositiveIntegerField(
        null=True,
        blank=True,
        db_index=True,
        help_text='Null for anonymous traffic. Not an FK — see the class docstring.',
    )
    # Held at full precision only for the security window, then truncated in place by
    # `enforce_log_retention`. Nullable because it is genuinely erased, not merely stopped.
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    ip_truncated = models.BooleanField(
        default=False,
        help_text='True once the address has been cut to /24 (IPv4) or /48 (IPv6).',
    )

    # --- what ---
    method = models.CharField(max_length=10)
    path = models.CharField(max_length=500)
    # Deliberately separate from `path`, and dropped entirely for search endpoints: what somebody
    # typed into `?q=` on a study site is their content, not metadata about a request, and it is
    # more revealing than their IP address. `middleware.redact_query_string` is what enforces that.
    query_string = models.CharField(max_length=500, blank=True)
    status_code = models.PositiveSmallIntegerField()
    duration_ms = models.PositiveIntegerField()

    # --- context, for debugging and abuse handling only ---
    user_agent = models.CharField(max_length=400, blank=True)
    referer = models.CharField(max_length=500, blank=True)
    # Random per REQUEST, never per visitor — see the module docstring. Correlates one request's log
    # line with its error report; it cannot link two requests by the same person.
    request_id = models.CharField(max_length=36, db_index=True)
    was_throttled = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['created_at', 'status_code'])]

    def __str__(self) -> str:
        return f'{self.method} {self.path} [{self.status_code}]'


class AuditEvent(models.Model):
    """A deliberate act by an identified person, kept so it can be reviewed later.

    This is the record the trust system's appeal process reads (see LAUNCHCHECKLIST.md §🟤): a
    moderation decision nobody can reconstruct cannot be investigated, upheld or overturned. It
    therefore outlives the traffic log by years, and it survives account deletion in pseudonymised
    form — `actor_id` is cleared, the decision and its reason stay. Erasing the decision instead
    would let anyone escape the consequences of their own moderation by closing their account.
    """

    ACTION_CHOICES = [
        ('login', 'Login'),
        ('logout', 'Logout'),
        ('register', 'Registration'),
        ('password_change', 'Password change'),
        ('content_create', 'Content created'),
        ('content_edit', 'Content edited'),
        ('content_remove', 'Content removed'),
        ('upload', 'File uploaded'),
        ('moderation_decision', 'Moderation decision'),
        ('feature_flag', 'Feature flag changed'),
        ('permission_change', 'Permission or tier changed'),
    ]

    actor_id = models.PositiveIntegerField(
        null=True,
        blank=True,
        db_index=True,
        help_text='Cleared on account deletion; the event itself is kept. Not an FK — cross-file.',
    )
    actor_label = models.CharField(
        max_length=150,
        blank=True,
        help_text='Username as it was at the time — a record of who acted survives a later rename.',
    )
    action = models.CharField(max_length=30, choices=ACTION_CHOICES, db_index=True)
    # Free-text rather than a real ContentType FK, for the same cross-file reason as `user_id`:
    # `django_content_type` lives in the default database and cannot be joined from here.
    target_type = models.CharField(max_length=60, blank=True)
    target_id = models.CharField(max_length=60, blank=True)
    summary = models.CharField(max_length=500, blank=True)
    detail = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    request_id = models.CharField(max_length=36, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['actor_id', 'created_at'])]

    def __str__(self) -> str:
        return f'{self.action} by {self.actor_label or "anon"} at {self.created_at:%Y-%m-%d %H:%M}'
