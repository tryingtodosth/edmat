"""EdMat managed on EdMat: the project's own organisation, and the work hung off it.

The owner's decision of 2026-10-07: the project page stops being a brochure and becomes the project
itself — an `organizations.Organization` called EdMat, with its plans, tasks, decisions, events and
needs on the platform, where anybody can read what is being built and what help is wanted. Later
the same day: *run it as an open volunteer cooperative, meeting what the Faculty asks of it;
import what has already been built, with its dates, from the project's own history; one goal per module, each a subproject with its own summary and child content; the
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
that belongs to it (`work/edmat_history.py`), then the open steps this file names.

**The association is retired (owner, 2026-11-02).** Until then it was three more plans (the phases
of `FUW/association/07`), phase 1 mirrored into tasks with deadlines, a "Founders" need, a poll on
founding it, a founding-meeting event waiting for its date, and the Gemini legal report under
`/about`. The owner: *"delete stowarzyszenie related ones"*. `RETIRED` names every one of those
rows and the seed deletes them, because an entry merely dropped from this file stays on production
(see "Idempotent by title" below).

**What the rule modules say, and what that means here.** A plan with status `active` is readable by
anyone who can see the organisation (`plans.rules.visible_plans`); `draft` is for its editors only,
which no plan here uses today. A task on the node is the roster's (`tasks.rules.visible_tasks`), a
poll is for the roster and its eligible members to vote on (the organisation's board is open, so
everybody READS both — the owner's call of 2026-10-08), and an open need is everybody's
(`needs.rules.public_needs`). Whatever the team acts on is a task; whatever the members decide is a
poll; what the public is asked for is a need.

**Idempotent by title.** The organisation is found by `ORGANIZATION_SLUG`; each plan, task and need
by its title on that node, each step by its title on its plan, each poll by its question. A second
run refreshes the *text* (descriptions, kinds, priorities, due dates, step order — the things this
file is the source of) and leaves the *state*
alone (status, assignees, applications, ballots, who marked a step done — the things people change
on the site). The one exception is a history step's `done_at`: that is a fact of the log, so it is
refreshed. Renaming or removing an entry here therefore leaves the old row standing; retire it on
the site, as a person would, or name it in `RETIRED` so every database loses it on the next run. An entry's `status` is its status *at creation*
only.

**Bilingual in one field.** A plan, a task and a need have no translation table
(`ExerciseTranslation` is for the corpus), so each description carries Polish first and English
after it, separated by a rule, in the project's own storage format (Markdown; `config/sanitize.py`
runs on save). History steps quote the English build log as written.

**No personal data.** Nothing here names a person, a Faculty official, an office or a sum of
money. `work.tests` scans every string below for secret-shaped text, and the people are referred to
by role or by count.
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

#: Threads under the project's OWN rows rather than under a standing page (2026-10-10): a list, each
#: entry located by `plan` (a `SUBPROJECTS` title — the thread lands under that plan, whatever id it
#: gets on the database at hand) or by `organization: true` (the EdMat organisation's own thread at
#: the top of `/coop`), with `author`, `date`, `items` and, optionally, a `replier` who answers an item
#: under it. The first is the state of contests as of 2026-10-10, signed by `anthropic-claude`.
PROJECT_THREADS_PATH = Path(__file__).with_name('edmat_project_threads.json')

ORGANIZATION_SLUG = 'edmat'


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
                     suffix: str = '', bilingual: bool = True, keep_edited: bool = True):
    """Store this row's two languages as two `translations.TextVersion` rows, Polish the original.

    This is what undoes the gluing: the file keeps writing `_pl_en(...)` and `'PL / EN'`, because
    that is a perfectly good way to keep a bilingual source readable in one place — and the seed
    splits it on the way in, so a reader of `/coop` gets their own language instead of both at
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
    # `keep_edited=False` is the one deliberate exception, asked for by name and never by default:
    # `seed_edmat_project --retake-description` is how the owner puts a NEW description from this
    # file onto a production row they have already edited by hand. Without it the protection above
    # is also a trap — the seed can never again change a field once anybody has touched it.
    write_versions(obj, original_locale='pl', versions=versions, user=None, keep_edited=keep_edited)


