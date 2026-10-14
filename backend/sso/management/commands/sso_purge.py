"""Deletes expired sign-in attempts, login codes and signup tickets (sso/services.py: purge).

Run it from cron with the mail job (every five minutes is plenty; hourly is enough). It also runs,
cheaply, on every press of a provider button, so a deployment that forgets the cron line still
does not keep an unfinished signup's email address for more than an hour past its expiry.
"""

from django.core.management.base import BaseCommand

from sso.services import purge


class Command(BaseCommand):
    help = 'Delete expired SSO attempts, codes and signup tickets.'

    def handle(self, *args, **options):
        counts = purge()
        self.stdout.write(', '.join(f'{k}: {v}' for k, v in counts.items()))
