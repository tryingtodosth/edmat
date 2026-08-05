"""Retention, enforced. Run daily from cron — see deploy/DEPLOYMENT.md.

A retention period nobody enforces is not a retention period, it is a sentence in a privacy policy
that is not true. This command is what makes the policy accurate, so it is not optional
infrastructure.

Two stages, because they answer different questions:

1. **Truncate** — after the security window, an IP address is cut to its network prefix (/24 for
   IPv4, /48 for IPv6). Abuse patterns stay visible; the individual subscriber stops being
   identifiable. This is done in place and is irreversible.
2. **Delete** — after the full retention period, the traffic row goes entirely.

`AuditEvent` is deliberately NOT deleted here. It records what an identified person decided, and it
is kept for the life of the account plus the appeal window; it is pseudonymised on account deletion
instead (`pseudonymise_actor`), which keeps the decision while dropping the link to the person.
"""

import ipaddress

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from telemetry.models import AuditEvent, RequestLog
from telemetry.routers import all_log_shards

# Full-precision window. Long enough to investigate an incident somebody reported a week late,
# short enough that the site is not holding identifiable addresses for browsing that turned out to
# be entirely ordinary.
DEFAULT_TRUNCATE_AFTER_DAYS = 30
# Total life of a traffic row, truncated for most of it.
DEFAULT_DELETE_AFTER_DAYS = 90


def truncate_ip(value: str) -> str | None:
    """/24 for IPv4, /48 for IPv6 — the conventional boundary between "an operator's network" and
    "a household". Returns None if the stored value cannot be parsed, so a malformed row is cleared
    rather than kept at full precision by accident."""
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return None
    if address.version == 4:
        return str(ipaddress.ip_network(f'{address}/24', strict=False).network_address)
    return str(ipaddress.ip_network(f'{address}/48', strict=False).network_address)


class Command(BaseCommand):
    help = 'Truncate and expire activity logs across every shard, per the published retention policy.'

    def add_arguments(self, parser):
        parser.add_argument('--truncate-after-days', type=int, default=DEFAULT_TRUNCATE_AFTER_DAYS)
        parser.add_argument('--delete-after-days', type=int, default=DEFAULT_DELETE_AFTER_DAYS)
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report what would change without writing. Worth doing on the first real run.',
        )

    def handle(self, *args, **options):
        now = timezone.now()
        truncate_before = now - timezone.timedelta(days=options['truncate_after_days'])
        delete_before = now - timezone.timedelta(days=options['delete_after_days'])
        dry_run = options['dry_run']

        total_truncated = 0
        total_deleted = 0

        for shard in all_log_shards():
            stale = RequestLog.objects.using(shard).filter(
                created_at__lt=delete_before
            )
            deleted = stale.count()
            if not dry_run and deleted:
                stale.delete()

            # Only rows still holding a full address — `ip_truncated` makes this idempotent, so a
            # daily run does not repeatedly rewrite the same history.
            identifiable = RequestLog.objects.using(shard).filter(
                created_at__lt=truncate_before, ip_truncated=False, ip_address__isnull=False
            )
            truncated = 0
            if dry_run:
                truncated = identifiable.count()
            else:
                # One row at a time rather than a bulk UPDATE: the new value depends on the old one,
                # which SQL alone cannot express here. Volumes are bounded by the daily window.
                for row in identifiable.iterator(chunk_size=500):
                    row.ip_address = truncate_ip(row.ip_address)
                    row.ip_truncated = True
                    row.save(using=shard, update_fields=['ip_address', 'ip_truncated'])
                    truncated += 1

            audit_kept = AuditEvent.objects.using(shard).count()
            total_truncated += truncated
            total_deleted += deleted
            self.stdout.write(
                f'  {shard}: {deleted} expired, {truncated} truncated, {audit_kept} audit events kept'
            )

        prefix = '[dry run] ' if dry_run else ''
        self.stdout.write(
            self.style.SUCCESS(
                f'{prefix}{total_deleted} request rows expired, {total_truncated} addresses truncated '
                f'across {len(all_log_shards())} shards.'
            )
        )


def pseudonymise_actor(user_id: int) -> int:
    """Called when an account is deleted: drop the link to the person, keep the decision.

    Erasing the events instead would let anyone escape review of their own moderation by closing
    their account, which is precisely the outcome the appeal process exists to prevent. Retaining a
    record of a decision, without the identifier, is the balance the GDPR's own erasure right allows
    where there is an overriding legitimate ground.
    """
    from telemetry.routers import shard_for_user

    shard = shard_for_user(user_id)
    return AuditEvent.objects.using(shard).filter(actor_id=user_id).update(
        actor_id=None, actor_label='[deleted account]', ip_address=None
    )