ORGANIZATION = {
    'name': 'EdMat',
    'kind': 'other',
    'website': 'https://edmat.net',
    'city': 'Warszawa',
    # The board is open: anyone may read the tasks and the polls (owner, 2026-10-08).
    'open_board': True,
    # The owner's own words, 2026-10-08 evening, replacing the two paragraphs the seed wrote the
    # day before: *"prepare the desc of edmat org on about to be Edukacja potrzebuje usprawnień…"*.
    # Short on purpose — it is the first thing a visitor reads on `/coop`, and the "how it works"
    # paragraph that used to follow it is now what the goals, the board and the needs below say for
    # themselves. A full stop was added to the end of the sentence; nothing else was changed.
    'description': _pl_en(
        'Edukacja potrzebuje usprawnień. EdMat.net to otwarte miejsce współpracy nad materiałami '
        'edukacyjnymi i oprogramowaniem: buduje je społeczność, każda zmiana jest widoczna, '
        'a każde rozwiązanie ma osobę, która za nie odpowiada.',
        'Education needs fixing. EdMat.net is an open place to work together on teaching materials '
        'and software: the community builds it, every change is visible, and every solution has '
        'somebody who answers for it.',
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
        # Contests (2026-10-09/10, CONTESTS-BRIEF.md): the sixth node kind. Its done steps are the
        # three §17CE rows of the log; its open steps are the module's own "left open" list, kept
        # here so `/coop` says what is lacking and not only what landed. The state as of
        # 2026-10-10, with the reasoning, is the thread under this plan (`PROJECT_THREADS_PATH`).
        'key': 'contests',
        'title': 'Konkursy / Contests',
        'apps': 'contests',
        'description': _pl_en(
            'Konkursy (szkolne, uczelniane, koła naukowego, organizacji, otwarte online, zespołowe, '
            'kuratoryjne, olimpiady i „challenge” bez nagrody) jako szósty rodzaj węzła: etapy, '
            'rejestracja ze zgodą opiekuna, jury z macierzą ocen, wyniki, reklamacje w ustawowym '
            'oknie, wersjonowany regulamin i raport zgodności z oznaczeniem, które przepisy '
            'sprawdzono, a które nie. Dziesięć presetów wyprowadzonych z badania prawa '
            '(`CONTESTS-LAW.md`) i personalizacja, która z presetu tworzy plan, cel, zadania, '
            'potrzebę i głosowanie w pozostałych modułach. Zbudowane 9.10.2026 w jeden dzień: '
            'badanie, przygotowanie, dwie równoległe gałęzie, integracja. Kroki zrobione to wpisy '
            'dziennika; kroki otwarte to, czego świadomie nie zrobiono.',
            'Contests (school, university, student-circle, organisation, open online, team, '
            'kuratorium, olympiad and a no-prize "challenge") as the sixth node kind: stages, '
            'registration with guardian consent, a jury with a scoring matrix, results, complaints '
            'inside the statutory window, a versioned regulamin and a compliance report that marks '
            'which provisions were verified and which were not. Ten presets derived from the legal '
            'research (`CONTESTS-LAW.md`), and a personalisation that turns a preset into a plan, a '
            'goal, tasks, a need and a poll in the other modules. Built on 2026-10-09 in one day: '
            'research, prep, two parallel branches, integration. The done steps are the log '
            'entries; the open steps are what was deliberately left undone.',
        ),
        'steps': [
            {
                'title': 'Cztery powiadomienia / Four notifications',
                'description': _pl_en(
                    'Decyzja o rejestracji, otwarcie etapu, publikacja wyników, odpowiedź na '
                    'reklamację — uczestnik dziś dowiaduje się o nich, patrząc. Każde to wywołanie '
                    '`notifications/services.notify()` plus pole preferencji i etykieta w '
                    '`labels.ts`; logika odbiorców jest już w `events`.',
                    'Registration decided, stage opened, results published, complaint answered — a '
                    'participant currently learns each by looking. Each is one `notify()` call plus '
                    'a preference field and a label in `labels.ts`; the recipient logic already '
                    'exists in `events`.',
                ),
            },
            {
                'title': 'Umowa powierzenia (DPA) organizator–EdMat / A DPA template between an organiser and EdMat',
                'description': _pl_en(
                    'EdMat jest procesorem danych uczestników na rzecz organizatora (RODO art. 28 '
                    'ust. 3); `LEGAL.md` §9–10 to nazywa, nic tego nie generuje. Wariant '
                    'współadministrowania (art. 26) trzeba napisać obok, nie potem.',
                    'EdMat processes participants\' data on the organiser\'s behalf (GDPR art. '
                    '28(3)); `LEGAL.md` §9–10 names it, nothing generates it. The joint-controller '
                    'fallback (art. 26) has to be drafted beside it, not after.',
                ),
            },
            {
                'title': 'Zespoły poza nazwą / Teams beyond a name',
                'description': _pl_en(
                    'Skład z kapitanem i podział nagrody wspólnej z KC art. 920 §3 jako wiersze, '
                    'nie akapit w §7 regulaminu. `Contest.team_size_max` istnieje i nic go nie '
                    'egzekwuje.',
                    'A roster with a captain, and KC art. 920 §3\'s "who gets which share" as rows '
                    'rather than a paragraph in §7 of the regulamin. `Contest.team_size_max` exists '
                    'and nothing enforces it.',
                ),
            },
            {
                'title': 'Konkursy oceniane przez społeczność / Community-judged contests',
                'description': _pl_en(
                    'Preset (k) z `CONTESTS-LAW.md` nie został zbudowany, dopóki prawnik nie '
                    'odpowie na §14 pkt 1: głosowanie społeczności decydujące o nagrodzie czyta '
                    'się jak loterię (u.g.h. art. 2).',
                    'Preset (k) of `CONTESTS-LAW.md` stays unbuilt until a lawyer answers §14 item '
                    '1: community voting that decides a prize reads as a lottery (u.g.h. art. 2).',
                ),
            },
            {
                'title': 'Załącznik do odpowiedzi uczestnika / An attachment on a participant\'s answer',
                'description': _pl_en(
                    '`ContestAnswer.attachment` to prawdziwy klucz obcy, ale uczestnik nie ma '
                    'przycisku: `attachments/access.py: can_attach` pozwala załączać do węzła tylko '
                    'jego obsłudze. Naprawa to rodzaj celu `contest_answer` w '
                    '`attachments/targets.py` z autorem odpowiedzi jako właścicielem — kształt, '
                    'który `needs` już ma.',
                    '`ContestAnswer.attachment` is a real FK, but a participant has no control: '
                    '`attachments/access.py: can_attach` lets only a node\'s staff attach to the '
                    'node. The fix is a `contest_answer` target kind in `attachments/targets.py` '
                    'with the answer\'s author as owner — the shape `needs` already uses.',
                ),
            },
            {
                'title': 'Kolumna języka konkursu / A language column on a contest',
                'description': _pl_en(
                    'Bez `Contest.language` kanał aktywności nie może filtrować po '
                    '`?content_locales=`. Jedna migracja w `contests`.',
                    'Without `Contest.language` the activity feed cannot filter by '
                    '`?content_locales=`. One `contests` migration.',
                ),
            },
            {
                'title': 'Regulamin poza tłumaczeniami / The regulamin outside translations',
                'description': _pl_en(
                    '`ContestRulesSection` to wersjonowany tekst prawny, którego tłumaczenie ktoś '
                    'podpisuje — nie pole w edytorze obok siebie. Dziś regulamin jest w jednym '
                    'języku.',
                    '`ContestRulesSection` is versioned legal text whose translation somebody signs '
                    'off — not a field in a side-by-side editor. Today the regulamin is in one '
                    'language.',
                ),
            },
            {
                'title': 'Zrzuty ekranu w rozdziale podręcznika / Screenshots in the manual chapter',
                'description': _pl_en(
                    'Strona główna podręcznika obiecuje zrzut w każdym rozdziale; '
                    '`/about/guide/contests` nie ma żadnego, dopóki ktoś nie uruchomi '
                    '`e2e/guide-screenshots.mjs`.',
                    'The manual\'s hub promises a screenshot in every chapter; '
                    '`/about/guide/contests` has none until somebody re-runs '
                    '`e2e/guide-screenshots.mjs`.',
                ),
            },
            {
                'title': 'Fast-forward gałęzi głównej / Fast-forward of the trunk',
                'description': _pl_en(
                    'Integracja żyje na `contests/prep`. `ux/colour-pass` nie został przesunięty, '
                    'bo inna sesja miała niezatwierdzone pliki w głównym katalogu. Jedno polecenie '
                    'po ich zatwierdzeniu: `git merge --ff-only contests/prep`.',
                    'The integration lives on `contests/prep`. `ux/colour-pass` was not moved '
                    'because another session had uncommitted files in the main checkout. One '
                    'command once they are committed: `git merge --ff-only contests/prep`.',
                ),
            },
        ],
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

# ---- retired: the association (owner, 2026-11-02) ------------------------------------------------

#: What this seed once wrote and now takes away. The owner, 2026-11-02: *"delete stowarzyszenie
#: related ones"* — the registered association (`FUW/association/`) is no longer the plan; the
#: operator is the student group `LEGAL.md` §1 names. The seed is idempotent by title, so removing
#: an entry from this file alone would leave its row standing on production for ever (the module's
#: own note: "retire the old one on the site, as a person would"). This list is that retirement,
#: written down so a deployment does it: every row is looked up exactly as the seed wrote it —
#: by its glued title, or by the Polish half the seed has stored since 2026-10-08 — and DELETED
#: with the thread under it, by the owner's explicit word rather than archived (house rule 12 is a
#: default; this is the owner deciding). Rows somebody made by hand are never matched: only a row
#: on the EdMat node with one of these exact titles is.
#:
#: `steps` are steps of the GOALS that pointed at the association (the plan named first, then the
#: step). `threads` are standing-page discussion locations — the Gemini legal report on registering
#: the association, which was `/about#money-and-openness`.
RETIRED = {
    'plans': [
        'Stowarzyszenie — faza 1: zgodność z prawem o stowarzyszeniach / The association — phase 1: compliance',
        'Stowarzyszenie — faza 2: działalność odpłatna i gospodarcza / The association — phase 2: paid and business activity',
        'Stowarzyszenie — faza 3: pożytek publiczny i fundacja / The association — phase 3: public benefit and the foundation',
    ],
    # Phase 1 was mirrored into these tasks (`as_tasks`), its sub-steps as sub-tasks.
    'tasks': [
        'Skompletować co najmniej 7 założycieli, realnie 10 / Gather at least 7 founders, realistically 10',
        'Adres do doręczeń i zgoda uczelni na lokal / The service address and the University’s consent for the premises',
        'Forma wynagrodzenia Zarządu — dopiero gdy będą pieniądze / How the board could be paid — only once there is money',
        'Zebranie założycielskie: uchwały 1–6, wybory tajne, lista, zgody / The founding meeting: resolutions 1–6, secret ballots, the list, consents',
        'Wniosek do KRS — rejestr stowarzyszeń, bez działalności gospodarczej / The KRS application — the register of associations, no business activity',
        'Odpowiedź na ewentualne wezwanie sądu / Answering a court summons, if one comes',
        'Wpis do KRS; NIP i REGON nadane automatycznie / Entry in the KRS; NIP and REGON assigned automatically',
        'Zgłoszenie do CRBR — 14 dni od wpisu / The CRBR filing — 14 days from entry',
        'Rachunek bankowy, księgowość, pełne księgi albo UEPiK / Bank account, bookkeeping, full books or the simplified ledger',
        'NIP-8 — rachunek, adres do korespondencji, miejsce ksiąg / NIP-8 — the account, the correspondence address, where the books are kept',
        'Rada Programowa: zaproszenia na Wydział, po 30 dniach scenariusz B / The Programme Council: the Faculty invitations, then plan B after 30 days',
        'Organizacja na edmat.net i ta tabela w module zadań, z terminami / The organisation on edmat.net and this table in the tasks module, with deadlines',
        'Regulamin składek i deklaracje członkowskie / Dues rules and membership declarations',
        'Infrastruktura i dane: ośrodek komputerowy, Kanclerz, inspektor ochrony danych, transfer technologii / Infrastructure and data: the computing centre, the Chancellor, the data-protection officer, technology transfer',
        'Pierwszy rok obrotowy do 31.12.2026: sprawozdanie, CIT-8, urząd skarbowy / The first financial year to 31 Dec 2026: the statement, CIT-8, the tax office',
        'Pierwsze Walne Zebranie: absolutorium, sprawozdanie Komisji, plan fazy 2 / The first general meeting: discharge, the Committee’s report, the phase 2 plan',
    ],
    'needs': [
        'Założyciele Stowarzyszenia EdMat.net association / Founders for the EdMat.net association',
    ],
    'polls': [
        'Czy EdMat ma działać jako stowarzyszenie rejestrowe „EdMat.net association”? / Should EdMat operate as the registered association “EdMat.net association”?',
    ],
    'steps': [
        (
            '/dziennik — demonstracja zarządzania szkołą / the school-management demo',
            'Plany i serwery dla szkół — faza 2 stowarzyszenia / Plans and servers for schools — the association’s phase 2',
        ),
    ],
    # Created only once a founding date was set, which never happened; listed so a database where
    # somebody set it is cleaned too. Matched by title AND the owner as host, as it was written.
    'events': [
        'Zebranie Założycielskie Stowarzyszenia EdMat.net association',
    ],
    'threads': [
        ('about', 'money-and-openness'),
    ],
}


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

#: Polls on the EdMat organisation. The board is open (`ORGANIZATION['open_board']`, 2026-10-08):
#: anybody reads them on `/coop` and sees the results, and the roster and its members vote.
#: `status` is the status at creation (open, with `opens_at` now); options are refreshed by their
#: order. Each title and option holds exactly one `' / '` (Polish, then English) — `_split_title`.
#:
#: The five after the first are the decisions §17DB–§17DC left to the owner (course licences,
#: per-content audience, invitations by e-mail), published on `/coop` by the owner's word of
#: 2026-11-02: *"next deployment will publish these decisions to make on edmat.net/about"*. Each
#: describes what the site does TODAY, so a vote is a vote on a change, never on a guess.
POLLS = [
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
    {
        'question': 'Jaką licencję podpowiadać przy zakładaniu kursu? / Which licence should the form suggest for a new course?',
        'mode': 'single',
        'eligibility': 'members',
        'anonymous': False,
        'description': _pl_en(
            'Licencja kursu obejmuje to, co piszą jego ludzie: opis, rozdziały i lekcje — także '
            'współprowadzący, którym zaproszenie mówi o niej przed przyjęciem. Dziś formularz podpowiada '
            'CC BY 4.0, zgodnie z zasadą dla własnej pracy; zakładający może wybrać każdą inną, a '
            'później licencję da się tylko poszerzyć. CC BY-SA 4.0 trzyma kursy pochodne otwartymi na '
            'tych samych warunkach; „tylko EdMat” to domyślna licencja pozostałych treści.',
            'A course’s licence covers what its own people write: the description, chapters and '
            'lessons — collaborators too, whose invitation names it before they accept. Today the '
            'form suggests CC BY 4.0, following the rule for one’s own work; the founder can pick any '
            'other, and later the licence can only be widened. CC BY-SA 4.0 keeps derived courses open '
            'on the same terms; “EdMat only” is the default of every other kind of content.',
        ),
        'options': [
            'CC BY 4.0, jak teraz / CC BY 4.0, as now',
            'CC BY-SA 4.0 / CC BY-SA 4.0',
            'Tylko EdMat, jak inne treści / EdMat only, like other content',
            'Bez podpowiedzi: zakładający musi wybrać / No suggestion: the founder has to choose',
        ],
    },
    {
        'question': 'Kiedy wolno poszerzyć licencję kursu? / When may a course’s licence be widened?',
        'mode': 'single',
        'eligibility': 'members',
        'anonymous': False,
        'description': _pl_en(
            'Dziś licencję kursu poszerza administrator, i tylko wtedy, gdy nikt inny nie jest w '
            'zespole: każdy obecny prowadzący liczy się jako współautor, bo lekcja nie zapisuje, kto ją '
            'napisał, a nikt nie przyznaje licencji na cudze zdania. Ktoś, kto pisał lekcje i odszedł z '
            'zespołu, nie jest liczony. Obie zmiany poniżej to praca w kodzie.',
            'Today an admin widens a course’s licence, and only while nobody else is on the staff: '
            'every current member of staff counts as a co-author, because a lesson does not record '
            'who wrote it, and nobody grants a licence on somebody else’s sentences. Somebody who wrote '
            'lessons and then left the staff is not counted. Both changes below are code work.',
        ),
        'options': [
            'Gdy w zespole nie ma nikogo innego, jak teraz / While nobody else is on the staff, as now',
            'Zapisywać autora lekcji i liczyć tylko autorów / Record each lesson’s writer and count only writers',
            'Gdy każdy współautor zgodzi się na stronie / Once every co-author agrees on the site',
        ],
    },
    {
        'question': 'Czy kursy mają trafić na stronę licencji w Ustawieniach? / Should courses be listed on the licences page in Settings?',
        'mode': 'single',
        'eligibility': 'members',
        'anonymous': False,
        'description': _pl_en(
            'Ustawienia → Licencje pokazują wszystko, co ktoś opublikował, i pozwalają poszerzyć licencję '
            'wielu rzeczy naraz. Kursów tam nie ma: licencję kursu zmienia się na stronie kursu, bo '
            'dotyczy pracy całego zespołu, a nie jednej osoby.',
            'Settings → Licences lists everything somebody posted and widens many licences at once. '
            'Courses are not there: a course’s licence is changed on the course’s own page, because '
            'it covers the whole staff’s work, not one person’s.',
        ),
        'options': [
            'Tak, obok innych treści / Yes, beside the other content',
            'Nie, tylko na stronie kursu / No, only on the course’s page',
        ],
    },
    {
        'question': 'Czy plik kursu z ograniczonym gronem ma się pobierać tylko po zalogowaniu? / Should a course file with a restricted audience download only for a signed-in reader?',
        'mode': 'single',
        'eligibility': 'members',
        'anonymous': False,
        'description': _pl_en(
            'Każdy plik kursu ma swoje grono: wszyscy w kursie albo tylko prowadzący. Ustawienie ukrywa '
            'plik na każdej stronie i liście, ale pliki podaje bezpośrednio serwer WWW, więc adres, '
            'który ktoś już skopiował, nadal działa (nazwa pliku jest losowa). Domknięcie tego to '
            'pobieranie przez widok sprawdzający logowanie i zmiana konfiguracji serwera przy wdrożeniu.',
            'Every course file has its own audience: everyone in the course, or staff only. The '
            'setting hides the file on every page and list, but files are served directly by the web '
            'server, so an address somebody already copied keeps working (the file name is random). '
            'Closing that means downloads through a view that checks the sign-in, and a server '
            'configuration change at deployment.',
        ),
        'options': [
            'Tak, dla każdego pliku z ograniczonym gronem / Yes, for every file with a restricted audience',
            'Tylko dla plików „tylko prowadzący” / Only for staff-only files',
            'Nie, ukrycie i losowa nazwa wystarczą / No, hiding and a random name are enough',
        ],
    },
    {
        'question': 'Na czyim prawnie uzasadnionym interesie opierać zaproszenia e-mailem? / Whose legitimate interest should invitations by e-mail rest on?',
        'mode': 'single',
        'eligibility': 'members',
        'anonymous': False,
        'description': _pl_en(
            'Prowadzący kursu może zaprosić kogoś, wpisując jego adres; serwis wysyła jedną wiadomość o '
            'stałej treści, a adres znika po 30 dniach. Podstawą jest art. 6 ust. 1 lit. f RODO — ale '
            'czy to interes organizatora kursu, czy serwisu, nie jest rozstrzygnięte. Strona '
            'prywatności wymienia dziś oba. Pytanie do inspektora ochrony danych UW jest otwarte.',
            'A course’s staff can invite somebody by typing their address; the service sends one '
            'fixed-text message, and the address is deleted after 30 days. The basis is GDPR art. '
            '6(1)(f) — but whether it is the course organiser’s interest or the service’s is not '
            'settled. The privacy page names both today. The question to the University’s '
            'data-protection officer is open.',
        ),
        'options': [
            'Organizatora kursu / The course organiser’s',
            'Serwisu / The service’s',
            'Obu, jak teraz na stronie prywatności / Both, as the privacy page says now',
            'Najpierw odpowiedź inspektora UW / The University officer’s answer first',
        ],
    },
]

#: The two research accounts (owner's ask, 2026-10-07): the Gemini Deep Research report was posted
#: under `google-gemini` and Claude's reading of it under `anthropic-claude`; the report went with
#: the association (`RETIRED`), and the accounts stay, because `anthropic-claude` signs the project
#: threads and an account is cheaper kept than re-made. Neither has a usable
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
    """A step's or task's deadline from its `due` spec — `('fixed', date)` or None. The two specs
    counted from the association's founding meeting and its KRS entry went with it (`RETIRED`)."""
    if not spec:
        return None
    kind, value = spec
    if kind == 'fixed':
        return _end_of_day(value)
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


def load_project_threads(path: Path = PROJECT_THREADS_PATH) -> list[dict]:
    """The threads under the project's own rows (`PROJECT_THREADS_PATH`), or none."""
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding='utf-8'))


