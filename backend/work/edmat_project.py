"""EdMat managed on EdMat: the project's own organisation, and the work hung off it.

The owner's decision of 2026-10-07: the project page stops being a brochure and becomes the project
itself — an `organizations.Organization` called EdMat, with its plans, tasks, decisions, events and
needs on the platform, where anybody can read what is being built and what help is wanted. Later
the same day: *run it as an open volunteer cooperative, meeting what the association being founded
and the Faculty ask of it; import what has already been built, with its dates, from the project's
own history; one goal per module, each a subproject with its own summary and child content; the
school demo is a subproject too.* This module is the content; `manage.py seed_edmat_project`
writes it. Everything here is REAL project state, not a demonstration, which is why nothing carries
`testing.personas.FAKE_PREFIX` and why the module does not live in `testing/`.

It lives in `work/` for the reason `work/integrations.py` does: this is the one place that already
knows every management app, and `organizations` must not import `tasks` or `needs` at module level
(`config/nodes.py` dispatches *to* `organizations`, so the import would be circular).

**What the platform offers for a "subproject", and what was chosen.** EdMat has no project tree
(2donet's `mainProjectId`; `MANAGEMENT-BRIEF.md` §1 rejected one `Content` shape on purpose). What
it has is a *plan* on a node: a title, a summary, ordered steps with one level of nesting, a status
per step with `done_at`, a readers' suggestion box, and a panel that already draws "N of M steps"
per plan. So a goal is a plan on the EdMat organisation (`SUBPROJECTS`), its summary is the plan's
description, and its child content is its steps: one done, dated step per `HISTORY.md` section
that belongs to it (`work/edmat_history.py`), then the open steps this file names. The association
is three more plans (the three phases of `FUW/association/07`), the compliance table of phase 1
mirrored into *tasks* with deadlines, because a task is what the work dashboard watches.

**What the rule modules say, and what that means here.** A plan with status `active` is readable by
anyone who can see the organisation (`plans.rules.visible_plans`); `draft` is for its editors only,
which is what phase 2 gets until the owner reconciles `FINANCES.md` with the decision to sell. A
task on the node is the roster's (`tasks.rules.visible_tasks`), a poll is for the roster and its
eligible members (`decisions.rules.visible_polls` — a stranger sees none), and an open need is
everybody's (`needs.rules.public_needs`). So whatever the public should read is a plan step or a
need; whatever the team acts on is a task; whatever the members decide is a poll.

**Idempotent by title.** The organisation is found by `ORGANIZATION_SLUG`; each plan, task and need
by its title on that node, each step by its title on its plan, each poll by its question, the
founding meeting by its title and host. A second run refreshes the *text* (descriptions, kinds,
priorities, due dates, step order — the things this file is the source of) and leaves the *state*
alone (status, assignees, applications, ballots, who marked a step done — the things people change
on the site). The one exception is a history step's `done_at`: that is a fact of the log, so it is
refreshed. Renaming an entry here therefore creates a new row and leaves the old one standing;
retire the old one on the site, as a person would. An entry's `status` is its status *at creation*
only.

**Dates.** Two facts are not known yet and are the owner's to state: when the founding meeting is
(`FOUNDING_MEETING_AT`) and when the court enters the association (`KRS_ENTRY_DATE`). Every legal
deadline of phase 1 counts from one of them (CRBR 14 days from entry, NIP-8 21, the KRS application
7 days from the meeting, …), so until they are set those due dates are empty and the founding
meeting itself is not created; set the constant, run the command again, and the deadlines fill in.
The two fixed dates (the first financial statement, the first general meeting) are set now.

**Bilingual in one field.** A plan, a task and a need have no translation table
(`ExerciseTranslation` is for the corpus), so each description carries Polish first and English
after it, separated by a rule, in the project's own storage format (Markdown; `config/sanitize.py`
runs on save). History steps quote the English build log as written.

**No personal data.** Nothing here names a founder, a Faculty official, an office or a sum of money
— those stay in `FUW/association/`, which is not in the repository. `work.tests` scans every string
below for secret-shaped text, and the people are referred to by role or by count.
"""

from __future__ import annotations

import calendar
import json
import re
from collections import Counter
from datetime import date, datetime, time, timedelta
from pathlib import Path

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.utils import timezone

from work.edmat_history import load_table

#: The Gemini Deep Research thread (`FUW/association/build_thread.py` writes it from the report).
RESEARCH_THREAD_PATH = Path(__file__).with_name('edmat_research_thread.json')

ORGANIZATION_SLUG = 'edmat'

#: The two facts the owner states when they are known. Tz-aware datetime and a date.
FOUNDING_MEETING_AT: datetime | None = None
KRS_ENTRY_DATE: date | None = None

#: The two dates phase 1 already fixes (`FUW/association/07` §4, rows 1.13 and 1.14).
FIRST_STATEMENT_DUE = date(2027, 3, 31)
FIRST_GENERAL_MEETING_DUE = date(2027, 6, 30)


def _pl_en(pl: str, en: str) -> str:
    return f'{pl}{_BODY_RULE}{en}'


#: What `_pl_en` joins a body with, and what `_split_body` splits one on.
_BODY_RULE = '\n\n---\n\n'

#: What every title and question in this file joins its two languages with. Checked when the
#: de-gluing below was written: 58 of the 59 titles in this file contain EXACTLY one of these, and
#: the 59th is the founding meeting's, which is an `events.Event` and not a translatable kind. So
#: the split is unambiguous for this data — `tak/nie` and `yes/no` carry no spaces round the slash.
_TITLE_RULE = ' / '


def _split_body(text: str) -> tuple[str, str]:
    """`"pl\n\n---\n\nen"` -> `('pl', 'en')`; anything else -> `(text, '')`."""
    pl, rule, en = (text or '').partition(_BODY_RULE)
    return (pl.strip(), en.strip()) if rule else ((text or '').strip(), '')


def _split_title(text: str) -> tuple[str, str]:
    """`"PL / EN"` -> `('PL', 'EN')`; anything else -> `(text, '')`."""
    pl, rule, en = (text or '').partition(_TITLE_RULE)
    return (pl.strip(), en.strip()) if rule else ((text or '').strip(), '')


def _find_by_title(model, filters: dict, glued: str, *, split: bool = True):
    """A row this seed wrote before, whichever state it is in.

    Idempotence used to be "find it by its title", and the title used to be the two languages glued
    together. Since 2026-10-08 the languages are stored as their own rows (`translations/`) and the
    model's own column holds the POLISH half alone — so a second run has to recognise both: the
    glued title an earlier run left, and the Polish one this run writes. Without the first, a run
    against a database seeded before this change would duplicate every task, plan, need and poll.
    """
    queryset = model.objects.filter(**filters)
    found = queryset.filter(title=glued).first()
    if found is not None or not split:
        return found
    pl, _en = _split_title(glued)
    return queryset.filter(title=pl).first() if pl != glued else None


def _write_bilingual(obj, glued_heading: str, glued_body: str = '', *, heading=True, body=True,
                     suffix: str = '', bilingual: bool = True):
    """Store this row's two languages as two `translations.TextVersion` rows, Polish the original.

    This is what undoes the gluing: the file keeps writing `_pl_en(...)` and `'PL / EN'`, because
    that is a perfectly good way to keep a bilingual source readable in one place — and the seed
    splits it on the way in, so a reader of `/about` gets their own language instead of both at
    once. `write_versions` mirrors the Polish back onto the row's own column, so every other reader
    of `Task.title` is unaffected.

    `suffix` is appended to BOTH languages, for the one call site that adds a line after the glue
    (a goal's `*Aplikacje / apps: …*`); appending before the split would have filed it under
    English only.

    **`bilingual=False` writes the text as ONE Polish version and splits nothing**, and it is not an
    optimisation — it is a correctness rule. Only the data IN THIS FILE is glued. A history step's
    title comes from `edmat_history.json`, i.e. from `HISTORY.md`'s own headings, and two of those
    contain a real ` / ` of their own:

        17C. … the Tag Hover-Menu — Follow / Notify / Save for Later …
        17AG. "Report issue / Zgłoś błąd" …

    Splitting those would have truncated the title and filed the remainder as English. The full test
    suite is what caught it; `_upsert_step` passes `bilingual=not history` for exactly this.
    """
    from translations.services import write_versions

    if bilingual:
        pl_heading, en_heading = _split_title(glued_heading)
        pl_body, en_body = _split_body(glued_body)
    else:
        pl_heading, en_heading = (glued_heading or '').strip(), ''
        pl_body, en_body = (glued_body or '').strip(), ''
    if suffix:
        pl_body = f'{pl_body}{suffix}' if pl_body else suffix.strip()
        en_body = f'{en_body}{suffix}' if en_body else en_body

    def half(one_heading: str, one_body: str) -> dict:
        out = {}
        if heading:
            out['heading'] = one_heading
        if body:
            out['body'] = one_body
        return out

    versions = {'pl': half(pl_heading, pl_body)}
    if en_heading or en_body:
        # An English half that is only a translation of the heading still gets a row, so a reader
        # of the English interface sees the English name rather than the Polish one.
        versions['en'] = half(en_heading or pl_heading, en_body)
    # `keep_edited=True` is the whole reason this seed is safe to re-run after every deployment
    # (owner, 2026-10-08: *"its going to overwrite my edits i do on production on the desc of
    # edmat"* — and it would have). A language somebody saved through the bilingual editor carries
    # `written_by`; this seed's rows do not, so the service can tell them apart and leaves a
    # person's words alone. The seed fills in what nobody has touched, for ever.
    write_versions(obj, original_locale='pl', versions=versions, user=None, keep_edited=True)


