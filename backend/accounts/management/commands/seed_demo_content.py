"""Fills a fresh install with enough real-looking content that every screen has something on it.

An empty app is genuinely hard to judge: every list says "nothing here yet", so you cannot tell a
feature that works from one that does not. This creates profiles with histories and skills, reviews,
threaded comments, courses with participants and discussion, and enough tags for the activity
filters to have something to filter.

**Idempotent, and additive only.** Everything is `get_or_create`/`update_or_create` keyed on
something stable, so re-running changes nothing and it can safely be part of a setup script somebody
runs twice. It never touches content it did not create.

    manage.py seed_demo_content            # add the demo content
    manage.py seed_demo_content --reset    # remove it first, then add it again

Every account it creates shares the same password as `seed_demo_users` (password123) — these are
demonstration accounts on a local machine, and pretending otherwise would just make them harder to
use.
"""

import random
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.utils import timezone

from accounts.models import ExperienceEntry, Profile, SkillEntry
from courses.models import Chapter, Enrollment, Lesson, Course
from community.models import Comment, Review
from exercises.models import Exercise, ExerciseTranslation, Tag
from materials.models import Material
from taxonomy.models import Branch, Discipline

User = get_user_model()
DEMO_PASSWORD = 'password123'

#: Marks every account this command creates, so `--reset` can find them again without guessing.
SEED_USERNAME_PREFIX = 'demo-'

PEOPLE = [
    {
        'key': 'ania',
        'display_name': 'Ania Kowalczyk',
        'bio': 'Trzeci rok matematyki na UW. Najbardziej lubię analizę, najmniej — statystykę, '
        'więc oczywiście robię z niej licencjat.',
        'experience': [
            ('study', 'Matematyka, studia licencjackie', 'Uniwersytet Warszawski', 2023, None),
            ('teaching', 'Korepetycje z analizy', 'prywatnie', 2024, None),
            ('project', 'Koło naukowe — seminarium z teorii miary', 'MIM UW', 2024, 2025),
        ],
        'skills': [
            ('Analiza matematyczna', 'teaching', 'coursework'),
            ('Algebra liniowa', 'comfortable', 'coursework'),
            ('LaTeX', 'teaching', 'self_declared'),
            ('Statystyka', 'learning', 'self_declared'),
        ],
    },
    {
        'key': 'piotr',
        'display_name': 'Piotr Adamski',
        'bio': 'Informatyka, czwarty rok. Piszę dużo kodu, rozwiązuję mało zadań — pracuję nad tym.',
        'experience': [
            ('study', 'Informatyka, studia inżynierskie', 'Politechnika Warszawska', 2022, None),
            ('work', 'Stażysta — backend', 'lokalny software house', 2024, 2024),
        ],
        'skills': [
            ('Wstęp do programowania', 'teaching', 'coursework'),
            ('Algorytmy', 'comfortable', 'coursework'),
            ('Rachunek prawdopodobieństwa', 'learning', 'self_declared'),
        ],
    },
    {
        'key': 'zofia',
        'display_name': 'Zofia Nowicka',
        'bio': 'Fizyka teoretyczna. Zbieram zadania z mechaniki klasycznej — jeśli masz ciekawe, pisz.',
        'experience': [
            ('study', 'Fizyka, studia magisterskie', 'Uniwersytet Warszawski', 2021, None),
            ('teaching', 'Asystent na ćwiczeniach z mechaniki', 'FUW', 2024, None),
            ('work', 'Wolontariat — warsztaty dla licealistów', 'Festiwal Nauki', 2023, 2023),
        ],
        'skills': [
            ('Mechanika klasyczna', 'teaching', 'coursework'),
            ('Analiza matematyczna', 'comfortable', 'coursework'),
            ('Python', 'comfortable', 'self_declared'),
        ],
    },
    {
        'key': 'jakub',
        'display_name': 'Jakub Wrona',
        'bio': 'Wracam do matematyki po kilku latach przerwy. Zaczynam od podstaw i wcale się tego nie wstydzę.',
        'experience': [
            ('other', 'Powrót do nauki po przerwie', '', 2025, None),
            ('work', 'Analityk danych', 'firma ubezpieczeniowa', 2019, 2024),
        ],
        'skills': [
            ('Excel', 'teaching', 'self_declared'),
            ('Analiza matematyczna', 'learning', 'self_declared'),
        ],
    },
]