def _thread_location(thread: dict, node: dict | None, organization) -> tuple[str, str]:
    """Where a thread file says its comments go: a standing page (`page` + `section`), the plan
    with a given `SUBPROJECTS` title on the node (`plan`), or the organisation's own thread
    (`organization`). Raises where the row is missing or the key is not one `discussions` accepts —
    a thread must never be written somewhere nobody can open it."""
    from community import discussions
    from plans.models import Plan

    if thread.get('plan'):
        if node is None:
            raise RuntimeError('a plan thread needs the node its plan hangs off')
        plan = _find_by_title(Plan, node, thread['plan'])
        if plan is None:
            raise RuntimeError(f"thread location: no plan titled {thread['plan']!r} on the node")
        key = f'plans/{plan.pk}'
    elif thread.get('organization'):
        if organization is None:
            raise RuntimeError('an organisation thread needs the organisation')
        key = f'organizations/{organization.slug}'
    else:
        page, section = thread['page'], thread['section']
        if not (discussions.PAGE_RE.match(page) and discussions.SECTION_RE.match(section)):
            raise RuntimeError(f'thread location {page}#{section} is not a legal discussion key')
        return page, section
    try:
        return discussions.parse_key(key)
    except ValueError as exc:
        raise RuntimeError(f'thread location {key} is not a legal discussion key') from exc


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
    head = f"**{item['n']}. {item['title']}**" if item.get('n') else f"**{item['title']}**"
    return f"{head}\n\n{item['body']}"


