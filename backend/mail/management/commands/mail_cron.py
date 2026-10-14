"""Every five minutes on webek4 (`/etc/cron.d/edmat-mail`, `deploy/UPDATE-2026-10-14.md`): send what
is still waiting, queue the notification digests that are due, and copy new inbox messages.

Each of the three steps runs even if an earlier one failed — OVH's IMAP being down is no reason not
to send a password reset — and the output is one line per step, for the system log.
"""

from django.core.management.base import BaseCommand

from mail import inbox, services


class Command(BaseCommand):
    help = 'Send queued mail, queue notification digests, fetch the inbox.'

    def add_arguments(self, parser):
        parser.add_argument('--no-fetch', action='store_true', help='Skip the IMAP fetch.')

    def handle(self, *args, **options):
        digests = services.send_digests()
        self.stdout.write(f'digests queued: {digests}')
        result = services.drain()
        self.stdout.write(f"outbound: {result['sent']} sent, {result['failed']} failed, {result['stuck']} un-stuck")
        if options['no_fetch']:
            return
        try:
            self.stdout.write(f'inbound: {inbox.fetch()} fetched')
        except inbox.MailUnavailable as exc:
            self.stdout.write(f'inbound: unavailable ({exc.reason}) {exc.detail}')
