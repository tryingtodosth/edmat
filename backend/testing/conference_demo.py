"""One lived-in demo conference for the conference layer (CONFERENCE-BRIEF.md §3, all seven steps).

`make_personas()` gives the permission matrix seven accounts and a bare "Sandbox conference". That
is the right fixture for a table of who-may-do-what and the wrong thing to screenshot: every
conference page — the checklist, the documents, the rota, the scanner log, the cloakroom desk —
stares at an empty table. This module builds the thing the follow-up research prompt asked for
(`CONFERENCE-RESEARCH-PROMPT.md`, "sample data for a demo conference"): a two-day, ~150-person
teaching conference at a real-shaped Warsaw physics building, with a venue and rooms, an approved
set of bookings, a checklist cut from the seeded two-day template with items in every state,
documents in every visibility tier with a partly-read acknowledgement ledger, a programme with
tracks and speakers, registrations with tickets and a day-one scan log, a rota with a short-staffed
shift and a minor on it, and a cloakroom desk with coats on the racks.

**Where the content comes from.** Gemini's answer (`CONFERENCE-RESEARCH-REPORT-DEMO.md`) answered
a different question — an enterprise summit — so almost everything here is **synthesised** to be
plausible for a Polish university teaching conference, and says so. What is taken from the report:
the document tiers and their typical titles, the desk ratios (one registration lane per ~150
arrivals, one cloakroom attendant per ~80 garments), and the day-over-day fall-off in attendance.
Every person, talk and affiliation is invented; the building is shaped like Pasteura 5 but the
room numbers and capacities are illustrative, not the faculty's.

**The clock.** Day one is *today* in Warsaw unless `day_one` says otherwise, so the
conference is in progress when you look at it — that is what makes a scan log, a desk with coats
on it and a rota with shifts already done possible at all, while registration, claims and the
cloakroom still answer (`Event.is_past` is false until day two ends). Everything the plan dates
*after now* is left unapplied: a scan that has not happened yet is not written, a coat not yet
deposited is not on a rack, a shift still to come is `confirmed` rather than `done`. Re-run the
command later in the day and more of day one has happened. Pass `day_one=yesterday` for a
conference on its second day, or a future date for one that has not started.

**Idempotent by rebuild.** Accounts, the event, the venue, its rooms, the programme and the
attendances are `update_or_create`d on stable keys (username; `(host, title)`; slug; `(event,
title)`; `(event, attendee)`). The operational rows that hang off them — bookings, the checklist
instance, stations, shifts, assignments, scans, cloakroom items, export logs, posts — have no
identity of their own worth preserving and are **deleted and rebuilt on every run**, which is what
lets the dates move to today without leaving last week's shifts behind. Documents keep their files
(a file is written once and reused), so `media/` does not fill up with copies.

Nothing here calls a function that notifies. `make_personas` explains why (a demo re-run must not
put a fresh bell on anybody's account); the same holds here, so attendances, decisions and
assignments are written directly and the only services called are the ones that mint or validate:
`ensure_ticket`, `apply_batch`, `instantiate`, `desk.new_token`, `hand_back`, `return_by_exception`,
`log_export`. The rota is then checked against `shifts.rules` so that a plan edited by hand cannot
quietly put a minor on a night shift or one person in two rooms at once.
"""

from __future__ import annotations

import random
import zlib
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.files.base import ContentFile
from django.db.models import Q
from django.utils import timezone

from accounts.models import Guardianship
from cloakroom.models import CloakroomDesk
from cloakroom.rules import hand_back, return_by_exception
from documents.models import DocumentAcknowledgement, EventDocument
from events.exports import log_export
from events.models import (
    Contribution,
    EventAttendance,
    EventPost,
    EventStaff,
    ExportLog,
    RegistrationField,
    ScanEvent,
    Session,
    SessionAttendance,
    SessionBookmark,
    SessionLink,
    SessionSpeaker,
    Track,
    Event,
)
from events.scanning import apply_batch, ensure_ticket
from shifts.models import Assignment, Shift, Station, VolunteerRecord
from shifts.rules import MIN_GAP, touches_night
from testing.personas import DEFAULT_PASSWORD, FAKE_PREFIX, make_personas
from venues.models import ChecklistInstance, ChecklistTemplate, Room, RoomBooking, Venue, VenueStaff
from venues.services import instantiate

User = get_user_model()

#: The event's title is its key, as `SANDBOX_TITLE` is for the personas' event. `FAKE_PREFIX` is
#: imported rather than repeated: two seeders spelling the same marker differently is exactly the
#: drift that makes "is this real?" unanswerable at a glance.
DEMO_TITLE = FAKE_PREFIX + 'Dni Dydaktyki Fizyki 2026'
DEMO_VENUE_SLUG = 'demo-pasteura-5'
#: Every account this module creates beyond the personas. `seed_demo_content` owns `demo-`; this
#: prefix is different on purpose, so neither command's `--reset` can delete the other's people.
PREFIX = 'conf.'
#: The building is in Warsaw, so the plan's hours are Warsaw hours: a browser in Warsaw draws
#: "09:00 otwarcie" at 09:00. `settings.TIME_ZONE` is UTC and the rota's rules (the 22:00–06:00
#: window, the daily cap) run in it, two hours earlier — every shift here sits well inside the day
#: either way, so the rules and the page agree. This is the standing "no per-account timezone" gap
#: (root CLAUDE.md), sidestepped for one demo rather than fixed.
DEMO_TZ = ZoneInfo('Europe/Warsaw')
#: The seeded platform template (venues migration 0002) the checklist is cut from.
TEMPLATE_NAME = 'Two-day multi-room academic conference'
#: The five flags a reader needs on to see all of this. Reported, never flipped: a switch somebody
#: turned off is a decision, and a seed command is not the place to overrule it.
FLAGS_NEEDED = ('events', 'venues', 'event_documents', 'tickets', 'shifts', 'cloakroom')

# ---------------------------------------------------------------------------------------------
# Synthesised people. Polish names, deterministic from a fixed seed so a re-run gives the same
# Jan Kowalski the same affiliation. None of these is a real person.
# ---------------------------------------------------------------------------------------------

#: Polish surnames are gendered where they are adjectival (-ski / -ska), so a name is a first name
#: of one gender and the matching form of the surname — "Marta Olszewski" reads as invented to any
#: Polish reader, which was what the first screenshot showed.
_FIRST_F = [
    'Anna', 'Katarzyna', 'Agnieszka', 'Magdalena', 'Joanna', 'Aleksandra', 'Monika', 'Natalia',
    'Karolina', 'Ewa', 'Zofia', 'Julia', 'Marta', 'Dorota', 'Beata', 'Iwona', 'Hanna', 'Weronika',
    'Barbara', 'Elżbieta', 'Justyna', 'Patrycja', 'Emilia', 'Alicja', 'Maria',
]
_FIRST_M = [
    'Piotr', 'Marcin', 'Tomasz', 'Michał', 'Krzysztof', 'Paweł', 'Łukasz', 'Jakub', 'Adam', 'Bartosz',
    'Mateusz', 'Rafał', 'Wojciech', 'Maciej', 'Grzegorz', 'Sebastian', 'Damian', 'Kamil', 'Dawid',
    'Szymon', 'Artur', 'Robert', 'Filip', 'Andrzej', 'Marek',
]
#: (masculine form, feminine form)
_LAST = [
    ('Nowak', 'Nowak'), ('Kowalski', 'Kowalska'), ('Wiśniewski', 'Wiśniewska'), ('Wójcik', 'Wójcik'),
    ('Kowalczyk', 'Kowalczyk'), ('Kamiński', 'Kamińska'), ('Lewandowski', 'Lewandowska'),
    ('Zieliński', 'Zielińska'), ('Szymański', 'Szymańska'), ('Woźniak', 'Woźniak'),
    ('Dąbrowski', 'Dąbrowska'), ('Kozłowski', 'Kozłowska'), ('Jankowski', 'Jankowska'), ('Mazur', 'Mazur'),
    ('Krawczyk', 'Krawczyk'), ('Piotrowski', 'Piotrowska'), ('Grabowski', 'Grabowska'),
    ('Nowakowski', 'Nowakowska'), ('Pawłowski', 'Pawłowska'), ('Michalski', 'Michalska'),
    ('Adamczyk', 'Adamczyk'), ('Dudek', 'Dudek'), ('Zając', 'Zając'), ('Wieczorek', 'Wieczorek'),
    ('Jabłoński', 'Jabłońska'), ('Król', 'Król'), ('Majewski', 'Majewska'), ('Olszewski', 'Olszewska'),
    ('Jaworski', 'Jaworska'), ('Wróbel', 'Wróbel'), ('Malinowski', 'Malinowska'), ('Pawlak', 'Pawlak'),
    ('Witkowski', 'Witkowska'), ('Walczak', 'Walczak'), ('Stępień', 'Stępień'), ('Górski', 'Górska'),
    ('Rutkowski', 'Rutkowska'), ('Michalak', 'Michalak'), ('Sikora', 'Sikora'), ('Ostrowski', 'Ostrowska'),
    ('Baran', 'Baran'), ('Duda', 'Duda'), ('Szewczyk', 'Szewczyk'), ('Tomaszewski', 'Tomaszewska'),
    ('Pietrzak', 'Pietrzak'), ('Marciniak', 'Marciniak'),
]
_AFFILIATIONS = [
    ('Wydział Fizyki UW', 22), ('XIV LO im. Staszica, Warszawa', 6), ('Politechnika Warszawska', 8),
    ('Uniwersytet Jagielloński', 6), ('AGH Kraków', 4), ('Instytut Fizyki PAN', 5),
    ('Uniwersytet Wrocławski', 4), ('UMK Toruń', 3), ('Uniwersytet Gdański', 3),
    ('Uniwersytet w Białymstoku', 2), ('II LO im. Batorego, Warszawa', 4), ('LO im. Kopernika, Łódź', 3),
    ('Centrum Nauki Kopernik', 3), ('Uniwersytet Śląski', 3), ('Politechnika Gdańska', 2),
    ('Szkoła Podstawowa nr 12, Warszawa', 3), ('Uniwersytet Łódzki', 2), ('Ośrodek Doskonalenia Nauczycieli, Warszawa', 3),
    ('Politechnika Wrocławska', 2), ('UAM Poznań', 4),
]
_ROLES = [('nauczyciel', 38), ('student', 30), ('doktorant / pracownik naukowy', 26), ('inne', 6)]
_DIETS = [('standardowa', 74), ('wegetariańska', 17), ('wegańska', 4), ('bezglutenowa', 4), ('inna', 1)]
_NEEDS = [
    'Poruszam się na wózku — proszę o miejsce przy przejściu w Auli.',
    'Aparat słuchowy: proszę o miejsce blisko prelegenta.',
    'Proszę o napisy / transkrypcję, jeśli będą dostępne.',
    'Alergia na orzechy (poczęstunek).',
]

