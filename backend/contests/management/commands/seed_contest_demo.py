"""Two lived-in demo contests on the dev accounts, so every page under `/contests` has something
real on it.

    manage.py seed_contest_demo                 # build or refresh
    manage.py seed_contest_demo --minors        # ALSO flag the two pupil accounts as under-16
    manage.py seed_contest_demo --reset         # remove both contests and stop

What it builds (CONTESTS-BRIEF.md §3.A item 13):

1. **"Szkolny Konkurs Matematyczny — etap I"** — `u-kasia` (a teacher, platform staff) organises a
   `school` contest with `u-michal` and `u-ola` on the jury and `u-bartek` as secretary. The four
   `demo-*` accounts are registered, two of them carrying a guardian's name and consent. One stage
   with four real exercises from the corpus, four submissions, scores from both jurors, results
   published, and one complaint lodged and answered with reasons.
2. **"Wyzwanie: ciagi i szeregi"** — `u-michal` organises a `challenge` (the prize-free default,
   which is why it needs no claim deadline and no tax copy at all), `u-julia` on the jury,
   registration open, nobody registered yet.
3. **`student1` is registered nowhere**, on purpose: the empty state of `/contests?mine=1` and the
   "you are not taking part" face of a contest page both need an account that shows them.

**Idempotent by title + organiser.** A second run finds both contests and refreshes them in place;
it creates no second copy and no second registration, and it says what it found rather than what it
made. Run it twice — that is the check.

**The minors question, stated rather than faked** (house rule 10). `Profile.is_minor` is a
site-wide flag: it closes messaging, locks the profile private, forbids an avatar and holds every
comment for review. A demo seed must not flip that on a shared dev account as a side effect of
wanting a guardian-consent block on one page. So by default the two pupil registrations carry
`guardian_name` and `guardian_consent_at` exactly as a real minor's would — which is what every
page and the compliance panel read — while the accounts themselves stay adults. `--minors` flips
the flag as well, for anybody who wants to see `rules.register_block_reason` actually refuse
`guardian_consent_required` in a browser, and the command says loudly that it did.

**`apply_preset` is step B's.** This command calls it and prints its report, which on step A's own
branch says `skipped: ['not_built']`. That is the honest answer and the wizard shows the same one.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from contests import personalize, presets, rules
from contests.models import (
    Contest,
    ContestAnswer,
    ContestComplaint,
    ContestProblem,
    ContestRegistration,
    ContestRulesSection,
    ContestScore,
    ContestStaff,
    ContestStage,
    ContestSubmission,
)
from exercises.models import Exercise
from moderation.models import FeatureFlag

SCHOOL_TITLE = 'Szkolny Konkurs Matematyczny — etap I'
CHALLENGE_TITLE = 'Wyzwanie: ciągi i szeregi'

#: The regulamin, in real Polish, short but not a placeholder — every page that renders it renders
#: this, and a demo whose §10 says "Lorem ipsum" teaches nothing about what the editor is for.
SCHOOL_RULES = {
    'organiser': 'Organizatorem konkursu jest Katarzyna Wiśniewska, nauczycielka matematyki w XIV LO '
                 'im. Stanisława Staszica w Warszawie, ul. Nowowiejska 37a, kasia@edmat.example. '
                 'Serwis EdMat jedynie udostępnia narzędzie i nie jest organizatorem ani fundatorem nagród.',
    'subject': 'Przedmiotem konkursu jest samodzielne rozwiązanie czterech zadań z analizy matematycznej. '
               'Konkurs jest konkursem w dziedzinie nauki.',
    'dates': 'Zgłoszenia: do 7 dni od ogłoszenia. Etap I: 14 dni. Ogłoszenie wyników: w ciągu 7 dni od '
             'zakończenia etapu. O nagrodę można ubiegać się w terminie 30 dni od ogłoszenia wyników; '
             'po tym terminie prawo do nagrody wygasa.',
    'participants': 'W konkursie mogą brać udział uczniowie szkoły. Osoby, które nie ukończyły 16 lat, '
                    'zgłasza się za zgodą opiekuna prawnego, którego imię i nazwisko zapisuje się przy '
                    'zgłoszeniu. W konkursie nie mogą brać udziału członkowie komisji konkursowej ani '
                    'ich osoby bliskie. Udział nie zależy od zakupu czegokolwiek.',
    'entry': 'Zgłoszenie następuje przez formularz na stronie konkursu. Jedno zgłoszenie na uczestnika. '
             'Zgłaszając się, uczestnik akceptuje regulamin w wersji wskazanej przy zgłoszeniu.',
    'criteria_jury': 'Każde zadanie oceniane jest w skali 0–5 punktów za poprawność i kompletność '
                     'uzasadnienia. Ocenia komisja: Michał Zieliński i Ola Nowak. Przy równej liczbie '
                     'punktów wyżej klasyfikowana jest praca o pełniejszym uzasadnieniu zadania 4. '
                     'Remisów nie rozstrzyga się losowaniem.',
    'prizes': 'Nagroda główna: książka o wartości 150 zł. Nagroda jest rzeczowa; jej wartość nie '
              'przekracza 2 000 zł, więc organizator powołuje się na zwolnienie dla konkursów '
              'w dziedzinie nauki. Nagrodę wydaje się w szkole w terminie z §3.',
    'results': 'Wyniki ogłasza się na stronie konkursu. Publikuje się inicjały uczestnika; pełne imię '
               'i nazwisko wyłącznie za osobną, odwołalną zgodą.',
    'complaints': 'Reklamację można złożyć w ciągu 14 dni od ogłoszenia wyników, przez stronę konkursu. '
                  'Organizator odpowiada w ciągu 14 dni, z uzasadnieniem. Droga sądowa pozostaje otwarta.',
    'personal_data': 'Administratorem danych jest organizator (§1). Dane przetwarza się w celu '
                     'przeprowadzenia konkursu (art. 6 ust. 1 lit. b RODO), rozliczenia nagrody '
                     '(lit. c) i — za zgodą — publikacji imienia i nazwiska (lit. a). Serwis EdMat jest '
                     'podmiotem przetwarzającym. Dane zgłoszeniowe przechowuje się do końca okresu '
                     'reklamacyjnego, dokumentację nagrody — 5 lat. Przysługuje prawo dostępu, '
                     'sprostowania, usunięcia, cofnięcia zgody i skargi do Prezesa UODO.',
    'copyright_image': 'Uczestnik oświadcza, że praca jest jego własna. Uczestnik udziela organizatorowi '
                       'licencji niewyłącznej na zwielokrotnienie i udostępnienie pracy na stronie '
                       'konkursu w celu przeprowadzenia i rozstrzygnięcia konkursu. Praw osobistych '
                       'nie można się zrzec. Zgoda na wizerunek jest osobną klauzulą i nie jest '
                       'warunkiem udziału.',
    'final': 'Regulamin obowiązuje w wersji opublikowanej na stronie konkursu. Zmiany nie mogą naruszać '
             'praw nabytych przez uczestników. Przyrzeczenie nagrody jest nieodwołalne. W razie '
             'odwołania konkursu organizator ogłasza to w tym samym miejscu, w którym ogłosił konkurs. '
             'Serwis EdMat jest wyłącznie medium.',
}

CHALLENGE_RULES = {
    'organiser': 'Organizatorem wyzwania jest Michał Zieliński, michal@edmat.example. '
                 'Serwis EdMat udostępnia tylko narzędzie.',
    'subject': 'Zestaw zadań o ciągach i szeregach. Wyzwanie nie przewiduje nagrody — jest to ranking '
               'i informacja zwrotna, nie przyrzeczenie publiczne.',
    'dates': 'Zgłoszenia: do 14 dni. Runda: 14 dni. Wyniki: w ciągu 7 dni od zamknięcia rundy.',
    'participants': 'Udział jest otwarty dla każdego zarejestrowanego użytkownika serwisu. '
                    'Członkowie jury nie biorą udziału.',
    'entry': 'Zgłoszenie przez formularz na stronie wyzwania.',
    'criteria_jury': 'Ocena w skali 0–5 punktów za zadanie, za poprawność i jakość uzasadnienia. '
                     'Ocenia Julia Wójcik. Remisy rozstrzyga się merytorycznie, nigdy losowaniem.',
    'results': 'Ranking publikuje się na stronie wyzwania, domyślnie z inicjałami.',
    'complaints': 'Uwagi do oceny przyjmuje się w ciągu 14 dni od publikacji rankingu; odpowiedź '
                  'w ciągu 14 dni, z uzasadnieniem.',
    'personal_data': 'Administratorem jest organizator (§1). Podstawą jest art. 6 ust. 1 lit. b RODO. '
                     'Serwis EdMat jest podmiotem przetwarzającym. Dane usuwa się po zamknięciu wyzwania.',
    'copyright_image': 'Uczestnik oświadcza, że praca jest jego własna. Organizator nie nabywa żadnych '
                       'praw do pracy — rozwiązania pozostają własnością autorów.',
    'final': 'Regulamin obowiązuje w wersji opublikowanej na stronie wyzwania. Wyzwanie nie przewiduje '
             'nagrody, więc nie jest przyrzeczeniem publicznym w rozumieniu art. 919 Kodeksu cywilnego.',
}

#: Four answers of visibly different quality, so the matrix and the ranking are worth looking at.
ANSWERS = [
    'Z definicji granicy: dla każdego \\( \\varepsilon > 0 \\) istnieje \\( N \\) takie, że dla '
    '\\( n > N \\) mamy \\( |a_n - a| < \\varepsilon \\). Pokazuję to wprost, szacując licznik.',
    'Ciąg jest monotoniczny i ograniczony, więc zbieżny (twierdzenie o ciągu monotonicznym). '
    'Granicę wyznaczam z równania \\( a = \\tfrac{1}{2}(a + 2/a) \\).',
    'Korzystam z kryterium porównawczego: \\[ \\sum \\frac{1}{n^2} \\] jest zbieżny, a wyrazy są '
    'mniejsze od pewnej wielokrotności \\( 1/n^2 \\).',
    'Szkic: rozwinięcie Taylora w zerze i oszacowanie reszty.',
]

PUPILS = ('demo-zofia', 'demo-jakub')


def _user(username):
    User = get_user_model()
    row = User.objects.filter(username=username).first()
    if row is None:
        raise CommandError(
            f'No account “{username}”. Run `manage.py seed_demo_users` first — this command '
            'deliberately does not create accounts of its own.'
        )
    return row


def _exercises(count):
    rows = list(
        Exercise.objects.filter(
            published=True, translations__status='published', translations__locale='pl'
        )
        .distinct()
        .order_by('branch__slug', 'number')[:count]
    )
    if len(rows) < count:
        raise CommandError(
            f'Only {len(rows)} published Polish exercise(s) in this database; the demo needs '
            f'{count}. Run the corpus import first.'
        )
    return rows


def _write_rules(contest, bodies):
    preset = presets.get(contest.preset_key)
    wanted = [s.key for s in presets.sections_for(preset)]
    for order, key in enumerate(wanted):
        ContestRulesSection.objects.update_or_create(
            contest=contest, key=key,
            defaults={'order': order, 'body': bodies.get(key, '')},
        )
    if contest.rules_version < 1:
        rules.publish_rules(contest, actor=contest.organiser)


class Command(BaseCommand):
    help = 'Seed (or refresh) two demo contests on the dev accounts. Idempotent.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--minors', action='store_true',
            help='Also set Profile.is_minor on the two pupil accounts (a site-wide flag — see the '
                 'module docstring).',
        )
        parser.add_argument(
            '--reset', action='store_true',
            help='Remove both demo contests and everything under them, then stop.',
        )

    def handle(self, *args, **options):
        if options['reset']:
            removed = Contest.objects.filter(title__in=(SCHOOL_TITLE, CHALLENGE_TITLE)).delete()
            self.stdout.write(self.style.WARNING(f'Removed: {removed[0]} row(s).'))
            return

        FeatureFlag.objects.update_or_create(key='contests', defaults={'is_enabled': True})

        with transaction.atomic():
            school, school_report, school_new = self._school(options['minors'])
            challenge, challenge_report, challenge_new = self._challenge()

        for contest, report, created in (
            (school, school_report, school_new), (challenge, challenge_report, challenge_new),
        ):
            verb = 'Created' if created else 'Refreshed'
            self.stdout.write(self.style.SUCCESS(
                f'{verb} “{contest.title}” — /contests/{contest.pk} '
                f'[{contest.preset_key}, {contest.status}]'
            ))
            self.stdout.write(
                f'  apply_preset: created={report["created"]} skipped={report["skipped"]}'
            )
        if options['minors']:
            self.stdout.write(self.style.WARNING(
                'Profile.is_minor was set on ' + ', '.join(PUPILS) + ' — a SITE-WIDE flag: it '
                'closes messaging, locks those profiles private and holds their comments for '
                'review. Clear it by hand when you are done looking.'
            ))
        student = _user('student1')
        self.stdout.write(
            f'  student1 (#{student.pk}) is registered nowhere, on purpose: it is the account that '
            'shows the empty states.'
        )

    # ---- 1. the school contest, end to end ----------------------------------------------------
    def _school(self, flag_minors):
        kasia = _user('u-kasia')
        michal, ola, bartek = _user('u-michal'), _user('u-ola'), _user('u-bartek')
        now = timezone.now()

        contest, created = Contest.objects.get_or_create(
            title=SCHOOL_TITLE,
            defaults={'organiser': kasia, 'preset_key': 'school'},
        )
        contest.organiser = kasia
        contest.preset_key = 'school'
        contest.description = (
            'Cztery zadania z analizy matematycznej dla uczniów klas maturalnych. Prace ocenia '
            'dwuosobowa komisja według kryteriów z §6 regulaminu. Nagrodą jest książka.'
        )
        contest.visibility = 'public'
        contest.audience = 'secondary'
        contest.allows_minors = True
        contest.starts_at = now - timedelta(days=30)
        contest.ends_at = now - timedelta(days=9)
        contest.registration_opens_at = now - timedelta(days=30)
        contest.registration_closes_at = now - timedelta(days=24)
        contest.has_prize = True
        contest.prize_claim_deadline = now + timedelta(days=21)
        contest.prize_description = 'Książka „Analiza matematyczna w zadaniach” (ok. 150 zł).'
        contest.prize_total_value_pln = 150
        contest.prize_regime = 'science_68_then_10pct'
        contest.entry_licence = 'non_exclusive'
        contest.complaint_window_days = 14
        contest.publication_default = 'initials'
        contest.merit_criteria = (
            'Każde zadanie 0–5 punktów: poprawność rachunku (0–2) i kompletność uzasadnienia (0–3). '
            'Remisy rozstrzyga się merytorycznie — pełniejszym uzasadnieniem zadania 4.'
        )
        contest.data_controller_name = 'Katarzyna Wiśniewska, XIV LO im. S. Staszica'
        contest.data_controller_contact = 'kasia@edmat.example, ul. Nowowiejska 37a, Warszawa'
        contest.accommodation_contact = 'Bartek Kamiński, bartek@edmat.example'
        contest.laureate_min_pct = 90
        contest.finalist_min_pct = 70
        contest.distinction_count = 1
        contest.save()

        for user, role in ((michal, 'jury'), (ola, 'jury'), (bartek, 'secretary')):
            ContestStaff.objects.update_or_create(
                contest=contest, user=user, defaults={'role': role, 'added_by': kasia}
            )

        _write_rules(contest, SCHOOL_RULES)

        stage, _ = ContestStage.objects.get_or_create(
            contest=contest, key='round',
            defaults={'order': 0, 'title': 'Etap I', 'advancement': 'final'},
        )
        stage.title = 'Etap I'
        stage.description = (
            'Cztery zadania do rozwiązania w domu, w ciągu dwóch tygodni. Rozwiązania wpisuje się '
            'w formularz; wolno dołączyć skan brudnopisu.'
        )
        stage.mode = 'online'
        stage.opens_at = now - timedelta(days=23)
        stage.closes_at = now - timedelta(days=12)
        stage.advancement = 'final'
        stage.save()

        for order, exercise in enumerate(_exercises(4)):
            ContestProblem.objects.update_or_create(
                stage=stage, exercise=exercise, defaults={'order': order, 'points': 5}
            )
        problems = list(stage.problems.order_by('order'))

        # The four entrants. Two carry a guardian's consent, the way a minor's registration does.
        entrants = [
            ('demo-ania', 'XIV LO, klasa 3C', None),
            ('demo-piotr', 'XIV LO, klasa 3A', None),
            ('demo-zofia', 'XIV LO, klasa 2B', 'Agnieszka Nowicka'),
            ('demo-jakub', 'XIV LO, klasa 2B', 'Marek Wrona'),
        ]
        registrations = []
        for username, affiliation, guardian in entrants:
            user = _user(username)
            if flag_minors and username in PUPILS:
                profile = user.profile
                profile.is_minor = True
                profile.save(update_fields=['is_minor'])
            row, _made = ContestRegistration.objects.get_or_create(contest=contest, user=user)
            row.status = 'accepted'
            row.affiliation = affiliation
            row.guardian_name = guardian or ''
            row.guardian_consent_at = now - timedelta(days=26) if guardian else None
            # One opt-in, so the results page shows both faces of `publish_name`. The preset's
            # publication default is `initials`, so even this row draws initials here — which is
            # the point: the consent and the contest's own default are two separate conditions.
            row.publish_name = username == 'demo-ania'
            row.accepted_rules_version = contest.rules_version
            row.decided_by = kasia
            row.decided_at = now - timedelta(days=25)
            row.save()
            registrations.append(row)

        # Submissions of visibly different quality, then two jurors' marks on every cell.
        quality = {0: (5, 5, 5, 5), 1: (5, 4, 4, 3), 2: (4, 3, 3, 2), 3: (3, 2, 1, 1)}
        for index, registration in enumerate(registrations):
            submission, _made = ContestSubmission.objects.get_or_create(
                stage=stage, registration=registration
            )
            submission.status = 'submitted'
            submission.submitted_at = now - timedelta(days=13)
            submission.save()
            for position, problem in enumerate(problems):
                ContestAnswer.objects.update_or_create(
                    submission=submission, problem=problem,
                    defaults={'text': ANSWERS[position % len(ANSWERS)]},
                )
            marks = quality[index]
            for juror, shift in ((michal, 0), (ola, -1)):
                for position, problem in enumerate(problems):
                    points = max(0, min(5, marks[position] + (shift if position == 0 else 0)))
                    ContestScore.objects.update_or_create(
                        submission=submission, problem=problem, juror=juror,
                        defaults={
                            'points': points,
                            'note': 'Uzasadnienie pełne.' if points >= 4 else 'Brak uzasadnienia kroku 2.',
                        },
                    )

        stage.status = 'closed'
        stage.save(update_fields=['status'])
        rules.advance(stage)

        # A re-run means "make the demo say this again", and the frozen ranking is part of what it
        # says — so if a previous run published it, take it down through the real rule (which is
        # allowed only while the complaints window is open) and publish it afresh below. If the
        # window has closed the rows stay, which is the honest behaviour and the one the law wants.
        if contest.results_published_at is not None and rules.unpublish_block_reason(contest) is None:
            rules.unpublish_results(contest, actor=kasia)

        if contest.status in ('draft',):
            rules.transition(contest, 'announced', actor=kasia)
        if contest.status == 'announced':
            rules.transition(contest, 'registration_open', actor=kasia)
        if contest.status == 'registration_open':
            rules.transition(contest, 'running', actor=kasia)
        if contest.status == 'running':
            rules.transition(contest, 'judging', actor=kasia)
        if contest.results_published_at is None:
            reason = rules.publish_results_block_reason(contest)
            if reason:
                raise CommandError(
                    f'The demo school contest cannot publish its results: {reason}. That is a bug '
                    'in this seed, not in the rules — fix the seed.'
                )
            rules.publish_results(contest, actor=kasia)
        contest.refresh_from_db()

        # One complaint, lodged by the lowest-placed entrant and answered with reasons — which is
        # what the law actually requires and what the inbox on `/manage` is for.
        complainant = registrations[-1]
        complaint = contest.complaints.filter(registration=complainant).first()
        if complaint is None:
            complaint = ContestComplaint.objects.create(
                contest=contest, registration=complainant,
                text='Uważam, że zadanie 3 oceniono za nisko — uzasadnienie było pełne, '
                     'brakowało tylko rysunku.',
            )
        complaint.status = 'answered'
        complaint.answer = (
            'Dziękujemy za uwagę. Komisja ponownie przeczytała rozwiązanie zadania 3. Zgodnie z §6 '
            'regulaminu za kompletność uzasadnienia przyznaje się do 3 punktów; w pracy brakuje '
            'uzasadnienia przejścia granicznego, nie samego rysunku. Ocena pozostaje bez zmian. '
            'Droga sądowa pozostaje otwarta.'
        )
        complaint.answered_by = bartek
        complaint.answered_at = now - timedelta(days=2)
        complaint.save()

        report = personalize.apply_preset(contest, kasia)
        return contest, report, created

    # ---- 2. the prize-free challenge, waiting for entrants -------------------------------------
    def _challenge(self):
        michal, julia = _user('u-michal'), _user('u-julia')
        now = timezone.now()

        contest, created = Contest.objects.get_or_create(
            title=CHALLENGE_TITLE,
            defaults={'organiser': michal, 'preset_key': 'challenge'},
        )
        contest.organiser = michal
        contest.preset_key = 'challenge'
        contest.description = (
            'Zestaw zadań o ciągach i szeregach, z jury i publikowanym rankingiem — bez nagrody. '
            'Bez nagrody nie ma przyrzeczenia publicznego, więc nie trzeba terminu ubiegania się '
            'o nagrodę i nie powstaje podatek.'
        )
        contest.visibility = 'public'
        contest.audience = 'university'
        contest.allows_minors = False
        contest.has_prize = False
        contest.prize_regime = 'none'
        contest.prize_claim_deadline = None
        contest.starts_at = now - timedelta(days=2)
        contest.ends_at = now + timedelta(days=26)
        contest.registration_opens_at = now - timedelta(days=2)
        contest.registration_closes_at = now + timedelta(days=12)
        contest.complaint_window_days = 14
        contest.publication_default = 'initials'
        contest.merit_criteria = (
            'Każde zadanie 0–5 punktów za poprawność i jakość uzasadnienia. Remisy rozstrzyga się '
            'merytorycznie.'
        )
        contest.data_controller_name = 'Michał Zieliński'
        contest.data_controller_contact = 'michal@edmat.example'
        contest.save()

        ContestStaff.objects.update_or_create(
            contest=contest, user=julia, defaults={'role': 'jury', 'added_by': michal}
        )
        _write_rules(contest, CHALLENGE_RULES)

        stage, _ = ContestStage.objects.get_or_create(
            contest=contest, key='round',
            defaults={'order': 0, 'title': 'Runda', 'advancement': 'final'},
        )
        stage.title = 'Runda'
        stage.description = 'Cztery zadania, dwa tygodnie, rozwiązania wpisywane w formularz.'
        stage.opens_at = now + timedelta(days=12)
        stage.closes_at = now + timedelta(days=26)
        stage.save()
        for order, exercise in enumerate(_exercises(8)[4:]):
            ContestProblem.objects.update_or_create(
                stage=stage, exercise=exercise, defaults={'order': order, 'points': 5}
            )

        if contest.status == 'draft':
            reason = rules.announce_block_reason(contest)
            if reason:
                raise CommandError(
                    f'The demo challenge cannot be announced: {reason}. A bug in this seed.'
                )
            rules.transition(contest, 'announced', actor=michal)
        if contest.status == 'announced':
            rules.transition(contest, 'registration_open', actor=michal)
        contest.refresh_from_db()

        report = personalize.apply_preset(contest, michal)
        return contest, report, created