def _upsert_thread(thread: dict, accounts: dict, counts: Counter, *, node=None, organization=None) -> dict:
    """The report as one top-level comment per item under the thread's location (a standing page,
    a plan of the node, or the organisation's own thread — `_thread_location`), each reply under
    its item where the file names a `replier`. Idempotent by the item's bold first line and by
    (parent, replier); the text is refreshed when the file changed, and the timestamps are the
    file's date, a minute apart so the order on the page is the file's."""
    from community.models import Comment, DiscussionLocation
    from config.sanitize import sanitize_content

    page, section = _thread_location(thread, node, organization)
    row, _ = DiscussionLocation.objects.get_or_create(page=page, section=section)
    content_type = ContentType.objects.get_for_model(DiscussionLocation)
    author = accounts[thread['author']]
    replier = accounts[thread['replier']] if thread.get('replier') else None
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
        if not reply_text or replier is None:
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


def _discussion_rows(page: str, section: str = ''):
    """The comments at one discussion location — replies go with their parent (`on_delete`)."""
    from community.models import Comment, DiscussionLocation

    location = DiscussionLocation.objects.filter(page=page, section=section).first()
    if location is None:
        return None, Comment.objects.none()
    content_type = ContentType.objects.get_for_model(DiscussionLocation)
    return location, Comment.objects.filter(content_type=content_type, object_id=location.pk)