ORGANIZATION = {
    'name': 'EdMat',
    'kind': 'other',
    'website': 'https://edmat.net',
    'city': 'Warszawa',
    # The board is open: anyone may read the tasks and the polls (owner, 2026-10-08).
    'open_board': True,
    'description': _pl_en(
        'Społecznościowa baza zadań i materiałów dydaktycznych, i platforma wokół niej. '
        'Ta organizacja to sam projekt EdMat, prowadzony na EdMacie: jego plany, zadania, '
        'decyzje, wydarzenia i potrzeby są tutaj — każdy może przeczytać, co powstaje i gdzie przyda '
        'się pomoc.\n\n'
        '**Jak to działa.** Projekt jest otwartą spółdzielnią wolontariuszy. Każdy moduł serwisu jest '
        'osobnym celem: planem z opisem, z tym, co już zbudowano (krok po kroku, z datami z dziennika '
        'projektu) i z tym, co otwarte. Pomoc zgłasza się przez tablicę „szukamy pomocy” albo własną '
        'ofertą na tablicy wolontariatu; osoba przyjęta do organizacji widzi tablicę zadań i głosuje '
        'w decyzjach; czytelnik może zgłosić sugestię pod każdym planem. Osobą prawną projektu ma '
        'zostać stowarzyszenie rejestrowe (plany „Stowarzyszenie — faza 1–3”), z radą programową z '
        'Wydziału Fizyki UW jako zewnętrznym okiem.',
        'A community database of exercises and teaching materials, and the platform grown around '
        'it. This organisation is the EdMat project itself, run on EdMat: its plans, tasks, '
        'decisions, events and needs live here, so anybody can read what is being built and where '
        'help is wanted.\n\n'
        '**How it works.** The project is an open volunteer cooperative. Each module of the site is '
        'a goal of its own: a plan with a summary, what has been built (step by step, dated from the '
        'project log) and what is open. Help is offered through the help-wanted board or an offer on '
        'the volunteering board; a person admitted to the organisation sees the task board and votes '
        'in decisions; any reader may leave a suggestion under any plan. The project’s legal body '
        'is to be a registered association (the plans "The association — phases 1–3"), with an '
        'advisory council from the Faculty of Physics as the outside eye.',
    ),
}

# ---- the goals: one plan per module ------------------------------------------------------------

#: One goal per module (`CLAUDE_MAP.md`'s layers), in the order the site presents them. `key` is what
#: `work/edmat_history.py` files each log section under; `apps` is the Django apps the goal covers;
#: `steps` are the open steps this file knows about (facts from the briefs and the boards), after
#: the done, dated history steps the seed writes first.
SUBPROJECTS = [
    {
        'key': 'corpus',
        'title': 'Zadania i korpus / Exercises and the corpus',
        'apps': 'taxonomy, exercises',
        'description': _pl_en(
            'Serce serwisu: ~740 zadań z treścią, wskazówką, odpowiedzią i rozwiązaniami, '
            'przeglądanych kierunek → przedmiot → temat → zadanie, z LaTeX-em renderowanym w '
            'przeglądarce, tłumaczeniami na język czytelnika, pulą rozwiązań i wskazówek od '
            'społeczności, zgłoszeniami nowych zadań i importem hurtowym.',
            'The heart of the site: ~740 exercises with a statement, a hint, an answer and solutions, '
            'browsed discipline → branch → topic → exercise, with LaTeX rendered in the browser, '
            'translations into the reader’s language, a community pool of solutions and hints, '
            'submissions of new exercises and a bulk import.',
        ),
        'steps': [],
    },
    {
        'key': 'materials',
        'title': 'Materiały / Materials',
        'apps': 'materials, materials_coop, coauthoring, galleries, sketches, chem',
        'description': _pl_en(
            'Materiały dydaktyczne: pliki i treści przesyłane przez ludzi, ponownie kodowane przy '
            'zapisie, z wymaganiami i pokryciem, podglądem PDF, współautorstwem w projektach z '
            'wersjami, galeriami zdjęć, szkicami i rysunkami chemicznymi.',
            'Teaching materials: files and content uploaded by people, re-encoded on write, with '
            'requirements and coverage claims, PDF preview, co-authoring in projects with versions, '
            'photo galleries, sketches and chemistry drawings.',
        ),
        'steps': [],
    },
    {
        'key': 'community',
        'title': 'Społeczność i moderacja / Community and moderation',
        'apps': 'community, moderation, notifications, messaging, activity, issues, legal',
        'description': _pl_en(
            'Komentarze, oceny, zgłoszenia, powiadomienia, wiadomości, kanał aktywności i dyskusje '
            'pod stronami stałymi; moderacja z zakresem, wyłączniki funkcji, kanał zgłoszeń prawnych '
            '(DSA) i ochrona nieletnich w każdym kanale.',
            'Comments, reviews, reports, notifications, messaging, the activity feed and discussions '
            'under the standing pages; scoped moderation, feature kill switches, the legal notice '
            'channel (DSA) and minor-safety in every channel.',
        ),
        'steps': [],
    },
    {
        'key': 'accounts',
        'title': 'Konta, nieletni, zaufanie / Accounts, minors, trust',
        'apps': 'accounts, identity',
        'description': _pl_en(
            'Konta i profile, konta opiekunów dla nieletnich z bezpiecznymi domyślnymi ustawieniami, '
            'poziomy zaufania, weryfikacja współtwórców i brama tworzenia (kurs, wydarzenie, '
            'ogłoszenie albo organizację zakłada zweryfikowany współtwórca, do czasu USOS).',
            'Accounts and profiles, guardian accounts for minors with safe defaults, trust levels, '
            'contributor verification and the creation gate (a course, an event, a listing or an '
            'organisation is founded by a verified contributor, until USOS).',
        ),
        'steps': [],
    },
    {
        'key': 'courses',
        'title': 'Kursy / Courses',
        'apps': 'courses',
        'description': _pl_en(
            'Kursy prowadzone przez użytkowników: wielu prowadzących, lekcje z prawdziwą treścią, '
            'zaproszenia, postępy, tryb szkolny (klasa to kurs prowadzony przez szkołę) i certyfikat '
            'ukończenia, który niesie własną podstawę.',
            'Courses people run: many staff, lessons linking real content, invite links, progress, '
            'school mode (a class is a course a school runs) and a completion certificate that '
            'carries its own basis.',
        ),
        'steps': [],
    },
    {
        'key': 'tutoring',
        'title': 'Korepetycje i rezerwacje / Tutoring and booking',
        'apps': 'services, booking',
        'description': _pl_en(
            'Ogłoszenia korepetytorów online i na miejscu (z mapą), dostępność układana tydzień po '
            'tygodniu i prawdziwa rezerwacja sesji — bez płatności w serwisie.',
            'Tutor listings online and in person (with a map), availability laid out week by week '
            'and real session booking — with no payment on the platform.',
        ),
        'steps': [],
    },
    {
        'key': 'events',
        'title': 'Wydarzenia / Events',
        'apps': 'events',
        'description': _pl_en(
            'Jednorazowe wydarzenia z programem, prelegentami, trybami rejestracji, listą '
            'oczekujących, odprawą, naborem wystąpień, aktualnościami i taliami fiszek na wynos.',
            'One-off events with a programme, speakers, registration modes, a waiting list, '
            'check-in, a call for contributions, updates and take-home flashcard decks.',
        ),
        'steps': [],
    },
    {
        'key': 'conference',
        'title': 'Warstwa konferencyjna / The conference layer',
        'apps': 'venues, documents, shifts, cloakroom',
        'description': _pl_en(
            'Zbudowana w jeden dzień przez siedem równoległych gałęzi: budynki i sale, dokumenty '
            'wydarzenia z poziomami widoczności, bilety i drzwi działające bez Wi-Fi, grafik '
            'wolontariuszy z certyfikatem godzin, szatnia bez nazwisk, minimalizacja danych i '
            'eksporty — plus demonstracyjna konferencja do pokazania.',
            'Built in one day by seven parallel branches: buildings and rooms, event documents with '
            'visibility tiers, tickets and a door that works offline, a volunteer rota with an hours '
            'certificate, a cloakroom with no names, data minimisation and exports — plus a seeded '
            'demonstration conference.',
        ),
        'steps': [],
    },
    {
        'key': 'management',
        'title': 'Zarządzanie, i EdMat na EdMacie / Management, and EdMat on EdMat',
        'apps': 'organizations, tasks, needs, plans, decisions, work',
        'description': _pl_en(
            'Warstwa, w której to czytasz: organizacje z własnym składem, zadania z terminami, '
            'tablica „szukamy pomocy”, plany z krokami i sugestiami, głosowania z regułą '
            'uprawnienia i pulpit „co na mnie czeka”. Od 7.10.2026 sam projekt EdMat jest tu '
            'organizacją, a ten plan jest jednym z jego celów.',
            'The layer you are reading this in: organisations with rosters, tasks with deadlines, '
            'the help-wanted board, plans with steps and suggestions, polls with an eligibility rule '
            'and the "what waits on me" dashboard. Since 2026-10-07 the EdMat project itself is an '
            'organisation here, and this plan is one of its goals.',
        ),
        'steps': [],
    },
    {
        'key': 'learning',
        'title': 'Cykl uczenia się / The learning cycle',
        'apps': 'flashcards, study, identity (learning record)',
        'description': _pl_en(
            'Mój zestaw, fiszki z powtórkami SM-2 umieszczane na kursie albo wydarzeniu, dziennik '
            'nauki (co kto zrobił i co udostępnił), pasmo odbiorców uczenia się przez całe życie i '
            'talia z jednego kliknięcia na lekcji.',
            'My set, flashcards with SM-2 review placed on a course or an event, the learning record '
            '(what somebody did and shared), the lifelong-learning audience band and a one-click '
            'deck from a lesson.',
        ),
        'steps': [],
    },
    {
        'key': 'concepts',
        'title': 'Pojęcia i ścieżki / Concepts and paths',
        'apps': 'concepts',
        'description': _pl_en(
            'Wiki pojęć: artykuły na każdy poziom odbiorcy, składane z bloków i podlinkowane do '
            'wszystkiego; ścieżki wymagań wstępnych („zanim to, poznaj…”) i talia fiszek z pojęcia.',
            'A concept wiki: articles per audience, built from blocks and linked to everything; '
            'prerequisite paths ("before this, know…") and a flashcard deck from a concept.',
        ),
        'steps': [],
    },
    {
        'key': 'dziennik',
        'title': '/dziennik — demonstracja zarządzania szkołą / the school-management demo',
        'apps': 'school-management-demo (drugi produkt w repozytorium / a second product in the repository)',
        'description': _pl_en(
            'Oprogramowanie do zarządzania szkołą, pokazane jako strona bez serwera: zamrożony '
            'zrzut danych demonstracyjnych, role (dyrekcja, nauczyciel, uczeń, opiekun), moduł '
            'wydarzeń szkolnych. Osobny podprojekt: ma własne testy, własny pakiet w wydaniu i '
            'własną listę spraw otwartych. Tryb szkolny w prawdziwych kursach jest krokiem celu '
            '„Kursy”.',
            'School-management software shown as a page with no server behind it: a frozen snapshot '
            'of demo data, roles (head, teacher, pupil, guardian), a school events module. A '
            'subproject of its own: its own tests, its own package in a release, its own list of '
            'open items. School mode in the real courses is a step of the "Courses" goal.',
        ),
        'steps': [
            {
                'title': 'Udostępnić demonstrację publicznie na serwerze / Serve the demo publicly on the server',
                'description': _pl_en(
                    'Pakiet jest zainstalowany i testowany na serwerze, ale nic go nie serwuje — '
                    'potrzebny jest blok vhosta, usługa systemowa i ścieżka bazowa. Kształt opisany '
                    'w runbooku wdrożenia z 25.09.2026.',
                    'The package is installed and tested on the server, but nothing serves it — a '
                    'vhost block, a system unit and a base path are needed. The shape is in the '
                    'deployment runbook of 2026-09-25.',
                ),
            },
            {
                'title': 'Zdecydować, czym staje się demonstracja / Decide what the demo becomes',
                'description': _pl_en(
                    'Dziś /dziennik niczego nie zapisuje. Albo interaktywna strona (serwer '
                    'zbudowany do przeglądarki — dużo pracy, świadomie nieprzebrana), albo tryb '
                    'szkolny w kursach jako produkt dla szkół.',
                    '/dziennik saves nothing today. Either an interactive page (the server bundled '
                    'into the browser — a large job, deliberately not attempted) or school mode in '
                    'courses as the product for schools.',
                ),
            },
            {
                'title': 'Plan lekcji i podpis opiekuna pod certyfikatem — odłożone świadomie / A timetable and a guardian’s sign-off — deferred by design',
                'description': _pl_en(
                    'Dwie rzeczy, które brief trybu szkolnego zostawił otwarte z nazwy; dziennik '
                    'ocen pozostaje poza EdMatem z decyzji projektowej.',
                    'Two things the school-mode brief left open by name; a gradebook stays out of '
                    'EdMat by design decision.',
                ),
            },
            {
                'title': 'Plany i serwery dla szkół — faza 2 stowarzyszenia / Plans and servers for schools — the association’s phase 2',
                'description': _pl_en(
                    'Hosting dla szkół jest działalnością gospodarczą; wymaga wpisu do rejestru '
                    'przedsiębiorców i umowy z uczelnią na infrastrukturę albo własnego hostingu. '
                    'Patrz plan „Stowarzyszenie — faza 2”.',
                    'Hosting for schools is business activity; it needs the register of '
                    'entrepreneurs and an infrastructure agreement with the University, or own '
                    'hosting. See the plan "The association — phase 2".',
                ),
            },
        ],
    },
    {
        'key': 'interface',
        'title': 'Interfejs, dostępność, języki, podręcznik / Interface, accessibility, languages, the manual',
        'apps': 'frontend (layout, styles, i18n, /about, /about/guide)',
        'description': _pl_en(
            'Pasek nawigacji z misją, polski jako język pierwszy, komfort czytania (rozmiar tekstu, '
            'wysoki kontrast, cele dotykowe 44 px), audyt dostępności na 48 stronach, kolor, który '
            'coś znaczy, strona /about, pokaz projektowy i podręcznik z prawdziwymi zrzutami.',
            'A navbar that carries the mission, Polish first, reading comfort (text size, high '
            'contrast, 44 px targets), an accessibility audit over 48 pages, colour that means '
            'something, the /about page, the design showcase and a manual with real screenshots.',
        ),
        'steps': [],
    },
    {
        'key': 'platform',
        'title': 'Platforma: testy, wydajność, wdrożenia / Platform: tests, performance, deployment',
        'apps': 'config, testing, deploy',
        'description': _pl_en(
            'To, co trzyma resztę: ponad 2700 testów w czterech równoległych procesach, skrypty '
            'przeglądarkowe, prerenderowane strony dla pierwszego malowania, Redis jako opcja, '
            'wydania pakowane do tarballa i publikowane przez odtworzenie, nie przez push.',
            'What holds the rest up: over 2,700 tests in four parallel processes, browser scripts, '
            'prerendered pages for first paint, Redis as an option, releases packed into a tarball '
            'and published by replay rather than by push.',
        ),
        'steps': [],
    },
    {
        'key': 'foundations',
        'title': 'Fundamenty / Foundations',
        'apps': 'the original blueprint: data model, i18n, LaTeX pipeline, stack, API, routing',
        'description': _pl_en(
            'Szkic, od którego wszystko się zaczęło: tekst w tabeli tłumaczeń (z oryginałem), dwie '
            'osie języka (interfejs i treść), LaTeX wyciągany przed Markdownem, Django + SvelteKit '
            'bez SSR, usługi jako jedyny szew do HTTP.',
            'The sketch everything started from: text in a translation table (including the '
            'original), two language axes (interface and content), LaTeX extracted before Markdown, '
            'Django + SvelteKit with no SSR, services as the only seam to HTTP.',
        ),
        'steps': [],
    },
]

