"""Contest presets — what a contest of each kind needs, derived from Polish law (CONTESTS-LAW.md).

A preset is DATA, not a model: it says which stages a contest of this kind has, who the
*przyrzekający* is, whether a prize is promised (and so whether KC art. 919–921, the gambling act
and PIT apply at all), which sections its regulamin must carry, which legal-checklist tasks the
organiser owes and when, what its goal's definition of done is, and which roles the founder is
asked to fill from the people they already work with. `personalize.apply_preset` (step B) turns a
preset into rows in the OTHER apps — a plan, a goal, tasks, needs, a poll — on the contest node;
the wizard (step A) turns it into a prefilled form. Neither re-states anything written here.

Every legal reference is a key into `LAW` below, and every `LAW` row carries the marker
CONTESTS-LAW.md gave it (`verified`, `secondary`, `unverified`, `disputed`), because the frontend
must never present an unverified article number as settled: the compliance panel draws a marker
next to each one. **Nothing here is legal advice and the copy must say so** (CONTESTS-LAW.md §14).

Three decisions baked in, each from the research and each the owner's to overturn:

1. **`challenge` is the default** and promises no prize. No prize ⇒ no przyrzeczenie publiczne
   (KC art. 919 §1 needs one), no gambling exposure, no PIT, no płatnik. Adding a prize is a
   deliberate step that UNLOCKS obligations (CONTESTS-LAW.md §13 g).
2. **A draw is structurally impossible.** No preset has a `draw` advancement, no tie-break by lot
   exists, and step A's `rules.py` refuses (400 `chance_element`) a stage whose description says
   *losowanie* (CONTESTS-LAW.md §2 — u.g.h. art. 89 and KKS art. 108 stack).
3. **`kuratorium` and `olympiad` are staff-only** (`staff_only=True`): a false "kuratoryjny" claim
   harms pupils who believe they are earning an exam exemption (CONTESTS-LAW.md §14 item 9), so
   only a platform operator may found one, and the external reference is mandatory.

`frontend/src/lib/utils/labels.ts` mirrors `PRESET_KEYS`, `PRIZE_REGIMES`, `ORGANISER_KINDS` and
`LAW_MARKERS`/`MARKER_WORDS` — as `PRESET_LABELS`, `PRIZE_REGIME_LABELS`, `ORGANISER_KIND_LABELS`
and `LAW_MARKER_LABELS`, under a comment naming this file (house rule 13: said in both, because
this is where drift creeps in). A value added here and not there shows a reader the raw key.
Step B owns this file after the prep; step A reads it only.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

# ---- the law, once, with its verification status ----------------------------------------------

#: key -> (short citation, marker). Markers are CONTESTS-LAW.md's: `verified` (the text was
#: opened), `secondary` (an authoritative restatement), `unverified` (number from memory — the
#: frontend shows it with a caveat), `disputed` (a lawyer must pick a side).
LAW: dict[str, tuple[str, str]] = {
    'kc_919': ('Kodeks cywilny art. 919 §1–2 — przyrzeczenie publiczne; revocation by the same channel', 'verified'),
    'kc_920_3': ('Kodeks cywilny art. 920 §3 — a joint prize is split by a court unless the regulamin says how', 'verified'),
    'kc_921_1': ('Kodeks cywilny art. 921 §1 — no claim deadline ⇒ the promise is bezskuteczne', 'verified'),
    'kc_921_2': ('Kodeks cywilny art. 921 §2 — the organiser judges unless a jury is reserved', 'verified'),
    'kc_921_3': ('Kodeks cywilny art. 921 §3 — rights in the winning work pass only if reserved; vs pr.aut. art. 53', 'disputed'),
    'kc_15_17': ('Kodeks cywilny art. 15 and 17 — a 13–17-year-old needs a guardian\'s consent for a legal act', 'unverified'),
    'kc_384': ('Kodeks cywilny art. 384 §1, 4 — a regulamin must be available before entry, storable', 'unverified'),
    'ugh_2': ('Ustawa o grach hazardowych art. 2 ust. 1 — chance deciding any stage makes it a gra losowa', 'secondary'),
    'ugh_89_kks_108': ('u.g.h. art. 89 kary pieniężne + Kodeks karny skarbowy art. 108 (240 stawek) — they stack', 'secondary'),
    'pit_30_1_2': ('PIT art. 30 ust. 1 pkt 2 — 10% flat tax on contest prizes', 'secondary'),
    'pit_21_1_68': ('PIT art. 21 ust. 1 pkt 68 — prizes ≤ 2 000 zł in contests "w dziedzinie nauki" exempt; the mass-media limb is disputed for the internet', 'disputed'),
    'pit_21_1_115': ('PIT art. 21 ust. 1 pkt 115 — pupils\' prizes in contests run on the education-system basis exempt, no cap', 'secondary'),
    'pit_41_4': ('PIT art. 41 ust. 4 — the organiser (a legal person) is the płatnik; PIT-8AR', 'secondary'),
    'pit_41_7': ('PIT art. 41 ust. 7 — an in-kind prize: the winner pays the tax first, hence ubruttowienie (÷ 0.9)', 'secondary'),
    'gdpr_6': ('GDPR art. 6(1)(b)/(c) for running and settling; art. 6(1)(a) consent only for publishing names, images, entries', 'verified'),
    'gdpr_8': ('GDPR art. 8 — under 16, consent is the guardian\'s; Poland did not lower the age', 'verified'),
    'gdpr_13': ('GDPR art. 13 — the information clause; EdMat named as processor', 'unverified'),
    'gdpr_28': ('GDPR art. 28 — EdMat processes on the organiser\'s behalf; joint-controller risk under art. 26', 'unverified'),
    'uodo_model': ('UODO\'s own pupil-contest regulamin — publication of a name is a separate, revocable consent', 'verified'),
    'praut_41_53_67': ('Prawo autorskie art. 41 ust. 2 and 4, art. 53, art. 67 ust. 5 — a transfer or exclusive licence needs written form; a non-exclusive licence does not', 'secondary'),
    'praut_16': ('Prawo autorskie art. 16 — moral rights cannot be waived', 'unverified'),
    'praut_81': ('Prawo autorskie art. 81 — publishing a likeness needs permission; a child\'s, the guardians\'', 'verified'),
    'menis_2002': ('Rozporządzenie MENiS z 29.01.2002 (t.j. Dz.U. 2020 poz. 1036) §3 ust. 2, §4 ust. 2 — konkursy: the kurator organises, the regulamin sets the stages', 'verified'),
    'menis_2002_olimp': ('The same regulation §8, §9 ust. 1 and 4, §13 — olimpiady: three fixed stages, a komitet główny, an appeal procedure', 'verified'),
    'uso_44zx': ('Ustawa o systemie oświaty art. 44zx — a laureat of a wojewódzki konkurs przedmiotowy is exempt from that part of the egzamin ósmoklasisty', 'verified'),
    'uso_44zzh': ('Ustawa o systemie oświaty art. 44zzh — a laureat/finalista of a listed olimpiada is exempt from the matura in that subject', 'verified'),
    'po_132': ('Prawo oświatowe art. 132 — laureaci and finaliści in secondary-school admission; point values unverified', 'secondary'),
    'pswin_70_6': ('Prawo o szkolnictwie wyższym i nauce art. 70 ust. 6 — a senate publishes its olympiad-admission rules in advance', 'unverified'),
    'uokik_14_days': ('UOKiK register — a 7-day complaint window was held abusive; ≥ 14 days to lodge, 14 to answer, when the organiser is a przedsiębiorca', 'secondary'),
    'uonpr_7': ('Ustawa o przeciwdziałaniu nieuczciwym praktykom rynkowym art. 7 pkt 16–17 — only when the organiser is a business', 'unverified'),
    'dostepnosc_2019': ('Ustawa o zapewnianiu dostępności (2019) — binds a public organiser (kurator, public school), not a private one', 'verified'),
    'dsa_hosting': ('DSA arts. 6, 14, 16, 17 — EdMat is the hosting service, never the przyrzekający; the Polish act applies from 6.11.2026', 'secondary'),
}

#: The same citations in Polish. A separate table rather than a third element on every tuple above,
#: because step A reads `LAW` and `law_as_api()` and a changed tuple shape would break it mid-build;
#: a reader of the Polish interface being shown an English gloss of a Polish statute is the drift
#: this closes (house rule 1 — a user-facing string is never one language). A key missing here falls
#: back to the English line rather than printing nothing.
LAW_PL: dict[str, str] = {
    'kc_919': 'Kodeks cywilny art. 919 §1–2 — przyrzeczenie publiczne; odwołanie tym samym kanałem, co ogłoszenie',
    'kc_920_3': 'Kodeks cywilny art. 920 §3 — nagrodę wspólną dzieli sąd, jeśli regulamin nie mówi jak',
    'kc_921_1': 'Kodeks cywilny art. 921 §1 — bez terminu ubiegania się o nagrodę przyrzeczenie jest bezskuteczne',
    'kc_921_2': 'Kodeks cywilny art. 921 §2 — ocenia przyrzekający, chyba że regulamin powołał jury',
    'kc_921_3': 'Kodeks cywilny art. 921 §3 — prawa do nagrodzonej pracy przechodzą tylko wtedy, gdy to zastrzeżono; spór z art. 53 pr.aut.',
    'kc_15_17': 'Kodeks cywilny art. 15 i 17 — osoba w wieku 13–17 lat potrzebuje zgody opiekuna na czynność prawną',
    'kc_384': 'Kodeks cywilny art. 384 §1 i 4 — regulamin musi być dostępny przed zgłoszeniem i możliwy do zachowania',
    'ugh_2': 'Ustawa o grach hazardowych art. 2 ust. 1 — jeśli o którymkolwiek etapie decyduje los, to gra losowa',
    'ugh_89_kks_108': 'u.g.h. art. 89 (kary pieniężne) i Kodeks karny skarbowy art. 108 (240 stawek) — kumulują się',
    'pit_30_1_2': 'PIT art. 30 ust. 1 pkt 2 — 10% podatku zryczałtowanego od nagród w konkursach',
    'pit_21_1_68': 'PIT art. 21 ust. 1 pkt 68 — nagrody do 2 000 zł w konkursach „w dziedzinie nauki" zwolnione; człon o środkach masowego przekazu jest sporny w internecie',
    'pit_21_1_115': 'PIT art. 21 ust. 1 pkt 115 — nagrody uczniów w konkursach na podstawie przepisów o systemie oświaty zwolnione bez limitu',
    'pit_41_4': 'PIT art. 41 ust. 4 — płatnikiem jest organizator będący osobą prawną; deklaracja PIT-8AR',
    'pit_41_7': 'PIT art. 41 ust. 7 — nagroda rzeczowa: laureat wpłaca podatek przed odbiorem, stąd ubruttowienie (÷ 0,9)',
    'gdpr_6': 'RODO art. 6 ust. 1 lit. b/c dla przeprowadzenia i rozliczenia; lit. a (zgoda) tylko dla publikacji imienia, wizerunku i pracy',
    'gdpr_8': 'RODO art. 8 — poniżej 16 lat zgodę wyraża opiekun; Polska nie obniżyła tego wieku',
    'gdpr_13': 'RODO art. 13 — klauzula informacyjna; ten serwis wskazany jako podmiot przetwarzający',
    'gdpr_28': 'RODO art. 28 — serwis przetwarza na zlecenie organizatora; ryzyko współadministrowania z art. 26',
    'uodo_model': 'Wzorcowy regulamin konkursu dla uczniów samego UODO — publikacja imienia i nazwiska to osobna, odwołalna zgoda',
    'praut_41_53_67': 'Prawo autorskie art. 41 ust. 2 i 4, art. 53, art. 67 ust. 5 — przeniesienie praw i licencja wyłączna wymagają formy pisemnej; licencja niewyłączna nie',
    'praut_16': 'Prawo autorskie art. 16 — autorskich praw osobistych nie można się zrzec',
    'praut_81': 'Prawo autorskie art. 81 — rozpowszechnianie wizerunku wymaga zezwolenia; w przypadku dziecka — opiekunów',
    'menis_2002': 'Rozporządzenie MENiS z 29.01.2002 (t.j. Dz.U. 2020 poz. 1036) §3 ust. 2, §4 ust. 2 — konkursy organizuje kurator, a etapy ustala regulamin',
    'menis_2002_olimp': 'To samo rozporządzenie §8, §9 ust. 1 i 4, §13 — olimpiady: trzy stałe etapy, komitet główny, tryb odwoławczy',
    'uso_44zx': 'Ustawa o systemie oświaty art. 44zx — laureat wojewódzkiego konkursu przedmiotowego jest zwolniony z tej części egzaminu ósmoklasisty',
    'uso_44zzh': 'Ustawa o systemie oświaty art. 44zzh — laureat lub finalista olimpiady z wykazu jest zwolniony z matury z tego przedmiotu',
    'po_132': 'Prawo oświatowe art. 132 — laureaci i finaliści w rekrutacji do szkół ponadpodstawowych; liczba punktów niesprawdzona',
    'pswin_70_6': 'Prawo o szkolnictwie wyższym i nauce art. 70 ust. 6 — senat publikuje z wyprzedzeniem zasady przyjęć laureatów olimpiad',
    'uokik_14_days': 'Rejestr klauzul niedozwolonych UOKiK — 7-dniowy termin reklamacji uznano za abuzywny; co najmniej 14 dni na złożenie i 14 na odpowiedź, gdy organizator jest przedsiębiorcą',
    'uonpr_7': 'Ustawa o przeciwdziałaniu nieuczciwym praktykom rynkowym art. 7 pkt 16–17 — tylko gdy organizator jest przedsiębiorcą',
    'dostepnosc_2019': 'Ustawa o zapewnianiu dostępności (2019) — wiąże organizatora publicznego (kuratora, szkołę publiczną), nie prywatnego',
    'dsa_hosting': 'Akt o usługach cyfrowych art. 6, 14, 16, 17 — serwis jest usługą hostingu, nigdy przyrzekającym; polska ustawa obowiązuje od 6.11.2026',
}

LAW_MARKERS = ('verified', 'secondary', 'unverified', 'disputed')


# ---- the pieces a preset is made of -------------------------------------------------------------


@dataclass(frozen=True)
class StageTemplate:
    key: str
    name_en: str
    name_pl: str
    #: `online` — problems are answered on EdMat; `onsite` — the stage is an `events.Event` (a
    #: room, a date, a rota); `either` — the founder chooses in the wizard.
    mode: str
    #: Days after `starts_at` the stage opens, and how long it stays open.
    offset_days: int
    duration_days: int
    #: `all` — everyone goes on; `top_n` / `threshold` — the founder sets the number; `final` —
    #: the last stage. NEVER `draw` (CONTESTS-LAW.md §2).
    advancement: str


@dataclass(frozen=True)
class RulesSection:
    key: str
    heading_en: str
    heading_pl: str
    required: bool
    law: tuple[str, ...]
    #: A sentence the editor sees under the heading, saying what belongs here and why.
    guidance_en: str
    guidance_pl: str


@dataclass(frozen=True)
class ChecklistItem:
    key: str
    title_en: str
    title_pl: str
    law: tuple[str, ...]
    #: The staff role that owes it: `organiser` or `secretary`.
    role: str
    #: `before_announce` (due before the contest leaves `draft`), `before_results`, `after_results`
    #: (due at the end of the complaints window), `at_close`.
    phase: str


@dataclass(frozen=True)
class RoleSlot:
    """A role the wizard asks the founder to fill from the people they already work with
    (`contests/people.py: suggested_people`, step A): course staff, event staff, organisation
    members, project members. `count` is how many pickers to draw; `required` whether the contest
    may be announced without them."""

    role: str
    count: int
    required: bool


@dataclass(frozen=True)
class Preset:
    key: str
    name_en: str
    name_pl: str
    summary_en: str
    summary_pl: str
    #: Who the przyrzekający, the data controller and the płatnik is: `person` (the founder),
    #: `organization` (an `organizations.Organization` the wizard asks for), `kurator`, `committee`.
    organiser_kind: str
    audience: str
    allows_minors: bool
    #: Every entrant is a minor — the guardian-consent flow is mandatory, not optional.
    minors_only: bool
    #: Whether a prize is promised. False ⇒ KC art. 919–921, the gambling act and PIT do not apply
    #: (CONTESTS-LAW.md §13 g) and the prize/tax sections are hidden.
    has_prize: bool
    #: `none` · `pupil_exempt_115` · `science_68_then_10pct` (≤ 2 000 zł exempt under the nauka limb,
    #: 10% above it, the organiser withholds) · `flat_10pct` (no exemption pleaded).
    prize_regime: str
    team: bool
    stages: tuple[StageTemplate, ...]
    #: Olympiads: the three stages are the regulation's and may not be edited (`menis_2002_olimp`).
    stages_locked: bool
    jury_min: int
    jury_recommended: int
    #: A link to the kurator's / komitet główny's own announcement is mandatory (and the preset is
    #: staff-only) — CONTESTS-LAW.md §14 item 9.
    external_reference_required: bool
    staff_only: bool
    #: `never` · `if_business` (the wizard asks "are you a przedsiębiorca?" and unlocks the
    #: UOKiK block) · `always`.
    consumer_block: str
    complaint_window_days: int
    #: `initials` · `full_name_opt_in` — what the public results list shows by default.
    publication_default: str
    rules_sections: tuple[str, ...]
    checklist: tuple[str, ...]
    goal_criteria: tuple[tuple[str, str], ...]
    needs: tuple[tuple[str, str, str, int], ...]  # (kind, title_en, title_pl, wanted_count)
    roles: tuple[RoleSlot, ...]
    #: Lines shown as INFORMATION about contests of this kind — never as a promise by this site.
    info: tuple[tuple[str, str, tuple[str, ...]], ...] = field(default_factory=tuple)  # (en, pl, law)


# ---- the regulamin skeleton (CONTESTS-LAW.md §12) ----------------------------------------------

RULES_SECTIONS: dict[str, RulesSection] = {
    s.key: s
    for s in (
        RulesSection('organiser', '§1 Organiser', '§1 Organizator', True, ('kc_919', 'gdpr_13'),
                     'Who promises the prize and controls the data: full name, legal form, address, contact. This site only hosts the contest.',
                     'Kto przyrzeka nagrodę i administruje danymi: pełna nazwa, forma prawna, adres, kontakt. Ten serwis jedynie udostępnia narzędzie.'),
        RulesSection('subject', '§2 Subject and aim', '§2 Przedmiot i cel konkursu', True, ('kc_919', 'pit_21_1_68'),
                     'The task precisely enough to perform it, and the field (mathematics, physics…) — the "science" tax exemption is pleaded here.',
                     'Zadanie opisane na tyle dokładnie, by dało się je wykonać, i dziedzina (matematyka, fizyka…) — tu powołuje się zwolnienie „w dziedzinie nauki".'),
        RulesSection('dates', '§3 Dates', '§3 Terminy', True, ('kc_921_1', 'kc_919'),
                     'Start, entry deadline, THE DEADLINE WITHIN WHICH THE PRIZE MAY BE CLAIMED, results date, handover date. Without the claim deadline a prize contest is ineffective.',
                     'Początek, termin zgłoszeń, TERMIN, W KTÓRYM MOŻNA UBIEGAĆ SIĘ O NAGRODĘ, data wyników, data wydania nagród. Bez terminu ubiegania się konkurs z nagrodą jest bezskuteczny.'),
        RulesSection('participants', '§4 Participants and conditions', '§4 Uczestnicy i warunki uczestnictwa', True, ('kc_15_17', 'gdpr_8', 'ugh_2'),
                     'Who may enter, who may not (organiser, jury, their relatives), age rules and guardian consent. Entry is never conditional on buying anything.',
                     'Kto może wziąć udział, kto nie (organizator, jury, ich bliscy), zasady wieku i zgoda opiekuna. Udział nigdy nie zależy od zakupu czegokolwiek.'),
        RulesSection('entry', '§5 Entering', '§5 Zgłoszenie', True, ('kc_384',),
                     'How to enter, the form, how many entries, technical requirements, acceptance of these rules (the version accepted is stored with the entry).',
                     'Jak się zgłosić, formularz, liczba zgłoszeń, wymagania techniczne, akceptacja regulaminu (wersja zaakceptowana jest zapisywana przy zgłoszeniu).'),
        RulesSection('criteria_jury', '§6 Criteria and the jury', '§6 Kryteria oceny i komisja konkursowa', True, ('ugh_2', 'kc_921_2', 'ugh_89_kks_108'),
                     'The merit criteria and their weights, the named jury and its procedure, how ties are broken BY MERIT — never by draw — and whether the decision is final. This section keeps the contest out of the lottery regime.',
                     'Kryteria merytoryczne i ich wagi, imiennie wskazane jury i tryb jego pracy, jak rozstrzyga się remisy MERYTORYCZNIE — nigdy losowaniem — i czy decyzja jest ostateczna. Ten paragraf chroni przed reżimem gier losowych.'),
        RulesSection('prizes', '§7 Prizes', '§7 Nagrody', True, ('pit_30_1_2', 'pit_41_4', 'pit_41_7', 'pit_21_1_68', 'pit_21_1_115'),
                     'Each prize, its value, cash or in kind, the tax clause (which exemption is relied on, or that 10% is withheld, or the gross-up), handover, what happens to an unclaimed prize.',
                     'Każda nagroda, jej wartość, pieniężna czy rzeczowa, klauzula podatkowa (jakie zwolnienie, albo potrącenie 10%, albo ubruttowienie), wydanie, los nagrody nieodebranej.'),
        RulesSection('results', '§8 Announcing results', '§8 Ogłoszenie wyników', True, ('gdpr_6', 'uodo_model'),
                     'Where and when, and WHAT is published about a winner — the default is initials; a full name rests on a separate consent.',
                     'Gdzie i kiedy, i CO publikuje się o laureacie — domyślnie inicjały; pełne imię i nazwisko wymaga osobnej zgody.'),
        RulesSection('complaints', '§9 Complaints', '§9 Reklamacje', True, ('uokik_14_days', 'menis_2002_olimp'),
                     'To whom, how, at least 14 days to lodge, 14 days to answer with reasons; court recourse is unaffected.',
                     'Do kogo, jak, co najmniej 14 dni na złożenie, 14 dni na odpowiedź z uzasadnieniem; droga sądowa pozostaje otwarta.'),
        RulesSection('personal_data', '§10 Personal data', '§10 Dane osobowe', True, ('gdpr_13', 'gdpr_6', 'gdpr_28', 'gdpr_8'),
                     'Controller, purposes with a legal basis EACH, recipients (this site as processor, the tax office), retention PER PURPOSE, rights, withdrawal, the complaint to the Prezes UODO.',
                     'Administrator, cele z podstawą prawną KAŻDY, odbiorcy (ten serwis jako procesor, urząd skarbowy), okres przechowywania DLA KAŻDEGO CELU, prawa, cofnięcie zgody, skarga do Prezesa UODO.'),
        RulesSection('copyright_image', '§11 Copyright and likeness', '§11 Prawa autorskie i wizerunek', True, ('praut_41_53_67', 'praut_16', 'praut_81', 'kc_921_3'),
                     'Warranty of authorship, a NON-EXCLUSIVE licence with the fields of exploitation listed, no waiver of moral rights, likeness consent as its own clause. A transfer needs a signed paper annex.',
                     'Oświadczenie o autorstwie, licencja NIEWYŁĄCZNA z wymienionymi polami eksploatacji, bez zrzeczenia się praw osobistych, zgoda na wizerunek jako osobna klauzula. Przeniesienie praw wymaga podpisanego aneksu na papierze.'),
        RulesSection('final', '§12 Final provisions', '§12 Postanowienia końcowe', True, ('kc_919', 'dsa_hosting'),
                     'Where these rules live and their version, how they may change (never to the worse for acquired rights), whether the promise is irrevocable, what happens on cancellation, that this site is the medium only.',
                     'Gdzie znajduje się regulamin i jego wersja, jak może się zmieniać (nigdy na niekorzyść praw nabytych), czy przyrzeczenie jest nieodwołalne, co w razie odwołania konkursu, że ten serwis jest tylko medium.'),
    )
}

#: The sections a contest WITHOUT a prize does not need (CONTESTS-LAW.md §13 g).
PRIZE_ONLY_SECTIONS = frozenset({'prizes'})


# ---- the legal checklist (becomes `tasks` rows on the contest node) ------------------------------

CHECKLIST: dict[str, ChecklistItem] = {
    c.key: c
    for c in (
        ChecklistItem('rules_published', 'Publish the regulamin with every required section, versioned', 'Opublikuj regulamin ze wszystkimi wymaganymi paragrafami, z numerem wersji', ('kc_384', 'kc_919'), 'organiser', 'before_announce'),
        ChecklistItem('claim_deadline', 'Set the deadline within which the prize may be claimed', 'Ustal termin, w którym można ubiegać się o nagrodę', ('kc_921_1',), 'organiser', 'before_announce'),
        ChecklistItem('criteria_published', 'Write the merit criteria and their weights', 'Zapisz kryteria merytoryczne i ich wagi', ('ugh_2', 'kc_921_2'), 'organiser', 'before_announce'),
        ChecklistItem('jury_appointed', 'Appoint the jury (at least the minimum; three is the recommendation)', 'Powołaj jury (co najmniej minimum; zalecane troje)', ('kc_921_2',), 'organiser', 'before_announce'),
        ChecklistItem('no_draw', 'Confirm that no stage and no tie-break depends on chance', 'Potwierdź, że żaden etap ani remis nie zależy od losu', ('ugh_2', 'ugh_89_kks_108'), 'organiser', 'before_announce'),
        ChecklistItem('tax_decided', 'Decide the tax treatment of each prize and write it into §7', 'Ustal sposób opodatkowania każdej nagrody i wpisz go do §7', ('pit_30_1_2', 'pit_21_1_68', 'pit_41_4', 'pit_41_7'), 'organiser', 'before_announce'),
        ChecklistItem('payer_identity', 'Name the legal person who is the płatnik and the data controller', 'Wskaż osobę prawną, która jest płatnikiem i administratorem danych', ('pit_41_4', 'gdpr_13'), 'organiser', 'before_announce'),
        ChecklistItem('guardian_consent', 'Prepare the guardian-consent form and require it for every minor entrant', 'Przygotuj formularz zgody opiekuna i wymagaj go od każdego niepełnoletniego uczestnika', ('kc_15_17', 'gdpr_8'), 'secretary', 'before_announce'),
        ChecklistItem('rodo_clause', 'Write the personal-data clause: a legal basis per purpose, this site named as processor', 'Napisz klauzulę RODO: podstawa prawna dla każdego celu, ten serwis jako procesor', ('gdpr_13', 'gdpr_6', 'gdpr_28'), 'organiser', 'before_announce'),
        ChecklistItem('publication_consent', 'Make publishing a winner\'s full name a separate, revocable consent', 'Uczyń publikację pełnego imienia i nazwiska laureata osobną, odwołalną zgodą', ('uodo_model', 'gdpr_6'), 'secretary', 'before_announce'),
        ChecklistItem('licence_clause', 'Choose the licence preset for entries (non-exclusive; a transfer needs paper)', 'Wybierz wariant licencji na prace (niewyłączna; przeniesienie wymaga papieru)', ('praut_41_53_67', 'praut_16', 'kc_921_3'), 'organiser', 'before_announce'),
        ChecklistItem('image_consent', 'Separate likeness consent for any photo of a participant', 'Osobna zgoda na wizerunek dla każdego zdjęcia uczestnika', ('praut_81',), 'secretary', 'before_announce'),
        ChecklistItem('complaints_procedure', 'Write the complaints procedure: at least 14 days to lodge, 14 to answer', 'Zapisz procedurę reklamacji: co najmniej 14 dni na złożenie, 14 na odpowiedź', ('uokik_14_days', 'menis_2002_olimp'), 'organiser', 'before_announce'),
        ChecklistItem('external_reference', 'Link the kurator\'s / committee\'s own announcement', 'Podlinkuj własne ogłoszenie kuratora / komitetu', ('menis_2002', 'menis_2002_olimp'), 'organiser', 'before_announce'),
        ChecklistItem('wykaz_listed', 'Check the contest is on the minister\'s current wykaz', 'Sprawdź, czy konkurs jest w aktualnym wykazie ministra', ('uso_44zx', 'uso_44zzh'), 'organiser', 'before_announce'),
        ChecklistItem('accommodation_contact', 'Name a contact for participants with special needs', 'Wskaż kontakt dla uczestników ze szczególnymi potrzebami', ('dostepnosc_2019',), 'secretary', 'before_announce'),
        ChecklistItem('team_split', 'Say how a team prize is split and who receives each share', 'Zapisz podział nagrody zespołowej i kto otrzymuje każdą część', ('kc_920_3', 'pit_30_1_2'), 'organiser', 'before_announce'),
        ChecklistItem('consumer_block', 'If the organiser is a business: the UOKiK complaint norms and the versioned, downloadable regulamin', 'Jeśli organizator jest przedsiębiorcą: normy reklamacyjne UOKiK i regulamin w wersji do pobrania', ('uokik_14_days', 'uonpr_7', 'kc_384'), 'organiser', 'before_announce'),
        ChecklistItem('every_stage_scored', 'Every stage scored by the jury against the published criteria', 'Każdy etap oceniony przez jury według opublikowanych kryteriów', ('kc_921_2',), 'organiser', 'before_results'),
        ChecklistItem('results_published', 'Publish the results in the form §8 promises', 'Opublikuj wyniki w formie obiecanej w §8', ('uodo_model',), 'organiser', 'before_results'),
        ChecklistItem('complaints_answered', 'Answer every complaint within the window, with reasons', 'Odpowiedz na każdą reklamację w terminie, z uzasadnieniem', ('uokik_14_days',), 'secretary', 'after_results'),
        ChecklistItem('prizes_handed', 'Hand over every prize by the date in §3', 'Wydaj każdą nagrodę w terminie z §3', ('kc_919',), 'organiser', 'at_close'),
        ChecklistItem('pit_8ar', 'Withhold the tax and file PIT-8AR (a legal-person organiser)', 'Potrąć podatek i złóż PIT-8AR (organizator będący osobą prawną)', ('pit_41_4', 'pit_30_1_2'), 'organiser', 'at_close'),
        ChecklistItem('certificates_issued', 'Issue the zaświadczenia to laureates and finalists', 'Wydaj zaświadczenia laureatom i finalistom', ('menis_2002',), 'secretary', 'at_close'),
    )
}

#: Checklist items that only make sense when a prize is promised.
PRIZE_ONLY_CHECKLIST = frozenset({'claim_deadline', 'no_draw', 'tax_decided', 'prizes_handed', 'pit_8ar', 'team_split'})

_COMMON = ('rules_published', 'criteria_published', 'jury_appointed', 'rodo_clause', 'publication_consent',
           'licence_clause', 'complaints_procedure', 'every_stage_scored', 'results_published', 'complaints_answered')
_PRIZE = ('claim_deadline', 'no_draw', 'tax_decided', 'prizes_handed')
_MINORS = ('guardian_consent', 'image_consent', 'accommodation_contact')
_LEGAL_PERSON = ('payer_identity', 'pit_8ar')

_GOAL_COMMON = (
    ('The regulamin is published with every required section', 'Regulamin jest opublikowany ze wszystkimi wymaganymi paragrafami'),
    ('A jury of at least the minimum size is appointed', 'Powołano jury co najmniej w minimalnym składzie'),
    ('Every stage has been scored against the published criteria', 'Każdy etap został oceniony według opublikowanych kryteriów'),
    ('Results are published', 'Wyniki są opublikowane'),
    ('The complaints window has closed with every complaint answered', 'Okno reklamacji zamknęło się, a każda reklamacja ma odpowiedź'),
)
_GOAL_PRIZE = (('Every prize has been handed over and its tax settled', 'Każda nagroda została wydana, a podatek rozliczony'),)
#: The criteria that only mean something when a prize is promised — the `goal_criteria` twin of
#: `PRIZE_ONLY_CHECKLIST`. `goal_criteria_for` drops them when the contest itself says there is no
#: prize, which is the case a preset cannot know: `has_prize` is a field on the row (step A), and a
#: founder may turn it off on a preset that normally promises one.
PRIZE_ONLY_GOAL_CRITERIA = frozenset(_GOAL_PRIZE)

_JURY_NEED = ('expertise', 'Jury member wanted', 'Poszukiwany członek jury', 2)
_PROCTOR_NEED = ('help', 'Proctor for the on-site stage', 'Opiekun etapu stacjonarnego', 2)

_ONE_ROUND = (StageTemplate('round', 'The round', 'Runda', 'either', 0, 14, 'final'),)
_SCHOOL_LADDER = (
    StageTemplate('school', 'School stage', 'Etap szkolny', 'either', 0, 1, 'threshold'),
    StageTemplate('district', 'District stage', 'Etap rejonowy', 'either', 42, 1, 'threshold'),
    StageTemplate('voivodeship', 'Voivodeship stage', 'Etap wojewódzki', 'onsite', 84, 1, 'final'),
)
_OLYMPIAD_LADDER = (
    StageTemplate('first', 'First-degree (school) stage', 'Zawody I stopnia (szkolne)', 'either', 0, 30, 'threshold'),
    StageTemplate('second', 'Second-degree (district) stage', 'Zawody II stopnia (okręgowe)', 'onsite', 90, 1, 'top_n'),
    StageTemplate('third', 'Third-degree (central) stage', 'Zawody III stopnia (centralne)', 'onsite', 150, 2, 'final'),
)
_TWO_ROUNDS = (
    StageTemplate('qualifying', 'Qualifying round', 'Runda kwalifikacyjna', 'online', 0, 14, 'top_n'),
    StageTemplate('final', 'Final', 'Finał', 'either', 28, 1, 'final'),
)

_ALL_SECTIONS = tuple(RULES_SECTIONS)
_NO_PRIZE_SECTIONS = tuple(k for k in RULES_SECTIONS if k not in PRIZE_ONLY_SECTIONS)

PRESETS: dict[str, Preset] = {
    p.key: p
    for p in (
        Preset(
            'challenge', 'Challenge (no prize)', 'Wyzwanie (bez nagrody)',
            'A problem set with a jury and a published ranking, and no prize — which keeps it outside the public-promise, gambling and tax rules entirely. The default; add a prize later as a deliberate step.',
            'Zestaw zadań z jury i publikowanym rankingiem, bez nagrody — co trzyma go poza regułami przyrzeczenia publicznego, gier losowych i podatków. Domyślny; nagrodę dodaje się później, świadomie.',
            'person', 'university', True, False, False, 'none', False, _ONE_ROUND, False, 1, 3, False, False, 'never', 14, 'initials',
            _NO_PRIZE_SECTIONS, _COMMON, _GOAL_COMMON, (_JURY_NEED,),
            (RoleSlot('jury', 2, False), RoleSlot('secretary', 1, False)),
            (('Without a prize there is no przyrzeczenie publiczne, so no claim deadline is required and no tax arises.', 'Bez nagrody nie ma przyrzeczenia publicznego, więc nie trzeba terminu ubiegania się o nagrodę i nie powstaje podatek.', ('kc_919',)),),
        ),
        Preset(
            'school', 'School contest (a teacher runs it)', 'Konkurs szkolny (prowadzi nauczyciel)',
            'The common case: pupils of one school, a teacher or the school as organiser, every entrant a minor. Guardian consent on every entry; initials on the results list; the "science" exemption up to 2 000 zł if a prize exists.',
            'Najczęstszy przypadek: uczniowie jednej szkoły, nauczyciel lub szkoła jako organizator, każdy uczestnik niepełnoletni. Zgoda opiekuna przy każdym zgłoszeniu; inicjały na liście wyników; zwolnienie „w dziedzinie nauki" do 2 000 zł, jeśli jest nagroda.',
            'person', 'secondary', True, True, True, 'science_68_then_10pct', False, _ONE_ROUND, False, 1, 3, False, False, 'never', 14, 'initials',
            _ALL_SECTIONS, _COMMON + _PRIZE + _MINORS, _GOAL_COMMON + _GOAL_PRIZE, (_JURY_NEED,),
            (RoleSlot('jury', 2, False), RoleSlot('secretary', 1, False)),
            (('A school contest run outside the kurator\'s regulation gives no exam exemption and its prizes are not covered by the pupils\' exemption; the "science" limb up to 2 000 zł is the one to rely on.', 'Konkurs szkolny poza rozporządzeniem kuratora nie daje zwolnienia z egzaminu, a jego nagrody nie podlegają zwolnieniu dla uczniów; właściwe jest zwolnienie „w dziedzinie nauki" do 2 000 zł.', ('pit_21_1_115', 'pit_21_1_68')),
             ('Whether an individual teacher is the płatnik of the 10% is an open question for a lawyer; a school (a legal person) is.', 'Czy nauczyciel jako osoba fizyczna jest płatnikiem 10% — to pytanie do prawnika; szkoła (osoba prawna) jest.', ('pit_41_4',))),
        ),
        Preset(
            'staged', 'Multi-stage contest (not a kurator\'s)', 'Konkurs wieloetapowy (nie kuratoryjny)',
            'A qualifying round online and a final — for a contest that wants stages without pretending to be a kuratorium one. Advancement by threshold or top-N, never by draw.',
            'Runda kwalifikacyjna online i finał — dla konkursu, który chce etapów, nie udając kuratoryjnego. Awans progiem lub top-N, nigdy losowaniem.',
            'person', 'secondary', True, False, True, 'science_68_then_10pct', False, _TWO_ROUNDS, False, 2, 3, False, False, 'if_business', 14, 'initials',
            _ALL_SECTIONS, _COMMON + _PRIZE + _MINORS + ('consumer_block',), _GOAL_COMMON + _GOAL_PRIZE, (_JURY_NEED, _PROCTOR_NEED),
            (RoleSlot('jury', 3, False), RoleSlot('secretary', 1, False), RoleSlot('proctor', 1, False)),
        ),
        Preset(
            'university', 'University or faculty contest', 'Konkurs uczelniany / wydziałowy',
            'For students; the university (not the faculty) is the legal person behind it, the płatnik and the controller. Not a competition for a post or a grant call — those are different things that share the word.',
            'Dla studentów; osobą prawną, płatnikiem i administratorem jest uczelnia (nie wydział). To nie konkurs na stanowisko ani konkurs grantowy — to inne rzeczy o tej samej nazwie.',
            'organization', 'university', False, False, True, 'science_68_then_10pct', False, _ONE_ROUND, False, 2, 3, False, False, 'never', 14, 'full_name_opt_in',
            _ALL_SECTIONS, _COMMON + _PRIZE + _LEGAL_PERSON, _GOAL_COMMON + _GOAL_PRIZE, (_JURY_NEED,),
            (RoleSlot('jury', 3, False), RoleSlot('secretary', 1, False)),
            (('Students are not "pupils": the no-cap exemption does not reach them; the "science" limb up to 2 000 zł and 10% above it do.', 'Studenci to nie „uczniowie": zwolnienie bez limitu ich nie obejmuje; obejmuje ich zwolnienie „w dziedzinie nauki" do 2 000 zł i 10% powyżej.', ('pit_21_1_115', 'pit_21_1_68', 'pit_30_1_2')),),
        ),
        Preset(
            'student_circle', 'Student circle contest', 'Konkurs koła naukowego',
            'As the university preset, with the university named as the legal person behind the circle — a koło is usually not one itself — and an "approved by" line for its supervisor.',
            'Jak wariant uczelniany, z uczelnią wskazaną jako osoba prawna stojąca za kołem — koło zwykle nią nie jest — i linią „zatwierdzone przez" opiekuna.',
            'organization', 'university', False, False, True, 'science_68_then_10pct', False, _ONE_ROUND, False, 1, 3, False, False, 'never', 14, 'full_name_opt_in',
            _ALL_SECTIONS, _COMMON + _PRIZE + _LEGAL_PERSON, _GOAL_COMMON + _GOAL_PRIZE, (_JURY_NEED,),
            (RoleSlot('jury', 2, False), RoleSlot('secretary', 1, False)),
            (('Prizes here are usually small and in kind: the winner pays the tax before receiving the prize unless the regulamin grosses it up.', 'Nagrody są tu zwykle małe i rzeczowe: laureat płaci podatek przed odbiorem, chyba że regulamin je ubruttowia.', ('pit_41_7',)),),
        ),
        Preset(
            'organization', 'On behalf of an organisation', 'W imieniu organizacji',
            'An organisation this site already knows is the organiser: its identity is inherited as the przyrzekający, the controller and the płatnik instead of being asked for again.',
            'Organizatorem jest organizacja znana temu serwisowi: jej tożsamość jako przyrzekającego, administratora i płatnika jest dziedziczona, nie wpisywana ponownie.',
            'organization', 'all', True, False, True, 'science_68_then_10pct', False, _ONE_ROUND, False, 2, 3, False, False, 'if_business', 14, 'initials',
            _ALL_SECTIONS, _COMMON + _PRIZE + _MINORS + _LEGAL_PERSON + ('consumer_block',), _GOAL_COMMON + _GOAL_PRIZE, (_JURY_NEED,),
            (RoleSlot('jury', 3, False), RoleSlot('secretary', 1, False)),
        ),
        Preset(
            'open_online', 'Open online contest with prizes', 'Otwarty konkurs internetowy z nagrodami',
            'Anyone may enter and a prize is promised: the full regulamin, the full tax block with the gross-up calculator, the explicit no-draw attestation, and the consumer block if the organiser is a business. The highest-risk kind.',
            'Każdy może wziąć udział, a nagroda jest przyrzeczona: pełny regulamin, pełny blok podatkowy z kalkulatorem ubruttowienia, wyraźne oświadczenie o braku losowania i blok konsumencki, jeśli organizator jest przedsiębiorcą. Najbardziej ryzykowny rodzaj.',
            'person', 'all', False, False, True, 'flat_10pct', False, _ONE_ROUND, False, 3, 3, False, False, 'if_business', 14, 'initials',
            _ALL_SECTIONS, _COMMON + _PRIZE + ('payer_identity', 'pit_8ar', 'consumer_block'), _GOAL_COMMON + _GOAL_PRIZE, (_JURY_NEED,),
            (RoleSlot('jury', 3, True), RoleSlot('secretary', 1, False)),
            (('Do not rely on the "mass media" limb of the 2 000 zł exemption for an internet announcement — it is disputed; the "science" limb needs no media at all.', 'Nie opieraj się na „środkach masowego przekazu" przy ogłoszeniu w internecie — to sporne; człon „w dziedzinie nauki" nie wymaga żadnych mediów.', ('pit_21_1_68',)),),
        ),
        Preset(
            'team', 'Team contest', 'Konkurs zespołowy',
            'Teams enter together. The regulamin must say how a team prize is split and who receives each share — otherwise a disputed joint prize is a matter for a court.',
            'Zespoły zgłaszają się razem. Regulamin musi mówić, jak dzieli się nagrodę zespołową i kto otrzymuje każdą część — inaczej sporną nagrodę wspólną dzieli sąd.',
            'person', 'secondary', True, False, True, 'science_68_then_10pct', True, _TWO_ROUNDS, False, 2, 3, False, False, 'if_business', 14, 'initials',
            _ALL_SECTIONS, _COMMON + _PRIZE + _MINORS + ('team_split', 'consumer_block'), _GOAL_COMMON + _GOAL_PRIZE, (_JURY_NEED, _PROCTOR_NEED),
            (RoleSlot('jury', 3, False), RoleSlot('secretary', 1, False), RoleSlot('proctor', 1, False)),
        ),
        Preset(
            'kuratorium', 'Kurator\'s subject contest (konkurs przedmiotowy)', 'Konkurs przedmiotowy kuratoryjny',
            'Organised by the kurator oświaty under the 2002 regulation, listed by the minister; a laureate is exempt from that part of the egzamin ósmoklasisty. Only a platform operator may found one here, and the kurator\'s own announcement must be linked. The stage ladder is the kuratorium\'s usual three and may be edited.',
            'Organizowany przez kuratora oświaty na podstawie rozporządzenia z 2002 r., w wykazie ministra; laureat jest zwolniony z tej części egzaminu ósmoklasisty. Założyć go może tu tylko operator platformy, a ogłoszenie kuratora musi być podlinkowane. Drabina etapów to zwyczajowe trzy kuratorium i można ją edytować.',
            'kurator', 'primary', True, True, True, 'pupil_exempt_115', False, _SCHOOL_LADDER, False, 3, 3, True, True, 'never', 7, 'full_name_opt_in',
            _ALL_SECTIONS, _COMMON + _MINORS + ('external_reference', 'wykaz_listed', 'certificates_issued', 'prizes_handed'), _GOAL_COMMON + (('Certificates are issued to laureates and finalists', 'Zaświadczenia wydano laureatom i finalistom'),), (_JURY_NEED, _PROCTOR_NEED),
            (RoleSlot('jury', 3, True), RoleSlot('secretary', 1, True), RoleSlot('proctor', 2, False)),
            (('A laureate of a wojewódzki konkurs przedmiotowy is exempt from that part of the egzamin ósmoklasisty, scored 100%. This describes the kurator\'s contest; this site promises nothing.', 'Laureat wojewódzkiego konkursu przedmiotowego jest zwolniony z tej części egzaminu ósmoklasisty z wynikiem 100%. To opis konkursu kuratora; ten serwis niczego nie obiecuje.', ('uso_44zx', 'po_132')),
             ('Pupils\' prizes in a contest run on the education-system basis are exempt from tax without a cap.', 'Nagrody uczniów w konkursie prowadzonym na podstawie przepisów o systemie oświaty są zwolnione z podatku bez limitu.', ('pit_21_1_115',)),
             ('The regulation does not fix the stages of a konkurs; the szkolny → rejonowy → wojewódzki ladder is the kuratoria\'s practice.', 'Rozporządzenie nie ustala etapów konkursu; drabina szkolny → rejonowy → wojewódzki to praktyka kuratoriów.', ('menis_2002',))),
        ),
        Preset(
            'olympiad', 'Subject olympiad (olimpiada przedmiotowa)', 'Olimpiada przedmiotowa',
            'Three fixed stages under the 2002 regulation, a komitet główny at a university or research institute, an appeal procedure that the regulation makes mandatory; a laureate or finalist is exempt from the matura in that subject. Staff-only here, with the committee\'s announcement linked.',
            'Trzy stałe etapy z rozporządzenia z 2002 r., komitet główny przy uczelni lub instytucie, obowiązkowy tryb odwoławczy; laureat lub finalista jest zwolniony z matury z tego przedmiotu. Tylko dla operatora platformy, z podlinkowanym ogłoszeniem komitetu.',
            'committee', 'secondary', True, True, True, 'pupil_exempt_115', False, _OLYMPIAD_LADDER, True, 3, 5, True, True, 'never', 7, 'full_name_opt_in',
            _ALL_SECTIONS, _COMMON + _MINORS + ('external_reference', 'wykaz_listed', 'certificates_issued', 'prizes_handed'), _GOAL_COMMON + (('Certificates are issued to laureates and finalists', 'Zaświadczenia wydano laureatom i finalistom'),), (_JURY_NEED, _PROCTOR_NEED),
            (RoleSlot('jury', 5, True), RoleSlot('secretary', 1, True), RoleSlot('proctor', 2, False)),
            (('A laureate or finalist of a listed olympiad is exempt from the matura in that subject, scored 100%; universities publish their admission rules for them in advance. Information about the committee\'s olympiad, not a promise by this site.', 'Laureat lub finalista olimpiady z wykazu jest zwolniony z matury z tego przedmiotu z wynikiem 100%; uczelnie publikują z wyprzedzeniem zasady ich przyjęć. To informacja o olimpiadzie komitetu, nie obietnica tego serwisu.', ('uso_44zzh', 'pswin_70_6')),
             ('The three stages are the regulation\'s and cannot be edited here.', 'Trzy etapy wynikają z rozporządzenia i nie można ich tu edytować.', ('menis_2002_olimp',))),
        ),
    )
}

#: In the order the wizard shows them: the safe default first, the staff-only ones last.
PRESET_KEYS = tuple(PRESETS)

#: `prize_regime` values — mirrored in labels.ts.
PRIZE_REGIMES = ('none', 'pupil_exempt_115', 'science_68_then_10pct', 'flat_10pct')
#: `organiser_kind` values — mirrored in labels.ts.
ORGANISER_KINDS = ('person', 'organization', 'kurator', 'committee')
#: `advancement` values a stage may carry. There is deliberately no `draw` (CONTESTS-LAW.md §2).
ADVANCEMENTS = ('all', 'threshold', 'top_n', 'final')
#: The 2 000 zł line of PIT art. 21 ust. 1 pkt 68, in grosz — the one number the tax copy shows.
PIT_68_THRESHOLD_PLN = 2000
#: The gross-up divisor of the ubruttowienie practice (PIT art. 41 ust. 7): a net in-kind prize is
#: declared as prize / 0.9 so that the 10% is withheld from the cash part.
GROSS_UP_DIVISOR = 0.9


# ---- what the preset becomes on the contest node (personalize.py) -------------------------------
#
# `personalize.apply_preset` turns a preset into rows in the OTHER apps — one `plans.Plan` with the
# timeline, one `goals.Goal` whose criteria are the definition of done, one `tasks.Task` per
# checklist item, the `needs.Need`s and one draft `decisions.Poll`. The MECHANISM is that module's;
# the WORDS are here, with everything else a preset says, so that the two languages of a sentence
# sit on one line and a reviewer can see that the Polish still says what the English does (the
# `content/about.ts` reasoning, applied to a seed).
#
# Polish first in every pair below, because Polish is this platform's base interface language and
# the original a `translations.TextVersion` row carries (`write_versions(original_locale='pl')`).


@dataclass(frozen=True)
class PlanPhase:
    """One step of the contest's timeline, as a `plans.PlanStep`.

    `anchor` says where its due date comes from, and the five values are the only dates a contest
    has before step A's stage rows exist: `starts_at`, `registration_opens_at`,
    `registration_closes_at`, `ends_at`, and `ends_at` plus the complaints window. A stage's own
    two steps are generated per `StageTemplate` instead and carry its offsets.
    """

    key: str
    title_en: str
    title_pl: str
    body_en: str
    body_pl: str
    #: `start` · `registration_opens` · `registration_closes` · `end` · `complaints_close` ·
    #: `handover` (the prize-handover date, 30 days after the end) — or `none` for a step whose
    #: date nobody can know yet.
    anchor: str
    #: False for a step that only exists when a prize is promised.
    prize_only: bool = False


#: The plan `apply_preset` writes, and the steps every contest's timeline has whatever its preset.
#: The per-stage steps are inserted between `registration_closes` and `judging`, in stage order.
PLAN_TITLE = ('Running the contest', 'Przeprowadzenie konkursu')
PLAN_DESCRIPTION = (
    'The timeline this kind of contest runs on, written from its preset when the contest was '
    'founded. Dates come from the contest\'s own dates; a step whose date is not knowable yet is '
    'left open. Edit it freely — this is a starting point, not a rule.',
    'Kalendarz, według którego biegnie konkurs tego rodzaju, zapisany z wariantu w chwili '
    'założenia konkursu. Terminy pochodzą z dat samego konkursu; krok, którego daty jeszcze nie '
    'da się ustalić, pozostaje bez terminu. Można go dowolnie zmieniać — to punkt wyjścia, '
    'nie reguła.',
)

PLAN_PHASES: tuple[PlanPhase, ...] = (
    PlanPhase(
        'announce', 'Announce the contest', 'Ogłoszenie konkursu',
        'The rules are published and the contest leaves draft. Until it does, nobody but its staff '
        'can see that it exists.',
        'Regulamin jest opublikowany i konkurs wychodzi z wersji roboczej. Dopóki tego nie zrobi, '
        'nikt poza organizatorami nie widzi, że istnieje.',
        'start',
    ),
    PlanPhase(
        'registration_opens', 'Registration opens', 'Otwarcie zapisów',
        'Entrants can register from this moment. A minor needs a guardian\'s consent recorded on '
        'the registration where the rules allow minors at all.',
        'Od tej chwili można się zapisywać. Osoba niepełnoletnia potrzebuje zgody opiekuna '
        'zapisanej przy zgłoszeniu — tam, gdzie regulamin dopuszcza udział niepełnoletnich.',
        'registration_opens',
    ),
    PlanPhase(
        'registration_closes', 'Registration closes', 'Zamknięcie zapisów',
        'The last moment to enter. After it the list of entrants is the list of entrants.',
        'Ostatni moment na zgłoszenie. Po nim lista uczestników jest już listą uczestników.',
        'registration_closes',
    ),
    PlanPhase(
        'judging', 'Judging', 'Ocenianie',
        'Every stage is closed and the jury scores against the published criteria. A tie is broken '
        'on merit and never by drawing lots.',
        'Wszystkie etapy są zamknięte, a jury ocenia według opublikowanych kryteriów. Remis '
        'rozstrzyga się merytorycznie, nigdy losowaniem.',
        'end',
    ),
    PlanPhase(
        'results', 'Publish the results', 'Ogłoszenie wyników',
        'The ranking goes out in the form the rules promised — initials by default; a full name '
        'only where the entrant consented to one separately.',
        'Ranking idzie w świat w formie obiecanej w regulaminie — domyślnie inicjały; pełne imię '
        'i nazwisko tylko tam, gdzie uczestnik zgodził się na to osobno.',
        'end',
    ),
    PlanPhase(
        'complaints_close', 'The complaints window closes', 'Zamknięcie okna reklamacji',
        'Every complaint lodged within the window has an answer with reasons by this date.',
        'Każda reklamacja złożona w terminie ma do tego dnia odpowiedź z uzasadnieniem.',
        'complaints_close',
    ),
    PlanPhase(
        'prizes_handed', 'Hand over the prizes', 'Wydanie nagród',
        'Every prize is handed over by the date the rules give, and the tax on it is settled.',
        'Każda nagroda jest wydana w terminie z regulaminu, a podatek od niej rozliczony.',
        'handover', True,
    ),
    PlanPhase(
        'close', 'Close the contest', 'Zamknięcie konkursu',
        'Complaints decided, prizes handed over, certificates issued. Nothing more is owed.',
        'Reklamacje rozstrzygnięte, nagrody wydane, zaświadczenia wystawione. Nic więcej nie jest '
        'należne.',
        'handover',
    ),
)

#: A stage becomes two steps, so that "opens" and "closes" can be ticked apart — which is what the
#: jury's work actually hangs on.
STAGE_STEP_OPENS = ('{name} opens', 'Otwarcie: {name}')
STAGE_STEP_CLOSES = ('{name} closes', 'Zamknięcie: {name}')

GOAL_TITLE = (
    'The contest is run the way its rules promise',
    'Konkurs przeprowadzony tak, jak obiecuje regulamin',
)
GOAL_DESCRIPTION = (
    'The lines below are what "done" means for this contest, and nothing else sets it: the status '
    'is derived from them. They come from the contest\'s preset and are the organiser\'s to edit.',
    'Poniższe punkty są definicją ukończenia tego konkursu i nic innego jej nie ustala: status '
    'wynika z nich. Pochodzą z wariantu konkursu i organizator może je zmieniać.',
)

#: The one decision `apply_preset` opens, as a DRAFT poll: the jury confirming the ranking before it
#: is published. A draft because a poll that opened itself would be a vote nobody was told about,
#: and because `decisions/views.py` lets a draft's question still be edited.
POLL_QUESTION = ('Confirm the final ranking', 'Zatwierdzenie końcowego rankingu')
POLL_DESCRIPTION = (
    'For the jury, before the results are published. A vote here records agreement; it does not '
    'decide anything a criterion did not already decide — the ranking is the scores, and chance '
    'never enters it.',
    'Dla jury, przed opublikowaniem wyników. Głos tutaj zapisuje zgodę; nie rozstrzyga niczego, '
    'czego nie rozstrzygnęły już kryteria — ranking to punkty, a los nigdy do niego nie wchodzi.',
)
POLL_OPTIONS = (
    ('The ranking is confirmed', 'Ranking zatwierdzony'),
    ('Not yet — it needs correcting', 'Jeszcze nie — wymaga korekty'),
)

#: A checklist item's `phase` -> how its task's due date is worked out. `complaint_window_days` is
#: the contest's own (step A's field) or the preset's.
TASK_PHASE_ANCHORS = {
    'before_announce': 'start_minus_7',
    'before_results': 'end',
    'after_results': 'complaints_close',
    'at_close': 'handover',
}

#: Days before `starts_at` a `before_announce` task is due, and days after `ends_at` the prizes are
#: handed over. Both are the brief's (`prompts/19-contests-b-personalise.md`), not the law's: the
#: law fixes the complaints window and the claim deadline, and leaves these to the organiser.
BEFORE_ANNOUNCE_LEAD_DAYS = 7
HANDOVER_DAYS_AFTER_END = 30

#: Appended to every task description and shown by the compliance panel. CONTESTS-LAW.md §14: this
#: project has never had a Polish lawyer read any of it, and the copy has to say so.
NOT_LEGAL_ADVICE = (
    'This is not legal advice. Every reference above carries how well it was checked, and nobody '
    'on this project is a lawyer.',
    'To nie jest porada prawna. Każde powołanie powyżej ma zapisane, jak dobrze zostało '
    'sprawdzone, i nikt w tym projekcie nie jest prawnikiem.',
)

#: What a marker means where it is shown next to a citation. Mirrored in
#: `frontend/src/lib/utils/labels.ts` as `LAW_MARKER_LABELS` (house rule 13, said in both).
MARKER_WORDS = {
    'verified': ('checked against the text', 'sprawdzone w tekście'),
    'secondary': ('from an authoritative restatement', 'z autorytatywnego omówienia'),
    'unverified': ('NOT checked — the number is from memory', 'NIESPRAWDZONE — numer z pamięci'),
    'disputed': ('disputed — a lawyer must decide', 'sporne — musi rozstrzygnąć prawnik'),
}

#: The heading above the citations inside a task's description.
LAW_HEADING = ('What this comes from', 'Z czego to wynika')


def citation_block(law_keys, locale: str = 'en') -> str:
    """The citations of one checklist item as Markdown, each with its marker, plus the
    not-legal-advice sentence — the body `personalize` puts on a task.

    Markers are rendered as words rather than as a bare `[UNVERIFIED]`, because the reader is an
    organiser and not the person who wrote the research note. One bullet per citation, in the order
    the item lists them.
    """
    index = 0 if locale != 'pl' else 1
    lines = [f'**{LAW_HEADING[index]}**', '']
    for key in law_keys:
        entry = LAW.get(key)
        if entry is None:
            continue
        citation, marker = entry
        if index == 1:
            citation = LAW_PL.get(key, citation)
        word = MARKER_WORDS.get(marker, (marker, marker))[index]
        lines.append(f'- {citation} — *{word}*')
    lines.append('')
    lines.append(f'*{NOT_LEGAL_ADVICE[index]}*')
    return '\n'.join(lines)


def get(key: str) -> Preset | None:
    return PRESETS.get(key)


def visible_to(user) -> list[Preset]:
    """The presets this founder may start from: everyone sees the public ones, a platform operator
    also sees the staff-only two (CONTESTS-LAW.md §14 item 9)."""
    is_staff = bool(user and getattr(user, 'is_authenticated', False) and user.is_staff)
    return [p for p in PRESETS.values() if is_staff or not p.staff_only]


def checklist_for(preset: Preset, has_prize: bool | None = None) -> list[ChecklistItem]:
    """The legal checklist this contest owes, in order.

    `has_prize` is the CONTEST's own answer when the caller has a row to ask (`personalize`, the
    compliance panel); left `None` the preset's own default stands, which is what the presets
    endpoint and the wizard's preview want before a contest exists. A prize turned OFF drops the
    prize-only items; a prize turned ON on a preset that does not list them does NOT add them,
    because a preset's `checklist` tuple is the list of what a contest of that kind owes and
    inventing rows it never named would make the wizard's preview a lie. Turning a prize on where
    the preset did not expect one is `open_online`'s job, and the wizard says so.
    """
    items = [CHECKLIST[k] for k in preset.checklist]
    prize = preset.has_prize if has_prize is None else bool(has_prize)
    if not prize:
        items = [c for c in items if c.key not in PRIZE_ONLY_CHECKLIST]
    return items


def goal_criteria_for(preset: Preset, has_prize: bool | None = None) -> list[tuple[str, str]]:
    """The goal's definition of done: `(en, pl)` per line, in order. Same `has_prize` rule as
    `checklist_for` — "every prize handed over and its tax settled" is not a condition a prize-free
    challenge can ever meet, and a criterion nobody can tick is a definition of done that never
    completes (`goals.rules.recount` derives `met` from the list, house rule 5)."""
    prize = preset.has_prize if has_prize is None else bool(has_prize)
    criteria = list(preset.goal_criteria)
    if not prize:
        criteria = [c for c in criteria if c not in PRIZE_ONLY_GOAL_CRITERIA]
    return criteria


def sections_for(preset: Preset) -> list[RulesSection]:
    return [RULES_SECTIONS[k] for k in preset.rules_sections]


def law_as_api() -> dict:
    """`{key: {citation, marker}}`, sent ONCE beside the presets rather than repeated on every
    checklist line — the frontend's compliance panel joins on the key."""
    return {
        k: {'citation': c, 'citation_pl': LAW_PL.get(k, c), 'marker': m}
        for k, (c, m) in LAW.items()
    }


def preset_to_api(preset: Preset) -> dict:
    data = asdict(preset)
    data['stages'] = [asdict(s) for s in preset.stages]
    data['roles'] = [asdict(r) for r in preset.roles]
    data['rules_sections'] = [{**asdict(s), 'law': list(s.law)} for s in sections_for(preset)]
    data['checklist'] = [{**asdict(c), 'law': list(c.law)} for c in checklist_for(preset)]
    data['goal_criteria'] = [{'en': en, 'pl': pl} for en, pl in preset.goal_criteria]
    data['needs'] = [{'kind': k, 'title_en': en, 'title_pl': pl, 'wanted_count': n} for k, en, pl, n in preset.needs]
    data['info'] = [{'en': en, 'pl': pl, 'law': list(law)} for en, pl, law in preset.info]
    return data


def as_api(user=None) -> dict:
    """What `GET /api/contest-presets/` answers: `{'law': {...}, 'presets': [...]}`, the presets
    in wizard order and filtered by who is asking (`visible_to`)."""
    return {'law': law_as_api(), 'presets': [preset_to_api(p) for p in visible_to(user)]}