_rng = random.Random(20261014)


def _weighted(pairs):
    values, weights = zip(*pairs)
    return _rng.choices(values, weights=weights, k=1)[0]


def _person_names(n: int):
    """`n` distinct "First Last" names, deterministic."""
    seen, out = set(), []
    while len(out) < n:
        feminine = _rng.random() < 0.55
        last = _rng.choice(_LAST)[1 if feminine else 0]
        name = f'{_rng.choice(_FIRST_F if feminine else _FIRST_M)} {last}'
        if name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


# ---------------------------------------------------------------------------------------------
# The building. Shaped like Wydział Fizyki UW at Pasteura 5; numbers illustrative.
# ---------------------------------------------------------------------------------------------

VENUE = {
    'name': 'Wydział Fizyki UW — Pasteura 5 (demo)',
    'address': 'ul. Pasteura 5, 02-093 Warszawa',
    'contact_note': (
        'Portiernia przy wejściu głównym czynna 6:00–22:00. Sprawy sal: administracja budynku, '
        'pok. 0.20. Room numbers and capacities in this demo are illustrative.'
    ),
    'security_phone': '22 55 32 000',
}

ROOMS = [
    # name, number, floor, seated, fire, has_av, accessible, notes
    ('Aula 0.03', '0.03', '0', 240, 300, True, True, 'Rzutnik laserowy 16:9, nagłośnienie, mikrofony bezprzewodowe ×4, pętla indukcyjna.'),
    ('Sala 0.06', '0.06', '0', 110, 140, True, True, 'Rzutnik, tablica, 1 mikrofon.'),
    ('Sala 1.01', '1.01', '1', 40, 60, True, True, 'Sala ćwiczeniowa: stoły, 24 gniazdka przy stołach.'),
    ('Sala 1.02', '1.02', '1', 40, 60, False, True, 'Tablica; brak rzutnika na stałe.'),
    ('Sala seminaryjna 1.40', '1.40', '1', 24, 30, True, False, 'Winda nie dojeżdża do tego skrzydła.'),
    ('Hol główny', '', '0', 0, 400, False, True, 'Rejestracja, szatnia, sesja plakatowa. 30 stojaków na plakaty.'),
]

# ---------------------------------------------------------------------------------------------
# The programme. Two days; every session dated (day, hh:mm, minutes). Synthesised.
# ---------------------------------------------------------------------------------------------

TRACKS = [
    ('Sesja plenarna', '#3b6ea5'),
    ('Dydaktyka fizyki', '#2e8b57'),
    ('Warsztaty', '#b5651d'),
    ('Sesja plakatowa', '#7b4fa0'),
]

#: (day, 'HH:MM', minutes, kind, track or None, room, title, abstract, capacity, speakers)
#: speakers: list of (name, affiliation) — or a persona key string for one of the accounts.
PROGRAMME = [
    (0, '08:00', 60, 'break', None, 'Hol główny', 'Rejestracja i kawa powitalna', '', 0, []),
    (0, '09:00', 20, 'other', 'Sesja plenarna', 'Aula 0.03', 'Otwarcie konferencji',
     'Powitanie uczestników, sprawy organizacyjne, plan dwóch dni.', 0,
     ['organiser', ('prof. Halina Sawicka', 'Prodziekan ds. studenckich, Wydział Fizyki UW')]),
    (0, '09:20', 60, 'talk', 'Sesja plenarna', 'Aula 0.03',
     'Fizyka kwantowa w liceum — co da się uczciwie powiedzieć',
     'Które pojęcia mechaniki kwantowej przeżywają uproszczenie do poziomu szkolnego bez kłamstwa, '
     'a które lepiej zostawić: doświadczenia z trzech lat pracy z klasami dwujęzycznymi.', 0,
     [('prof. Andrzej Wieliczko', 'Instytut Fizyki Teoretycznej UW')]),
    (0, '10:20', 30, 'break', None, 'Hol główny', 'Przerwa kawowa', '', 0, []),
    (0, '10:50', 40, 'talk', 'Sesja plenarna', 'Aula 0.03',
     'Symulacje w dydaktyce: od PhET do własnego kodu',
     'Kiedy gotowa symulacja wystarcza, a kiedy warto, żeby studenci napisali dwadzieścia linijek sami.', 0,
     [('dr Marek Ptaszyński', 'Wydział Fizyki UW')]),
    (0, '10:50', 40, 'talk', 'Dydaktyka fizyki', 'Sala 0.06',
     'Ocenianie kształtujące na ćwiczeniach z mechaniki',
     'Jak przebudowano ćwiczenia z mechaniki I roku: kartki wyjścia, praca w parach, zero sprawdzianów do listopada.', 0,
     [('dr Agata Rybak', 'Uniwersytet Jagielloński')]),
    (0, '11:35', 40, 'talk', 'Sesja plenarna', 'Aula 0.03',
     'Baza zadań EdMat: rok otwartych rozwiązań',
     'Co wynika z roku prowadzenia bazy ~740 zadań z rozwiązaniami: kto zgłasza, kto poprawia, co ludzie naprawdę czytają.', 0,
     ['reviewer']),
    (0, '11:35', 40, 'talk', 'Dydaktyka fizyki', 'Sala 0.06',
     'Jak studenci czytają wykresy — badanie 300 kolokwiów',
     'Analiza błędów w odczytywaniu wykresów v(t) i a(t) na kolokwiach z trzech uczelni.', 0,
     [('mgr Ewelina Sadowska', 'Politechnika Warszawska'), ('dr hab. Jerzy Klimek', 'Politechnika Warszawska')]),
    (0, '12:15', 75, 'break', None, 'Hol główny', 'Obiad', '', 0, []),
    (0, '13:30', 120, 'workshop', 'Warsztaty', 'Sala 1.01',
     'Warsztat: Arduino w pracowni fizycznej',
     'Cztery doświadczenia z czujnikami za mniej niż 100 zł na stanowisko. Laptop własny; zestawy na miejscu. Liczba miejsc ograniczona.', 24,
     [('mgr Tomasz Grelak', 'XIV LO im. Staszica, Warszawa')]),
    (0, '13:30', 40, 'talk', 'Dydaktyka fizyki', 'Sala 0.06',
     'Laboratorium I pracowni po pandemii',
     'Co zostało z laboratoriów zdalnych, a co wróciło do stołu: dwa lata obserwacji z I Pracowni Fizycznej.', 0,
     [('dr Beata Wróblewska', 'Wydział Fizyki UW')]),
    (0, '14:15', 40, 'talk', 'Dydaktyka fizyki', 'Sala 0.06',
     'Zadania otwarte a egzamin maturalny',
     'Dlaczego zadanie z jedną odpowiedzią liczbową uczy czegoś innego niż zadanie z pytaniem „ile mniej więcej”.', 0,
     [('mgr Iwona Pacholczyk', 'II LO im. Batorego, Warszawa')]),
    (0, '15:30', 30, 'break', None, 'Hol główny', 'Przerwa kawowa', '', 0, []),
    (0, '16:00', 90, 'other', 'Sesja plenarna', 'Aula 0.03',
     'Panel: Czy wykład jeszcze ma sens?',
     'Cztery osoby, cztery odpowiedzi, pytania z sali.', 0,
     [('prof. Andrzej Wieliczko', 'Instytut Fizyki Teoretycznej UW'), ('dr Agata Rybak', 'Uniwersytet Jagielloński'),
      ('mgr Tomasz Grelak', 'XIV LO im. Staszica, Warszawa'), ('Olga Stankiewicz', 'studentka III roku, Wydział Fizyki UW')]),
    (0, '18:00', 150, 'social', 'Sesja plakatowa', 'Hol główny',
     'Sesja plakatowa z poczęstunkiem',
     '30 plakatów; autorzy przy plakatach 18:00–19:30. Poczęstunek — proszę o zgłoszenie diety w formularzu.', 0, []),
    (1, '09:00', 60, 'talk', 'Sesja plenarna', 'Aula 0.03',
     'Termodynamika bez wzorów? Eksperyment dydaktyczny',
     'Semestr termodynamiki prowadzony od zjawisk do równań, i co z tego wyszło na egzaminie.', 0,
     [('prof. Renata Kubiak', 'UMK Toruń')]),
    (1, '10:00', 30, 'break', None, 'Hol główny', 'Przerwa kawowa', '', 0, []),
    (1, '10:30', 40, 'talk', 'Dydaktyka fizyki', 'Sala 0.06',
     'Zadania z mechaniki dla pierwszego roku — co sprawia trudność',
     'Dwadzieścia zadań, które najczęściej wracają na poprawkę, i próba wyjaśnienia dlaczego.', 0,
     [('dr Piotr Zawadzki', 'Uniwersytet Wrocławski')]),
    (1, '10:30', 120, 'workshop', 'Warsztaty', 'Sala 1.01',
     'Warsztat: Tworzenie zadań z rozwiązaniami dla EdMat',
     'Od pomysłu do zgłoszenia: treść, wskazówka, rozwiązanie, LaTeX. Każdy uczestnik wychodzi z jednym zgłoszonym zadaniem.', 20,
     ['organiser']),
    (1, '11:15', 40, 'talk', 'Dydaktyka fizyki', 'Sala 0.06',
     'Optyka na telefonie: pomiary z aparatem',
     'Dyfrakcja na płycie CD, prawo Malusa z dwóch par okularów — pomiary ilościowe telefonem.', 0,
     [('mgr Karol Lis', 'LO im. Kopernika, Łódź')]),
    (1, '12:00', 60, 'break', None, 'Hol główny', 'Obiad', '', 0, []),
    (1, '13:00', 90, 'other', 'Sesja plenarna', 'Aula 0.03',
     'Krótkie wystąpienia (5 × 15 min)',
     'Pięć krótkich wystąpień zgłoszonych w naborze.', 0,
     [('Olga Stankiewicz', 'studentka III roku, Wydział Fizyki UW'), ('dr Michał Serafin', 'AGH Kraków'),
      ('mgr Anna Domańska', 'Centrum Nauki Kopernik'), ('dr Łukasz Bielawski', 'Instytut Fizyki PAN'),
      ('mgr Dorota Krupa', 'Uniwersytet Gdański')]),
    (1, '14:30', 30, 'break', None, 'Hol główny', 'Przerwa kawowa', '', 0, []),
    (1, '15:00', 45, 'other', 'Sesja plenarna', 'Aula 0.03',
     'Zamknięcie i wnioski',
     'Podsumowanie, ankieta, zaproszenie na przyszły rok.', 0, ['organiser']),
]

