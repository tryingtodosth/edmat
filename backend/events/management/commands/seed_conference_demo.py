"""One lived-in demo conference, so the conference layer has something to show.

    manage.py seed_conference_demo                    # build or rebuild, day one = today
    manage.py seed_conference_demo --day-one 2026-10-14
    manage.py seed_conference_demo --password X
    manage.py seed_conference_demo --reset            # remove it (accounts, event, venue) and stop

Builds on `seed_conference_personas` (the seven accounts and the Sandbox conference are made or
refreshed first) and adds "Dni Dydaktyki Fizyki 2026": a two-day, ~150-person teaching conference
at a demo venue shaped like Pasteura 5, with rooms, approved bookings, a checklist, documents in
every tier, a programme, registrations with tickets, a day-one scan log, a rota and a cloakroom.
`testing/conference_demo.py` holds the content and says what is synthesised (nearly all of it) and
what the research report contributed. The password is printed at the end; on a real deployment
that is a decision, not a side effect.
"""

from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from moderation.models import FeatureFlag
from testing.conference_demo import (
    DEFAULT_PASSWORD,
    FLAGS_NEEDED,
    PREFIX,
    VOLUNTEERS,
    make_conference_demo,
    remove_conference_demo,
)


class Command(BaseCommand):
    help = 'Seed (or rebuild) one realistic demo conference on top of the conference personas.'

    def add_arguments(self, parser):
        parser.add_argument('--password', default=DEFAULT_PASSWORD, help='Password for every account made (default: the personas’ one).')
        parser.add_argument('--day-one', type=date.fromisoformat, default=None, metavar='YYYY-MM-DD',
                            help='Which calendar day (Warsaw) is day one (default: today, so the conference is in progress).')
        parser.add_argument('--reset', action='store_true', help='Remove the demo conference, its venue and its conf.* accounts, then stop.')

    def handle(self, *args, **options):
        if options['reset']:
            counts = remove_conference_demo()
            self.stdout.write(self.style.WARNING(
                f'Removed: {counts["events"]} event row(s) and everything under them, '
                f'{counts["venues"]} venue row(s), {counts["accounts"]} {PREFIX}* account row(s).'
            ))
            return

        try:
            with transaction.atomic():
                built = make_conference_demo(options['password'], day_one=options['day_one'])
        except RuntimeError as exc:  # a hand-edited rota plan that the rota itself would refuse
            raise CommandError(str(exc)) from exc

        event, report, venue = built['event'], built['report'], built['venue']
        self.stdout.write(self.style.SUCCESS(f'“{event.title}” — /events/{event.pk}   (venue “{venue.name}” — /venues/{venue.slug})'))
        when = 'in progress' if report['in_progress'] else 'not in progress right now'
        self.stdout.write(f'  Day one: {report["day_one"]} (Warsaw) — {when}. Everything the plan dates after now is left unapplied; re-run later for more of day one.')
        self.stdout.write('')
        self.stdout.write(
            f'  {report["registered"]} registrations ({report["going"]} going, {report["waitlisted"]} waiting; capacity {event.capacity}, so it reads as full) · '
            f'{report["sessions"]} sessions · {report["contributions"]} proposals in the call'
        )
        self.stdout.write(f'  {report["checked_in"]} checked in from {report["scans"]} scans · {report.get("documents", 0)} documents · {report.get("checklist_items", 0)} checklist items')
        self.stdout.write(
            f'  Rota: {report["stations"]} stations, {report["shifts"]} shifts, {report["shifts_done"]} assignments already done, {report["shifts_short"]} shifts short-staffed'
        )
        self.stdout.write(f'  Cloakroom: {report["coats_stored"]} on the racks, {report["coats_returned"]} returned, {report["coats_exception"]} returned on a lost slip')
        self.stdout.write('')
        self.stdout.write('  Accounts worth signing in as (password below; the seven personas too):')
        for username, note in (
            ('persona.organiser', 'runs the conference'),
            ('persona.venue_admin', 'runs the building — checklist sign-off, bookings, the venue tier'),
            ('persona.porter', 'venue porter'),
            ('persona.volunteer', 'volunteer on the registration desk, briefing read'),
            ('persona.clerk', 'volunteer who has NOT read the briefing — the scanner and the desk refuse them'),
            (f'{PREFIX}volunteer.09', 'volunteer who read version 1 of the briefing, not the corrected version 2'),
            ('persona.child', 'a 15-year-old volunteer on the information desk, consent on file (guardian: persona.guardian)'),
            (f'{PREFIX}child.02', 'a second minor on staff with NO consent on file — cannot claim a shift'),
            (f'{PREFIX}attendee.001 … {PREFIX}attendee.144', 'attendees; the first few are speakers or proposers'),
        ):
            self.stdout.write(f'    {username:36} {note}')
        self.stdout.write(f'    {len(VOLUNTEERS)} more volunteers: {PREFIX}volunteer.01 … {PREFIX}volunteer.{len(VOLUNTEERS):02d}')
        self.stdout.write('')
        self.stdout.write(self.style.WARNING(f'  Password for all of them: {built["password"]}'))

        off = list(FeatureFlag.objects.filter(key__in=FLAGS_NEEDED, is_enabled=False).values_list('key', flat=True))
        if off:
            self.stdout.write(self.style.WARNING(
                f'  Note: the flag(s) {", ".join(off)} are OFF, so part of this is hidden. Not flipped — a kill switch is somebody’s decision.'
            ))
