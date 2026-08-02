"""Runs `migrate` against every log shard, and warns before capacity runs out.

`manage.py migrate` on its own only touches `default`, so without this the log tables would simply
never exist. Every deploy has to run this alongside the ordinary migrate — see deploy/DEPLOYMENT.md.
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand

from telemetry.routers import all_log_shards


class Command(BaseCommand):
    help = 'Apply telemetry migrations to every log shard and report remaining user capacity.'

    def add_arguments(self, parser):
        parser.add_argument('--check-capacity-only', action='store_true')

    def handle(self, *args, **options):
        shards = all_log_shards()

        if not options['check_capacity_only']:
            for shard in shards:
                self.stdout.write(f'  migrating {shard}…')
                call_command('migrate', 'telemetry', database=shard, verbosity=0)
            self.stdout.write(self.style.SUCCESS(f'{len(shards)} log shards migrated.'))

        # Capacity is driven by the HIGHEST user id, not the user count — ids are never reused, so a
        # site that has deleted many accounts can be near capacity while looking half empty.
        User = get_user_model()
        highest = User.objects.order_by('-id').values_list('id', flat=True).first() or 0
        capacity = settings.LOG_SHARD_SIZE * settings.LOG_SHARD_COUNT
        used_shards = highest // settings.LOG_SHARD_SIZE + 1

        self.stdout.write(
            f'Highest user id {highest}; using {used_shards} of {settings.LOG_SHARD_COUNT} shards '
            f'({settings.LOG_SHARD_SIZE} users each, capacity {capacity}).'
        )
        if used_shards >= settings.LOG_SHARD_COUNT:
            self.stdout.write(
                self.style.ERROR(
                    'AT CAPACITY — new accounts cannot be logged. Raise EDMAT_LOG_SHARD_COUNT and '
                    're-run. Never change EDMAT_LOG_SHARD_SIZE: shard membership is user_id // SIZE, '
                    'so changing it re-points every existing user at a different file.'
                )
            )
        elif used_shards >= settings.LOG_SHARD_COUNT - 1:
            self.stdout.write(
                self.style.WARNING('One shard from capacity — raise EDMAT_LOG_SHARD_COUNT soon.')
            )