#: Slides and links hung off sessions: (session title, role, label, url).
SESSION_LINKS = [
    ('Symulacje w dydaktyce: od PhET do własnego kodu', 'slides', 'Slajdy (PDF)', 'https://example.org/ddf2026/ptaszynski-symulacje.pdf'),
    ('Warsztat: Arduino w pracowni fizycznej', 'prepare', 'Lista sprzętu i instalacja IDE', 'https://example.org/ddf2026/arduino-przygotowanie'),
    ('Baza zadań EdMat: rok otwartych rozwiązań', 'live', 'Baza zadań', 'https://example.org/exercises'),
]

#: The call for contributions, as it stands on day one. (submitter index into attendees, kind,
#: title, abstract, status, reason_code, review_note, scheduled session title or None)
CONTRIBUTIONS = [
    (3, 'talk', 'Optyka na telefonie: pomiary z aparatem',
     'Dyfrakcja na płycie CD, prawo Malusa z dwóch par okularów — pomiary ilościowe telefonem.',
     'scheduled', '', 'Świetnie pasuje do sesji dydaktycznej.', 'Optyka na telefonie: pomiary z aparatem'),
    (7, 'talk', 'Jak studenci czytają wykresy — badanie 300 kolokwiów',
     'Analiza błędów w odczytywaniu wykresów v(t) i a(t) na kolokwiach z trzech uczelni.',
     'scheduled', '', '', 'Jak studenci czytają wykresy — badanie 300 kolokwiów'),
    (11, 'talk', 'Laboratorium I pracowni po pandemii',
     'Co zostało z laboratoriów zdalnych, a co wróciło do stołu.',
     'scheduled', '', '', 'Laboratorium I pracowni po pandemii'),
    (15, 'talk', 'Symulacja gazu doskonałego w przeglądarce',
     'Prosty model cząsteczkowy w JavaScript i jak studenci sami odkrywają rozkład Maxwella.',
     'accepted', '', 'Przyjęte; czekamy na wolny slot w sesji krótkich wystąpień.', None),
    (19, 'workshop', 'Kurs przygotowawczy do olimpiady online',
     'Jak prowadzić kółko olimpijskie zdalnie dla uczniów z małych miejscowości.',
     'rejected', 'no_room', 'Bardzo dobry temat, ale w tym roku mamy tylko dwa sloty warsztatowe. Zapraszamy za rok.', None),
    (23, 'talk', 'Doświadczenia z ciekłym azotem na dniu otwartym',
     'Bezpieczeństwo, logistyka i co naprawdę zapamiętują uczniowie.',
     'under_review', '', '', None),
    (27, 'poster', 'Plakat: błędne wyobrażenia o sile tarcia',
     'Wyniki ankiety wśród 200 uczniów pierwszej klasy liceum.',
     'submitted', '', '', None),
]

# ---------------------------------------------------------------------------------------------
# Registration. capacity 134 = exactly the seat holders, so the event reads as FULL with a
# waiting list, which is the interesting state. Percentages are synthesised: a free academic
# conference typically sees ~20–25 % of "going" not turn up on day one (report: paid enterprise
# events see ~4 %; free events far more), so ~78 % checked in by the end of day one.
# ---------------------------------------------------------------------------------------------

N_ATTENDEE_ACCOUNTS = 144
CAPACITY = 134
N_GOING = 128          # + persona.attendee + persona.child = 130 going
N_PROMOTED = 4         # 24-hour seat offers still open
N_WAITLISTED = 6
N_NOT_GOING = 6          # 128 + 4 + 6 + 6 = 144 accounts; going + promoted + the two personas = 134 = capacity
#: Attendees (by index) whose door scan happens on day one, with the minute offset from 08:00 they
#: arrive. Peak 08:30–09:10 (report: arrivals peak in the 15 minutes before the opening).
DAY_ONE_CHECKED_IN = 100
DAY_ONE_DOOR_START = time(8, 5)

# ---------------------------------------------------------------------------------------------
# The rota. Stations and shifts synthesised for 150 people; ratios from the report (one
# registration lane per 150–200 arrivals, one cloakroom attendant per 80 garments).
# ---------------------------------------------------------------------------------------------

#: name, kind, location, briefing, minors_permitted, requires_adult, needs_confirmation
STATIONS = [
    ('Rejestracja', 'door', 'Hol główny, przy wejściu', 'Skanujesz bilet z telefonu lub z wydruku; bez biletu — szukasz po nazwisku. Nie wpuszczasz nikogo „na słowo”: odsyłasz do punktu informacyjnego.', True, True, False),
    ('Szatnia', 'cloakroom', 'Hol główny, po lewej', 'Numer wieszaka + token na kwitku. Zgubiony kwitek: opis rzeczy + legitymacja, wpis w konsoli. Nigdy nie wydajesz bez wpisu.', False, False, True),
    ('Punkt informacyjny', 'info', 'Hol główny, przy schodach', 'Program, mapa budynku, toalety, apteczka jest w portierni. Sprawy zdrowotne: dzwonisz do organizatora dyżurnego.', True, True, False),
    ('Aula 0.03 — obsługa sali', 'room', 'Aula 0.03', 'Mikrofony, pilot, licznik czasu. Powtarzasz pytania z sali do mikrofonu. Znasz drogę ewakuacyjną z Auli.', False, False, False),
    ('Sala 0.06 — obsługa sali', 'room', 'Sala 0.06', 'Rzutnik i mikrofon; pilnujesz czasu prelegenta (kartki 5 / 1 min).', True, True, False),
    ('Sala 1.01 — warsztaty', 'room', 'Sala 1.01', 'Zestawy Arduino wydajesz za podpisem na liście; po warsztacie liczysz.', False, False, False),
    ('Przygotowanie i sprzątanie sal', 'setup', 'cały budynek', 'Krzesła, stojaki na plakaty, oznakowanie. Rękawice w portierni.', False, False, False),
]

#: (station, day, 'start', 'end', needed, note)
SHIFTS = [
    ('Przygotowanie i sprzątanie sal', 0, '07:00', '08:30', 4, 'Ustawienie holu i stojaków'),
    ('Rejestracja', 0, '08:00', '10:00', 3, 'Szczyt przyjazdów'),
    ('Rejestracja', 0, '10:00', '13:00', 2, ''),
    ('Rejestracja', 0, '13:00', '16:00', 1, 'Spóźnieni'),
    ('Szatnia', 0, '08:00', '11:00', 2, 'Przyjmowanie'),
    ('Szatnia', 0, '11:00', '14:00', 1, ''),
    ('Szatnia', 0, '14:00', '18:30', 2, 'Wydawanie po sesji'),
    ('Szatnia', 0, '18:30', '21:00', 1, 'Sesja plakatowa'),
    ('Punkt informacyjny', 0, '08:30', '13:00', 2, ''),
    ('Punkt informacyjny', 0, '13:00', '18:00', 2, 'Z nieletnim wolontariuszem'),
    ('Aula 0.03 — obsługa sali', 0, '08:45', '12:30', 1, ''),
    ('Aula 0.03 — obsługa sali', 0, '15:45', '17:45', 1, 'Panel'),
    ('Sala 0.06 — obsługa sali', 0, '10:30', '12:30', 1, ''),
    ('Sala 0.06 — obsługa sali', 0, '13:15', '15:15', 1, ''),
    ('Sala 1.01 — warsztaty', 0, '13:00', '16:00', 1, 'Arduino'),
    ('Przygotowanie i sprzątanie sal', 0, '17:30', '18:15', 3, 'Hol na sesję plakatową'),
    ('Przygotowanie i sprzątanie sal', 1, '08:00', '08:45', 2, ''),
    ('Rejestracja', 1, '08:30', '10:00', 2, ''),
    ('Rejestracja', 1, '10:00', '13:00', 1, ''),
    ('Szatnia', 1, '08:30', '12:00', 1, ''),
    ('Szatnia', 1, '12:00', '16:30', 2, 'Wydawanie'),
    ('Punkt informacyjny', 1, '08:30', '13:00', 2, 'Z nieletnim wolontariuszem'),
    ('Punkt informacyjny', 1, '13:00', '16:00', 1, ''),
    ('Aula 0.03 — obsługa sali', 1, '08:45', '10:15', 1, ''),
    ('Aula 0.03 — obsługa sali', 1, '12:45', '16:00', 1, ''),
    ('Sala 0.06 — obsługa sali', 1, '10:15', '12:15', 1, ''),
    ('Sala 1.01 — warsztaty', 1, '10:00', '13:00', 1, 'Zadania dla EdMat'),
    ('Przygotowanie i sprzątanie sal', 1, '16:00', '18:00', 4, 'Sprzątanie i zdanie sal'),
]