def _retire(organization, node: dict, owner, counts: Counter) -> list[str]:
    """Delete every row `RETIRED` names, with the thread under it; return one line per row, for the
    command to print (and a dry run to show before anything is gone). A row is matched only on the
    EdMat node and only by the exact title this seed wrote, so nothing a person made is touched."""
    from config import nodes
    from decisions.models import Poll
    from events.models import Event
    from needs.models import Need
    from organizations.models import OrganizationLink
    from plans.models import Plan, PlanStep
    from tasks.models import Task

    lines: list[str] = []

    def drop_thread(page: str, section: str = '') -> int:
        location, comments = _discussion_rows(page, section)
        if location is None:
            return 0
        gone = comments.count()
        comments.delete()
        location.delete()
        return gone

    for kind, model, key in (('plan', Plan, 'plans'), ('task', Task, 'tasks'), ('need', Need, 'needs')):
        for title in RETIRED[key]:
            row = _find_by_title(model, node, title)
            if row is None:
                continue
            gone = drop_thread(f'{key}/{row.pk}')
            # A sub-task goes with its parent (`on_delete=CASCADE`), so it is named on the
            # parent's line — a dry run has to say everything that will be gone.
            children = list(row.subtasks.all()) if model is Task else []
            for child in children:
                gone += drop_thread(f'tasks/{child.pk}')
            extra = [f'+{len(children)} sub-task(s)'] if children else []
            extra += [f'+{gone} comment(s)'] if gone else []
            lines.append(f'{kind} /{key}/{row.pk}   {row.title}' + (f"   ({', '.join(extra)})" if extra else ''))
            row.delete()
            counts[f'{kind}s_retired'] += 1
    for question in RETIRED['polls']:
        pl_question, _en = _split_title(question)
        row = (
            Poll.objects.filter(**node, question=question).first()
            or Poll.objects.filter(**node, question=pl_question).first()
        )
        if row is None:
            continue
        gone = drop_thread(f'polls/{row.pk}')
        ballots = row.ballots.count()
        lines.append(
            f'poll /polls/{row.pk}   {row.question}   ({ballots} ballot(s)'
            + (f', +{gone} comment(s)' if gone else '') + ')'
        )
        row.delete()
        counts['polls_retired'] += 1
    for plan_title, step_title in RETIRED['steps']:
        plan = _find_by_title(Plan, node, plan_title)
        step = _find_by_title(PlanStep, {'plan': plan}, step_title) if plan else None
        if step is None:
            continue
        lines.append(f'step /plans/{plan.pk}?step={step.pk}   {step.title}')
        step.delete()
        counts['steps_retired'] += 1
    for title in RETIRED['events']:
        for event in Event.objects.filter(host=owner, title=title):
            OrganizationLink.objects.filter(
                organization=organization, content_type=nodes.node_content_type(event), object_id=event.pk
            ).delete()
            lines.append(f'event /events/{event.pk}   [{event.status}]   {event.title}')
            event.delete()
            counts['events_retired'] += 1
    for page, section in RETIRED['threads']:
        gone = drop_thread(page, section)
        if gone:
            lines.append(f'thread /{page}#{section}   {gone} comment(s)')
            counts['threads_retired'] += 1
    return lines


