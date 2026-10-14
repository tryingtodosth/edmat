"""`manage.py mail_check [--send-to ADDRESS]` — is the mailbox reachable with the configured password?

Logs into SMTP and IMAP and says which transport the site would use; sends nothing unless
`--send-to` is given, in which case it queues one test message and delivers it immediately. The
first thing to run after putting the password file in place.
"""

import imaplib
import smtplib

from django.conf import settings
from django.core.management.base import BaseCommand

from mail import services
from mail.models import OutboundEmail
from mail.texts import text
from mail.transport import transport_name


class Command(BaseCommand):
    help = 'Check SMTP and IMAP login for the configured mailbox.'

    def add_arguments(self, parser):
        parser.add_argument('--send-to', default='', help='Also send one test message to this address.')

    def handle(self, *args, **options):
        self.stdout.write(f'transport: {transport_name()}   from: {settings.DEFAULT_FROM_EMAIL}')
        if not settings.EMAIL_HOST_PASSWORD:
            self.stdout.write(self.style.WARNING(
                'no password: neither EDMAT_MAIL_PASSWORD nor a readable password file '
                '(EDMAT_MAIL_PASSWORD_FILE, default /etc/edmat/mail-password). Run this as www-data.'
            ))
            return
        try:
            smtp_class = smtplib.SMTP_SSL if settings.EMAIL_USE_SSL else smtplib.SMTP
            with smtp_class(settings.EMAIL_HOST, settings.EMAIL_PORT, timeout=20) as smtp:
                if settings.EMAIL_USE_TLS:
                    smtp.starttls()
                smtp.login(settings.EMAIL_HOST_USER, settings.EMAIL_HOST_PASSWORD)
            self.stdout.write(self.style.SUCCESS(f'SMTP login OK ({settings.EMAIL_HOST}:{settings.EMAIL_PORT})'))
        except Exception as exc:  # noqa: BLE001
            self.stdout.write(self.style.ERROR(f'SMTP: {type(exc).__name__}: {exc}'))
        try:
            client = imaplib.IMAP4_SSL(settings.EDMAT_IMAP_HOST, settings.EDMAT_IMAP_PORT, timeout=20)
            client.login(settings.EMAIL_HOST_USER, settings.EMAIL_HOST_PASSWORD)
            _, data = client.select('INBOX', readonly=True)
            self.stdout.write(self.style.SUCCESS(f'IMAP login OK ({settings.EDMAT_IMAP_HOST}), INBOX holds {data[0].decode()}'))
            client.logout()
        except Exception as exc:  # noqa: BLE001
            self.stdout.write(self.style.ERROR(f'IMAP: {type(exc).__name__}: {exc}'))
        if options['send_to']:
            # Written directly rather than through `services.queue`, whose commit hook would start a
            # delivery thread racing the one below for the same row.
            row = OutboundEmail.objects.create(
                kind=OutboundEmail.KIND_TEST, to=options['send_to'], subject=text('pl', 'test_subject'),
                body=text('pl', 'test_body'), transport=transport_name(),
            )
            status = services.deliver(row.pk)
            row.refresh_from_db()
            self.stdout.write(f'test message #{row.pk}: {status} {row.error}')
