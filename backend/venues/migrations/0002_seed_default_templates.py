"""The four bilingual starter checklists, as platform defaults.

Straight from `CONFERENCE-RESEARCH-REPORT.md` §6.4 and its Polish appendix — the report's own
operationalisation of UW Zarządzenie nr 110, the fire-safety regulations, the mass-event threshold
and the child-protection standards. **Both reports' legal citations are unverified**
(CONFERENCE-BRIEF.md §1 says so, and `LEGAL.md` carries the caveat): these are a building's starting
point for a conversation with its own administration, not a statement of law. A venue edits its own
copy; nothing here is enforced by code.

Seeded as **platform defaults** (`venue = NULL`) rather than per venue, which is what makes the
feature useful to the very first building that signs up and has written nothing: it picks one of
these, and it is offered on every event.

Idempotent by `(venue IS NULL, name)` — re-running adds nothing, and a default whose items an
administrator has since edited is left exactly as it is.

Offsets are signed minutes. Negative is before the anchor, positive after; `anchor='end'` measures
from the event's own end, which is what makes "T + 1 day" land after a two-day conference finishes.
"""

from django.db import migrations

DAY = 24 * 60

TEMPLATES = [
    {
        'name': 'One-room guest lecture',
        'description': (
            'A single hall, one speaker, one afternoon. UW Zarządzenie nr 110 § 2 and the '
            'faculty room-reservation rules, as read by CONFERENCE-RESEARCH-REPORT.md §6.4 — '
            'the citations there are unverified and this is a starting point, not legal advice.'
        ),
        'event_kind_hint': 'lecture',
        'items': [
            {
                'title_en': 'Reserve the lecture hall and verify its seated capacity.',
                'title_pl': 'Rezerwacja sali wykładowej i weryfikacja liczby miejsc siedzących.',
                'description_en': (
                    'File the reservation with the seat count recorded in the building’s fire '
                    'safety instruction (IBP), not the number of chairs in the room.'
                ),
                'description_pl': (
                    'Złożenie wniosku o rezerwację auli z uwzględnieniem liczby miejsc '
                    'siedzących określonych w Instrukcji Bezpieczeństwa Pożarowego.'
                ),
                'due_offset_minutes': -14 * DAY,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'text',
                'requires_venue_signoff': True,
            },
            {
                'title_en': 'Test the audio-visual equipment and guest Wi-Fi access.',
                'title_pl': 'Weryfikacja sprawności sprzętu AV oraz dostępu do sieci Wi-Fi dla gości.',
                'description_en': (
                    'Projector, sound, radio microphones, and a guest account on the wireless '
                    'network.'
                ),
                'description_pl': (
                    'Sprawdzenie rzutnika, nagłośnienia, mikrofonów bezprzewodowych oraz '
                    'konfiguracji kont gościnnych w sieci Wi-Fi.'
                ),
                'due_offset_minutes': -2 * DAY,
                'anchor': 'start',
                'is_mandatory': False,
                'na_allowed': True,
                'evidence_kind': 'none',
                'requires_venue_signoff': False,
            },
            {
                'title_en': (
                    'Display the GDPR Art. 13 photography and recording notice at the entrance.'
                ),
                'title_pl': (
                    'Wywieszenie klauzuli informacyjnej RODO (art. 13) o rejestracji foto/wideo '
                    'przy wejściu do sali.'
                ),
                'description_en': 'UODO event guidance and Art. 81 of the copyright act.',
                'description_pl': 'Wytyczne UODO oraz art. 81 Prawa autorskiego.',
                'due_offset_minutes': -60,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': True,
                'evidence_kind': 'none',
                'requires_venue_signoff': False,
            },
            {
                'title_en': 'Put the hall back as it was and return the keys.',
                'title_pl': 'Przywrócenie pierwotnego układu sali i zdanie kluczy na portierni.',
                'description_en': (
                    'Equipment off, windows shut, furniture back, key handed in at the lodge.'
                ),
                'description_pl': (
                    'Wyłączenie aparatury multimedialnej, zamknięcie okien, przywrócenie układu '
                    'sali i zwrot klucza do portierni.'
                ),
                'due_offset_minutes': 60,
                'anchor': 'end',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'none',
                'requires_venue_signoff': True,
            },
        ],
    },
    {
        'name': 'One-day workshop with catering',
        'description': (
            'Food, deliveries and a foyer. Campus BHP rules, security-service vehicle access and '
            'the waste protocols, per CONFERENCE-RESEARCH-REPORT.md §6.4.'
        ),
        'event_kind_hint': 'workshop',
        'items': [
            {
                'title_en': (
                    'Notify the catering company and verify the electrical capacity for warming '
                    'units.'
                ),
                'title_pl': (
                    'Zgłoszenie firmy cateringowej i weryfikacja dopuszczalnego obciążenia '
                    'instalacji elektrycznej dla podgrzewaczy.'
                ),
                'description_en': 'Campus technical infrastructure and fire safety regulations.',
                'description_pl': 'Przepisy techniczne kampusu i ochrony przeciwpożarowej.',
                'due_offset_minutes': -10 * DAY,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': True,
                'evidence_kind': 'text',
                'requires_venue_signoff': True,
            },
            {
                'title_en': (
                    'Submit delivery vehicle registrations for loading-dock gate access.'
                ),
                'title_pl': (
                    'Zgłoszenie numerów rejestracyjnych pojazdów dostawczych do Straży '
                    'Uniwersyteckiej (przepustka wjazdowa).'
                ),
                'description_en': 'Registration numbers and drivers, to the university guard.',
                'description_pl': 'Numery rejestracyjne i dane kierowców — Straż Uniwersytecka.',
                'due_offset_minutes': -3 * DAY,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': True,
                'evidence_kind': 'text',
                'requires_venue_signoff': True,
            },
            {
                'title_en': 'Check that escape routes in the catering and foyer zones are clear.',
                'title_pl': (
                    'Kontrola drożności ciągów ewakuacyjnych w strefie cateringu i foyer.'
                ),
                'description_en': (
                    'Buffet tables must not narrow a corridor below its required evacuation width '
                    '(Rozporządzenie MSWiA § 4).'
                ),
                'description_pl': (
                    'Bufet i stoliki koktajlowe nie mogą zawężać wymaganej szerokości korytarzy '
                    'ewakuacyjnych (Rozporządzenie MSWiA § 4).'
                ),
                'due_offset_minutes': -60,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'none',
                'requires_venue_signoff': True,
            },
            {
                'title_en': 'Clear the waste, sorted, and clean the foyer afterwards.',
                'title_pl': (
                    'Protokół uprzątnięcia odpadów pocateringowych i selektywna zbiórka śmieci '
                    'w foyer.'
                ),
                'description_en': 'Municipal waste obligations and campus hygiene rules.',
                'description_pl': 'Obowiązki odpadowe gminy i zasady higieny kampusu.',
                'due_offset_minutes': 120,
                'anchor': 'end',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'none',
                'requires_venue_signoff': True,
            },
        ],
    },
    {
        'name': 'Two-day multi-room academic conference',
        'description': (
            'Several rooms, two days, a cloakroom and a handover. UW Zarządzenie nr 110, the '
            'higher-education act and the campus administrative standards, per '
            'CONFERENCE-RESEARCH-REPORT.md §6.4.'
        ),
        'event_kind_hint': 'conference',
        'items': [
            {
                'title_en': (
                    'File the event and its safety concept with the Dean or the head of the '
                    'building.'
                ),
                'title_pl': (
                    'Formalne zgłoszenie wydarzenia i przedłożenie koncepcji bezpieczeństwa '
                    'Dziekanowi / Kierownikowi jednostki.'
                ),
                'description_en': 'UW Zarządzenie nr 110 §§ 3–4. Programme and room plan attached.',
                'description_pl': (
                    'UW Zarządzenie nr 110 §§ 3–4. Ze szczegółowym programem i planem '
                    'wykorzystania sal.'
                ),
                'due_offset_minutes': -30 * DAY,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'link',
                'requires_venue_signoff': True,
            },
            {
                'title_en': (
                    'Verify that concurrent attendance stays below the mass-event threshold.'
                ),
                'title_pl': (
                    'Weryfikacja, czy przewidywana liczba jednoczesnych uczestników nie '
                    'przekracza limitów ustawy o bezpieczeństwie imprez masowych.'
                ),
                'description_en': (
                    'Ustawa o bezpieczeństwie imprez masowych art. 3 — a scientific event states '
                    'that it is one.'
                ),
                'description_pl': (
                    'Ustawa o bezpieczeństwie imprez masowych art. 3 — potwierdzenie naukowego '
                    'charakteru wydarzenia.'
                ),
                'due_offset_minutes': -14 * DAY,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'text',
                'requires_venue_signoff': True,
            },
            {
                'title_en': (
                    'Brief the volunteers on evacuation routes and emergency procedures.'
                ),
                'title_pl': (
                    'Przeprowadzenie instruktażu z zakresu dróg ewakuacyjnych i procedur '
                    'awaryjnych dla wolontariuszy i służby informacyjnej.'
                ),
                'description_en': (
                    'Exits, manual call points, emergency numbers. The building’s fire safety '
                    'instruction is the source.'
                ),
                'description_pl': (
                    'Wyjścia ewakuacyjne, ręczne ostrzegacze pożarowe (ROP), numery alarmowe.'
                ),
                'due_offset_minutes': -1 * DAY,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'none',
                'requires_venue_signoff': False,
            },
            {
                'title_en': 'Walk the rooms and take over the AV equipment, on the record.',
                'title_pl': (
                    'Protokolarne przejęcie sal i sprzętu multimedialnego od administratora '
                    'budynku.'
                ),
                'description_en': 'The initial condition of halls, corridors and cloakroom.',
                'description_pl': (
                    'Spisanie stanu początkowego sal, korytarzy, wyposażenia szatni i sprzętu.'
                ),
                'due_offset_minutes': -120,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'file',
                'requires_venue_signoff': True,
            },
            {
                'title_en': (
                    'Reconcile the cloakroom and hand unclaimed items to lost property.'
                ),
                'title_pl': (
                    'Rozliczenie szatni i protokolarne przekazanie rzeczy znalezionych do '
                    'depozytu uczelni.'
                ),
                'description_en': 'Kodeks cywilny art. 835 and the university property rules.',
                'description_pl': 'Kodeks cywilny art. 835 i regulamin mienia uczelni.',
                'due_offset_minutes': 180,
                'anchor': 'end',
                'is_mandatory': True,
                'na_allowed': True,
                'evidence_kind': 'text',
                'requires_venue_signoff': True,
            },
            {
                'title_en': 'Joint damage inspection and formal release of the building.',
                'title_pl': (
                    'Końcowy protokół zdawczo-odbiorczy obiektu i weryfikacja ewentualnych '
                    'uszkodzeń mienia.'
                ),
                'description_en': 'Civil liability and the faculty room-lease regulations.',
                'description_pl': 'Odpowiedzialność cywilna i regulamin wynajmu sal.',
                'due_offset_minutes': 1 * DAY,
                'anchor': 'end',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'file',
                'requires_venue_signoff': True,
            },
        ],
    },
    {
        'name': 'School science day with minors',
        'description': (
            'Children on campus. The child-protection standards ("Ustawa Kamilka"), laboratory '
            'safety and the UODO guidance on minors’ data, per CONFERENCE-RESEARCH-REPORT.md §6.4. '
            'EdMat’s own minor line is under 16 (accounts/minors.py); the school groups this '
            'template is for are younger than that by definition.'
        ),
        'event_kind_hint': 'minors',
        'items': [
            {
                'title_en': (
                    'Check staff and volunteers against the RSPTS register and collect their child '
                    'protection acknowledgements.'
                ),
                'title_pl': (
                    'Weryfikacja personelu i wolontariuszy w Rejestrze Sprawców Przestępstw na '
                    'Tle Seksualnym (RSPTS) oraz odebranie oświadczeń o zapoznaniu się ze '
                    'Standardami Ochrony Małoletnich.'
                ),
                'description_en': (
                    'Ustawa z 13 maja 2016 r. (t.j. Dz.U. 2024 poz. 560). Record that the check '
                    'was done and when — never store the certificate itself '
                    '(CONFERENCE-BRIEF.md §6.5).'
                ),
                'description_pl': (
                    'Ustawa z 13 maja 2016 r. (t.j. Dz.U. 2024 poz. 560). Odnotowujemy fakt i '
                    'datę weryfikacji — nigdy samego zaświadczenia.'
                ),
                'due_offset_minutes': -14 * DAY,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'text',
                'requires_venue_signoff': True,
            },
            {
                'title_en': (
                    'Collect guardian consents and emergency contact numbers for every minor.'
                ),
                'title_pl': (
                    'Weryfikacja zgód rodziców/opiekunów prawnych na udział małoletnich oraz '
                    'rejestracja telefonów kontaktowych ICE.'
                ),
                'description_en': 'Kodeks rodzinny i opiekuńczy and the institution’s standards.',
                'description_pl': 'Kodeks rodzinny i opiekuńczy oraz standardy instytucji.',
                'due_offset_minutes': -3 * DAY,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'text',
                'requires_venue_signoff': False,
            },
            {
                'title_en': (
                    'Chemical, laser and high-voltage safety assessment for the hands-on '
                    'demonstrations.'
                ),
                'title_pl': (
                    'Protokół bezpieczeństwa chemicznego, radiologicznego lub laserowego dla '
                    'pokazów laboratoryjnych z udziałem młodzieży.'
                ),
                'description_en': 'The physics/chemistry laboratory regulations.',
                'description_pl': 'Regulamin pracowni fizycznych i chemicznych.',
                'due_offset_minutes': -7 * DAY,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': True,
                'evidence_kind': 'file',
                'requires_venue_signoff': True,
            },
            {
                'title_en': (
                    'Badge minimisation: a minor’s badge carries a first name only, the guardian’s '
                    'number concealed on the back.'
                ),
                'title_pl': (
                    'Weryfikacja minimalizacji danych na identyfikatorach: wyłącznie imię dziecka '
                    'na awersie, telefon do opiekuna ukryty na rewersie.'
                ),
                'description_en': 'UODO child data guidance and the child protection standards.',
                'description_pl': 'Wytyczne UODO i Standardy Ochrony Małoletnich.',
                'due_offset_minutes': -120,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'none',
                'requires_venue_signoff': False,
            },
            {
                'title_en': (
                    'Designate a safe-haven point for a lost child and brief the response '
                    'procedure.'
                ),
                'title_pl': (
                    'Wyznaczenie punktu opieki nad zagubionym dzieckiem i instruktaż procedury '
                    'reagowania na incydenty krzywdzenia dzieci.'
                ),
                'description_en': (
                    'A marked room, and a named person responsible for the child protection '
                    'procedures.'
                ),
                'description_pl': (
                    'Oznakowane pomieszczenie i wskazana osoba odpowiedzialna za procedury '
                    'ochrony małoletnich.'
                ),
                'due_offset_minutes': -60,
                'anchor': 'start',
                'is_mandatory': True,
                'na_allowed': False,
                'evidence_kind': 'text',
                'requires_venue_signoff': True,
            },
        ],
    },
]


def seed(apps, schema_editor):
    ChecklistTemplate = apps.get_model('venues', 'ChecklistTemplate')
    ChecklistTemplateItem = apps.get_model('venues', 'ChecklistTemplateItem')
    for spec in TEMPLATES:
        if ChecklistTemplate.objects.filter(venue__isnull=True, name=spec['name']).exists():
            continue
        template = ChecklistTemplate.objects.create(
            venue=None,
            name=spec['name'],
            description=spec['description'],
            event_kind_hint=spec['event_kind_hint'],
            version=1,
            is_active=True,
        )
        for order, item in enumerate(spec['items']):
            ChecklistTemplateItem.objects.create(
                template=template, owner_role='organiser', order=order, **item
            )


def unseed(apps, schema_editor):
    """Reversible, but only for the untouched defaults: a template an administrator has since
    instantiated leaves its snapshots behind by design (the instance carries its own words), so
    removing the template takes nothing away from anybody working through one."""
    ChecklistTemplate = apps.get_model('venues', 'ChecklistTemplate')
    ChecklistTemplate.objects.filter(
        venue__isnull=True, name__in=[spec['name'] for spec in TEMPLATES]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [('venues', '0001_initial')]
    operations = [migrations.RunPython(seed, unseed)]