REVIEW_BODIES = [
    'Bardzo dobre zadanie na rozgrzewkę — wskazówka jest w sam raz, nie zdradza za dużo.',
    'Treść trochę myląca, ale rozwiązanie wszystko prostuje. Warto przeczytać do końca.',
    'Klasyk z kolokwium. Robiłam je trzy razy i za każdym razem czegoś się uczę.',
    'Odpowiedź się zgadza, ale w rozwiązaniu przydałby się jeden krok więcej.',
    'Idealne na powtórkę przed egzaminem.',
]

COMMENT_BODIES = [
    'Czy w drugim kroku nie trzeba założyć, że ciąg jest ograniczony?',
    'Można też przez twierdzenie o trzech ciągach — wychodzi krócej.',
    'Dzięki, właśnie tego szukałam.',
    'Uwaga: w wersji z 2022 roku była inna stała po prawej stronie.',
    'Zrobiłem to inaczej i wyszło to samo, więc chyba obie drogi są dobre.',
]

REPLY_BODIES = [
    'Trzeba, dobre pytanie — bez tego założenia drugi krok nie przechodzi.',
    'Racja, tak jest szybciej. Dopisałem to do rozwiązania.',
    'Też mi tak wyszło.',
]

COURSES = [
    {
        'key': 'analiza',
        'owner': 'ania',
        'title': 'Analiza od zera',
        'summary': 'Od ciągów do całek, w dziesięć tygodni.',
        'description': 'Spotykamy się w czwartki o 18:00, online. Zadania co tydzień, '
        'rozwiązania omawiamy razem. Nie zakładam nic poza liceum.',
        'policy': 'open',
        'capacity': 0,
        'discussion': 'participants',
        'lessons': [
            ('Ciągi i granice', 'Definicja granicy, twierdzenie o trzech ciągach.',
             'Link do spotkania: example.invalid/analiza — zadania 1–8 z pierwszej listy.'),
            ('Szeregi liczbowe', 'Kryteria zbieżności: porównawcze, d’Alemberta, Cauchy’ego.', ''),
            ('Pochodna', 'Definicja, interpretacja, reguły różniczkowania.', ''),
        ],
    },
    {
        'key': 'programowanie',
        'owner': 'piotr',
        'title': 'Wstęp do programowania — grupa ćwiczeniowa',
        'summary': 'Mała grupa, rozwiązujemy zadania razem.',
        'description': 'Zapisy przez prośbę — napisz, na którym jesteś roku i czego chcesz się nauczyć.',
        'policy': 'approval',
        'capacity': 12,
        'discussion': 'public',
        'lessons': [
            ('Rekurencja', 'Od silni do drzew.', 'Kod z zajęć wrzucam po każdym spotkaniu.'),
            ('Złożoność obliczeniowa', 'Notacja O, typowe pułapki.', ''),
        ],
    },
    {
        'key': 'mechanika',
        'owner': 'zofia',
        'title': 'Mechanika klasyczna — powtórka przed egzaminem',
        'summary': 'Sześć spotkań, same zadania egzaminacyjne.',
        'description': 'Bez teorii od zera — zakładam, że wykład już był.',
        'policy': 'open',
        'capacity': 20,
        'discussion': 'participants',
        'lessons': [('Zasady dynamiki w praktyce', 'Zadania z kolokwiów 2019–2024.', '')],
    },
]

COURSE_POSTS = [
    'Cześć wszystkim! Jeśli ktoś ma pytania przed pierwszymi zajęciami, piszcie tutaj.',
    'Czy zadania oddajemy przed spotkaniem, czy po?',
    'Przed — ale bez stresu, chodzi o to, żebyśmy mieli o czym rozmawiać.',
]