#: Volunteers beyond the personas: username suffix → display name. All adults but the last, who
#: is a second minor with NO consent on file (so the "minor_no_consent" refusal is demonstrable).
VOLUNTEERS = {
    'volunteer.01': 'Marta Wiśniewska', 'volunteer.02': 'Kuba Lewandowski', 'volunteer.03': 'Ola Kamińska',
    'volunteer.04': 'Bartek Zieliński', 'volunteer.05': 'Zuzanna Mazur', 'volunteer.06': 'Igor Krawczyk',
    'volunteer.07': 'Nina Grabowska', 'volunteer.08': 'Wiktor Pawłowski', 'volunteer.09': 'Lena Michalska',
    'volunteer.10': 'Franek Dudek', 'volunteer.11': 'Maja Zając',
}
MINOR_VOLUNTEER_2 = ('child.02', 'Hania Wieczorek')  # 15, guardian conf.guardian.02, no consent recorded

#: Who holds which shift: (station, day, start) → list of (who, status-or-None, source).
#: `None` status means "by the clock": done if the shift has ended, confirmed otherwise.
#: Left deliberately short: Rejestracja day 0 10:00 (needs 2, has 1 — and it is `clerk`, who has not
#: read the briefing, so the scanner refuses them), Szatnia day 1 12:00 (needs 2, has 1), Sala 1.01
#: day 1 (only an offer, not yet taken), Sprzątanie day 1 16:00 (needs 4, has 2) — the coverage grid
#: must have something to say. Nobody is back-to-back: the rota's 15-minute gap is a hard refusal.
ASSIGNMENTS = {
    ('Przygotowanie i sprzątanie sal', 0, '07:00'): [('volunteer.02', None, 'self'), ('volunteer.04', None, 'self'), ('volunteer.06', 'no_show', 'self'), ('volunteer.08', None, 'organiser')],
    ('Rejestracja', 0, '08:00'): [('volunteer', None, 'self'), ('volunteer.01', None, 'self'), ('volunteer.03', None, 'organiser')],
    ('Rejestracja', 0, '10:00'): [('clerk', None, 'organiser')],
    ('Rejestracja', 0, '13:00'): [('volunteer.05', None, 'self')],
    ('Szatnia', 0, '08:00'): [('volunteer.07', None, 'self'), ('volunteer.09', None, 'self')],
    ('Szatnia', 0, '11:00'): [('volunteer.02', None, 'self')],
    ('Szatnia', 0, '14:00'): [('volunteer.09', None, 'self'), ('clerk', None, 'organiser')],
    ('Szatnia', 0, '18:30'): [('volunteer.10', None, 'self')],
    ('Punkt informacyjny', 0, '08:30'): [('volunteer.11', None, 'self'), ('volunteer.06', None, 'self')],
    ('Punkt informacyjny', 0, '13:00'): [('child', None, 'self'), ('volunteer.08', None, 'self')],
    ('Aula 0.03 — obsługa sali', 0, '08:45'): [('volunteer.04', None, 'self')],
    ('Aula 0.03 — obsługa sali', 0, '15:45'): [('volunteer.04', None, 'self')],
    ('Sala 0.06 — obsługa sali', 0, '10:30'): [('volunteer.08', None, 'self')],
    ('Sala 0.06 — obsługa sali', 0, '13:15'): [('volunteer.03', None, 'self'), ('volunteer.06', 'dropped', 'self')],
    ('Sala 1.01 — warsztaty', 0, '13:00'): [('volunteer.10', None, 'organiser')],
    ('Przygotowanie i sprzątanie sal', 0, '17:30'): [('volunteer.05', None, 'self'), ('volunteer.01', None, 'self'), ('volunteer.03', None, 'self')],
    ('Przygotowanie i sprzątanie sal', 1, '08:00'): [('volunteer.06', None, 'self'), ('volunteer.02', None, 'self')],
    ('Rejestracja', 1, '08:30'): [('volunteer', None, 'self'), ('volunteer.03', None, 'self')],
    ('Rejestracja', 1, '10:00'): [('volunteer.01', None, 'self')],
    ('Szatnia', 1, '08:30'): [('volunteer.09', None, 'self')],
    ('Szatnia', 1, '12:00'): [('volunteer.07', None, 'self')],
    ('Punkt informacyjny', 1, '08:30'): [('child', None, 'self'), ('volunteer.11', None, 'self')],
    ('Punkt informacyjny', 1, '13:00'): [('clerk', None, 'organiser')],
    ('Aula 0.03 — obsługa sali', 1, '08:45'): [('volunteer.04', None, 'self')],
    ('Aula 0.03 — obsługa sali', 1, '12:45'): [('volunteer.08', None, 'self')],
    ('Sala 0.06 — obsługa sali', 1, '10:15'): [('volunteer.05', None, 'self')],
    ('Sala 1.01 — warsztaty', 1, '10:00'): [('volunteer.10', 'offered', 'organiser')],
    ('Przygotowanie i sprzątanie sal', 1, '16:00'): [('volunteer.02', None, 'self'), ('volunteer.06', None, 'self')],
}

# ---------------------------------------------------------------------------------------------
# Cloakroom. ~60 % of the people through the door leave a coat in mid-October; peak deposits track
# the door peak; a few returned at lunch; two lost slips. Synthesised — the report gives only the
# attendant ratio and the seconds per transaction.
# ---------------------------------------------------------------------------------------------

DESK_NAME = 'Szatnia — hol główny'
RACKS = [f'A{i:02d}' for i in range(1, 61)] + [f'B{i:02d}' for i in range(1, 61)]
N_DEPOSITS = 62
N_LUNCH_RETURNS = 9
_ITEMS = ['kurtka czarna', 'płaszcz beżowy', 'plecak', 'kurtka granatowa', 'parasol i torba', 'płaszcz szary',
          'kurtka czerwona', 'walizka kabinowa', 'kurtka zielona', 'torba na laptopa', 'płaszcz czarny', 'kurtka szara']

# ---------------------------------------------------------------------------------------------
# Documents, one per tier and a few more; the tiers and titles follow the report's five-tier
# scheme mapped onto EdMat's (public / attendees / staff / organisers / venue).
# ---------------------------------------------------------------------------------------------

#: (title, tier, kind, requires_ack, version, lines-of-text or url)
DOCUMENTS = [
    ('Program konferencji (PDF)', 'public', 'file', False, 1,
     ['Dni Dydaktyki Fizyki 2026 — program', 'Dzień 1: 9:00 otwarcie, Aula 0.03', 'Dzień 2: 9:00 wykład plenarny', 'Pełny program: zakładka Program.']),
    ('Plan budynku i dojazd', 'public', 'link', False, 1, 'https://example.org/ddf2026/dojazd'),
    ('Informacje dla uczestników: Wi-Fi, rejestracja, szatnia', 'attendees', 'file', False, 1,
     ['Wi-Fi: eduroam; goście — sieć „UW-Goscie”, kod przy rejestracji.', 'Rejestracja: hol główny, od 8:00.', 'Szatnia: hol główny; kwitek z tokenem — nie zgub.', 'Obiad: bufet w holu, 12:15–13:30.']),
    ('Wskazówki dla prelegentów — AV', 'attendees', 'file', False, 1,
     ['Ekran 16:9, HDMI i USB-C w każdej sali.', 'Slajdy proszę wgrać na komputer sali 15 min przed sesją.', 'Mikrofon bezprzewodowy w Auli; w salach 0.06 i 1.01 mikrofon stołowy.', 'Osoba obsługi sali pokazuje kartkę „5 min” i „1 min”.']),
    ('Instrukcja bezpieczeństwa dla wolontariuszy', 'staff', 'file', True, 2,
     ['WERSJA 2 (poprawiony numer telefonu dyżurnego).', 'Drogi ewakuacyjne: hol główny → wyjście główne; skrzydło 1 → klatka B.', 'Miejsce zbiórki: parking przed budynkiem.', 'Apteczka: portiernia. AED: hol, przy windzie.', 'Organizator dyżurny: 600 000 001 (dzień 1), 600 000 002 (dzień 2).', 'Nie podajesz nikomu danych uczestników; pytania — punkt informacyjny.']),
    ('Plan ewakuacji — Pasteura 5', 'staff', 'file', True, 1,
     ['Plan ewakuacji budynku — parter i piętro 1.', 'Aula 0.03: dwa wyjścia, do holu i na dziedziniec.', 'Sala 1.01/1.02: klatka B.', 'Osoby na wózkach: winda NIE działa w czasie alarmu; asysta do klatki A.']),
    ('Kontakty dyżurne i kanały', 'staff', 'link', False, 1, 'https://example.org/ddf2026/kontakty-dyzurne'),
    ('Rejestr ryzyka', 'organisers', 'file', False, 1,
     ['Rejestr ryzyka (5×5): prawdopodobieństwo × skutek.', 'Awaria zasilania w Auli — 2×4=8: rzutnik zapasowy, sesja bez slajdów.', 'Reakcja alergiczna na poczęstunku — 3×4=12: oznaczenie 14 alergenów, apteczka, 112.', 'Tłok przy rejestracji 8:30–9:10 — 3×3=9: trzecia osoba na stanowisku, kolejka po nazwisku.', 'Brak sieci przy skanowaniu — 4×2=8: skaner działa offline, synchronizacja później.', 'Nieletni wolontariusz po 22:00 — 2×3=6: rota odmawia; dorosły na tej samej zmianie.']),
    ('Catering — liczba porcji', 'organisers', 'file', False, 1,
     ['Zamówienie na dzień 1: 130 obiadów (standard 96, wege 22, wegańskie 5, bezglutenowe 5, inne 2).', 'Dzień 2: 105 obiadów.', 'Poczęstunek sesji plakatowej: 150 osób.', 'Liczby zagregowane z formularza — bez nazwisk.']),
    ('Protokół przekazania sal', 'venue', 'file', False, 1,
     ['Protokół przekazania sal — Pasteura 5.', 'Odbiór: dzień 1, 7:00. Zdanie: dzień 2, 18:00.', 'Stan: Aula 0.03 — bez uwag; Sala 1.01 — 1 gniazdko uszkodzone (zgłoszone wcześniej).', 'Podpisy: organizator / administracja budynku.']),
]


