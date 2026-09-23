"""`manage.py seed_conference_personas` — seven accounts, one conference, and a table saying who
can do what (CONFERENCE-BRIEF.md §3.B).

This is EdMat's whole answer to "let me see what a volunteer sees". There is no "log in as"
anywhere in this codebase and there is not going to be one: a preview never carries somebody
else's token (see `testing/personas.py` for the Facebook post-mortem this rule comes from), so the
way to see a volunteer's screen is to sign in as a volunteer who is not a real person.

    ../.venv/bin/python3 manage.py seed_conference_personas
    ../.venv/bin/python3 manage.py seed_conference_personas --password 'something else'

Idempotent: run it as often as you like. It resets the passwords, pushes the conference's dates
back into the future, and leaves exactly one of everything.

**These accounts can sign in.** On a real deployment that is a decision, not a side effect — the
command prints the password it used precisely so that nobody has to guess whether it was left at
the default.
"""

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from testing.personas import CAPABILITY_TABLE, DEFAULT_PASSWORD, PERSONA_USERNAMES, make_personas


class Command(BaseCommand):
    help = 'Create or refresh the conference personas and the Sandbox conference they live on.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--password',
            default=DEFAULT_PASSWORD,
            help=f'The password every persona gets (default: {DEFAULT_PASSWORD}).',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        password = options['password']
        built = make_personas(password=password)
        event = built['event']

        self.stdout.write(self.style.SUCCESS(f'“{event.title}” — /events/{event.pk}'))
        self.stdout.write(
            f'  {event.status}, {event.visibility}, '
            f'{timezone.localtime(event.starts_at):%Y-%m-%d %H:%M} → '
            f'{timezone.localtime(event.runs_until):%Y-%m-%d %H:%M} ({settings.TIME_ZONE}), '
            f'{len(built["sessions"])} sessions, registration by {event.registration_mode}, '
            f'call for contributions {"open" if event.cfp_open else "closed"}'
        )
        self.stdout.write('')

        self.stdout.write('  Accounts (password below):')
        for username, display_name in PERSONA_USERNAMES.items():
            self.stdout.write(f'    {username + "@edmat.example":36} {display_name}')
        self.stdout.write(f'    {"persona.child (no email)":36} {built["child"].profile.display_name} — a real minor, via the guardian flow')
        self.stdout.write('')

        widths = (14, 74)
        self.stdout.write(f'  {"Persona":{widths[0]}} {"May":{widths[1]}} May not')
        self.stdout.write(f'  {"-" * widths[0]} {"-" * widths[1]} {"-" * 60}')
        for persona, may, may_not in CAPABILITY_TABLE:
            self.stdout.write(f'  {persona:{widths[0]}} {may:{widths[1]}} {may_not}')
        self.stdout.write('')
        self.stdout.write(
            '  Proved endpoint by endpoint in events/test_permission_matrix.py, which builds these '
            'same personas.'
        )
        self.stdout.write('')
        self.stdout.write(self.style.WARNING(f'  Password for all of them: {password}'))
