"""Retention for the personal data that had none (2026-10-14) — one table of rules, one command.

Every other retention in the project belongs to the app that owns the data and has its own command
(`enforce_log_retention`, `rollup_analytics`, `sso_purge`, `purge_event_data`). These had no
owner willing to delete anything, which is how they ended up kept "until the account is deleted" —
a sentence the privacy policy had to admit. They are gathered here so the policy's retention table
has ONE place in the code to be checked against, and `deploy/cron/edmat-retention` runs them nightly
through `manage.py enforce_data_retention`.

| Data | Kept | Why that long |
|---|---|---|
| `moderation.ContentView` — which exercises a signed-in person opened | 12 months | It is the denominator of the auto-hide rule (`moderation/services.py: check_auto_hide`). "Registered readers in the last year" is a fairer pool than "everybody who ever opened it", and a year covers an academic cycle |
| `materials.MaterialView` — which materials a person opened | 12 months | Feeds only "you have not opened this yet" in recommendations; a year-old view says little about that |
| `mail.OutboundEmail` — the log of mail sent | 12 months after it was created, once it is finished (sent, not sent, or out of retries) | Answers "did you send me that?" and debugging; links were never stored in it. A row still queued or retrying is never deleted |
| `mail.InboundEmail` — the copy of mail sent to us | 12 months after it was fetched | Long enough to answer and to refer back to; the mailbox itself on OVH is the operator's to clean |
| `community.Comment.anon_ip_hash` — the salted hash of an anonymous commenter's address | 30 days, then blanked (the comment stays) | It exists only to rate-limit "three comments in a minute"; 30 days matches the full-IP window of the request log |
| `courses.CourseInvite.sent_to` — the address a course invitation was mailed to (2026-11-02) | 30 days after the invite was made, then blanked (the invite row stays) | A mailed invite works once and expires after 14 days (`courses/mailinvite.py`); the address is only there to say "sent to …" and to refuse a duplicate while the first still works. It may be a stranger's who never answered |
"""

from datetime import timedelta

from django.utils import timezone

DAYS = {
    'content_views': 365,
    'material_views': 365,
    'outbound_mail': 365,
    'inbound_mail': 365,
    'anon_ip_hash': 30,
    'invite_address': 30,
}


def _rules(now):
    from community.models import Comment
    from courses.models import CourseInvite
    from mail.models import InboundEmail, OutboundEmail
    from materials.models import MaterialView
    from moderation.models import ContentView

    finished = [OutboundEmail.STATUS_SENT, OutboundEmail.STATUS_CONSOLE, OutboundEmail.STATUS_FAILED]
    cut = {k: now - timedelta(days=v) for k, v in DAYS.items()}
    return [
        ('content_views', 'delete', ContentView.objects.filter(viewed_at__lt=cut['content_views'])),
        ('material_views', 'delete', MaterialView.objects.filter(viewed_at__lt=cut['material_views'])),
        # A `failed` row past its retries is finished; one still under the attempt cap is the cron
        # job's to retry, and a year-old one of those is nothing anybody will retry either.
        ('outbound_mail', 'delete', OutboundEmail.objects.filter(status__in=finished, created_at__lt=cut['outbound_mail'])),
        ('inbound_mail', 'delete', InboundEmail.objects.filter(fetched_at__lt=cut['inbound_mail'])),
        ('anon_ip_hash', ('blank', 'anon_ip_hash'), Comment.objects.filter(created_at__lt=cut['anon_ip_hash']).exclude(anon_ip_hash='')),
        ('invite_address', ('blank', 'sent_to'), CourseInvite.objects.filter(created_at__lt=cut['invite_address']).exclude(sent_to='')),
    ]


def enforce(now=None, *, dry_run: bool = False) -> dict:
    """Returns `{rule: rows affected}` (or rows that would be, under `dry_run`). Idempotent."""
    now = now or timezone.now()
    out = {}
    for name, action, qs in _rules(now):
        if dry_run:
            out[name] = qs.count()
        elif action == 'delete':
            out[name] = qs.delete()[0]
        else:
            _, field = action
            out[name] = qs.update(**{field: ''})
    return out