# ---------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------


def _pdf(lines) -> bytes:
    """A genuine one-page PDF with the given lines of Helvetica text, built by hand so the seed has
    no new dependency. Offsets in the xref are computed, so pdf.js and libmagic both accept it
    (a `%PDF-` header alone would sniff but render nothing). Non-Latin-1 letters are transliterated
    away by the standard font's encoding; good enough for a demo cover sheet."""
    text = '\n'.join(
        f'BT /F1 {14 if i == 0 else 11} Tf 56 {780 - 26 * i} Td ({_pdf_escape(line)}) Tj ET'
        for i, line in enumerate(lines)
    ).encode('latin-1', 'replace')
    stream = zlib.compress(text)
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        b'<< /Length ' + str(len(stream)).encode() + b' /Filter /FlateDecode >>\nstream\n' + stream + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ]
    out = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    for off in offsets:
        out += f'{off:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return bytes(out)


def _pdf_escape(s: str) -> str:
    return s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


_HASH: dict[str, str] = {}


def _account(username: str, display_name: str, password: str, *, affiliation: str = ''):
    """One account. The password hash is computed once per run and shared: 160 PBKDF2 rounds at a
    quarter of a second each is a minute of waiting for demonstration accounts that all carry the
    same password anyway, and a shared salt protects nothing here that a shared password does not
    already give away. Reset on every run, so `--password` means something the second time."""
    if password not in _HASH:
        _HASH[password] = make_password(password)
    user, _ = User.objects.get_or_create(username=username, defaults={'email': f'{username}@edmat.example'})
    if user.password != _HASH[password]:
        user.password = _HASH[password]
        user.save(update_fields=['password'])
    profile = user.profile
    changed = False
    if profile.display_name != display_name:
        profile.display_name = display_name
        changed = True
    if affiliation and profile.bio != affiliation:
        profile.bio = affiliation
        changed = True
    if changed:
        profile.save()
    return user


def _minor(username: str, display_name: str, guardian, password: str):
    """A second minor, made exactly as `testing.personas._child` makes one — the guardian flow's
    five lines, the one path that may mark an account a minor's (`accounts/CLAUDE.md`)."""
    child, _ = User.objects.get_or_create(username=username, defaults={'email': ''})
    child.email = ''
    child.set_password(password)
    child.save()
    profile = child.profile
    profile.is_minor = True
    profile.display_name = display_name
    profile.show_profile_publicly = False
    profile.save()
    Guardianship.objects.update_or_create(guardian=guardian, child=child, defaults={'revoked_at': None})
    return child


class _Clock:
    """Day-one-anchored Warsaw times. `at(day, 'HH:MM')` is aware, in `DEMO_TZ`."""

    def __init__(self, day_one: date):
        self.day_one = day_one
        self.tz = DEMO_TZ
        self.now = timezone.now()

    def at(self, day: int, hhmm, minutes: int = 0):
        if isinstance(hhmm, str):
            h, m = (int(p) for p in hhmm.split(':'))
            hhmm = time(h, m)
        naive = datetime.combine(self.day_one + timedelta(days=day), hhmm) + timedelta(minutes=minutes)
        return timezone.make_aware(naive, self.tz)

    def happened(self, moment) -> bool:
        return moment <= self.now


def _check_rota(plan_rows, people):
    """Refuse a hand-edited plan that breaks the rota's own invariants, in the same words
    `shifts.rules` would use. Cheaper than discovering it on the coverage grid."""
    by_user: dict[str, list] = {}
    for shift, who, status in plan_rows:
        if status in ('dropped', 'no_show'):
            continue
        user = people[who]
        if user.profile.is_minor:
            if not shift.station.minors_permitted:
                raise RuntimeError(f'plan: minor {who} on station {shift.station.name!r} (minor_station)')
            if touches_night(shift.starts_at, shift.ends_at):
                raise RuntimeError(f'plan: minor {who} on a night shift (minor_night)')
            day_hours = sum(
                (s.ends_at - s.starts_at).total_seconds() / 3600
                for s, w, st in plan_rows
                if w == who and st not in ('dropped', 'no_show') and s.starts_at.date() == shift.starts_at.date()
            )
            if day_hours > 7:
                raise RuntimeError(f'plan: minor {who} over the daily cap ({day_hours} h)')
        by_user.setdefault(who, []).append(shift)
    for who, shifts in by_user.items():
        shifts.sort(key=lambda s: s.starts_at)
        for a, b in zip(shifts, shifts[1:]):
            if b.starts_at < a.ends_at:
                raise RuntimeError(f'plan: {who} overlaps {a.station.name} / {b.station.name} (overlap)')
            if b.starts_at - a.ends_at < MIN_GAP:
                raise RuntimeError(f'plan: {who} has less than {MIN_GAP} between shifts (too_close)')
    for shift in {s for s, _, _ in plan_rows}:
        holders = [people[w] for s, w, st in plan_rows if s == shift and st not in ('dropped', 'no_show')]
        if len(holders) > shift.needed:
            raise RuntimeError(f'plan: {shift.station.name} {shift.starts_at:%d %H:%M} over-filled (shift_full)')
        if shift.station.requires_adult and any(h.profile.is_minor for h in holders) and not any(
            not h.profile.is_minor for h in holders
        ):
            raise RuntimeError(f'plan: minor alone on {shift.station.name} (needs_adult)')


# ---------------------------------------------------------------------------------------------
# The build
# ---------------------------------------------------------------------------------------------