# ---- the association: three phases ---------------------------------------------------------------

#: `due`: None, `('meeting', days)`, `('entry', days)` or `('fixed', date)` — resolved by
#: `due_at_for` against the two constants above. `status` is the status at creation.
PHASE_1_STEPS = [
    {
        'title': 'Skompletować co najmniej 7 założycieli, realnie 10 / Gather at least 7 founders, realistically 10',
        'priority': 1,
        'due': ('meeting', 0),
        'description': _pl_en(
            'Ustawa wymaga siedmiu osób fizycznych z pełną zdolnością do czynności prawnych; z '
            'arytmetyki głosowań na zebraniu (trzyosobowa komisja skrutacyjna nie kandyduje, do '
            'obsadzenia sześć mandatów) wychodzi dziesięć i więcej. Stan 7.10.2026: cztery osoby '
            'potwierdzone, trzy jeszcze nie pytane. Potrzeba „Założyciele” na tablicy jest otwarta. '
            'Dowód wykonania: podpisana lista założycieli.',
            'The Act requires seven natural persons with full legal capacity; the meeting’s '
            'voting arithmetic (a three-person scrutiny committee that does not stand, six seats to '
            'fill) makes it ten or more. As of 2026-10-07: four confirmed, three not yet asked. The '
            '"Founders" need on the board is open. Proof: the signed founders list.',
        ),
        'substeps': [
            {
                'title': 'Adres do doręczeń i zgoda uczelni na lokal / The service address and the University’s consent for the premises',
                'priority': 2,
                'due': None,
                'description': _pl_en(
                    'Siedzibą statutową jest Warszawa (sama miejscowość). Adres do doręczeń ma być '
                    'na terenie Wydziału Fizyki UW, co wymaga zgody uczelni (Rektor albo Kanclerz, '
                    'na wniosek przez Dziekana) — potrzebnej urzędowi skarbowemu i bankowi, nie '
                    'sądowi. Awaryjnie: lokal członka Zarządu z umową użyczenia.',
                    'The statutory seat is Warsaw (the locality alone). The service address is to '
                    'be on the Faculty of Physics premises, which needs the University’s '
                    'consent (the Rector or the Chancellor, applied for through the Dean) — '
                    'required by the tax office and the bank, not by the court. Fallback: a board '
                    'member’s premises under a loan-for-use agreement.',
                ),
            },
            {
                'title': 'Forma wynagrodzenia Zarządu — dopiero gdy będą pieniądze / How the board could be paid — only once there is money',
                'priority': 4,
                'due': None,
                'description': _pl_en(
                    'Powołanie albo zlecenie, każde z innymi składkami; decyzja Walnego Zebrania, '
                    'do potwierdzenia u księgowego. Nie wcześniej niż po pierwszych środkach.',
                    'Appointment or a service contract, each with different contributions; a '
                    'general-meeting decision, to be confirmed with an accountant. Not before the '
                    'first funds.',
                ),
            },
        ],
    },
    {
        'title': 'Zebranie założycielskie: uchwały 1–6, wybory tajne, lista, zgody / The founding meeting: resolutions 1–6, secret ballots, the list, consents',
        'priority': 1,
        'due': ('meeting', 0),
        'description': _pl_en(
            'Szesnastopunktowy porządek obrad, około 90 minut: utworzenie, statut, Zarząd i Komisja '
            'Rewizyjna w głosowaniu tajnym, upoważnienie do rejestracji, zaproszenie przedstawicieli '
            'Wydziału do Rady Programowej, adres siedziby. Dowód: protokół z jedenastoma '
            'załącznikami. Wydarzenie w serwisie powstaje, gdy data zostanie ustalona.',
            'A sixteen-point agenda, about 90 minutes: formation, the statute, the Board and the '
            'Audit Committee by secret ballot, the registration mandate, the invitation of Faculty '
            'representatives to the Programme Council, the seat. Proof: the minutes with eleven '
            'attachments. The event appears on the site once its date is set.',
        ),
    },
    {
        'title': 'Wniosek do KRS — rejestr stowarzyszeń, bez działalności gospodarczej / The KRS application — the register of associations, no business activity',
        'priority': 1,
        'due': ('meeting', 7),
        'description': _pl_en(
            'Do siedmiu dni po zebraniu (art. 22 ustawy o KRS); wpis do rejestru stowarzyszeń jest '
            'bezpłatny (art. 17 ust. 3 Prawa o stowarzyszeniach); formularze KRS-W20 i KRS-WK, bez '
            'KRS-WF, gdy Zarząd został wybrany. Dowód: potwierdzenie złożenia.',
            'Within seven days of the meeting (art. 22 of the KRS Act); entry in the register of '
            'associations is free (art. 17(3) of the Associations Act); forms KRS-W20 and KRS-WK, '
            'no KRS-WF when a Board was elected. Proof: the filing receipt.',
        ),
    },
    {
        'title': 'Odpowiedź na ewentualne wezwanie sądu / Answering a court summons, if one comes',
        'priority': 2,
        'due': None,
        'description': _pl_en(
            'Siedem dni od doręczenia (art. 20a ustawy o KRS). Dowód: pismo.',
            'Seven days from service (art. 20a of the KRS Act). Proof: the letter.',
        ),
    },
    {
        'title': 'Wpis do KRS; NIP i REGON nadane automatycznie / Entry in the KRS; NIP and REGON assigned automatically',
        'priority': 2,
        'due': None,
        'description': _pl_en(
            'Sąd, zwykle jeden do trzech miesięcy. Dowód: odpis z KRS. Po wpisie: ustawić datę '
            'wpisu w `work/edmat_project.py` i uruchomić `seed_edmat_project` ponownie — terminy '
            'kolejnych kroków wypełnią się same.',
            'The court, usually one to three months. Proof: the KRS extract. After entry: set the '
            'entry date in `work/edmat_project.py` and run `seed_edmat_project` again — the '
            'deadlines of the following steps fill in by themselves.',
        ),
    },
    {
        'title': 'Zgłoszenie do CRBR — 14 dni od wpisu / The CRBR filing — 14 days from entry',
        'priority': 1,
        'due': ('entry', 14),
        'description': _pl_en(
            'Centralny Rejestr Beneficjentów Rzeczywistych: członkowie Zarządu; art. 60 ust. 1 '
            'ustawy o przeciwdziałaniu praniu pieniędzy; kara do miliona złotych. Dowód: '
            'potwierdzenie zgłoszenia.',
            'The central register of beneficial owners: the Board members; art. 60(1) of the '
            'anti-money-laundering Act; a fine of up to a million złoty. Proof: the filing receipt.',
        ),
    },
    {
        'title': 'Rachunek bankowy, księgowość, pełne księgi albo UEPiK / Bank account, bookkeeping, full books or the simplified ledger',
        'priority': 2,
        'due': ('entry', 30),
        'description': _pl_en(
            'Trzydzieści dni od wpisu. Uproszczona ewidencja wymaga zawiadomienia urzędu skarbowego '
            'w trzy miesiące od rozpoczęcia działalności i mieści się do miliona złotych przychodu. '
            'Dowód: umowa, numer rachunku, zawiadomienie.',
            'Thirty days from entry. The simplified ledger needs a notice to the tax office within '
            'three months of starting activity and holds up to a million złoty of revenue. Proof: '
            'the contract, the account number, the notice.',
        ),
    },
    {
        'title': 'NIP-8 — rachunek, adres do korespondencji, miejsce ksiąg / NIP-8 — the account, the correspondence address, where the books are kept',
        'priority': 2,
        'due': ('entry', 21),
        'description': _pl_en(
            'Dwadzieścia jeden dni od wpisu, każda zmiana w siedem. Dowód: urzędowe poświadczenie '
            'odbioru.',
            'Twenty-one days from entry, every change within seven. Proof: the official receipt.',
        ),
    },
    {
        'title': 'Rada Programowa: zaproszenia na Wydział, po 30 dniach scenariusz B / The Programme Council: the Faculty invitations, then plan B after 30 days',
        'priority': 2,
        'due': ('entry', 30),
        'description': _pl_en(
            'Trzy osoby z Wydziału Fizyki UW, których funkcje wiążą się z projektem — jeszcze nie '
            'pytane; zaproszenia idą po wpisie, infrastruktura (OKWF) jako pierwsza rozmowa. '
            'Scenariusz B po trzydziestu dniach milczenia: potrzeba na tablicy „szukamy pomocy” '
            '(ekspertyza, trzy miejsca, zdalnie, około dziesięciu godzin rocznie), oferty z tablicy '
            'wolontariatu, głosowanie członków, gdy kandydatów jest więcej niż miejsc. Minimum dwie '
            'osoby, docelowo trzy. Dowód: pisma, protokół Zarządu.',
            'Three people from the Faculty of Physics whose roles touch the project — not yet '
            'asked; invitations go out after entry, the computing centre first. Plan B after thirty '
            'days of silence: a need on the help-wanted board (expertise, three seats, remote, '
            'about ten hours a year), offers from the volunteering board, a members’ vote when '
            'there are more candidates than seats. At least two people, three in the end. Proof: '
            'the letters, the Board’s minutes.',
        ),
    },
    {
        'title': 'Organizacja na edmat.net i ta tabela w module zadań, z terminami / The organisation on edmat.net and this table in the tasks module, with deadlines',
        'priority': 3,
        'due': ('entry', 7),
        'status': 'in_progress',
        'description': _pl_en(
            'To robi `seed_edmat_project`: organizacja, ten plan, zadania z terminami liczonymi od '
            'zebrania i od wpisu. W toku, bo obie daty są jeszcze puste. Dowód: strona organizacji.',
            'This is what `seed_edmat_project` does: the organisation, this plan, the tasks with '
            'deadlines counted from the meeting and from entry. In progress, because both dates '
            'are still empty. Proof: the organisation page.',
        ),
    },
    {
        'title': 'Regulamin składek i deklaracje członkowskie / Dues rules and membership declarations',
        'priority': 3,
        'due': ('fixed', FIRST_GENERAL_MEETING_DUE),
        'description': _pl_en(
            'Statut: składek nie pobiera się do pierwszej uchwały Walnego Zebrania. Dowód: uchwała.',
            'The statute: no dues are collected until the first general-meeting resolution. Proof: '
            'the resolution.',
        ),
    },
    {
        'title': 'Infrastruktura i dane: ośrodek komputerowy, Kanclerz, inspektor ochrony danych, transfer technologii / Infrastructure and data: the computing centre, the Chancellor, the data-protection officer, technology transfer',
        'priority': 2,
        'due': None,
        'description': _pl_en(
            'Najpierw rozmowa z ośrodkiem komputerowym Wydziału, który administruje serwerem. Potem '
            'pisma: do Kanclerza (lokal, użyczenie), do inspektora ochrony danych (test równowagi '
            'interesów z art. 6 ust. 1 lit. f RODO, zawiadomienie użytkowników 30 dni wcześniej z '
            'prawem sprzeciwu, obowiązek z art. 14, umowa powierzenia na okres przejściowy) i do '
            'biura transferu technologii (prawa do zadań napisanych przez pracowników uczelni). '
            'Dowód: notatki, projekty umów.',
            'First a conversation with the Faculty computing centre, which administers the server. '
            'Then letters: to the Chancellor (premises, loan for use), to the data-protection '
            'officer (the legitimate-interest balancing test of GDPR art. 6(1)(f), notice to users '
            '30 days ahead with a right to object, the art. 14 duty, a processing agreement for the '
            'transition) and to the technology-transfer office (rights to exercises written by '
            'University staff). Proof: notes, draft agreements.',
        ),
    },
    {
        'title': 'Pierwszy rok obrotowy do 31.12.2026: sprawozdanie, CIT-8, urząd skarbowy / The first financial year to 31 Dec 2026: the statement, CIT-8, the tax office',
        'priority': 2,
        'due': ('fixed', FIRST_STATEMENT_DUE),
        'description': _pl_en(
            'Sprawozdanie finansowe do 31.03.2027, zatwierdzenie na Walnym do 30.06.2027, wysyłka '
            'do Szefa KAS w 15 dni od zatwierdzenia, CIT-8 do 31.03.2027. Jeżeli wpis wypadnie w '
            '2027, zapis statutu o pierwszym roku obrotowym trzeba zmienić. Dowód: urzędowe '
            'poświadczenia odbioru.',
            'The financial statement by 2027-03-31, approval at the general meeting by 2027-06-30, '
            'sent to the head of the tax administration within 15 days of approval, CIT-8 by '
            '2027-03-31. If entry falls in 2027, the statute’s first-financial-year clause has '
            'to change. Proof: the official receipts.',
        ),
    },
    {
        'title': 'Pierwsze Walne Zebranie: absolutorium, sprawozdanie Komisji, plan fazy 2 / The first general meeting: discharge, the Committee’s report, the phase 2 plan',
        'priority': 2,
        'due': ('fixed', FIRST_GENERAL_MEETING_DUE),
        'description': _pl_en(
            'Do 30.06.2027. Kryterium wyjścia z fazy 1: każda pozycja ma dowód wykonania, a Rada '
            'Programowa liczy co najmniej trzy osoby. Dowód: protokół.',
            'By 2027-06-30. Phase 1’s exit criterion: every item has its proof, and the '
            'Programme Council has at least three people. Proof: the minutes.',
        ),
    },
]