def build_edmat_project(
    owner_username: str | None = None,
    *,
    history: list[dict] | None = None,
    project_threads: list[dict] | None = None,
    retake_description: bool = False,
) -> dict:
    """Write (or refresh) the organisation, its owner, the goals, the tasks, the needs and the polls,
    and retire what `RETIRED` names. One transaction, so a missing user or a bad entry leaves
    nothing half-made. Returns what it touched, with counts a command can print and a test can
    assert.

    `owner_username=None` means the organisation's existing owner — what a deployment re-running the
    seed wants, so the apply script need not know a username; on a database with no organisation
    yet it is refused, because somebody has to be named once."""
    from needs.models import Need
    from decisions.models import Poll
    from organizations.models import Organization, OrganizationMember
    from plans.models import Plan, PlanStep
    from tasks.models import Task

    User = get_user_model()
    if owner_username is None:
        member = (
            OrganizationMember.objects.filter(organization__slug=ORGANIZATION_SLUG, role='owner')
            .select_related('user').order_by('pk').first()
        )
        if member is None:
            raise RuntimeError('No EdMat organisation with an owner yet; pass --owner <username> once.')
        owner = member.user
    else:
        try:
            owner = User.objects.get(username=owner_username)
        except User.DoesNotExist as exc:
            raise RuntimeError(f'No account named {owner_username!r}; pass --owner <username>.') from exc

    if history is None:
        history = load_table()
    by_goal: dict[str, list[dict]] = {}
    for entry in sorted(history, key=lambda e: (e.get('date') or '9999', e.get('line', 0))):
        by_goal.setdefault(entry['subproject'], []).append(entry)

    counts: Counter = Counter()
    now = timezone.now()
    with transaction.atomic():
        # `description` is deliberately NOT in these defaults, and that is the one line standing
        # between a deployment and the owner's own words. Everything else here (name, kind, city,
        # website, open_board) is seed-owned and refreshed on every run; the description is the one
        # field the bilingual editor exposes on `/coop`, so refreshing it from this file would undo
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
        # Its description in both languages — the first paragraph on `/coop`, glued by hand until
        # 2026-10-08. No heading: an organisation's NAME is a registered name and the same in every
        # language (translations/targets.py). This is the ONLY writer of the description now, and it
        # leaves alone any language a person has saved.
        _write_bilingual(
            organization, '', ORGANIZATION['description'], heading=False,
            keep_edited=not retake_description,
        )
        OrganizationMember.objects.update_or_create(
            organization=organization, user=owner, defaults={'role': 'owner'}
        )
        node = _node_filter(organization)

        # Retired first, so a goal's step that pointed at the association is gone before the goal
        # is refreshed, and nothing below can find a retired row by its title.
        retired = _retire(organization, node, owner, counts)

        # Created last-to-first, because the plans panel lists newest first: a reader then meets
        # the goals in the order `SUBPROJECTS` gives.
        for goal in reversed(SUBPROJECTS):
            _upsert_plan(
                node, owner,
                # The apps line goes through `body_suffix` so `_write_bilingual` can append it to
                # BOTH languages; concatenating it here (as this did until 2026-10-08) filed it
                # under the English half alone, because it landed after `_pl_en`'s own rule.
                {**goal, 'body_suffix': f"\n\n*Aplikacje / apps: {goal['apps']}*", 'status': 'active'},
                counts, history_steps=by_goal.get(goal['key'], ()),
            )
        for entry in TASKS:
            _upsert_task(node, owner, entry, counts)
        for entry in NEEDS:
            _upsert_need(node, owner, entry, counts)
        for entry in POLLS:
            _upsert_poll(node, owner, entry, counts, now)
        accounts = _upsert_accounts(counts)
        # After the plans, because a plan thread is located by its plan's title on this node.
        project_threads = [
            _upsert_thread(extra, accounts, counts, node=node, organization=organization)
            for extra in (load_project_threads() if project_threads is None else project_threads)
        ]

    unfiled = sorted(set(by_goal) - {goal['key'] for goal in SUBPROJECTS})
    return {
        'accounts': list(accounts),
        'accounts_created': counts['accounts_created'],
        'retired': retired,
        'project_threads': project_threads,
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
        'history_count': len(history),
        'history_unfiled': unfiled,
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
    for task in TASKS:
        out.extend([task['title'], task['description']])
    for need in NEEDS:
        out.extend([need['title'], need['description']])
    for poll in POLLS:
        out.extend([poll['question'], poll['description'], *poll['options']])
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
