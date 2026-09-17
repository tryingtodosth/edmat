"""DSA Art. 16 "notice and action": a legal notice that a SPECIFIC, already-published piece of
content is illegal. Deliberately its own app, its own model, and its own always-on endpoint — NOT
`issues.Issue` with a fourth `kind`, and NOT gated by the `issues` `FeatureFlag` or any kill switch
of its own (`moderation.models.FEATURE_FLAG_CHOICES`'s own docstring calls a flag "a genuine kill
switch for an entire feature surface" — this channel is the opposite of that: a standing legal
obligation this platform commits to keeping open, not a product feature somebody might turn off to
quiet down bug reports).

Distinct from `Issue` on the merits too, not just the flag:
- `contact_email` is OPTIONAL on an Issue (an anonymous bug report may genuinely have nobody to
  reach). It is REQUIRED here, even for a fully anonymous notifier — DSA's whole "actual knowledge"
  mechanism (Art. 16(3)) depends on the platform being able to follow up, and Art. 16(6) obliges a
  decision to be communicated back to whoever sent the notice.
- `content_url` and `good_faith_confirmed` have no Issue equivalent — Art. 16(2)(b)/(d).
- Status here is `open` / `acted` / `rejected`, not Issue's four-value set, because DSA's own
  framing is binary: either the platform restricted the content or it didn't, and Art. 17 requires a
  real stated ground either way once a decision is made (`resolve_note` below, made mandatory in
  `legal/serializers.py` the moment `status` leaves `open`).

**`content_kind`/`content_object_id` are set by STAFF during review, not by the notifier.** A
notifier identifies the content by URL (exactly what DSA Art. 16(2)(b) asks for — a URL, not a
database id); resolving that URL to one of this app's own reportable rows is a human judgment call
a moderator makes while triaging, using `moderation.services.REPORT_KIND_MODELS` — the same catalog
`Report`/`ReportActionView` already use, reused here so acting on a legal notice reuses the EXACT
same content-mutation logic (`moderation.services.resolve_report_decision`) rather than a second,
independently-drifting copy. Left blank when the notice does not map onto a moderatable content row
at all, or when staff choose to act outside the app (e.g. Django admin, a direct DB fix) and simply
record the decision and its reason here.
"""

from django.conf import settings
from django.db import models

LEGAL_NOTICE_STATUS_CHOICES = [
    ('open', 'Open — awaiting review'),
    ('acted', 'Content removed or restricted'),
    ('rejected', 'Reviewed — no action taken'),
]


class LegalNotice(models.Model):
    # Art. 16(2)(b) — "an indication of the exact electronic location of that information, such as
    # the URL". A URL, not a resolved content row: DSA does not require (and this app does not
    # attempt) a machine-resolvable target at submission time.
    content_url = models.URLField(max_length=500)
    # Art. 16(2)(a) — "an explanation of the reasons why the individual or entity considers the
    # information in question to be illegal content".
    explanation = models.TextField()
    # Art. 16(2)(d) — "a statement confirming the bona fide belief... that the information and
    # allegations contained therein are accurate and complete". Must be True to submit — enforced in
    # the serializer, not just the default, so a form that silently sent False can never slip through.
    good_faith_confirmed = models.BooleanField(default=False)
    # Art. 16(2)(c) — name of the notifier. Optional: this platform does not verify identity for an
    # ordinary account, so requiring a "real name" here would be theatre, not compliance; offered as
    # a free-text field for whoever wants to give one.
    notifier_name = models.CharField(max_length=200, blank=True)
    # Required even when the notifier has no account and asked to stay unidentified — see the module
    # docstring. Never dropped the way `issues.Issue.contact_email` is for an anonymous bug report.
    contact_email = models.EmailField()
    # Set when the notifier is signed in at submission time; None for a genuine guest. SET_NULL, so
    # deleting an account never deletes the record of a real legal notice.
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        related_name='legal_notices',
        on_delete=models.SET_NULL,
    )
    status = models.CharField(max_length=10, choices=LEGAL_NOTICE_STATUS_CHOICES, default='open')
    # Set by staff during triage — see the module docstring. `content_kind` mirrors
    # `moderation.services.REPORT_KIND_MODELS`'s own key strings, validated against that catalog in
    # the serializer rather than a second, independently-drifting `choices=` list here.
    content_kind = models.CharField(max_length=20, blank=True)
    content_object_id = models.PositiveIntegerField(null=True, blank=True)
    # The Art. 17 "statement of reasons" — mandatory in the serializer the moment `status` moves away
    # from 'open', whichever way the decision goes. Shown to the notifier (`notify()`, if they have
    # an account to notify) and, when `content_kind`/`content_object_id` resolve to a real row and the
    # decision is 'acted', to the content's own author too — via the exact same `content_removed`
    # notification type `ReportActionView` already sends for a routine report.
    resolve_note = models.TextField(blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, related_name='+', on_delete=models.SET_NULL
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'legal notice re {self.content_url} [{self.status}]'