PHASE_2_STEPS = [
    {'title': 'Uchwała Walnego Zebrania o podjęciu działalności gospodarczej / A general-meeting resolution to start business activity',
     'description': _pl_en('Statut już ją dopuszcza, więc bez zmiany statutu.', 'The statute already permits it, so no statute change.')},
    {'title': 'Wpis do rejestru przedsiębiorców KRS / Entry in the KRS register of entrepreneurs',
     'description': _pl_en('Wyłącznie elektronicznie, z kodami PKD 2025, z opłatą sądową.', 'Electronically only, with PKD 2025 codes, with a court fee.')},
    {'title': 'Pełne księgi i wyodrębnienie rachunkowe działalności gospodarczej / Full books and separate accounts for the business',
     'description': _pl_en('Wymóg ustawy o rachunkowości i statutu.', 'Required by the Accounting Act and the statute.')},
    {'title': 'VAT, sprzedaż do UE, prewspółczynnik, CIT od składek / VAT, EU sales, the pro-rata, CIT on dues',
     'description': _pl_en('Zwolnienie podmiotowe z limitem; składki finansujące działalność gospodarczą tracą zwolnienie — osobna analityka. Księgowy.', 'The small-business VAT exemption has a ceiling; dues that fund the business lose their CIT exemption — separate accounts. An accountant.')},
    {'title': 'Regulamin sprzedaży: konto premium jako usługa cyfrowa / Terms of sale: the premium account as a digital service',
     'description': _pl_en('Odstąpienie 14 dni z zapłatą proporcjonalną, RODO dla płatności, kasa fiskalna. Przed pierwszą sprzedażą konsumentowi.', 'A 14-day withdrawal with proportional payment, GDPR for payments, the fiscal register. Before the first consumer sale.')},
    {'title': 'Umowa z uczelnią na infrastrukturę albo własny hosting / An agreement with the University for infrastructure, or own hosting',
     'description': _pl_en('Bez tego nic nie jest sprzedawane: darmowe utrzymywanie sprzedającego serwisu na mieniu uczelni narusza dyscyplinę finansów publicznych.', 'Without it nothing is sold: hosting a selling service for free on University property breaches public-finance discipline.'),
     'substeps': [
         {'title': 'Audyt praw do korpusu i licencja od uczelni / A copyright audit of the corpus and a licence from the University',
          'description': _pl_en('Zadania pisane przez pracowników uczelni w ramach obowiązków są utworami pracowniczymi; sprzedaż dostępu bez licencji narusza prawo autorskie. Warunek wstępny, nie jedno z zadań.', 'Exercises written by University staff in the course of their duties are employee works; selling access without a licence infringes copyright. A precondition, not one task among others.')},
         {'title': 'Wniosek o interpretację podatkową dla hostingu dla szkół / A tax-ruling request for school hosting',
          'description': _pl_en('Po uzyskaniu NIP.', 'After the tax number is assigned.')},
     ]},
    {'title': 'Moduł płatności w serwisie — dziś nie istnieje / A payments module — does not exist today',
     'description': _pl_en('Operator płatności, faktury, zwroty, spory: decyzja produktowa i inżynierska. Dziś ceny są tylko tekstem.', 'A payment operator, invoices, refunds, disputes: a product and engineering decision. Today prices are only text.')},
    {'title': 'Rada Programowa opiniuje cennik i warunki dla szkół / The Programme Council reviews the price list and school terms',
     'description': _pl_en('Zgodnie z rolą Rady, przed uruchomieniem.', 'Per the Council’s role, before launch.')},
]