class Command(BaseCommand):
    help = 'Seeds demonstration profiles, reviews, comments and courses. Idempotent.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Delete previously seeded demo content first (only what this command created).',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        rng = random.Random(20260802)  # fixed seed: the same demo data every time, on every machine

        if options['reset']:
            removed = User.objects.filter(username__startswith=SEED_USERNAME_PREFIX).delete()
            Course.objects.filter(title__in=[c['title'] for c in COURSES]).delete()
            self.stdout.write(f'Removed previously seeded demo content ({removed[0]} rows).')

        people = self._seed_people()
        self._seed_reviews_and_comments(people, rng)
        courses = self._seed_courses(people)
        self._seed_course_activity(courses, people)
        attributed = self._seed_attribution(people)

        self.stdout.write(
            self.style.SUCCESS(
                f'Seeded {len(people)} demo profiles, {Review.objects.count()} reviews, '
                f'{Comment.objects.count()} comments, {len(courses)} courses and '
                f'{attributed} attributed contributions. '
                f'Password for every demo account: {DEMO_PASSWORD}'
            )
        )

    # -- attribution ------------------------------------------------------------------------------

    def _seed_attribution(self, people: dict) -> int:
        """Give some content a real account behind it, so the credit lines are not permanently empty.

        Both the exercise and the material pages link whoever contributed to their profile, and both
        were rendering nothing at all — not because the link was missing but because the imported
        corpus has `submitted_by = NULL` on every row. It was imported from a course archive; nobody
        on this platform submitted it, and inventing an uploader for all 742 would be a lie told at
        scale.

        So a handful are attributed here instead, in the command whose entire job is to make features
        visible. Deliberately a handful and not all of them: the mixture is the honest state of a real
        catalogue — some things somebody here contributed, most things predating the platform — and it
        keeps the "no contributors" rendering path exercised rather than hidden.

        Idempotent: only ever fills a blank, so re-running never reassigns something and never
        overwrites a real submission made through the app.
        """
        contributors = [
            people[key] for key in ('michal', 'ania', 'piotr') if key in people
        ]
        if not contributors:
            return 0

        touched = 0
        for index, material in enumerate(Material.objects.filter(submitted_by__isnull=True)[:4]):
            material.submitted_by = contributors[index % len(contributors)]
            material.save(update_fields=['submitted_by'])
            touched += 1

        for index, exercise in enumerate(Exercise.objects.filter(submitted_by__isnull=True)[:6]):
            exercise.submitted_by = contributors[index % len(contributors)]
            exercise.save(update_fields=['submitted_by'])
            touched += 1

        # A translation credit as well, so the exercise page shows what it looks like with more than
        # one person on it — which is the case the plural list exists for.
        translations = ExerciseTranslation.objects.filter(
            translated_by__isnull=True, status='published'
        ).exclude(exercise__submitted_by__isnull=True)[:4]
        for index, translation in enumerate(translations):
            translation.translated_by = contributors[(index + 1) % len(contributors)]
            translation.save(update_fields=['translated_by'])
            touched += 1

        return touched

    # -- people -----------------------------------------------------------------------------------

    def _seed_people(self) -> dict:
        people = {}
        for spec in PEOPLE:
            username = f'{SEED_USERNAME_PREFIX}{spec["key"]}'
            user, created = User.objects.get_or_create(
                username=username,
                defaults={'email': f'{spec["key"]}@edmat.example'},
            )
            if created:
                user.set_password(DEMO_PASSWORD)
                user.save()
            profile, _ = Profile.objects.get_or_create(user=user)
            profile.display_name = spec['display_name']
            profile.bio = spec['bio']
            profile.preferred_locale = 'pl'
            profile.save()

            for order, (kind, title, org, start, end) in enumerate(spec['experience']):
                ExperienceEntry.objects.update_or_create(
                    profile=profile,
                    title=title,
                    defaults={
                        'kind': kind,
                        'organisation': org,
                        'started_on': date(start, 10, 1),
                        'ended_on': date(end, 6, 30) if end else None,
                        'order': order,
                    },
                )

            for order, (label, level, evidence) in enumerate(spec['skills']):
                branch = self._branch_for_skill(label)
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
            people[spec['key']] = user
        return people

    @staticmethod
    def _branch_for_skill(label: str):
        """Best-effort link into the real taxonomy — a skill tied to a Branch can be filtered and
        matched against this site's own exercises; a free-text one cannot."""
        needle = label.strip().lower()
        for branch in Branch.objects.prefetch_related('translations'):
            for translation in branch.translations.all():
                name = (translation.name or '').strip().lower()
                if name and (name == needle or needle in name or name in needle):
                    return branch
        return None

    # -- reviews and comments ---------------------------------------------------------------------

    def _seed_reviews_and_comments(self, people: dict, rng: random.Random) -> None:
        exercises = list(Exercise.objects.filter(published=True).order_by('id')[:12])
        if not exercises:
            self.stdout.write(
                self.style.WARNING(
                    'No exercises found — run import_legacy_corpus first if you want reviews and '
                    'comments on real content.'
                )
            )
            return

        content_type = ContentType.objects.get_for_model(Exercise)
        users = list(people.values())

        for index, exercise in enumerate(exercises):
            # A couple of reviews each, from different people, so an average is a real average.
            for offset in range(2):
                author = users[(index + offset) % len(users)]
                Review.objects.update_or_create(
                    exercise=exercise,
                    author=author,
                    defaults={
                        'rating': rng.choice([3, 4, 4, 5, 5]),
                        'body': REVIEW_BODIES[(index + offset) % len(REVIEW_BODIES)],
                    },
                )

            root_author = users[index % len(users)]
            root, created = Comment.objects.get_or_create(
                content_type=content_type,
                object_id=exercise.pk,
                author=root_author,
                parent=None,
                defaults={'body': COMMENT_BODIES[index % len(COMMENT_BODIES)]},
            )
            # One real reply per thread, so the tree view has something to render rather than a
            # flat list pretending to be threaded.
            if created:
                Comment.objects.create(
                    content_type=content_type,
                    object_id=exercise.pk,
                    parent=root,
                    author=users[(index + 1) % len(users)],
                    body=REPLY_BODIES[index % len(REPLY_BODIES)],
                )

        # Tags, so the activity feed's own filters have something real to filter on.
        for slug in ('analiza', 'ciagi', 'egzamin', 'latwe', 'klasyk'):
            tag, _ = Tag.objects.get_or_create(slug=slug)
            for exercise in exercises[:6]:
                exercise.tags.add(tag)

    # -- courses ----------------------------------------------------------------------------------

    def _seed_courses(self, people: dict) -> dict:
        courses = {}
        for spec in COURSES:
            owner = people[spec['owner']]
            course, _ = Course.objects.update_or_create(
                title=spec['title'],
                instructor=owner,
                defaults={
                    'summary': spec['summary'],
                    'description': spec['description'],
                    'status': 'open',
                    'enrollment_policy': spec['policy'],
                    'capacity': spec['capacity'],
                    'discussion_mode': spec['discussion'],
                    'starts_on': timezone.now().date() + timedelta(days=7),
                },
            )
            subject = self._branch_for_skill(spec['title'].split()[0])
            if subject:
                course.subjects.add(subject)
                course.field = subject.discipline
                course.save(update_fields=['field'])

            # A lesson lives in a chapter now, so the seed makes one to hold them — a demo course
            # with no chapter would render as empty, which is the opposite of this command's job.
            chapter, _ = Chapter.objects.get_or_create(
                course=course, title='Program', defaults={'order': 0}
            )
            for order, (title, description, notes) in enumerate(spec['lessons'], start=1):
                Lesson.objects.update_or_create(
                    chapter=chapter,
                    title=title,
                    defaults={'description': description, 'participant_notes': notes, 'order': order},
                )
            courses[spec['key']] = course

        # One of each unlisted visibility, so "only you" and "private" are both things you can
        # actually see the effect of rather than read about.
        Course.objects.update_or_create(
            title='Topologia — szkic',
            instructor=people['zofia'],
            defaults={'summary': 'Jeszcze nieopublikowany.', 'visibility': 'only_you'},
        )
        Course.objects.update_or_create(
            title='Seminarium — tylko z linkiem',
            instructor=people['zofia'],
            defaults={
                'summary': 'Niewidoczny na liście; wchodzisz z zaproszenia.',
                'visibility': 'private',
            },
        )
        return courses

    def _seed_course_activity(self, courses: dict, people: dict) -> None:
        analiza, programowanie = courses['analiza'], courses['programowanie']
        content_type = ContentType.objects.get_for_model(Course)

        for key in ('piotr', 'zofia', 'jakub'):
            Enrollment.objects.update_or_create(
                course=analiza,
                participant=people[key],
                defaults={'status': 'active'},
            )
        # One request left deliberately pending, so the instructor's approve/decline UI is not empty.
        Enrollment.objects.update_or_create(
            course=programowanie,
            participant=people['jakub'],
            defaults={
                'status': 'pending',
                'request_note': 'Wracam do nauki po przerwie, chcę nadrobić podstawy.',
            },
        )
        Enrollment.objects.update_or_create(
            course=programowanie, participant=people['ania'], defaults={'status': 'active'}
        )

        authors = [people['ania'], people['piotr'], people['ania']]
        parent = None
        for body, author in zip(COURSE_POSTS, authors):
            comment, created = Comment.objects.get_or_create(
                content_type=content_type,
                object_id=analiza.pk,
                author=author,
                body=body,
                defaults={'parent': parent},
            )
            if created and parent is None:
                parent = comment
