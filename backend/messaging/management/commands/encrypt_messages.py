"""Encrypt the bodies of messages that were written before encryption was switched on.

Not required for correctness — `decrypt_text` returns an unprefixed value unchanged, so a mixed
table works — which is exactly why this is a command somebody runs rather than a migration that runs
itself. A data migration would encrypt every existing row under whatever key happened to be resolved
at migrate time, on every deployment, including one whose `EDMAT_MESSAGE_KEY` was not set up yet;
getting that wrong makes messages unreadable rather than merely un-encrypted, and the failure would
show up long after the migration that caused it.

    manage.py encrypt_messages --check    # count what is in clear, change nothing
    manage.py encrypt_messages            # encrypt those rows

Idempotent: a row that already carries the `edmat1:` prefix is skipped, so running it twice does not
double-encrypt anything.
"""

from django.core.management.base import BaseCommand
from postman.models import Message

from messaging.crypto import encrypt_text, is_encrypted


class Command(BaseCommand):
    help = 'Encrypt message bodies still stored in clear (see messaging/crypto.py).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--check',
            action='store_true',
            help='Report how many rows are still in clear without changing anything.',
        )

    def handle(self, *args, **options):
        plain, empty, already = [], 0, 0
        for message in Message.objects.all().only('id', 'body'):
            if not message.body:
                empty += 1
            elif is_encrypted(message.body):
                already += 1
            else:
                plain.append(message)

        self.stdout.write(
            f'{already} already encrypted, {empty} with no body, {len(plain)} in clear.'
        )
        if options['check'] or not plain:
            return

        for message in plain:
            message.body = encrypt_text(message.body)
            # `update_fields` deliberately: a Message carries moderation and threading state that
            # this command has no business rewriting, and a bare save() would write all of it back
            # from a row read with `.only()`.
            message.save(update_fields=['body'])
        self.stdout.write(self.style.SUCCESS(f'Encrypted {len(plain)} message bod{"y" if len(plain) == 1 else "ies"}.'))