PHASE_3_STEPS = [
    {'title': 'Fundacja EdMat ustanowiona przez Stowarzyszenie / The EdMat Foundation founded by the association',
     'description': _pl_en('Po zebraniu środków; akt notarialny; lista decyzji w materiałach grantowych.', 'Once funds are gathered; a notarial deed; the list of decisions is in the grant materials.')},
    {'title': 'Status organizacji pożytku publicznego po dwóch latach / Public-benefit status after two years',
     'description': _pl_en('Komisja Rewizyjna już spełnia wymóg niezależności od Zarządu.', 'The Audit Committee already meets the independence requirement.')},
    {'title': 'Umowa partnerska z uczelnią do konkursów FERS / A partnership agreement with the University for FERS calls',
     'description': _pl_en('Wymaga istniejącej osoby prawnej, więc dopiero teraz.', 'Needs an existing legal person, so only now.')},
]

#: `as_tasks`: mirror every step into a task on the node (the roster’s compliance calendar).
ASSOCIATION_PLANS = [
    {
        'title': 'Stowarzyszenie — faza 1: zgodność z prawem o stowarzyszeniach / The association — phase 1: compliance',
        'status': 'active',
        'as_tasks': True,
        'steps': PHASE_1_STEPS,
        'description': _pl_en(
            'Od zebrania założycielskiego do pierwszego Walnego Zebrania po rejestracji. Cel: '
            'Stowarzyszenie EdMat.net association istnieje, jest wpisane, ma rachunek, księgowość, '
            'Radę Programową i komplet obowiązków pilnowanych w module zadań. Dopiero po tej fazie '
            'wolno zacząć cokolwiek sprzedawać. Terminy ustawowe liczą się od zebrania i od wpisu do '
            'KRS; dopóki te daty nie są znane, terminy są puste. Ta sama tabela jest zadaniami '
            'organizacji, które pulpit pracy pokazuje każdemu z Zarządu, zanim zobaczy je organ '
            'nadzorujący.',
            'From the founding meeting to the first general meeting after registration. Goal: the '
            'EdMat.net association exists, is entered, has an account, bookkeeping, a Programme '
            'Council and the full set of duties watched in the tasks module. Only after this phase '
            'may anything be sold. The statutory deadlines count from the meeting and from the KRS '
            'entry; until those dates are known, the deadlines are empty. The same table is the '
            'organisation’s tasks, which the work dashboard shows every Board member before the '
            'supervising authority sees them.',
        ),
    },
    {
        'title': 'Stowarzyszenie — faza 2: działalność odpłatna i gospodarcza / The association — phase 2: paid and business activity',
        'status': 'draft',
        'as_tasks': False,
        'steps': PHASE_2_STEPS,
        'description': _pl_en(
            'Konta premium na lata i plany z serwerami dla szkół — decyzja właściciela z 6.10.2026. '
            'Plan jest szkicem (widzą go tylko redaktorzy), dopóki `FINANCES.md` i strona '
            'prywatności, które dziś mówią „nic nie bierze pieniędzy”, nie zostaną uzgodnione z tą '
            'decyzją; wtedy status zmienia się na aktywny.',
            'Multi-year premium accounts and plans with servers for schools — the owner’s '
            'decision of 2026-10-06. The plan is a draft (its editors alone see it) until '
            '`FINANCES.md` and the privacy page, which today say "nothing takes money", are '
            'reconciled with that decision; then its status becomes active.',
        ),
    },
    {
        'title': 'Stowarzyszenie — faza 3: pożytek publiczny i fundacja / The association — phase 3: public benefit and the foundation',
        'status': 'active',
        'as_tasks': False,
        'steps': PHASE_3_STEPS,
        'description': _pl_en(
            'Po fazie 1, niezależnie od fazy 2.',
            'After phase 1, independently of phase 2.',
        ),
    },
]

# ---- standalone tasks, needs, polls, the founding meeting ---------------------------------------

#: Tasks on the EdMat organisation that are not mirrored from a plan. A task board is the inside of
#: a team — `tasks.rules.visible_tasks` shows it to the organisation's members only — so each task
#: the public should know about has a sibling in `NEEDS`, which the help-wanted board shows to
#: everyone. `assign_owner` seats the owner on it at creation, so it is on their work dashboard.
TASKS = [
    {
        'title': 'Wskaźnik „z pomocą AI” — autor oznacza, społeczność głosuje / The “AI-assisted” score — author marks, community votes',
        'priority': 2,
        'assign_owner': True,
        'description': (
            '**Stan (2026-10-07): do zrobienia; nic jeszcze nie istnieje w kodzie.** W dyskusji '
            '(2026-10-07): czy „z pomocą AI” to **liczba** (0–1), czy **tak/nie** — właściciel nie zdecydował; '
            'pytanie stoi w głosowaniu organizacji.\n\n'
            'Każda treść (zadanie z rozwiązaniami, materiał, artykuł, wpis) ma wskaźnik `ai_assisted` '
            'od 0 do 1. Autor może oznaczyć treść jako „z pomocą AI” przy zgłaszaniu i przy każdej '
            'edycji — to oznaczenie jest zapisane osobno i nigdy nie ginie pod głosami. Społeczność '
            'zmienia wskaźnik swoimi głosami. Co ma powstać:\n\n'
            '1. oznaczenie autora: pole wyboru w `/submit`, `/submit-material` i w edytorach, z '
            'jednozdaniowym wyjaśnieniem, co znaczy „z pomocą AI”; zapisane jako własny rekord '
            '(kto, kiedy, przy której wersji);\n'
            '2. głosy: jeden głos na osobę na treść („z pomocą AI” / „bez”), zmienialny, zapisany '
            'z datą; nieletni mogą głosować (głos nie niesie wolnego tekstu);\n'
            '3. wskaźnik: **przeliczany** z oznaczenia autora i głosów przy każdej zmianie, nigdy '
            'inkrementowany (zasada 5); wzór w jednym module regułowym, o który pytają wszystkie '
            'końcówki — API, listy, strona treści;\n'
            '4. odczyt: **jedna plakietka, dwa znaki** (decyzja właściciela, 2026-10-07): u góry ikona '
            'trzech osób — „społeczność uważa, że z pomocą AI” — a pod nią ikona jednej osoby — „autor '
            'oznaczył”; każdy znak świeci osobno, więc plakietka mówi, kto tak twierdzi; na stronie '
            'treści i na kartach; filtr na listach '
            '(„ukryj powyżej X” / „tylko powyżej X”) z nagłówkiem liczby ukrytych, jak '
            '`X-EdMat-Hidden-Languages`;\n'
            '5. moderacja: moderator może zablokować wskaźnik na wartości z powodem (zasada 6) i '
            'odblokować; zgłoszenie „wygląda na treść AI bez oznaczenia” przez `moderation.Report`;\n'
            '6. wyłącznik `ai_assisted` (trzy pliki + migracja).\n\n'
            'Do rozstrzygnięcia: liczba czy tak/nie (propozycja: zapisać fakty — oznaczenie autora i głosy — '
            'a z nich wyliczać i wskaźnik 0–1 do filtra, i jedno słowo do plakietki: brak / autor / '
            'społeczność; oznaczenie autora jest ostateczne, głosy mogą tylko dodać, nie zdjąć), waga '
            'głosów i próg, czy głos jest tak/nie czy skala.\n\n'
            '---\n\n'
            '**State (2026-10-07): to do; nothing exists in the code yet.** Under discussion '
            '(2026-10-07): whether “AI-assisted” is a **number** (0–1) or **yes/no** — the owner has not decided; '
            'the question is in the organisation’s poll.\n\n'
            'Every piece of content (an exercise with its solutions, a material, an article, a post) '
            'carries an `ai_assisted` score from 0 to 1. The author may mark the content as '
            'AI-assisted on submission and on every edit — that mark is stored on its own and is '
            'never lost under votes. The community moves the score with its votes. What has to '
            'exist:\n\n'
            '1. the author’s mark: a choice in `/submit`, `/submit-material` and the editors, with a '
            'one-sentence explanation of what AI-assisted means; stored as its own record (who, when, '
            'at which version);\n'
            '2. votes: one vote per person per content (“AI-assisted” / “not”), changeable, dated; '
            'minors may vote (a vote carries no free text);\n'
            '3. the score: **recounted** from the author’s mark and the votes on every change, never '
            'incremented (house rule 5); the formula in one rule module every endpoint asks — API, '
            'lists, the content page;\n'
            '4. reading: **one chip, two marks** (owner’s decision, 2026-10-07): a three-people icon on '
            'top — “the community thinks this is AI-assisted” — and a single-person icon below it — '
            '“the author marked it”; each mark lights on its own, so the chip says who is claiming it; '
            'on the content page and on cards; a list filter '
            '(“hide above X” / “only above X”) with a hidden-count header, the '
            '`X-EdMat-Hidden-Languages` shape;\n'
            '5. moderation: a moderator may lock the score at a value with a reason (house rule 6) '
            'and unlock it; a report “looks AI-made, not marked” through `moderation.Report`;\n'
            '6. a kill switch `ai_assisted` (three files + migration).\n\n'
            'To decide: number or yes/no (proposal: store the facts — the author’s mark and the votes — '
            'and derive both a 0–1 score for the filter and one word for the badge: none / author / '
            'community; the author’s mark is final, votes can only add the badge, never remove it), '
            'the vote weight and threshold, whether a vote is yes/no or a scale.'
        ),
    },
]

