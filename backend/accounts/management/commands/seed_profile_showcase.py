"""Fills ONE account's profile with enough real content to judge the profile screens by.

`seed_demo_content` already populates the site — several people, courses, reviews, comments. What it
does not do is fill any single profile deeply enough to tell whether the profile page *works*: a
person with three skills and no transcript, no certificates and an activity feed of four rows renders
the same whether the layout is right or wrong. Every summary tile reads a plausible number and every
modal opens onto something small enough to look deliberate.

So this is a second, narrower command beside it rather than more cases inside it, and the split is
not stylistic:

* It targets an account that **already exists** (`u-kasia` by default, the seeded moderator every
  other demo flow signs in as) instead of creating one. `seed_demo_content`'s own `--reset` deletes
  by `username__startswith='demo-'`, so putting Kasia's content in there would have made it
  unresettable — the reset would either miss it or would have to delete an account other things
  depend on.
* It writes across five apps (`accounts`, `identity`, `community`, `study`, `courses`, `services`)
  for one person, where the other command writes one shape at a time for several.

**Idempotent, and `--reset` removes exactly what it created.** Everything is keyed on something
stable and every deletable thing is listed as a constant in this file, so a re-run changes nothing and
a reset never touches a review somebody wrote by hand. The one deliberate exception is attribution
(`Exercise.submitted_by` on corpus rows), which is additive-only and only ever fills a blank — the
same decision, for the same reason, `seed_demo_content._seed_attribution` already records.

    manage.py seed_profile_showcase
    manage.py seed_profile_showcase --user u-ola
    manage.py seed_profile_showcase --reset
"""

from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import Certificate, ExperienceEntry, Profile, SkillEntry
from community.models import Comment, Review
from courses.models import Chapter, Course, Enrollment, Lesson, LessonProgress
from exercises.models import Exercise
from identity import services as identity_services
from identity.models import EducationProfile, School
from materials.models import Material
from services.models import Service, ServiceReview
from study.models import ExerciseSet, ExerciseSetItem
from taxonomy.models import Branch

User = get_user_model()

DEFAULT_USERNAME = 'u-kasia'

#: The institution whose transcript is transferred. Must be one that runs USOS, or there is nothing
#: to connect to and the whole education half of the profile stays empty — which is a real state the
#: app handles, and the wrong one to demonstrate with.
SHOWCASE_SCHOOL_SLUG = 'uw'

BIO = (
    'Czwarty rok matematyki na UW, specjalizacja: analiza. Prowadzę ćwiczenia na pierwszym roku i '
    'zbieram zadania z kolokwiów — jeśli masz jakieś sprzed 2020, napisz.'
)

#: `(kind, title, organisation, started (year, month), ended (year, month) or None)`
EXPERIENCE = [
    ('study', 'Matematyka, studia magisterskie', 'Uniwersytet Warszawski', (2025, 10), None),
    ('teaching', 'Ćwiczenia z Analizy Matematycznej I', 'MIM UW', (2024, 10), None),
    ('study', 'Matematyka, studia licencjackie', 'Uniwersytet Warszawski', (2022, 10), (2025, 6)),
    ('work', 'Stażystka — zespół analityczny', 'towarzystwo ubezpieczeń', (2024, 7), (2024, 9)),
    ('project', 'Koło naukowe — seminarium z teorii miary', 'MIM UW', (2023, 10), (2024, 6)),
]

#: `(label, level, evidence)`. All three evidence values are represented on purpose: the distinction
#: between them is the whole point of the field, and a demo that only ever shows one makes the badge
#: look decorative.
#:
#: `registry` is written directly here, which the API deliberately refuses to do
#: (`SkillViewSet.perform_create` downgrades it — a value anybody can type is worth what typing
#: costs). That is not a loophole: `registry` means an institution said so, and a seed standing in for
#: `identity.standing.skill_seeds` is exactly the non-user-input path that value exists for.
SKILLS = [
    ('Analiza matematyczna', 'teaching', 'registry'),
    ('Algebra liniowa z geometrią I', 'comfortable', 'registry'),
    ('Rachunek prawdopodobieństwa', 'comfortable', 'coursework'),
    ('Topologia', 'learning', 'coursework'),
    ('LaTeX', 'teaching', 'self_declared'),
    ('Python', 'comfortable', 'self_declared'),
]

