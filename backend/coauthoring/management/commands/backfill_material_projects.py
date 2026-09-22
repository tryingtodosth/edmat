"""Give every material that has no project one. Safe to re-run; makes nothing new for a material
that already has one."""

from django.core.management.base import BaseCommand

from coauthoring.backfill import ensure_projects


class Command(BaseCommand):
    help = 'Create a project and a published version 1 for every material that has none.'

    def handle(self, *args, **options):
        made = ensure_projects()
        if made:
            self.stdout.write(
                self.style.SUCCESS(f'Gave {made} material(s) a project and a version 1.')
            )
        else:
            self.stdout.write('Every material already has a project.')