#: Public needs on the EdMat organisation — what the project asks strangers for. Open needs on a
#: node anybody can view are public (`needs.rules.public_needs`), so this is the surface a reader
#: who is not on the roster actually sees.
NEEDS = [
    {
        'title': 'Wskaźnik „z pomocą AI”: wzór, głosy, filtr / The “AI-assisted” score: formula, votes, filter',
        'kind': 'expertise',
        'skill_level': 'intermediate',
        'is_remote': True,
        'wanted_count': 2,
        'description': _pl_en(
            'Szukamy osób, które pomogą zaprojektować i sprawdzić wskaźnik „z pomocą AI”: liczbę od 0 do '
            '1 przy każdej treści, którą autor ustawia oznaczeniem, a społeczność zmienia głosami. Jak '
            'ważyć oznaczenie autora, jak nie dać się zagłosować w dół, gdzie postawić próg filtra, jak '
            'to wyjaśnić autorom. Przyda się doświadczenie z moderacją treści, dydaktyką albo oceną '
            'tekstów generowanych. Stan prac jest w zadaniu organizacji EdMat o tej samej nazwie.',
            'We are looking for people to help design and check the AI-assisted score: a number from 0 '
            'to 1 on every piece of content, set by the author’s mark and moved by the community’s '
            'votes. How to weigh the author’s mark, how to resist being voted down, where the filter '
            'threshold goes, how to explain it to authors. Experience with content moderation, teaching, '
            'or judging generated text helps. The state of the work is in the EdMat organisation’s '
            'task of the same name.',
        ),
    },
    {
        'title': 'Założyciele Stowarzyszenia EdMat.net association / Founders for the EdMat.net association',
        'kind': 'help',
        'skill_level': 'none',
        'is_remote': False,
        'wanted_count': 6,
        'description': _pl_en(
            'EdMat zakłada stowarzyszenie rejestrowe, które będzie osobą prawną projektu: zawiera umowy, '
            'przyjmuje darowizny i granty, odpowiada za treści i dane. Ustawa wymaga siedmiu założycieli; '
            'arytmetyka wyborów na zebraniu mówi, że bezpiecznie jest dziesięciu. Cztery osoby są '
            'potwierdzone — szukamy sześciu. Założycielem może być osoba z pełną zdolnością do czynności '
            'prawnych, niepozbawiona praw publicznych; cudzoziemiec mieszkający w Polsce na tych samych '
            'zasadach. Co to oznacza: przyjść na zebranie założycielskie w Warszawie (około 90 minut), '
            'wpisać się odręcznie na listę z dowodem w ręku, zostać członkiem zwyczajnym. Składek nie ma '
            'do pierwszego Walnego Zebrania. Kandydaci do Zarządu i Komisji Rewizyjnej mile widziani, '
            'ale nie wymagani. Data zebrania pojawi się w wydarzeniach organizacji.',
            'EdMat is founding a registered association to be the project’s legal person: it signs '
            'agreements, receives donations and grants, answers for content and data. The Act requires '
            'seven founders; the meeting’s voting arithmetic says ten is safe. Four people are '
            'confirmed — we are looking for six. A founder is a person with full legal capacity and '
            'public rights; a foreigner living in Poland on the same terms. What it means: come to the '
            'founding meeting in Warsaw (about 90 minutes), sign the list by hand with an ID in hand, '
            'become an ordinary member. There are no dues until the first general meeting. Candidates '
            'for the Board and the Audit Committee are welcome, not required. The meeting date will '
            'appear among the organisation’s events.',
        ),
    },
    {
        'title': 'Promocja EdMat wśród studentów i nauczycieli / Telling students and teachers about EdMat',
        'kind': 'help',
        'skill_level': 'beginner',
        'is_remote': True,
        'wanted_count': 2,
        'description': _pl_en(
            'Serwis ma ~740 zadań, kursy, korepetycje, wydarzenia, fiszki i podręcznik — i prawie nikt '
            'o nim nie wie. Szukamy osób, które napiszą o EdMacie w grupach studenckich i kanałach '
            'wydziałowych, zrobią plakat na uczelnię, krótkie wideo z przejściem przez stronę, '
            'wiadomość do nauczycieli o trybie szkolnym. Bez budżetu i bez płatnych reklam. Miarą jest '
            'kanał aktywności: ludzie, którzy trafili, zgłosili zadanie albo dołączyli do kursu.',
            'The site has ~740 exercises, courses, tutoring, events, flashcards and a manual — and '
            'almost nobody knows. We are looking for people to write about EdMat in student groups and '
            'faculty channels, make a poster for the university, a short walkthrough video, a message '
            'to teachers about school mode. No budget and no paid ads. The measure is the activity '
            'feed: people who arrived, submitted an exercise or joined a course.',
        ),
    },
    {
        'title': 'Testowanie: przejść podręcznik i zgłosić, co nie działa / Testing: walk the manual and report what breaks',
        'kind': 'help',
        'skill_level': 'none',
        'is_remote': True,
        'wanted_count': 3,
        'description': _pl_en(
            'Jedenaście rozdziałów podręcznika (/about/guide) na własnym telefonie i laptopie, każdy '
            'błąd przez „Zgłoś błąd” tam, gdzie się stało. Szczególnie szukamy kogoś, kto przejdzie '
            'serwis czytnikiem ekranu albo samą klawiaturą — audyt automatyczny obejmuje około jednej '
            'trzeciej WCAG i nikt jeszcze nie zrobił tego ręcznie — oraz kogoś ze starszym telefonem. '
            'Przełączanie polski/angielski też jest w zakresie.',
            'The eleven chapters of the manual (/about/guide) on your own phone and laptop, every bug '
            'through "Report issue" where it happened. We are especially looking for somebody to walk '
            'the site with a screen reader or the keyboard alone — the automated audit covers about a '
            'third of WCAG and nobody has done it by hand — and somebody with an older phone. Switching '
            'Polish/English is in scope too.',
        ),
    },
]

#: Polls on the EdMat organisation. A stranger sees no poll at all (`decisions.rules.visible_polls`);
#: these are put to the roster and its members, who are the people who will sign. `status` is the
#: status at creation (open, with `opens_at` now); options are refreshed by their order.
POLLS = [
    {
        'question': 'Czy EdMat ma działać jako stowarzyszenie rejestrowe „EdMat.net association”? / Should EdMat operate as the registered association “EdMat.net association”?',
        'mode': 'single',
        'eligibility': 'members',
        'anonymous': False,
        'description': _pl_en(
            'Projekt statutu: nazwa rejestrowa „EdMat.net association”, siedziba Warszawa, Zarząd 3–5 '
            'osób i Komisja Rewizyjna 3 osoby wybierane tajnie na trzy lata, Rada Programowa jako ciało '
            'doradcze dla przedstawicieli Wydziału, działalność gospodarcza dopuszczona, ale nie '
            'podejmowana, składki dopiero po pierwszym Walnym. Formalną decyzją jest uchwała nr 1 '
            'zebrania założycielskiego; to głosowanie jest zdaniem członków projektu przed nim.',
            'The draft statute: registered name "EdMat.net association", seat Warsaw, a Board of 3–5 '
            'and an Audit Committee of 3 elected by secret ballot for three years, a Programme Council '
            'as an advisory body for Faculty representatives, business activity permitted but not '
            'taken up, dues only after the first general meeting. The formal decision is resolution '
            'no. 1 of the founding meeting; this poll is the project members’ view before it.',
        ),
        'options': [
            'Tak, zakładamy / Yes, we found it',
            'Nie, zostajemy nieformalną grupą / No, we stay an informal group',
            'Wstrzymuję się / I abstain',
        ],
    },
    {
        'question': 'Wskaźnik „z pomocą AI”: liczba 0–1 czy tak/nie? / The “AI-assisted” score: a number 0–1 or yes/no?',
        'mode': 'single',
        'eligibility': 'members',
        'anonymous': False,
        'description': _pl_en(
            'Właściciel zdecydował, że autor oznacza, a społeczność głosuje, i że plakietka ma dwa '
            'znaki — ale nie zdecydował, czy wskaźnik jest liczbą (głosy przesuwają ją w górę i w dół) '
            'czy wartością tak/nie. Trzecia opcja: zapisać same fakty — oznaczenie autora i głosy — i '
            'wyliczać z nich oba odczyty. Szczegóły w zadaniu organizacji o tej nazwie.',
            'The owner decided that the author marks and the community votes, and that the chip has '
            'two marks — but not whether the score is a number (votes move it up and down) or a yes/no. '
            'A third option: store only the facts — the author’s mark and the votes — and derive both '
            'readings from them. Details in the organisation’s task of that name.',
        ),
        'options': [
            'Liczba 0–1, głosy ją przesuwają / A number 0–1, moved by votes',
            'Tak/nie / Yes or no',
            'Same fakty, oba odczyty wyliczane / The facts alone, both readings derived',
        ],
    },
]

#: The founding meeting, written as a draft event hosted by the owner and linked to the
#: organisation — only once `FOUNDING_MEETING_AT` is set; until then the seed says it is waiting.
FOUNDING_MEETING = {
    'title': 'Zebranie Założycielskie Stowarzyszenia EdMat.net association',
    'summary': 'Szesnaście punktów, około 90 minut, dowód tożsamości w ręku. / Sixteen points, about 90 minutes, bring an ID.',
    'description': _pl_en(
        'Porządek obrad: otwarcie; wybór Przewodniczącego i Protokolanta; stwierdzenie liczby '
        'obecnych założycieli (co najmniej siedmiu); przyjęcie porządku; przedstawienie inicjatywy i '
        'projektu statutu; dyskusja i poprawki; uchwała nr 1 o utworzeniu stowarzyszenia; uchwała nr 2 '
        'o przyjęciu statutu; wybór komisji skrutacyjnej; uchwała nr 3 — wybór Zarządu (tajnie); '
        'uchwała nr 4 — wybór Komisji Rewizyjnej (tajnie); uchwała nr 5 — upoważnienie do '
        'rejestracji; uchwała nr 6 — zaproszenie przedstawicieli Wydziału do Rady Programowej; adres '
        'siedziby; wolne wnioski; zamknięcie. Lista założycieli wymaga daty i miejsca urodzenia oraz '
        'adresu zamieszkania — wpisywanych odręcznie na miejscu, nie zbieranych wcześniej.',
        'Agenda: opening; election of the Chair and the Secretary; count of founders present (at '
        'least seven); adoption of the agenda; presentation of the initiative and the draft statute; '
        'discussion and amendments; resolution no. 1 on forming the association; no. 2 adopting the '
        'statute; election of the scrutiny committee; no. 3 — the Board (secret ballot); no. 4 — the '
        'Audit Committee (secret ballot); no. 5 — the registration mandate; no. 6 — inviting Faculty '
        'representatives to the Programme Council; the seat; any other business; closing. The '
        'founders list needs each person’s date and place of birth and home address — written by '
        'hand on the spot, never collected beforehand.',
    ),
    'location_kind': 'onsite',
    'location_text': 'Warszawa — miejsce do ustalenia / venue to be set',
    'duration_minutes': 90,
    'language': 'pl',
    'visibility': 'public',
    'registration_mode': 'rsvp',
}