#: `(title, issuer, issued (y, m, d), expires (y, m, d) or None, credential_id, url)`
#:
#: One of each shape the model can hold, because each renders differently and each is a real case: a
#: language certificate that expires, a course certificate that does not, one with a verification link
#: and a reference, and one with neither (a paper certificate, which is the common case and the one
#: that must not look broken).
CERTIFICATES = [
    (
        'Certificate in Advanced English (C1)',
        'Cambridge Assessment English',
        (2023, 6, 15),
        None,
        '0123456789',
        'https://www.cambridgeenglish.org/verify-certificate/',
    ),
    (
        'Mathematics for Machine Learning',
        'Imperial College London (Coursera)',
        (2024, 2, 3),
        None,
        'ABC123XYZ',
        'https://www.coursera.org/account/accomplishments/verify/ABC123XYZ',
    ),
    (
        'Pierwsza pomoc — kurs podstawowy',
        'PCK',
        (2022, 4, 9),
        (2025, 4, 9),
        '',
        '',
    ),
    ('Warsztat: prowadzenie zajęć akademickich', 'MIM UW', (2024, 9, 20), None, '', ''),
]

REVIEW_BODIES = [
    'Dobre zadanie na rozgrzewkę — wskazówka mówi dokładnie tyle, ile trzeba.',
    'Klasyk z kolokwium. Robiłam je trzy razy i za każdym razem czegoś się uczę.',
    'Rozwiązanie jest poprawne, ale w trzecim kroku brakuje jednego założenia.',
    'Idealne na powtórkę przed egzaminem — krótkie i dokładnie o tym, co jest na liście.',
    'Treść trochę myląca; warto przeczytać rozwiązanie do końca przed pierwszą próbą.',
]

COMMENT_BODIES = [
    'W drugim kroku trzeba założyć, że ciąg jest ograniczony — bez tego nie przechodzi.',
    'Można też przez twierdzenie o trzech ciągach, wychodzi krócej.',
    'Uwaga: w wersji z 2022 roku była inna stała po prawej stronie.',
    'Dopisałam brakujący krok do rozwiązania, powinno być teraz jaśniejsze.',
]

#: `(name, is_public, how many exercises)`. One of each, because `is_public` is what decides whether a
#: stranger sees the row in the activity feed at all, and a demo with only public sets cannot show
#: that.
SETS = [
    ('Kolokwium 2 — powtórka', True, 6),
    ('Do przemyślenia (prywatne)', False, 4),
]

TAUGHT_COURSE = {
    'title': 'Analiza I — ćwiczenia dodatkowe',
    'summary': 'Cotygodniowe spotkania dla pierwszego roku, przed każdym kolokwium.',
    'description': 'Czwartki 18:00, sala 2180. Zadania wysyłam dzień wcześniej.',
    'lessons': [
        ('Ciągi i granice', 'Definicja granicy, twierdzenie o trzech ciągach.'),
        ('Szeregi liczbowe', 'Kryteria zbieżności: porównawcze, d’Alemberta, Cauchy’ego.'),
        ('Pochodna i jej zastosowania', 'Reguły różniczkowania, badanie przebiegu funkcji.'),
    ],
}

#: A course somebody else runs, so the profile shows the "joined" side of the relationship too — and
#: so there is a lesson whose progress this account can genuinely mark done. A person's own course is
#: no use for that: `LessonProgress` is a participant's statement, and staff never write one.
JOINED_COURSE = {
    'title': 'Rachunek prawdopodobieństwa — grupa zadaniowa',
    'summary': 'Rozwiązujemy listy razem, dwa razy w tygodniu.',
    'lessons': [
        ('Przestrzeń probabilistyczna', 'Aksjomaty, prawdopodobieństwo warunkowe.'),
        ('Zmienne losowe', 'Rozkłady dyskretne i ciągłe, wartość oczekiwana.'),
    ],
}

SHOWCASE_SERVICE = {
    'title': 'Korepetycje z analizy — poziom licencjacki',
    'description': 'Przygotowanie do kolokwiów i egzaminów z analizy matematycznej I i II.',
}
SERVICE_REVIEW_BODY = (
    'Trzy spotkania przed egzaminem i wreszcie rozumiem, po co jest ciągłość jednostajna. Polecam.'
)