def make_conference_demo(password: str = DEFAULT_PASSWORD, *, day_one: date | None = None) -> dict:
    """Build (or rebuild) the demo conference. Returns the accounts and the main rows, plus a
    `report` dict of counts for the command to print."""
    global _rng
    _rng = random.Random(20261014)  # the same names every run, whatever ran before in this process

    personas = make_personas(password)
    organiser, reviewer, volunteer = personas['organiser'], personas['reviewer'], personas['volunteer']
    clock = _Clock(day_one or timezone.now().astimezone(DEMO_TZ).date())
    report: dict[str, int | str] = {}

    # --- People beyond the personas ---------------------------------------------------------
    people = {
        'organiser': organiser, 'reviewer': reviewer, 'volunteer': volunteer,
        'attendee': personas['attendee'], 'guardian': personas['guardian'], 'child': personas['child'],
    }
    people['venue_admin'] = _account('persona.venue_admin', 'Jan Administrator', password)
    people['porter'] = _account('persona.porter', 'Zofia Portier', password)
    people['clerk'] = _account('persona.clerk', 'Ola Clerk', password)
    for suffix, name in VOLUNTEERS.items():
        people[suffix] = _account(f'{PREFIX}{suffix}', name, password)
    people['guardian.02'] = _account(f'{PREFIX}guardian.02', 'Renata Wieczorek', password)
    people['child.02'] = _minor(f'{PREFIX}{MINOR_VOLUNTEER_2[0]}', MINOR_VOLUNTEER_2[1], people['guardian.02'], password)

    names = _person_names(N_ATTENDEE_ACCOUNTS)
    attendees = []
    for i, name in enumerate(names, start=1):
        affiliation = _weighted(_AFFILIATIONS)
        attendees.append(_account(f'{PREFIX}attendee.{i:03d}', name, password, affiliation=affiliation))

    # --- The venue ------------------------------------------------------------------------------
    venue, _ = Venue.objects.update_or_create(slug=DEMO_VENUE_SLUG, defaults={**VENUE, 'is_active': True})
    VenueStaff.objects.update_or_create(venue=venue, user=people['venue_admin'], defaults={'role': 'administrator', 'added_by': None})
    VenueStaff.objects.update_or_create(venue=venue, user=people['porter'], defaults={'role': 'porter', 'added_by': people['venue_admin']})
    rooms = {}
    for name, number, floor, seated, fire, av, acc, notes in ROOMS:
        room, _ = Room.objects.update_or_create(
            venue=venue, name=name,
            defaults={'number': number, 'floor': floor, 'seated_capacity': seated, 'fire_capacity': fire,
                      'has_av': av, 'accessible': acc, 'notes': notes, 'is_active': True},
        )
        room.full_clean()
        rooms[name] = room

    # --- The event -------------------------------------------------------------------------------
    starts = clock.at(0, '08:00')
    ends = clock.at(1, '16:00')
    event, _ = Event.objects.get_or_create(host=organiser, title=DEMO_TITLE, defaults={'status': 'published', 'visibility': 'public'})
    event.summary = 'Dwudniowa konferencja o uczeniu fizyki — wykłady, warsztaty, sesja plakatowa. Wstęp wolny, rejestracja obowiązkowa.'
    event.description = (
        'Dni Dydaktyki Fizyki to spotkanie nauczycieli, studentów i pracowników uczelni o tym, jak uczyć fizyki: '
        'od liceum po pierwszy rok studiów. Dwa dni, trzy sale, sesja plakatowa z poczęstunkiem pierwszego dnia wieczorem.\n\n'
        'To jest konferencja demonstracyjna: wszystkie osoby, wystąpienia i liczby są zmyślone, '
        'a konta uczestników mają adresy w domenie edmat.example, która nie odbiera poczty.\n\n'
        'This is a demonstration conference: every person, talk and figure is invented.'
    )
    event.status = 'published'
    event.visibility = 'public'
    event.audience = 'all'
    event.language = 'pl'
    event.starts_at = starts
    event.runs_until = ends
    event.duration_minutes = 10 * 60
    event.location_kind = 'onsite'
    event.location_text = 'Wydział Fizyki UW, ul. Pasteura 5, Warszawa — Aula 0.03 i sale 0.06, 1.01'
    event.capacity = CAPACITY
    event.registration_mode = 'form'
    event.show_attendees_publicly = True
    event.cfp_open = False
    event.cfp_deadline = starts - timedelta(days=45)
    event.full_clean()
    event.save()

    # Staff. The host's organiser row comes from `Event.save()`.
    EventStaff.objects.update_or_create(event=event, user=reviewer, defaults={'role': 'reviewer', 'added_by': organiser})
    volunteer_keys = ['volunteer', 'clerk', 'child', 'child.02', *VOLUNTEERS.keys()]
    for key in volunteer_keys:
        EventStaff.objects.update_or_create(event=event, user=people[key], defaults={'role': 'volunteer', 'added_by': organiser})
    # Consent for the minor who volunteers; none for the second minor, on purpose.
    VolunteerRecord.objects.update_or_create(
        event=event, user=people['child'],
        defaults={'consent_recorded_at': starts - timedelta(days=12), 'consent_recorded_by': organiser,
                  'consent_note': 'Zgoda opiekunki (Ewa Guardian) na piśmie, w teczce organizatora.',
                  'emergency_contact_note': 'Opiekunka: Ewa Guardian, tel. w teczce.'},
    )
    VolunteerRecord.objects.update_or_create(
        event=event, user=people['child.02'],
        defaults={'consent_recorded_at': None, 'consent_recorded_by': None,
                  'consent_note': 'Zgoda obiecana, jeszcze nie dotarła.', 'emergency_contact_note': ''},
    )

    # --- Bookings and the checklist (rebuilt) ---------------------------------------------------
    RoomBooking.objects.filter(event=event).delete()
    bookings = [
        ('Aula 0.03', 0, '08:00', '18:00', 'approved', 240, 'Sesje plenarne i panel', ''),
        ('Aula 0.03', 1, '08:30', '16:00', 'approved', 200, 'Sesje plenarne, zamknięcie', ''),
        ('Hol główny', 0, '07:00', '21:00', 'approved', 150, 'Rejestracja, szatnia, przerwy, sesja plakatowa', 'Stojaki na plakaty z magazynu 0.22.'),
        ('Hol główny', 1, '07:30', '18:00', 'approved', 150, 'Rejestracja, szatnia, przerwy', ''),
        ('Sala 0.06', 0, '10:00', '16:00', 'approved', 100, 'Sesja dydaktyczna', ''),
        ('Sala 0.06', 1, '10:00', '12:30', 'approved', 100, 'Sesja dydaktyczna', ''),
        ('Sala 1.01', 0, '13:00', '16:00', 'approved', 24, 'Warsztat Arduino', ''),
        ('Sala 1.01', 1, '10:00', '13:00', 'approved', 20, 'Warsztat EdMat', ''),
        ('Sala seminaryjna 1.40', 1, '13:00', '15:00', 'requested', 12, 'Spotkanie komitetu programowego', ''),
        ('Sala 1.02', 0, '10:00', '16:00', 'rejected', 40, 'Rezerwa na drugą sesję równoległą', 'Sala zajęta przez zajęcia kursowe do 16:00; proszę spróbować 1.40.'),
    ]
    for room_name, day, s, e, status, headcount, purpose, note in bookings:
        decided = status != 'requested'
        booking = RoomBooking(
            event=event, room=rooms[room_name], starts_at=clock.at(day, s), ends_at=clock.at(day, e), status=status,
            expected_headcount=headcount, purpose=purpose, note=note, requested_by=organiser,
            decided_by=people['venue_admin'] if decided else None,
            decided_at=(starts - timedelta(days=20)) if decided else None,
        )
        booking.full_clean()
        booking.save()

    ChecklistInstance.objects.filter(event=event, venue=venue).delete()
    template = ChecklistTemplate.objects.filter(venue__isnull=True, name=TEMPLATE_NAME, is_active=True).first()
    checklist = None
    if template is not None:
        checklist = instantiate(event, venue, template, created_by=people['venue_admin'])
        items = list(checklist.items.order_by('order', 'id'))
        # In order of the template: -30 d, -14 d, -1 d, -2 h, +3 h, +1 d.
        plans = [
            ('done', 'Zgłoszenie z listą sal i szacowaną liczbą 150 osób złożone w administracji.', 'https://example.org/ddf2026/zgloszenie', True),
            ('done', 'Potwierdzenie: Aula 0.03 — 240 miejsc siedzących, ewakuacyjnie 300. Poniżej progu imprezy masowej.', '', True),
            ('done', 'Instrukcja BHP (wersja 2) i plan ewakuacji wgrane; 13 z 15 wolontariuszy potwierdziło.', '', False),
            ('in_progress', 'Obchód sal rozpoczęty 7:10; Aula i 0.06 odebrane, 1.01 czeka na klucz.', '', False),
            ('pending', '', '', False),
            ('pending', '', '', False),
        ]
        for item, (status, text, url, signed) in zip(items, plans):
            item.status = status
            item.evidence_text = text
            item.evidence_url = url
            if status in ('done', 'in_progress'):
                item.done_by = organiser
                item.done_at = min(clock.now, (item.computed_due_at or clock.now) - timedelta(hours=3))
            if signed and item.requires_venue_signoff:
                item.signed_off_by = people['venue_admin']
                item.signed_off_at = item.done_at + timedelta(hours=5)
            item.save()
        report['checklist_items'] = len(items)

    # --- Programme -------------------------------------------------------------------------------
    tracks = {}
    for order, (name, colour) in enumerate(TRACKS):
        track, _ = Track.objects.update_or_create(event=event, name=name, defaults={'colour': colour, 'order': order})
        tracks[name] = track
    sessions = {}
    for order, (day, hhmm, minutes, kind, track_name, room, title, abstract, capacity, speakers) in enumerate(PROGRAMME):
        session, _ = Session.objects.get_or_create(event=event, title=title, defaults={'starts_at': clock.at(day, hhmm), 'kind': kind})
        session.track = tracks[track_name] if track_name else None
        session.kind = kind
        session.starts_at = clock.at(day, hhmm)
        session.duration_minutes = minutes
        session.location_text = room
        session.abstract = abstract
        session.capacity = capacity
        session.order = order
        session.full_clean()
        session.save()
        sessions[title] = session
        session.speakers.all().delete()
        for pos, speaker in enumerate(speakers):
            if isinstance(speaker, str):
                user = people[speaker]
                SessionSpeaker.objects.create(session=session, user=user, name=user.profile.display_name,
                                              affiliation='Wydział Fizyki UW', order=pos)
            else:
                SessionSpeaker.objects.create(session=session, name=speaker[0], affiliation=speaker[1], order=pos)
    for title, role, label, url in SESSION_LINKS:
        SessionLink.objects.update_or_create(session=sessions[title], url=url, defaults={'role': role, 'label': label})
    report['sessions'] = len(sessions)

    # --- Registration ----------------------------------------------------------------------------
    fields = {}
    for order, (label, kind, required, options) in enumerate([
        ('Afiliacja (szkoła / uczelnia / instytucja)', 'text', True, []),
        ('Jestem', 'choice', True, [r for r, _ in _ROLES]),
        ('Dieta (obiad i poczęstunek)', 'choice', False, [d for d, _ in _DIETS]),
        ('Wezmę udział w sesji plakatowej z poczęstunkiem', 'checkbox', False, []),
    ]):
        field, _ = RegistrationField.objects.update_or_create(
            event=event, label=label, defaults={'kind': kind, 'required': required, 'options': options, 'order': order}
        )
        fields[order] = field

    def answers_for(user):
        needs = _rng.choice(_NEEDS) if _rng.random() < 0.04 else ''
        return {
            str(fields[0].pk): user.profile.bio or 'Wydział Fizyki UW',
            str(fields[1].pk): _weighted(_ROLES),
            str(fields[2].pk): _weighted(_DIETS),
            str(fields[3].pk): _rng.random() < 0.7,
            '_attendance_mode': 'onsite',
            '_needs': needs,
        }

    statuses = (['going'] * N_GOING + ['promoted'] * N_PROMOTED + ['waitlisted'] * N_WAITLISTED
                + ['not_going'] * N_NOT_GOING)
    statuses += ['not_going'] * (N_ATTENDEE_ACCOUNTS - len(statuses))
    going_rows = []
    for i, (user, status) in enumerate(zip(attendees, statuses)):
        row, _ = EventAttendance.objects.update_or_create(
            event=event, attendee=user,
            defaults={'status': status, 'answers': answers_for(user), 'note': '',
                      'waitlisted_at': starts - timedelta(days=9, hours=i) if status in ('waitlisted', 'promoted') else None,
                      'promotion_expires_at': clock.now + timedelta(hours=6 + i) if status == 'promoted' else None,
                      'checked_in_at': None, 'checked_in_by': None, 'checked_out_at': None},
        )
        if status in ('going', 'promoted'):
            ensure_ticket(row)
        if status == 'going':
            going_rows.append(row)
    for user, registered_by in ((personas['attendee'], None), (personas['child'], personas['guardian'])):
        row, _ = EventAttendance.objects.update_or_create(
            event=event, attendee=user,
            defaults={'status': 'going', 'registered_by': registered_by, 'answers': answers_for(user),
                      'checked_in_at': None, 'checked_in_by': None, 'checked_out_at': None},
        )
        ensure_ticket(row)
        going_rows.insert(0, row)
    report['registered'] = event.attendances.count()
    report['going'] = len(going_rows)
    report['waitlisted'] = N_WAITLISTED

    # The capped workshops: day one full, day two with seats left.
    SessionAttendance.objects.filter(session__event=event).delete()
    for title, n in (('Warsztat: Arduino w pracowni fizycznej', 24), ('Warsztat: Tworzenie zadań z rozwiązaniami dla EdMat', 14)):
        for row in going_rows[:n]:
            SessionAttendance.objects.get_or_create(session=sessions[title], attendance=row)
    for title in ('Fizyka kwantowa w liceum — co da się uczciwie powiedzieć', 'Warsztat: Arduino w pracowni fizycznej', 'Panel: Czy wykład jeszcze ma sens?'):
        SessionBookmark.objects.get_or_create(user=personas['attendee'], session=sessions[title])

    # The call: decided rows written directly (no notification on a re-run), scheduled ones
    # pointing at the programme session that came out of them.
    for idx, kind, title, abstract, status, reason, note, session_title in CONTRIBUTIONS:
        submitter = attendees[idx]
        decided = status in ('accepted', 'rejected', 'scheduled')
        Contribution.objects.update_or_create(
            event=event, submitter=submitter, title=title,
            defaults={'kind': kind, 'abstract': abstract, 'audience': 'all', 'status': status,
                      'reason_code': reason, 'review_note': note,
                      'session': sessions[session_title] if session_title else None,
                      'decided_by': reviewer if decided else None,
                      'decided_at': starts - timedelta(days=30) if decided else None,
                      'submitted_at': starts - timedelta(days=50 + idx)},
        )
    report['contributions'] = len(CONTRIBUTIONS)

    # --- Documents -------------------------------------------------------------------------------
    doc_rows = {}
    for title, tier, kind, ack, version, payload in DOCUMENTS:
        versions = [version] if version == 1 else [1, version]
        previous = None
        for v in versions:
            doc = EventDocument.objects.filter(event=event, title=title, version=v).first()
            if doc is None:
                doc = EventDocument(event=event, title=title, kind=kind, visibility=tier, requires_acknowledgement=ack,
                                    version=v, uploaded_by=organiser)
                if kind == 'link':
                    doc.url = payload
                    doc.save()
                else:
                    lines = payload if v == version else [payload[0], 'WERSJA 1 — nieaktualna.', *payload[2:]]
                    content = _pdf(lines)
                    doc.content_type = 'application/pdf'
                    doc.byte_size = len(content)
                    doc.scanned = False
                    doc.scan_detail = 'no scanner on this machine (demo)'
                    doc.save()
                    doc.file.save(f'{title[:20]}.pdf', ContentFile(content), save=True)
            else:
                doc.visibility, doc.requires_acknowledgement = tier, ack
                doc.removed_at, doc.removed_by = None, None
                doc.save(update_fields=['visibility', 'requires_acknowledgement', 'removed_at', 'removed_by'])
            if previous is not None and previous.replaced_by_id != doc.pk:
                previous.replaced_by = doc
                previous.save(update_fields=['replaced_by'])
            previous = doc
        doc_rows[title] = previous
    report['documents'] = len(doc_rows)

    # The acknowledgement ledger. Everybody on staff has read both mandatory documents at their
    # current version, except: `clerk` (never), `child.02` (never), `volunteer.09` (read version 1
    # of the briefing, not the corrected version 2 — the stale-acknowledgement case).
    briefing = doc_rows['Instrukcja bezpieczeństwa dla wolontariuszy']
    briefing_v1 = EventDocument.objects.get(event=event, title=briefing.title, version=1)
    evacuation = doc_rows['Plan ewakuacji — Pasteura 5']
    readers = ['organiser', 'reviewer', 'volunteer', 'child', *VOLUNTEERS.keys()]
    for key in readers:
        user = people[key]
        if key == 'volunteer.09':
            DocumentAcknowledgement.objects.get_or_create(document=briefing_v1, user=user, version=1)
        else:
            DocumentAcknowledgement.objects.get_or_create(document=briefing, user=user, version=briefing.version)
        DocumentAcknowledgement.objects.get_or_create(document=evacuation, user=user, version=evacuation.version)
    DocumentAcknowledgement.objects.filter(document__in=[briefing, briefing_v1, evacuation],
                                           user__in=[people['clerk'], people['child.02']]).delete()

    # --- Rota (rebuilt) -------------------------------------------------------------------------
    Station.objects.filter(event=event).delete()
    stations = {}
    for order, (name, kind, location, briefing_note, minors, adult, confirm) in enumerate(STATIONS):
        station = Station(event=event, name=name, kind=kind, location_text=location, briefing_note=briefing_note,
                          minors_permitted=minors, requires_adult=adult, needs_confirmation=confirm, order=order)
        station.full_clean()
        station.save()
        stations[name] = station
    shifts = {}
    for station_name, day, s, e, needed, note in SHIFTS:
        shift = Shift(station=stations[station_name], starts_at=clock.at(day, s), ends_at=clock.at(day, e), needed=needed, note=note)
        shift.full_clean()
        shift.save()
        shifts[(station_name, day, s)] = shift
    plan_rows = [(shifts[key], who, status) for key, rows in ASSIGNMENTS.items() for who, status, _ in rows]
    _check_rota(plan_rows, people)
    n_done = n_short = 0
    for key, rows in ASSIGNMENTS.items():
        shift = shifts[key]
        for who, status, source in rows:
            user = people[who]
            ended = clock.happened(shift.ends_at)
            if status is None:
                status = 'done' if ended else 'confirmed'
            elif status == 'no_show' and not ended:
                status = 'confirmed'
            row = Assignment(shift=shift, user=user, status=status, source=source)
            if status in ('confirmed', 'done', 'no_show'):
                row.confirmed_by = organiser if source == 'organiser' else None
                row.confirmed_at = shift.starts_at - timedelta(days=5)
            if status == 'dropped':
                row.dropped_at = shift.starts_at - timedelta(days=1, hours=2)
                row.drop_reason = 'Choroba — przepraszam, zgłaszam dzień wcześniej.'
            if status == 'done':
                row.hours_credited = shift.hours
                row.credited_by = organiser
                row.credited_at = shift.ends_at + timedelta(minutes=20)
                n_done += 1
            row.save()
        if sum(1 for _, st, _ in rows if st not in ('dropped', 'no_show', 'offered')) < shift.needed:
            n_short += 1
    report['stations'], report['shifts'], report['shifts_done'], report['shifts_short'] = len(stations), len(shifts), n_done, n_short

    # --- Door scans (day one, up to now) ---------------------------------------------------------
    ScanEvent.objects.filter(event=event).delete()
    door_staff = [volunteer, people['volunteer.01'], people['volunteer.03']]
    arrivals = []
    for i, row in enumerate(going_rows[:DAY_ONE_CHECKED_IN]):
        # Peak 30–70 min after opening; a tail through lunch.
        offset = int(_rng.triangular(0, 330, 45))
        arrivals.append((clock.at(0, DAY_ONE_DOOR_START, offset), row.ticket_token, i))
    arrivals.sort()
    def nonce(tag: str) -> str:
        return f'demo-{event.pk}-{tag}'  # deterministic: the same scan on a re-run is the same row

    batches: dict[int, list] = {}
    for moment, token, i in arrivals:
        if not clock.happened(moment):
            continue
        batches.setdefault(moment.hour, []).append({
            'token': token, 'direction': 'entry', 'client_nonce': nonce(f'in-{i}'), 'client_at': moment,
            'device_label': 'Drzwi A' if i % 3 else 'Drzwi B', 'is_offline_sync': i % 7 == 0,
        })
    if arrivals and batches:
        # The extras: a second scan of an admitted ticket in the same batch (collision), the same
        # a batch later (already_in), two tokens nobody issued, three people out for lunch.
        first_hour = min(batches)
        first = batches[first_hour]
        dup = dict(first[0], client_nonce=nonce('collision'), client_at=first[0]['client_at'] + timedelta(seconds=40), device_label='Drzwi B')
        first.append(dup)
        later_hour = max(batches)
        for n, entry in enumerate(first[1:5]):
            batches[later_hour].append(dict(entry, client_nonce=nonce(f'again-{n}'), client_at=entry['client_at'] + timedelta(hours=1, minutes=7 * n)))
        for n in range(2):
            batches[later_hour].append({'token': f'nobody-{n}-xxxxxxxxxxxxxxxxxxxxxxxx', 'direction': 'entry', 'client_nonce': nonce(f'unknown-{n}'),
                                        'client_at': first[0]['client_at'] + timedelta(minutes=20 + n), 'device_label': 'Drzwi A', 'is_offline_sync': False})
        lunch = clock.at(0, '12:20')
        if clock.happened(lunch):
            for n, entry in enumerate(first[5:8]):
                batches.setdefault(12, []).append(dict(entry, direction='exit', client_nonce=nonce(f'out-{n}'), client_at=lunch + timedelta(minutes=3 * n)))
            for n, entry in enumerate(first[5:7]):
                batches.setdefault(13, []).append(dict(entry, client_nonce=nonce(f'back-{n}'), client_at=clock.at(0, '13:25', 2 * n)))
    scans_written = 0
    for hour in sorted(batches):
        scanner = door_staff[hour % len(door_staff)]
        scans_written += len(apply_batch(event, scanner, batches[hour]))
    report['scans'] = scans_written
    report['checked_in'] = event.attendances.filter(checked_in_at__isnull=False).count()

    # --- Cloakroom (rebuilt, up to now) ----------------------------------------------------------
    CloakroomDesk.objects.filter(event=event).delete()
    desk = CloakroomDesk.objects.create(
        event=event, name=DESK_NAME, rack_labels=RACKS, status='open', created_by=organiser,
        opens_note='Czynna 8:00–21:00 (dzień 1), 8:30–16:30 (dzień 2). Rzeczy nieodebrane po zamknięciu — portiernia.',
    )
    clerks = [people['volunteer.07'], people['volunteer.09']]
    racks = list(RACKS)
    _rng.shuffle(racks)
    deposits = sorted((clock.at(0, '08:10', int(_rng.triangular(0, 150, 35))), racks[n]) for n in range(N_DEPOSITS))
    items = []
    for n, (moment, rack) in enumerate(deposits):
        if not clock.happened(moment):
            break
        item = desk.items.create(rack_label=rack, token=desk.new_token(), description=_rng.choice(_ITEMS), deposited_by=clerks[n % 2])
        desk.items.filter(pk=item.pk).update(deposited_at=moment)
        items.append(item)
    returned = 0
    for n, item in enumerate(items[:N_LUNCH_RETURNS]):
        moment = clock.at(0, '12:25', 4 * n)
        if clock.happened(moment) and hand_back(item, clerks[1]):
            desk.items.filter(pk=item.pk).update(returned_at=moment)
            returned += 1
    exceptions = 0
    for n, item in enumerate(items[N_LUNCH_RETURNS:N_LUNCH_RETURNS + 2]):
        moment = clock.at(0, '13:05', 9 * n)
        if clock.happened(moment) and return_by_exception(
            item, clerks[0], description=item.description + ', zgubiony kwitek',
            identity_kind='student_card' if n == 0 else 'id_document',
            note='Opis zgadza się z wieszakiem; okazano legitymację. Kwitek unieważniony.',
        ):
            desk.items.filter(pk=item.pk).update(returned_at=moment)
            exceptions += 1
    report['coats_stored'] = len(items) - returned - exceptions
    report['coats_returned'] = returned
    report['coats_exception'] = exceptions

    # --- Posts, exports --------------------------------------------------------------------------
    EventPost.objects.filter(event=event, author=organiser).delete()
    for body, when in (
        ('Zmiana sali: wykład „Ocenianie kształtujące na ćwiczeniach z mechaniki” odbędzie się w Sali 0.06 (nie 1.02). Program zaktualizowany.', starts - timedelta(days=2, hours=5)),
        ('Warsztat Arduino jest już pełny (24/24). Kto nie dostał miejsca — zapraszamy na warsztat EdMat w dzień 2, zostało 6 miejsc.', starts - timedelta(hours=20)),
    ):
        post = EventPost.objects.create(event=event, author=organiser, body=body)
        EventPost.objects.filter(pk=post.pk).update(created_at=when)
    ExportLog.objects.filter(event=event).delete()
    log_export(event, organiser, 'door_list', rows=len(going_rows))
    ExportLog.objects.filter(event=event).update(created_at=starts - timedelta(hours=14))
    log_export(event, organiser, 'full_csv', rows=report['registered'])

    report['day_one'] = clock.day_one.isoformat()
    report['in_progress'] = bool(clock.at(0, '08:00') <= clock.now <= ends)

    # Last, so it sees the finished thing: every role this function handed out is in place by now,
    # and the caller's `transaction.atomic()` means a refusal here leaves no conference at all.
    report['containment'] = assert_contained(event, venue)
    return {
        **people, 'attendees': attendees, 'event': event, 'venue': venue, 'rooms': rooms, 'checklist': checklist,
        'sessions': sessions, 'tracks': tracks, 'stations': stations, 'shifts': shifts, 'desk': desk,
        'documents': doc_rows, 'password': password, 'report': report, 'clock': clock,
    }


