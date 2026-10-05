"""One lived-in demo school, so school mode has something to show.

    manage.py seed_school_demo                 # build or rebuild
    manage.py seed_school_demo --password X
    manage.py seed_school_demo --reset         # remove it (school, classes, school.* accounts) and stop

Builds a school (`organizations.Organization` of kind `school`), two classes it runs, the teacher who
runs them, a head teacher who owns the body, twelve pupils — eleven minors with guardians on file —
the progress each pupil stated about themselves, and one completion certificate.
`testing/school_demo.py` holds the content and says what is synthesised (all of it).

`seed_conference_demo`'s shape and both of its promises: every seeded course and the school carry the
`TEST=FAKE ` marker, and no seeded account holds authority outside the demo (`assert_contained`, run
inside the build's transaction). The password is printed at the end; on a real deployment that is a
decision, not a side effect.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from moderation.models import FeatureFlag
from testing.school_demo import (
    CLASS_PLAN,
    DEFAULT_PASSWORD,
    FLAGS_NEEDED,
    PREFIX,
    SCHOOL_SLUG,
    WORTH_SIGNING_IN_AS,
    build_school_demo,
    remove_school_demo,
)


class Command(BaseCommand):
    help = 'Seed (or rebuild) one realistic demo school: two classes, a teacher, twelve pupils with guardians.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--password',
            default=DEFAULT_PASSWORD,
            help='Password for every account made (default: the personas’ one).',
        )
        parser.add_argument(
            '--reset',
            action='store_true',
            help=f'Remove the demo school, its classes and every {PREFIX}* account, then stop.',
        )

    def handle(self, *args, **options):
        if options['reset']:
            counts = remove_school_demo()
            self.stdout.write(
                self.style.WARNING(
                    # Django's own cascade totals, as `seed_conference_demo --reset` reports them:
                    # each number counts the row AND everything deleted with it, which is the honest
                    # thing to print when one course takes thirty progress statements with it.
                    f'Removed (including cascades): {counts["courses"]} row(s) under the two classes, '
                    f'{counts["organizations"]} under the school, {counts["links"]} organisation link(s), '
                    f'{counts["accounts"]} under the {PREFIX}* accounts.'
                )
            )
            return

        # One transaction around the whole build, so the containment check at the end of it — and
        # the certificate check inside it — can refuse and leave nothing behind rather than a
        # half-privileged school or one holding a certificate the API would not have issued.
        try:
            with transaction.atomic():
                built = build_school_demo(options['password'])
        except RuntimeError as exc:
            raise CommandError(str(exc)) from exc
        report, school = built['report'], built['school']

        self.stdout.write(
            self.style.SUCCESS(f'“{school.name}” — /organizations/{SCHOOL_SLUG}')
        )
        for plan in CLASS_PLAN:
            course = built['classes'][plan['key']]['course']
            self.stdout.write(
                f'  /courses/{course.pk}   {course.title}   '
                f'(progress_visibility={course.progress_visibility}, '
                f'{course.enrollments.count()} pupils, '
                f'{len(built["classes"][plan["key"]]["lessons"])} lessons)'
            )
        self.stdout.write('')
        self.stdout.write(
            f'  {report["pupils"]} pupils ({report["minors"]} of them minors) · '
            f'{report["guardians"]} guardians · {report["lessons"]} lessons · '
            f'{report["exercises_filed"]} exercises filed · {report["progress_rows"]} progress statements'
        )
        branch = report['branch'] or '— (no branch in the taxonomy, so the classes carry no subject)'
        self.stdout.write(f'  Subject branch: {branch}')
        cert = built['certificate']
        self.stdout.write(
            f'  1 certificate: /courses/{cert.course_id}/certificate/{cert.pk} — {cert.note}'
        )
        self.stdout.write(
            f'  Containment: {report["containment"]["accounts_checked"]} accounts over '
            f'{report["containment"]["surfaces_checked"]} authority surfaces, none outside the demo.'
        )
        self.stdout.write('')
        self.stdout.write('  Accounts worth signing in as (password below):')
        for username, note in WORTH_SIGNING_IN_AS:
            self.stdout.write(f'    {username:26} {note}')
        self.stdout.write(
            f'    {PREFIX}pupil.01 … {PREFIX}pupil.12   the whole roster; '
            f'{PREFIX}guardian.01 … {PREFIX}guardian.11   the guardians'
        )
        self.stdout.write('')
        self.stdout.write(self.style.WARNING(f'  Password for all of them: {built["password"]}'))

        off = list(
            FeatureFlag.objects.filter(key__in=FLAGS_NEEDED, is_enabled=False).values_list(
                'key', flat=True
            )
        )
        if off:
            self.stdout.write(
                self.style.WARNING(
                    f'  Note: the flag(s) {", ".join(off)} are OFF, so part of this is hidden. '
                    'Not flipped — a kill switch is somebody’s decision.'
                )
            )