#: The two research accounts (owner's ask, 2026-10-07): the Gemini Deep Research report is posted
#: under `google-gemini`, Claude's reading of it under `anthropic-claude`. Neither has a usable
#: password — nobody signs in as them; the seed is the only thing that writes under their names,
#: and each profile's bio says so. The e-mail is on the reserved `.invalid` domain.
ACCOUNTS = {
    'google-gemini': {
        'display_name': 'Gemini Deep Research (Google)',
        'bio': _pl_en(
            'Narzędzie badawcze Google. Treści pod tym kontem to raporty wklejone przez zespół '
            'EdMat tak, jak przyszły, z datą i briefem, na który odpowiadają. To analiza narzędzia, '
            'nie opinia prawnika.',
            'A Google research tool. Content under this account is reports pasted by the EdMat '
            'team as they arrived, dated and tied to the brief they answer. A tool’s analysis, '
            'not a lawyer’s opinion.',
        ),
    },
    'anthropic-claude': {
        'display_name': 'Claude (Anthropic)',
        'bio': _pl_en(
            'Agent Anthropic, który buduje EdMat razem z zespołem. Pod tym kontem komentuje to, co '
            'przeczytał i sprawdził — mówiąc, co przyjęto, co odrzucono i dlaczego.',
            'The Anthropic agent that builds EdMat with the team. Under this account it comments on '
            'what it read and checked — saying what was accepted, what was rejected and why.',
        ),
    },
}

#: How a history step says where its date came from.
DATE_SOURCE_NOTE = {
    'heading': 'data z nagłówka / date from the heading',
    'git': 'data pierwszego commitu z tym nagłówkiem / date of the first commit carrying this heading',
    'repo-start': 'nie później niż pierwszy commit repozytorium / no later than the repository’s first commit',
}

_MONTHS_PL = [
    '', 'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień',
    'wrzesień', 'październik', 'listopad', 'grudzień',
]


# ---- dates ---------------------------------------------------------------------------------------


def _end_of_day(day: date) -> datetime:
    return timezone.make_aware(datetime.combine(day, time(23, 59)))


def _midday(day: date) -> datetime:
    return timezone.make_aware(datetime.combine(day, time(12, 0)))


def due_at_for(spec) -> datetime | None:
    """A step's or task's deadline from its `due` spec and the two constants; None while unknown."""
    if not spec:
        return None
    kind, value = spec
    if kind == 'fixed':
        return _end_of_day(value)
    if kind == 'meeting':
        if FOUNDING_MEETING_AT is None:
            return None
        return FOUNDING_MEETING_AT + timedelta(days=value)
    if kind == 'entry':
        if KRS_ENTRY_DATE is None:
            return None
        return _end_of_day(KRS_ENTRY_DATE + timedelta(days=value))
    raise ValueError(f'unknown due spec {spec!r}')


def month_title(day: date) -> str:
    return f'{_MONTHS_PL[day.month]} {day.year} / {calendar.month_name[day.month]} {day.year}'


# ---- the builder ---------------------------------------------------------------------------------


def _node_filter(organization):
    from config import nodes

    return {'content_type': nodes.node_content_type(organization), 'object_id': organization.pk}


def _history_step(entry: dict) -> dict:
    ref = entry.get('ref')
    title = f"§{ref} — {entry['title']}" if ref else entry['title']
    note = DATE_SOURCE_NOTE.get(entry.get('date_source') or '', '')
    # In code marks: the renderer linkifies bare `HISTORY.md` as a domain (.md is a country code).
    where = f"`HISTORY.md` §{ref}" if ref else '`HISTORY.md`'
    description = entry['summary'] + f"\n\n{where} · {entry.get('date') or '—'} · {note}".rstrip(' ·')
    return {
        'title': title[:200],
        'description': description,
        'status': 'done',
        'done_on': date.fromisoformat(entry['date']) if entry.get('date') else None,
    }


def _upsert_task(node: dict, owner, entry: dict, counts: Counter, *, due_at=None, parent=None):
    """A task by title on the node: text refreshed, state left alone, the owner seated at creation."""
    from tasks.models import Task, TaskAssignee

    task = _find_by_title(Task, node, entry['title'])
    created = task is None
    if created:
        pl_title, _en = _split_title(entry['title'])
        task = Task.objects.create(
            **node, title=pl_title, created_by=owner,
            status=entry.get('status', 'todo'), parent=parent,
        )
    task.priority = entry.get('priority', 3)
    task.due_at = due_at
    task.save(update_fields=['priority', 'due_at', 'updated_at'])
    # The two languages as two rows, Polish mirrored back onto `title`/`description`. The explicit
    # `sanitize_content` that used to stand here is gone because `TextVersion.save()` does it and
    # `write_versions` mirrors the SANITIZED row onto the column — one sanitizer, one copy.
    _write_bilingual(task, entry['title'], entry['description'])
    if created and entry.get('assign_owner', True):
        TaskAssignee.objects.get_or_create(task=task, user=owner, defaults={'assigned_by': owner})
    counts['tasks_created'] += created
    return task


def _upsert_step(plan, entry: dict, order: int, counts: Counter, *, parent=None, history=False):
    from plans.models import PlanStep

    # A history step's title is the log's own heading and is never glued, so it is neither split
    # nor looked up by half (`_write_bilingual`'s own note has the two headings that proved it).
    step = _find_by_title(PlanStep, {'plan': plan}, entry['title'], split=not history)
    created = step is None
    if created:
        pl_title = entry['title'] if history else _split_title(entry['title'])[0]
        step = PlanStep(plan=plan, title=pl_title, status=entry.get('status', 'pending'))
        done_on = entry.get('done_on')
        if entry.get('status') == 'done' and done_on:
            step.done_at = _midday(done_on)
    step.parent = parent
    step.order = order
    step.due_at = due_at_for(entry.get('due'))
    if history and entry.get('done_on') and step.status == 'done':
        step.done_at = _midday(entry['done_on'])  # a fact of the log, so refreshed
    step.save()
    _write_bilingual(step, entry['title'], entry.get('description', ''), bilingual=not history)
    counts['steps_created'] += created
    return step


def _upsert_plan(node: dict, owner, entry: dict, counts: Counter, *, history_steps=()):
    """A plan by title on the node, its steps by title on the plan — history steps first (done,
    dated, in date order), then the file's own steps and their substeps; optionally mirrored into
    tasks with the same titles and deadlines."""
    from plans.models import Plan

    plan = _find_by_title(Plan, node, entry['title'])
    created = plan is None
    if created:
        pl_title, _en = _split_title(entry['title'])
        plan = Plan.objects.create(
            **node, title=pl_title, created_by=owner, status=entry.get('status', 'active')
        )
    _write_bilingual(plan, entry['title'], entry['description'], suffix=entry.get('body_suffix', ''))
    counts['plans_created'] += created

    order = 0
    for raw in history_steps:
        order += 1
        _upsert_step(plan, _history_step(raw), order, counts, history=True)
    for step_entry in entry.get('steps', ()):
        order += 1
        parent = _upsert_step(plan, step_entry, order, counts)
        parent_task = None
        if entry.get('as_tasks'):
            parent_task = _upsert_task(
                node, owner, step_entry, counts, due_at=due_at_for(step_entry.get('due'))
            )
        for sub_order, sub_entry in enumerate(step_entry.get('substeps', ()), start=1):
            _upsert_step(plan, sub_entry, sub_order, counts, parent=parent)
            if entry.get('as_tasks'):
                _upsert_task(
                    node, owner, sub_entry, counts,
                    due_at=due_at_for(sub_entry.get('due')), parent=parent_task,
                )
    return plan


def _upsert_need(node: dict, owner, entry: dict, counts: Counter):
    from needs.models import Need

    need = _find_by_title(Need, node, entry['title'])
    created = need is None
    if created:
        pl_title, _en = _split_title(entry['title'])
        need = Need.objects.create(**node, title=pl_title, created_by=owner, kind=entry['kind'])
    need.kind = entry['kind']
    need.skill_level = entry['skill_level']
    need.is_remote = entry['is_remote']
    need.wanted_count = entry['wanted_count']
    need.save()
    _write_bilingual(need, entry['title'], entry['description'])
    counts['needs_created'] += created
    return need


def _upsert_poll(node: dict, owner, entry: dict, counts: Counter, now):
    from decisions.models import Poll, PollOption

    # A poll is found by its QUESTION, which `_find_by_title` cannot help with (it looks at
    # `title`), so the same two-state lookup is written out here.
    pl_question, _en_question = _split_title(entry['question'])
    poll = (
        Poll.objects.filter(**node, question=entry['question']).first()
        or Poll.objects.filter(**node, question=pl_question).first()
    )
    created = poll is None
    if created:
        poll = Poll.objects.create(
            **node, question=pl_question, created_by=owner, status='open', opens_at=now
        )
    poll.mode = entry['mode']
    poll.eligibility = entry['eligibility']
    poll.anonymous = entry['anonymous']
    poll.save(update_fields=['mode', 'eligibility', 'anonymous'])
    _write_bilingual(poll, entry['question'], entry['description'])
    for order, text in enumerate(entry['options'], start=1):
        pl_text, _en_text = _split_title(text)
        option, _made = PollOption.objects.update_or_create(
            poll=poll, order=order, defaults={'text': pl_text}
        )
        # An option is one line of text: a heading and no body (translations/targets.py).
        _write_bilingual(option, text, heading=True, body=False)
    counts['polls_created'] += created
    return poll


def _upsert_founding_meeting(organization, owner, counts: Counter):
    """The draft event, hosted by the owner and linked to the organisation — or None, with the
    reason, while the date is not set."""
    from config import nodes
    from events.models import Event
    from organizations.models import OrganizationLink

    if FOUNDING_MEETING_AT is None:
        return None
    fields = {k: v for k, v in FOUNDING_MEETING.items() if k != 'title'}
    event, created = Event.objects.get_or_create(
        host=owner, title=FOUNDING_MEETING['title'],
        defaults={**fields, 'status': 'draft', 'starts_at': FOUNDING_MEETING_AT},
    )
    for key, value in fields.items():
        setattr(event, key, value)
    event.starts_at = FOUNDING_MEETING_AT
    event.save()
    OrganizationLink.objects.get_or_create(
        organization=organization,
        content_type=nodes.node_content_type(event),
        object_id=event.pk,
        defaults={'kind': 'runs', 'added_by': owner},
    )
    counts['events_created'] += created
    return event


def load_thread(path: Path = RESEARCH_THREAD_PATH) -> dict | None:
    """The exported thread, or None where the file is absent — the seed then posts nothing."""
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding='utf-8'))