#: Every model in this project through which one account gains authority over something, as
#: (label, model path, the field naming what the authority is *over*). A demo account is allowed a
#: row here only when the thing it points at is this conference's own event or its own venue —
#: anything else is authority that leaked out of the sandbox. Listed explicitly rather than
#: discovered by walking `_meta`: a new authority model should have to be thought about here once,
#: which is a deliberate reminder, not an oversight.
CONTAINMENT_MODELS = (
    ('EventStaff', 'events.models.EventStaff', 'event'),
    ('VenueStaff', 'venues.models.VenueStaff', 'venue'),
    ('CourseStaff', 'courses.models.CourseStaff', None),
    ('OrganizationMember', 'organizations.models.OrganizationMember', None),
    ('ProjectMember', 'coauthoring.models.ProjectMember', None),
    ('NodeGovernor', 'moderation.models.NodeGovernor', None),
)


def seeded_accounts():
    """Every account the two conference seeders own — the personas and this module's `conf.*`."""
    return User.objects.filter(Q(username__startswith=PREFIX) | Q(username__startswith='persona.'))


def assert_contained(event, venue) -> dict:
    """Refuse to hand back a demo whose accounts can reach anything outside it.

    A demonstration conference is seeded onto the *live* database, beside real events and real
    people, so "these are only demo accounts" is a claim about permissions and not about intent.
    Checked rather than assumed, and checked here rather than only in a test, because the test runs
    on a machine where nothing is at stake and this runs where everything is: the whole
    build is inside one `transaction.atomic()`, so raising rolls the conference back rather than
    leaving a half-privileged one behind.

    Three kinds of reach, all of them real:

    - **Platform-wide.** `is_staff` opens `/moderation`, every feature flag's `is_staff` bypass and
      the Django admin; `is_superuser` needs no explanation. Groups and per-user permissions are the
      quieter versions of the same thing.
    - **Another object of the same kind.** An `EventStaff` row on somebody else's event, a
      `VenueStaff` row on a real building.
    - **A different surface entirely.** A course, an organisation, a co-authored material, or a
      `NodeGovernor` row — none of which this seeder creates, so any row found is a collision with
      a username that already existed and meant somebody real.
    """
    from importlib import import_module

    accounts = list(seeded_accounts())
    if not accounts:  # nothing seeded yet is not "nothing leaked"
        raise RuntimeError('Containment check found no seeded accounts at all — the seeder did not run.')

    leaks = []
    for user in accounts:
        if user.is_staff or user.is_superuser:
            flags = ', '.join(n for n, v in (('is_staff', user.is_staff), ('is_superuser', user.is_superuser)) if v)
            leaks.append(f'{user.username}: {flags}')
        if user.groups.exists():
            leaks.append(f'{user.username}: in group(s) {", ".join(user.groups.values_list("name", flat=True))}')
        if user.user_permissions.exists():
            leaks.append(f'{user.username}: {user.user_permissions.count()} direct permission(s)')

    # Both seeders' events count as inside, and the membership test is the marker itself: a role is
    # allowed only on an event whose title says it is fake. That ties the two guarantees together —
    # widening containment now means marking another event as demonstration data, in public, which
    # is a thing somebody has to mean. The first run of this check found exactly this case: the
    # personas hold roles on the Sandbox conference, which is seeded and marked but is not the
    # event being built here.
    allowed = {
        'event': set(Event.objects.filter(title__startswith=FAKE_PREFIX).values_list('pk', flat=True)),
        'venue': {venue.pk},
    }
    if event.pk not in allowed['event']:  # belt and braces: the marker is what is being trusted
        raise RuntimeError(f'The demo event {event.title!r} does not carry the {FAKE_PREFIX!r} marker.')
    for label, path, scope_field in CONTAINMENT_MODELS:
        module_path, _, class_name = path.rpartition('.')
        model = getattr(import_module(module_path), class_name)
        rows = model.objects.filter(user__in=accounts)
        if scope_field is not None:
            rows = rows.exclude(**{f'{scope_field}_id__in': allowed[scope_field]})
        for row in rows.select_related('user')[:20]:
            leaks.append(f'{row.user.username}: {label} row #{row.pk} outside this conference')

    if leaks:
        raise RuntimeError(
            'The demo conference would have given its accounts authority outside itself, so it was '
            'not created. Offending rows:\n  - ' + '\n  - '.join(leaks) + '\n'
            'This almost always means a seeded username collided with a real account. Rename the '
            'demo prefix, or remove the real account\u2019s row, and seed again.'
        )
    return {'accounts_checked': len(accounts), 'surfaces_checked': len(CONTAINMENT_MODELS) + 2}


def remove_conference_demo() -> dict:
    """Undo: the event (everything hangs off it), the venue (rooms, bookings, checklist), and every
    `conf.*` account. Persona accounts stay — they belong to `make_personas`. Files under
    `media/event-documents/` are removed with their rows by the storage backend."""
    counts = {}
    for doc in EventDocument.objects.filter(event__title=DEMO_TITLE, event__host__username='persona.organiser'):
        if doc.file:
            doc.file.delete(save=False)
    counts['events'] = Event.objects.filter(title=DEMO_TITLE, host__username='persona.organiser').delete()[0]
    counts['venues'] = Venue.objects.filter(slug=DEMO_VENUE_SLUG).delete()[0]
    counts['accounts'] = User.objects.filter(username__startswith=PREFIX).delete()[0]
    return counts