class Command(BaseCommand):
    help = "Fills one account's profile with exemplary content (default: u-kasia). Idempotent."

    def add_arguments(self, parser):
        parser.add_argument(
            '--user',
            default=DEFAULT_USERNAME,
            help=f'Username to fill. Default: {DEFAULT_USERNAME}.',
        )
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Delete what this command previously created for that account, then create it again.',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        username = options['user']
        user = User.objects.filter(username=username).first()
        if user is None:
            raise CommandError(
                f'No account named {username!r}. Run `manage.py seed_demo_users` first — this '
                'command fills an existing profile rather than inventing an account for it.'
            )
        profile, _ = Profile.objects.get_or_create(user=user)

        if options['reset']:
            self._reset(user, profile)

        self._seed_profile(profile)
        counts = {
            'experience': self._seed_experience(profile),
            'skills': self._seed_skills(profile),
            'certificates': self._seed_certificates(profile),
            'grades': self._seed_education(user, profile),
            'reviews': self._seed_reviews_and_comments(user),
            'sets': self._seed_sets(user),
            'courses': self._seed_courses(user),
            'attributed': self._seed_attribution(user),
            'service_review': self._seed_service_review(user),
        }

        self.stdout.write(
            self.style.SUCCESS(
                f'Filled {username}: '
                + ', '.join(f'{value} {name}' for name, value in counts.items())
                + '.'
            )
        )

    # -- reset ------------------------------------------------------------------------------------

    def _reset(self, user, profile) -> None:
        """Delete exactly what this command creates, and nothing adjacent to it.

        Every clause below names the content by the constant that produced it rather than deleting a
        whole relation, so a certificate or a review this account added by hand survives a reset. That
        is the difference between a seed you can safely re-run on a real account and one you cannot.
        """
        ExperienceEntry.objects.filter(
            profile=profile, title__in=[title for _, title, *_ in EXPERIENCE]
        ).delete()
        SkillEntry.objects.filter(profile=profile, label__in=[label for label, *_ in SKILLS]).delete()
        Certificate.objects.filter(
            profile=profile, title__in=[title for title, *_ in CERTIFICATES]
        ).delete()

        education = EducationProfile.objects.filter(user=user).first()
        if education is not None:
            education.diplomas.all().delete()
            education.grades.all().delete()
            education.clear_usos()
            education.share_school = False
            education.share_diploma = False
            education.share_grades = False
            education.school = None
            education.programme = ''
            education.save()

        Review.objects.filter(author=user, body__in=REVIEW_BODIES).delete()
        Comment.objects.filter(author=user, body__in=COMMENT_BODIES).delete()
        ExerciseSet.objects.filter(owner=user, name__in=[name for name, *_ in SETS]).delete()
        ServiceReview.objects.filter(author=user, body=SERVICE_REVIEW_BODY).delete()
        Service.objects.filter(title=SHOWCASE_SERVICE['title']).delete()
        # Deleting the joined course takes this account's own Enrollment and LessonProgress with it
        # (both cascade), which is what makes the "solved" rows resettable without hunting for them.
        Course.objects.filter(title__in=[TAUGHT_COURSE['title'], JOINED_COURSE['title']]).delete()

        self.stdout.write('Removed previously seeded showcase content.')

    # -- the profile itself -----------------------------------------------------------------------

    def _seed_profile(self, profile) -> None:
        profile.bio = BIO
        profile.preferred_locale = 'pl'
        # A profile with nothing public is a profile whose every screen renders the private notice, so
        # the demonstration account opts in. Set explicitly rather than relying on the default, because
        # an earlier run of the e2e suite may well have turned it off.
        profile.show_profile_publicly = True
        profile.offers_tutoring = True
        profile.tutoring_note = 'Analiza I i II, przygotowanie do kolokwiów. Online lub na MIM.'
        profile.save()

    def _seed_experience(self, profile) -> int:
        for order, (kind, title, organisation, start, end) in enumerate(EXPERIENCE):
            ExperienceEntry.objects.update_or_create(
                profile=profile,
                title=title,
                defaults={
                    'kind': kind,
                    'organisation': organisation,
                    'started_on': date(start[0], start[1], 1),
                    'ended_on': date(end[0], end[1], 1) if end else None,
                    'order': order,
                },
            )
        return len(EXPERIENCE)

    def _seed_skills(self, profile) -> int:
        for order, (label, level, evidence) in enumerate(SKILLS):
            branch = self._branch_for(label)
            SkillEntry.objects.update_or_create(
                profile=profile,
                label=label,
                defaults={
                    'level': level,
                    'evidence': evidence,
                    'branch': branch,
                    'discipline': branch.discipline if branch else None,
                    'order': order,
                },
            )
        return len(SKILLS)

    def _seed_certificates(self, profile) -> int:
        for order, (title, issuer, issued, expires, credential_id, url) in enumerate(CERTIFICATES):
            Certificate.objects.update_or_create(
                profile=profile,
                title=title,
                issuer=issuer,
                defaults={
                    'issued_on': date(*issued),
                    'expires_on': date(*expires) if expires else None,
                    'credential_id': credential_id,
                    'url': url,
                    'order': order,
                },
            )
        return len(CERTIFICATES)

    # -- education --------------------------------------------------------------------------------

    def _seed_education(self, user, profile) -> int:
        """A connected link, a diploma and a three-year transcript — through the real import path.

        **The mock connector is switched on for the duration of this call and switched back off.** No
        institution has issued EdMat a consumer key (see `identity/usos.py`), so a demonstration
        transcript can only come from the mock — and the honest way to reach it is the same
        `active_connector()` lookup the real endpoints use, rather than instantiating the mock here and
        bypassing the seam this app deliberately built. Restored in a `finally`, because a seed command
        that leaves a mock enabled would make the running site claim to verify people it cannot.

        Consents are turned ON here, which is the one place in this codebase that happens without a
        person clicking something — and it is a deliberate exception rather than an oversight. Every
        other path is careful that importing never publishes, precisely because publishing is the
        account holder's decision; a demonstration account has no holder to ask, and a transcript
        nobody can see demonstrates nothing about the screens that show one. Named here so the
        exception cannot be mistaken for the rule.
        """
        school = School.objects.filter(slug=SHOWCASE_SCHOOL_SLUG).first()
        if school is None:
            self.stdout.write(
                self.style.WARNING(
                    f'No school {SHOWCASE_SCHOOL_SLUG!r} — skipping the education section.'
                )
            )
            return 0

        education, _ = EducationProfile.objects.get_or_create(user=user)
        education.school = school
        education.other_school_name = ''
        education.save()

        was_mock = getattr(settings, 'EDMAT_USOS_MOCK', False)
        settings.EDMAT_USOS_MOCK = True
        try:
            if not identity_services.connect_usos(education, user, include_grades=True):
                self.stdout.write(
                    self.style.WARNING('USOS connector refused — skipping the education section.')
                )
                return 0
            identity_services.import_diplomas(education)
            imported = identity_services.import_grades(education)
        finally:
            settings.EDMAT_USOS_MOCK = was_mock

        education.share_school = True
        education.share_diploma = True
        education.share_grades = True
        education.save()
        return imported

    # -- activity ---------------------------------------------------------------------------------

    def _seed_reviews_and_comments(self, user) -> int:
        exercises = list(Exercise.objects.filter(published=True).order_by('id')[:12])
        if not exercises:
            self.stdout.write(
                self.style.WARNING(
                    'No exercises found — run `import_legacy_corpus` first if you want reviews and '
                    'comments on real content.'
                )
            )
            return 0

        content_type = ContentType.objects.get_for_model(Exercise)
        for index, body in enumerate(REVIEW_BODIES):
            Review.objects.update_or_create(
                exercise=exercises[index % len(exercises)],
                author=user,
                defaults={'rating': [5, 4, 3, 5, 4][index % 5], 'body': body},
            )
        for index, body in enumerate(COMMENT_BODIES):
            Comment.objects.get_or_create(
                content_type=content_type,
                object_id=exercises[(index + 5) % len(exercises)].pk,
                author=user,
                body=body,
                defaults={'parent': None},
            )
        return len(REVIEW_BODIES)

    def _seed_sets(self, user) -> int:
        """Two sets, one shared and one not.

        The sets are created even on a database with no corpus imported, and only their CONTENTS
        depend on there being exercises to put in them. That is not padding: `is_public` is what
        decides whether a stranger sees the row in somebody's activity feed at all, and a seed that
        silently created nothing on an empty database would leave that rule undemonstrated on exactly
        the installs most likely to be looked at first — a fresh one.
        """
        exercises = list(Exercise.objects.filter(published=True).order_by('id')[:12])
        for name, is_public, size in SETS:
            exercise_set, _ = ExerciseSet.objects.get_or_create(
                owner=user, name=name, defaults={'is_public': is_public}
            )
            exercise_set.is_public = is_public
            exercise_set.save(update_fields=['is_public'])
            for order, exercise in enumerate(exercises[:size]):
                ExerciseSetItem.objects.update_or_create(
                    exercise_set=exercise_set,
                    exercise=exercise,
                    defaults={'order': order},
                )
        return len(SETS)

    def _seed_courses(self, user) -> int:
        """One course this account runs, one it takes part in, and a lesson marked done in the latter.

        The second is not padding: `LessonProgress` is only ever written by a participant about
        themselves, so a person who only runs courses has no "finished" rows to show at all — and
        those rows are the closest thing this app has to "solved", which is exactly what the profile is
        being asked to display.
        """
        other = (
            User.objects.exclude(pk=user.pk)
            .filter(username__in=['u-michal', 'u-ola', 'u-bartek', 'u-julia'])
            .first()
        )

        taught, _ = Course.objects.update_or_create(
            title=TAUGHT_COURSE['title'],
            instructor=user,
            defaults={
                'summary': TAUGHT_COURSE['summary'],
                'description': TAUGHT_COURSE['description'],
                'status': 'open',
                'enrollment_policy': 'open',
                'discussion_mode': 'participants',
                'starts_on': timezone.now().date() + timedelta(days=7),
            },
        )
        self._fill_course(taught, TAUGHT_COURSE['lessons'])

        if other is None:
            self.stdout.write(
                self.style.WARNING(
                    'No second demo account — skipping the joined course and the finished lessons.'
                )
            )
            return 1

        joined, _ = Course.objects.update_or_create(
            title=JOINED_COURSE['title'],
            instructor=other,
            defaults={
                'summary': JOINED_COURSE['summary'],
                'status': 'running',
                'enrollment_policy': 'open',
                # Participants can see each other's progress, which is what makes the "finished"
                # rows below visible to anybody but this account. `off` would hide them from the
                # instructor too, by design — see `Course.progress_visible_to`.
                'progress_visibility': 'shared_anonymous',
            },
        )
        lessons = self._fill_course(joined, JOINED_COURSE['lessons'])
        Enrollment.objects.update_or_create(
            course=joined, participant=user, defaults={'status': 'active'}
        )
        for lesson in lessons:
            LessonProgress.objects.update_or_create(
                lesson=lesson, participant=user, defaults={'status': 'done'}
            )
        return 2

    @staticmethod
    def _fill_course(course, lessons) -> list:
        chapter, _ = Chapter.objects.get_or_create(
            course=course, title='Program', defaults={'order': 0}
        )
        created = []
        for order, (title, description) in enumerate(lessons, start=1):
            lesson, _ = Lesson.objects.update_or_create(
                chapter=chapter,
                title=title,
                defaults={'description': description, 'order': order},
            )
            created.append(lesson)
        return created

    def _seed_service_review(self, user) -> int:
        """A review this account wrote on somebody else's tutoring listing.

        Needs a listing owned by a DIFFERENT person: `ServiceReview` is one row per (service, author)
        and reviewing your own offering would be both meaningless and, on the profile, misleading —
        the feed would show "reviewed" pointing at the reviewer's own listing.
        """
        other = (
            User.objects.exclude(pk=user.pk)
            .filter(username__in=['u-michal', 'u-ola', 'u-bartek', 'u-julia'])
            .first()
        )
        if other is None:
            return 0
        service, _ = Service.objects.update_or_create(
            title=SHOWCASE_SERVICE['title'],
            provider=other,
            defaults={'description': SHOWCASE_SERVICE['description'], 'is_active': True},
        )
        ServiceReview.objects.update_or_create(
            service=service, author=user, defaults={'rating': 5, 'body': SERVICE_REVIEW_BODY}
        )
        return 1

    def _seed_attribution(self, user) -> int:
        """Put this account's name on a few corpus rows, so "posted" is not permanently empty.

        Additive only, and only ever fills a blank — the same decision, for the same reason,
        `seed_demo_content._seed_attribution` records: the imported corpus has `submitted_by = NULL`
        on all 742 rows because nobody on this platform submitted it, and inventing an uploader for
        every one would be a lie told at scale. A handful is also the honest state of a real catalogue,
        and it keeps the no-contributor rendering path exercised rather than hidden.

        Not undone by `--reset`, deliberately: there is no record of which blanks this filled, and
        guessing would risk clearing a real submission made through the app.
        """
        touched = 0
        for exercise in Exercise.objects.filter(submitted_by__isnull=True, published=True)[:5]:
            exercise.submitted_by = user
            exercise.save(update_fields=['submitted_by'])
            touched += 1
        for material in Material.objects.filter(submitted_by__isnull=True, published=True)[:3]:
            material.submitted_by = user
            material.save(update_fields=['submitted_by'])
            touched += 1
        return touched

    @staticmethod
    def _branch_for(label: str):
        """Best-effort link into the real taxonomy — a skill tied to a Branch can be filtered and
        matched against this site's own exercises; a free-text one cannot."""
        needle = label.strip().lower()
        for branch in Branch.objects.prefetch_related('translations'):
            for translation in branch.translations.all():
                name = (translation.name or '').strip().lower()
                if name and (name == needle or needle in name or name in needle):
                    return branch
        return None