def _upsert_accounts(counts: Counter) -> dict:
    from accounts.models import Profile

    User = get_user_model()
    users = {}
    for username, spec in ACCOUNTS.items():
        user, created = User.objects.get_or_create(
            username=username, defaults={'email': f'{username}@edmat.invalid', 'is_active': True}
        )
        if created:
            user.set_unusable_password()
            user.save(update_fields=['password'])
        profile, _ = Profile.objects.get_or_create(user=user)
        profile.display_name = spec['display_name']
        profile.bio = spec['bio']
        profile.save()
        counts['accounts_created'] += created
        users[username] = user
    return users


def _comment_body(item: dict) -> str:
    head = f"**{item['n']}. {item['title']}**" if item['n'] else f"**{item['title']}**"
    return f"{head}\n\n{item['body']}"


def _upsert_thread(thread: dict, accounts: dict, counts: Counter) -> dict:
    """The report as one top-level comment per item under the standing-page location, each
    reply under its item. Idempotent by the item's bold first line and by (parent, replier); the
    text is refreshed when the file changed, and the timestamps are the report's date, a minute
    apart so the order on the page is the report's."""
    from community import discussions
    from community.models import Comment, DiscussionLocation
    from config.sanitize import sanitize_content

    page, section = thread['page'], thread['section']
    if not (discussions.PAGE_RE.match(page) and discussions.SECTION_RE.match(section)):
        raise RuntimeError(f'thread location {page}#{section} is not a legal discussion key')
    row, _ = DiscussionLocation.objects.get_or_create(page=page, section=section)
    content_type = ContentType.objects.get_for_model(DiscussionLocation)
    author = accounts[thread['author']]
    replier = accounts[thread['replier']]
    posted_at = _midday(date.fromisoformat(thread['date']))
    at_location = Comment.objects.filter(content_type=content_type, object_id=row.pk)
    created = replies = 0
    for index, item in enumerate(thread['items']):
        body = _comment_body(item)
        head = sanitize_content(body.split('\n', 1)[0])
        comment = at_location.filter(author=author, parent=None, body__startswith=head).first()
        if comment is None:
            comment = Comment.objects.create(
                content_type=content_type, object_id=row.pk, author=author, body=body
            )
            Comment.objects.filter(pk=comment.pk).update(
                created_at=posted_at + timedelta(minutes=index)
            )
            created += 1
        elif comment.body != sanitize_content(body):
            comment.body = body
            comment.save()
        reply_text = item.get('reply')
        if not reply_text:
            continue
        reply = Comment.objects.filter(parent=comment, author=replier).first()
        if reply is None:
            reply = Comment.objects.create(
                content_type=content_type, object_id=row.pk, author=replier,
                parent=comment, body=reply_text,
            )
            Comment.objects.filter(pk=reply.pk).update(
                created_at=posted_at + timedelta(minutes=index, seconds=30)
            )
            created += 1
        elif reply.body != sanitize_content(reply_text):
            reply.body = reply_text
            reply.save()
        replies += 1
    return {'page': page, 'section': section, 'comments': len(thread['items']), 'replies': replies, 'created': created}


def build_edmat_project(owner_username: str, *, history: list[dict] | None = None, thread: dict | None = None) -> dict:
    """Write (or refresh) the organisation, its owner, the goals, the association's plans, the
    tasks, the needs, the polls and the founding meeting. One transaction, so a missing user or a
    bad entry leaves nothing half-made. Returns what it touched, with counts a command can print
    and a test can assert."""
    from needs.models import Need
    from decisions.models import Poll
    from organizations.models import Organization, OrganizationMember
    from plans.models import Plan, PlanStep
    from tasks.models import Task

    User = get_user_model()
    try:
        owner = User.objects.get(username=owner_username)
    except User.DoesNotExist as exc:
        raise RuntimeError(f'No account named {owner_username!r}; pass --owner <username>.') from exc

    if history is None:
        history = load_table()
    if thread is None:
        thread = load_thread()
    by_goal: dict[str, list[dict]] = {}
    for entry in sorted(history, key=lambda e: (e.get('date') or '9999', e.get('line', 0))):
        by_goal.setdefault(entry['subproject'], []).append(entry)

    counts: Counter = Counter()
    now = timezone.now()
    with transaction.atomic():
        # `description` is deliberately NOT in these defaults, and that is the one line standing
        # between a deployment and the owner's own words. Everything else here (name, kind, city,
        # website, open_board) is seed-owned and refreshed on every run; the description is the one
        # field the bilingual editor exposes on `/about`, so refreshing it from this file would undo
        # an edit made on production — which `_write_bilingual`'s `keep_edited` otherwise prevents,
        # and which THIS call would have gone on doing behind its back (found by editing the
        # description on the dev VM and re-running the seed: the two `TextVersion` rows survived and
        # the column did not).
        org_defaults = {k: v for k, v in ORGANIZATION.items() if k != 'description'}
        organization, org_created = Organization.objects.update_or_create(
            slug=ORGANIZATION_SLUG,
            defaults={**org_defaults, 'is_active': True},
        )
        if org_created:
            organization.created_by = owner
            organization.save(update_fields=['created_by'])
        # Its description in both languages — the first paragraph on `/about`, glued by hand until
        # 2026-10-08. No heading: an organisation's NAME is a registered name and the same in every
        # language (translations/targets.py). This is the ONLY writer of the description now, and it
        # leaves alone any language a person has saved.
        _write_bilingual(organization, '', ORGANIZATION['description'], heading=False)
        OrganizationMember.objects.update_or_create(
            organization=organization, user=owner, defaults={'role': 'owner'}
        )
        node = _node_filter(organization)

        # Created last-to-first, because the plans panel lists newest first: a reader then meets
        # phase 1 of the association at the top and the goals in the order `SUBPROJECTS` gives.
        for goal in reversed(SUBPROJECTS):
            _upsert_plan(
                node, owner,
                # The apps line goes through `body_suffix` so `_write_bilingual` can append it to
                # BOTH languages; concatenating it here (as this did until 2026-10-08) filed it
                # under the English half alone, because it landed after `_pl_en`'s own rule.
                {**goal, 'body_suffix': f"\n\n*Aplikacje / apps: {goal['apps']}*", 'status': 'active'},
                counts, history_steps=by_goal.get(goal['key'], ()),
            )
        for plan_entry in reversed(ASSOCIATION_PLANS):
            _upsert_plan(node, owner, plan_entry, counts)
        for entry in TASKS:
            _upsert_task(node, owner, entry, counts)
        for entry in NEEDS:
            _upsert_need(node, owner, entry, counts)
        for entry in POLLS:
            _upsert_poll(node, owner, entry, counts, now)
        event = _upsert_founding_meeting(organization, owner, counts)
        accounts = _upsert_accounts(counts)
        posted = _upsert_thread(thread, accounts, counts) if thread else None

    unfiled = sorted(set(by_goal) - {goal['key'] for goal in SUBPROJECTS})
    return {
        'accounts': list(accounts),
        'accounts_created': counts['accounts_created'],
        'thread': posted,
        'organization': organization,
        'organization_created': org_created,
        'owner': owner,
        'plans': Plan.objects.filter(**node).order_by('pk'),
        'plans_created': counts['plans_created'],
        'steps': PlanStep.objects.filter(plan__in=Plan.objects.filter(**node)),
        'steps_created': counts['steps_created'],
        'tasks': Task.objects.filter(**node).order_by('pk'),
        'tasks_created': counts['tasks_created'],
        'needs': Need.objects.filter(**node).order_by('pk'),
        'needs_created': counts['needs_created'],
        'polls': Poll.objects.filter(**node).order_by('pk'),
        'polls_created': counts['polls_created'],
        'event': event,
        'event_created': bool(counts['events_created']),
        'history_count': len(history),
        'history_unfiled': unfiled,
        'waiting': [] if FOUNDING_MEETING_AT else ['founding meeting: no date yet (FOUNDING_MEETING_AT)']
        + ([] if KRS_ENTRY_DATE else ['deadlines counted from the KRS entry: no date yet (KRS_ENTRY_DATE)']),
    }


#: Every string this file would write, for the secrets test and for a reader. Titles, descriptions,
#: questions, options — nothing else carries text.
def all_seeded_text() -> list[str]:
    out: list[str] = [ORGANIZATION['name'], ORGANIZATION['description']]

    def steps(items):
        for item in items:
            out.extend([item['title'], item.get('description', '')])
            steps(item.get('substeps', ()))

    for goal in SUBPROJECTS:
        out.extend([goal['title'], goal['description'], goal['apps']])
        steps(goal['steps'])
    for plan in ASSOCIATION_PLANS:
        out.extend([plan['title'], plan['description']])
        steps(plan['steps'])
    for task in TASKS:
        out.extend([task['title'], task['description']])
    for need in NEEDS:
        out.extend([need['title'], need['description']])
    for poll in POLLS:
        out.extend([poll['question'], poll['description'], *poll['options']])
    out.extend(str(v) for v in FOUNDING_MEETING.values())
    return out


#: Secret-shaped text that must never appear in anything this file writes to a public page: an
#: e-mail address, a phone number, a credential word, a street address with a number, a sum of
#: money with a figure. (A personal name cannot be a pattern; the texts above refer to people by
#: role or by count, and the history table was read for the founders' and officials' surnames by
#: hand before it was committed.) "Secret" alone is not a shape — a founding meeting has secret
#: ballots — and neither is "token", which a ticket feature and an e-voting paragraph both use.
SECRET_SHAPES = [
    re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+'),
    re.compile(r'(?<!\d)\d{3}[ -]?\d{3}[ -]?\d{3}(?!\d)'),
    re.compile(r'(?i)\b(password|hasło|haslo|api[_ -]?key|secret[_ -]?key|client[_ -]?secret|bearer)\b'),
    re.compile(r'(?i)\bul\.\s*\w+\s*\d'),
    re.compile(r'\d[\d\s]*\s?(zł|PLN|€|EUR|\$)'),
]

#: The narrower set for the two data files, which quote a legal report and the build log: an
#: address, a phone number, an eleven-digit national id, a credential word with a value after it.
DATA_FILE_SHAPES = [
    SECRET_SHAPES[0],
    SECRET_SHAPES[1],
    re.compile(r'(?<!\d)\d{11}(?!\d)'),
    re.compile(r'(?i)\b(password|hasło|haslo|pesel|api[_ -]?key|secret[_ -]?key)\s*[:=]\s*\S'),
]
