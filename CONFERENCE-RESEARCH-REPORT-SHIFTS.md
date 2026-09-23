# Gemini Deep Research report — volunteer shift scheduling

Received 2026-09-23 in answer to the follow-up prompt at the end of `CONFERENCE-RESEARCH-PROMPT.md`
(section 6 of the prompt). Companion to `CONFERENCE-RESEARCH-REPORT.md`. Pasted from the Gemini
output, which lost its line breaks and table grid; headings, lists and one-row-per-line tables
were restored by hand, the wording is Gemini's. Citations did not survive the paste — treat every
statute article number and every claim about a tool as **unverified** until checked. Not yet
reconciled.

Three things in this report contradict decisions EdMat has already made, noted here so the
reconciliation does not miss them:

- It recommends **badge-token authentication** (a passphrase or QR printed on the badge) and
  argues against email magic links. EdMat already has accounts with token login; the shift board
  needs no new authentication. Its own decision 5 admits badge tokens break pre-event scheduling.
- It says **do not build in-app messaging**. EdMat has a messaging app already, and minors
  cannot message or be messaged by server rule. The point to keep is narrower: no volunteer
  chat channel inside the rota, and no volunteer-to-volunteer contact data.
- Its minor rules assume **under 18**; EdMat's guardian model is **under 16** (GDPR Art. 8 as
  transposed in Poland). The Labour Code limits it cites (8 h, or 7 h under 16; no 22:00–06:00;
  14 h rest) are applied "by analogy" — Gemini's inference, not a rule the statute states for
  volunteers. The report's own last section says the Lex Kamilek question is unsettled.

---

# Volunteer Shift Scheduling in Academic Event Operations: Systems Architecture, Data Invariants, and Legal Compliance

## 1. Comparative Evaluation of Volunteer Scheduling Systems

Managing student and peer volunteers for an academic conference of 50 to 500 attendees staffed by 5 to 40 volunteers is fundamentally an exercise in scheduling temporal availability rather than filling abstract functional roles. In an academic conference, a volunteer is rarely a fungible, full-time laborer; rather, they are a dual-status participant who balances operational duties against presenting papers, attending technical sessions, and networking with senior colleagues. When the volunteer cohort includes minors participating with statutory guardian consent, temporal scheduling must strictly enforce civil protections and child-safeguarding guardrails alongside physical venue logistics.

The landscape of shift coordination software reflects four distinct architectural paradigms: open-source community self-service tools, enterprise non-profit volunteer suites, casual workforce task dispatchers, and custom academic student volunteer auction frameworks.

Comparison (columns: scheduling paradigm and allocation / swapping / hours tracking / safeguarding and minors / architecture, delivery, cost / fit for 5–40 volunteers at a 50–500 person academic conference):

- **Engelsystem** — Open self-signup gated by qualified role types (Angeltypes); supports arrival-gated claiming and nocturnal multipliers. / Unilateral unsubscription before a deadline; vacated slot returns to the open pool. No bilateral peer swap mechanism. / Planned vs. attended hours logged; vouchers awarded based on hours or shift counts; freeload penalty flags. / Configurable night windows (default 02:00–08:00). No native minor-consent or guardian tracking. / Self-hosted PHP/Laravel/MariaDB; open-source (GPLv2); zero licence fees; requires dedicated hosting; email optional. / Excellent for technical teams willing to self-host, but administratively heavy for small teams without dedicated server infrastructure.
- **Bloomerang Volunteer (formerly InitLive)** — Centralized administrative scheduling with rule-based auto-assignment, paired with mobile self-service claiming. / Peer-to-peer shift trading and drop-and-pickup workflows via native mobile apps with manager approval. / In-app mobile time-clock, QR check-in kiosks, real-time attendance dashboards synced with impact metrics. / Integrated criminal background check workflows. Minor working-hour restrictions require manual oversight. / Commercial SaaS; annual or per-event subscription; requires email delivery and app store downloads. / Ill-suited for zero-budget events; setup overhead exceeds coordination value under 40 volunteers.
- **Zelos Team Management** — Broadcast task board (first-come, first-served) or applicant queue with administrative review; no auto-scheduler. / Shift drop, pickup, and peer swap requests routed through configurable approval gates. / Task completion self-confirmation; hours tracking with CSV export. / Participant contact details hidden between peers by default. No native minor hour caps or parental consent tracking. / Commercial SaaS; EU-hosted; perpetual free tier (limited to 25 concurrent tasks); web and mobile. / Highly accessible for zero-budget operations, but the 25-task cap creates friction for multi-track conferences.
- **CHISV and academic SV systems (SIGGRAPH, SIGCSE)** — Day-ahead interactive task bidding resolved by an auction algorithm balancing volunteer preference and task priority. / Manual peer matchmaking via external chat (Slack/Discord), followed by coordinator entry. / Service quotas (6 to 20 hours for pass waivers); tracked by day captains and committee chairs. / Strict age gates (frequently 18+ at registration). Minor workflows require bespoke offline processing. / Custom university software (Python/Node.js); open-source forks; custom deployment and maintenance. / Ideal operational logic for academic conferences, but requires custom technical setup and lacks turnkey distribution.

Engelsystem was created for large hacker conventions such as the Chaos Communication Congress, where it coordinates thousands of helpers. In observed practice, it relies on a high-trust, decentralized organizational culture where volunteers register for specific capabilities (Angeltypes) and independently claim open shifts across venue halls. Vendor and developer documentation highlights its arrival-gated claiming feature, which prevents volunteers from claiming shifts until they have physically checked in with organizers, as well as its tracking of unexcused absences through "freeloading" penalty flags.

However, developer commits and system architecture confirm that Engelsystem lacks an automated bilateral shift-swapping mechanism. If a volunteer cannot make a commitment, they must cancel their assignment before a configured deadline (e.g., three hours prior), returning the slot to the public pool. Once that deadline passes, the unsubscription window closes, requiring manual administrative intervention to reassign the slot.

Commercial platforms like Bloomerang Volunteer take a top-down administrative approach. Vendor claims emphasize AI-assisted matching algorithms that fill shifts by aligning volunteer skills, availability, and interests. In observed practice within non-profit event operations, these platforms cater to large, predictable workforce pools; when deployed in academic conferences, their rigid templates often fail to capture conference presentation schedules, forcing committee members to coordinate exceptions via external spreadsheets.

By contrast, custom systems built for major computer science conferences—such as the CHISV framework developed at RWTH Aachen and platforms deployed at ACM SIGGRAPH and SIGCSE—reflect the dual role of the student volunteer. Observed academic practice shows that student volunteers provide between 6 and 20 hours of operational labor in exchange for waived conference fees, banquet access, and mentoring sessions. Rather than publishing static rosters weeks in advance, CHISV implements day-ahead interactive task bidding resolved by an auction algorithm. This mechanism maximizes preferences and guarantees that students are not rostered during sessions where they present papers or participate in research competitions.

Shift swapping in these academic environments is often handled through manual matchmaking: volunteers negotiate trades directly in event chat channels, and day captains record the approved changes in the master schedule. Zelos offers an intermediate dispatch model with self-signup and task-specific chat threads. However, its free tier limits deployments to 25 concurrent active tasks, creating operational challenges for multi-day, multi-track academic symposia.

Our engineering inference is that for an academic conference with 5 to 40 volunteers, neither the massive self-serve architecture of Engelsystem nor the auction algorithms of CHISV represent a practical turnkey choice. An academic conference requires a relational model that enforces scheduling invariants, accounts for minor volunteer protections, and handles bilateral swaps without enterprise SaaS costs or server maintenance.

## 2. Domain Data Model and Relational Invariants

### Entity Relationships and Structural Overview

The domain model is structured around five core entities: Station, Shift, Assignment, Swap Request, and Hours Log.

A Station represents an operational post, physical room, or functional role within the conference venue, such as a registration desk, session room, or speaker preparation room. Each Station maintains a one-to-many relationship with Shifts, defining the specific time windows during which that post requires coverage.

Each Shift maintains a one-to-many relationship with Assignments, which record the allocation of individual volunteers to that time block. An Assignment exists in a specific lifecycle state (CONFIRMED, ATTENDED, NO_SHOW, or CANCELLED).

When a volunteer cannot fulfill a confirmed assignment, a Swap Request is instantiated. The Swap Request references the source Assignment and can either target a specific replacement volunteer or be released to the open pool of qualified peers.

Once a shift concludes, an Assignment transitions into an immutable Hours Log. This log captures actual service hours, adjustments, and the verifying organizer's credentials, serving as an audit trail for legal compliance and academic pass waivers.

### Entity Definitions and Attributes

**Station** — operational requirements, physical location, safety parameters: station_id; name (e.g., "Main Auditorium Track A AV Support", "Registration & Information Desk"); description (operational checklist, standard operating procedures, run-sheet); location_room; required_skill_level (STANDARD, TECHNICAL_AV, CHAIRING); is_minor_permitted (whether volunteers under 18 may staff the post); requires_adult_supervision (whether a minor must be paired with an adult co-volunteer).

**Shift** — a temporal block requiring coverage at a station: shift_id; station_id; start_time and end_time (timestamps with time zone); min_volunteers (minimum staffing threshold to maintain operations); target_volunteers (ideal quota); max_volunteers (ceiling to prevent over-staffing and credit dilution).

**Assignment** — links a volunteer to a shift: assignment_id; shift_id; volunteer_id; status (CONFIRMED, ATTENDED, NO_SHOW, CANCELLED); assignment_source (SELF_CLAIM, ADMIN_DIRECT, SWAP_RESOLVED); created_at, updated_at.

**Swap Request** — schedule trades and transfers: swap_request_id; source_assignment_id (the assignment being vacated); target_volunteer_id (nullable: the intended recipient for direct swaps, null for pool swaps); target_assignment_id (nullable: populated during bilateral trades involving two distinct shifts); status (PENDING, PEER_ACCEPTED, ORGANISER_APPROVED, REJECTED, CANCELLED, EXPIRED); peer_accepted_at; organiser_approved_at.

**Hours Log** — completed volunteer service: log_id; assignment_id (unique, one-to-one); volunteer_id; recorded_start; recorded_end; credited_hours (decimal, net of breaks or adjustments); verified_by_admin_id; verification_timestamp.

### Mathematical and Business Invariants

Let V be the set of volunteers, S the set of shifts, A the set of assignments, T the set of stations. For an assignment a, v(a) is its volunteer, s(a) its shift, station(s) the station of shift s, start(s) and end(s) its bounds, duration(s) = end(s) − start(s) in hours. V_minor ⊂ V are volunteers under 18 on the day of the shift.

**Temporal non-overlap.** For any two distinct assignments a_i, a_j with status in {CONFIRMED, ATTENDED}: if v(a_i) = v(a_j) then [start(s(a_i)), end(s(a_i))) ∩ [start(s(a_j)), end(s(a_j))) = ∅. To accommodate room transit and rest, the engine should also enforce a minimum buffer Δt_buffer ≥ 15 minutes between consecutive duties: start(s(a_j)) ≥ end(s(a_i)) + Δt_buffer, or the symmetric case.

**Capacity conservation.** The number of CONFIRMED assignments on a shift ≤ max_volunteers(s). A shift is flagged operationally deficient if CONFIRMED assignments < min_volunteers(s).

**Minor safeguarding and rest.** For any m ∈ V_minor: total scheduled duration in any calendar day ≤ 8 hours (7 hours under 16); between two consecutive shifts start(s(a_j)) − end(s(a_i)) ≥ 14 consecutive hours; no shift overlapping the night window 22:00–06:00; no assignment unless guardian consent is on file (consent(v) = TRUE).

**Station eligibility and supervision.** v(a) ∈ V_minor ⇒ is_minor_permitted(station(s(a))) = TRUE. If requires_adult_supervision(station(s(a))) then there exists a CONFIRMED assignment a_sup on the same shift with v(a_sup) ∉ V_minor.

**Swap request atomicity.** A bilateral swap between a_src (held by v_src) and a_tgt (held by v_tgt) can only resolve to ORGANISER_APPROVED if the resulting schedules for both volunteers satisfy all non-overlap, daily-hours and rest invariants. The state transition executes as one atomic transaction, swapping ownership simultaneously or rolling back entirely on validation failure.

## 3. User Interface Specifications: Visibility and Permissions

### Volunteer application views (shows / hides)

- **Personal Schedule & Rota Dashboard** — Shows: confirmed shifts, countdown timers, co-volunteer first names, coordinator desk location, completed hours log. Hides: peer phone/email contacts, peer minor statuses, venue-wide staffing deficits, manual override controls.
- **Open Shifts & Available Duty Board** — Shows: unfilled shifts, station room locations, vacancies, "Claim Shift" button (with invariant checks). Hides: admin-reserved shifts, clashing shifts, night shifts (for minors), internal task difficulty ratings.
- **Shift Detail & Swap Action View** — Shows: station operational run-sheets, "Initiate Swap" button, recipient selector, swap status tracking. Hides: identifiers of previous assignment holders, full personal schedules of other volunteers.
- **Service Summary & Certification** — Shows: verified hours logs, certifying coordinator names, cumulative completed hours, "Download Certificate". Hides: raw system timestamps, compliance check hashes, internal coordinator performance notes.

### Organiser management views (shows / hides)

- **Master Schedule Gantt & Venue Grid** — Shows: multi-track timeline grid, colour-coded staffing status, vacancy counts, minor supervision alerts, filters. Hides: authentication tokens, password hashes, session keys.
- **Volunteer Profile & Safeguarding** — Shows: full legal names, dates of birth, minor badges, guardian consent scan links, RPS check IDs, KRK audit dates. Hides: passphrases; the organiser view otherwise has unrestricted visibility over compliance and operational profile data.
- **Swap & Schedule Exception Queue** — Shows: pending swap transactions, source/target volunteers, automated invariant check badges, Approve/Reject buttons. Hides: shifts unaffected by the active swap.
- **Attendance Kiosk & Hours Auditing** — Shows: current shift check-in rosters, "Mark Attended" toggles, manual duration overrides, audit CSV export. Hides: volunteer credentials, personal contact directories, unrelated session details.

### Volunteer-facing interface detail

**Personal Schedule & Rota Dashboard** displays: a chronological list of confirmed shifts with station name, room, start, end and duration; the next shift with a countdown; co-volunteers on the same shift (first name and last initial only); the coordinator's name and headquarters desk location; a running total of credited hours against the target for a pass waiver. It hides: other volunteers' phone numbers and email addresses; peers' minor status or birthdates; internal notes or venue-wide staffing deficits; administrative override buttons.

**Open Shifts & Available Duty Board** displays: shifts with vacant capacity, filtered to exclude times clashing with the volunteer's own roster; station title, room, functional category (AV, Registration, Badging, Pack-down); remaining capacity ("1 of 2 slots open"); a "Claim Shift" button enabled only when skill, age and rest invariants hold. It hides: shifts reserved for direct administrative allocation; shifts violating minor rest or night rules for an under-18 user; task difficulty ratings or VIP speaker annotations.

**Shift Detail & Swap Action View** displays: the full run-sheet for the station including checklists and handover procedures; an "Initiate Swap Request" button available until a fixed cutoff (e.g., 4 hours before start); a recipient selector (a specific peer or the open station-qualified pool); status badges (PENDING, PEER_ACCEPTED, AWAITING_ORGANISER). It hides: previous holders' identities; other volunteers' full rotas.

**Service Summary & Certification Screen** displays: verified hours logs with times and certifying organiser names; cumulative verified hours; a "Download Certificate" button generating a PDF Certificate of Volunteer Service (Zaświadczenie o wykonaniu świadczeń wolontariackich). It hides: raw timestamps, change logs, coordinator performance notes.

### Organiser-facing interface detail

**Master Schedule Gantt & Venue Grid** displays: stations on the vertical axis against time on the horizontal across all event dates; colour-coded blocks (green fully staffed, amber below minimum, red unstaffed, blue at maximum); staffing counts per block ("2/3"); alert flags on minor-assigned shifts requiring adult pairing; filters "Show Deficits Only", "Show Minor Assignments", "Filter by Station".

**Volunteer Profile, Safeguarding & Legal Verification Panel** displays: full legal name, preferred name, email, phone, date of birth and computed age; a minor indicator; guardian consent status with verification date, verifying coordinator and a link to the scanned form; criminal record and sexual offender registry check date and reference; rostered hours, verified hours, reliability metrics (completed vs. no-shows); emergency contacts, mandatory for minors.

**Swap & Schedule Exception Queue** displays: incoming swap requests needing sign-off; cards with source volunteer, target volunteer, station and times; an automated compliance checker (no overlap, valid rest intervals, station qualifications met); Approve and Reject buttons with a mandatory rejection reason.

**Attendance Kiosk & Hours Auditing Roster** displays: volunteers scheduled for the current window; toggles "Mark Arrived", "Mark Attended", "Mark No-Show", "Adjust Hours"; manual time adjustment with a mandatory audit note for deviations over 30 minutes; bulk "Approve All Scheduled"; "Export Audit CSV".

## 4. Legal Requirements and Compliance Architecture (Polish Jurisdiction)

### English legal analysis

Organizing volunteer labor for an academic conference held in Poland is governed by civil, administrative, and public benefit law rather than standard commercial employment statutes. Volunteer engagements are primarily regulated by the Act on Public Benefit Activity and Volunteerism of 24 April 2003 (Ustawa o działalności pożytku publicznego i o wolontariacie, Dz. U. z 2023 r. poz. 571).

Under Article 42(1), volunteers may provide services exclusively to eligible beneficiaries, which include non-governmental organizations, foundations, associations, and public entities such as state universities and research institutes. If an academic conference is organized directly by a commercial entity, volunteer participation under this Act is legally invalid; such staff must instead be engaged under civil law contracts (umowa zlecenie) or standard employment agreements.

Under Article 44, volunteer service must be governed by an agreement (porozumienie) defining the scope, manner, and duration of duties. For services lasting 30 days or less—which covers typical three-to-five-day academic conferences—the agreement may be concluded orally or in writing. However, under Article 44(2), the organizer is legally bound to provide written confirmation of the agreement's terms if the volunteer requests it. Furthermore, upon completion of service, the organizer must issue a formal certificate confirming the scope and total hours of service rendered upon request. If volunteer service exceeds 30 days, the agreement must be executed in writing under Article 44(4).

Article 45 requires organizers to inform volunteers of occupational health and safety risks and to guarantee safe and hygienic working conditions on principles comparable to standard employees. Organizers are legally obligated to cover travel expenses and per diems unless the volunteer releases them from this obligation in writing under pain of nullity (w formie pisemnej pod rygorem nieważności, Art. 45(4)).

Insurance obligations are split by service duration under Article 46: for engagements of 30 days or less, the organizer must procure individual accident insurance (NNW). Engagements exceeding 30 days are automatically covered by state-administered accident insurance under the Act of 30 October 2002 on Provision for Accidents Sustained in Special Circumstances (Dz. U. Nr 199, poz. 1673).

The participation of minor volunteers introduces additional requirements under the Polish Civil Code (Kodeks cywilny, Dz. U. z 2023 r. poz. 1610). Under Articles 15 and 17, minors aged 13 to 18 possess limited legal capacity (ograniczona zdolność do czynności prawnych), meaning their execution of a volunteer agreement requires the consent of a statutory representative (parent or legal guardian). While family law permits one parent to grant consent for everyday matters, institutional best practice requires collecting signed parental declarations detailing emergency contacts and approving the minor's participation in the conference.

Furthermore, because Article 45(1)(2) of the Volunteer Act requires working conditions to align with employee standards, labor inspectors apply juvenile employment protections from the Polish Labour Code (Kodeks pracy, Dz. U. z 2023 r. poz. 1465) by analogy: daily volunteer duties cannot exceed 8 hours in any 24-hour window (7 hours under 16; Art. 202(2)); shifts are prohibited during the statutory night window of 22:00 to 06:00 (Art. 203(1)); volunteers are entitled to a minimum daily rest of 14 uninterrupted hours (Art. 203(2)).

Recent child safeguarding legislation (Lex Kamilek, amending the Act of 13 May 2016 on Counteracting Threats of Sexual Crime and Protection of Minors, Dz. U. z 2024 r. poz. 560) imposes additional operational duties. Under Articles 22b and 22c, institutions conducting activities involving minors must publish formal Standards for the Protection of Minors (Standardy Ochrony Małoletnich) on their website and display them at the venue in both full and child-accessible summaries. Under Article 21(1), prior to admitting any worker or volunteer to activities involving care, education, or supervision of minors, the organizer must verify the candidate in the Register of Sexual Offenders with Limited Access (Rejestr Sprawców Przestępstw na Tle Seksualnym z dostępem ograniczonym) and inspect a clean criminal certificate from the National Criminal Register (KRK). If minor student volunteers work alongside adult coordinators without continuous third-party supervision, those adult coordinators must be vetted under this statute.

To satisfy audits by the National Labour Inspectorate (PIP) or insurers, the scheduling system must store six compliance artifacts:

1. **Agreement Audit Log:** record of agreement creation, format (oral or written), acceptance timestamps, and health and safety briefing confirmations.
2. **Guardian Consent Profile:** scanned signed parental consent forms, guardian contact numbers, verification timestamps, and verifying organizer IDs.
3. **Expense Waiver Record:** scanned physical waivers releasing the organization from per diem obligations under Article 45(4).
4. **Group NNW Policy Ledger:** insurer name, policy number, and coverage period for short-term volunteers.
5. **Safeguarding Vetting Audit:** verification query IDs and check dates for the Sexual Offender Register (RPS) and KRK certificate validation dates for adult supervisors.
6. **Immutable Time and Rest Logs:** check-in and check-out timestamps, break logs, and daily hour totals verifying compliance with minor work caps and nocturnal prohibitions.

### Sekcja prawna w języku polskim

Zasady angażowania wolontariuszy podczas konferencji naukowej organizowanej na terytorium Rzeczypospolitej Polskiej podlegają przepisom prawa cywilnego oraz administracyjnego, a nie powszechnym przepisom prawa pracy właściwym dla pracowników etatowych. Kluczowym aktem prawnym jest Ustawa z dnia 24 kwietnia 2003 r. o działalności pożytku publicznego i o wolontariacie (t.j. Dz. U. z 2023 r. poz. 571 z późn. zm.).

Zgodnie z art. 42 ust. 1 ustawy, korzystającymi ze świadczeń wolontariuszy mogą być wyłącznie organizacje pozarządowe (w tym stowarzyszenia i fundacje), organy administracji publicznej oraz podległe im jednostki organizacyjne (np. uczelnie publiczne, instytuty badawcze PAN). W przypadku gdy organizatorem wydarzenia jest komercyjna spółka z o.o. lub spółka akcyjna prowadząca działalność gospodarczą, angażowanie wolontariuszy w reżimie tej ustawy jest bezwzględnie niedopuszczalne; współpraca z personelem pomocniczym musi wówczas przybrać formę umów cywilnoprawnych (np. zlecenia) lub umów o pracę.

W myśl art. 44 ustawy świadczenia wolontariuszy są wykonywane w zakresie, w sposób i w czasie określonych w porozumieniu z korzystającym. Jeżeli świadczenie jest wykonywane przez okres nie dłuższy niż 30 dni (co obejmuje większość konferencji akademickich), porozumienie może być zawarte w formie ustnej. Jednakże na żądanie wolontariusza korzystający ma prawny obowiązek potwierdzić na piśmie treść porozumienia (art. 44 ust. 2). Ponadto, po zakończeniu zaangażowania, na wniosek wolontariusza korzystający jest zobowiązany wystawić pisemne zaświadczenie o wykonaniu świadczeń, zawierające wyszczególnienie ich zakresu oraz liczbę wypracowanych godzin. Jeżeli współpraca przekracza 30 dni, porozumienie musi zostać zawarte na piśmie pod rygorem nieważności (art. 44 ust. 4).

Zgodnie z art. 45 korzystający jest zobowiązany poinformować wolontariusza o ryzyku dla zdrowia i bezpieczeństwa oraz zapewnić mu bezpieczne i higieniczne warunki wykonywania świadczeń na zasadach dotyczących pracowników. Korzystający ma także ustawowy obowiązek pokrywania kosztów podróży służbowych i diet, chyba że wolontariusz zwolni go z tego obowiązku w formie pisemnej pod rygorem nieważności (art. 45 ust. 4).

Kwestię ubezpieczenia reguluje art. 46: jeżeli świadczenie trwa do 30 dni, organizator musi zapewnić wolontariuszowi ubezpieczenie od następstw nieszczęśliwych wypadków (NNW). W przypadku świadczeń trwających dłużej niż 30 dni, wolontariusz uzyskuje prawo do zaopatrzenia z tytułu wypadku z mocy ustawy z dnia 30 października 2002 r. o zaopatrzeniu z tytułu wypadków lub chorób zawodowych powstałych w szczególnych okolicznościach (Dz. U. Nr 199, poz. 1673).

Status wolontariuszy małoletnich normują przepisy Kodeksu cywilnego (Dz. U. z 2023 r. poz. 1610). Osoby w wieku od 13 do 18 lat posiadają ograniczoną zdolność do czynności prawnych (art. 15 i 17 k.c.), w związku z czym ważność porozumienia wolontariackiego wymaga zgody przedstawiciela ustawowego (rodzica lub opiekuna prawnego). Chociaż przepisy Kodeksu rodzinnego i opiekuńczego uznają zgodę jednego rodzica za wystarczającą w sprawach zwykłego zarządu majątkiem i osobą dziecka, procedury organizacyjne wymagają zebrania pisemnego oświadczenia zawierającego kontakt telefoniczny do opiekunów.

Co istotne, odesłanie zawarte w art. 45 ust. 1 pkt 2 Ustawy o działalności pożytku publicznego (zapewnienie warunków BHP na zasadach pracowniczych) nakazuje stosowanie wobec małoletnich wolontariuszy norm ochronnych wynikających z przepisów o zatrudnianiu młodocianych zawartych w Kodeksie pracy (Dz. U. z 2023 r. poz. 1465): czas pracy małoletniego nie może przekraczać 8 godzin na dobę (7 godzin w przypadku osób poniżej 16. roku życia; art. 202 § 2 k.p.); obowiązuje bezwzględny zakaz wyznaczania dyżurów w porze nocnej obejmującej godziny od 22:00 do 06:00 (art. 203 § 1 k.p.); małoletniemu należy zagwarantować co najmniej 14 godzin nieprzerwanego odpoczynku dobowego (art. 203 § 2 k.p.).

Dodatkowe obowiązki nakłada Ustawa z dnia 13 maja 2016 r. o przeciwdziałaniu zagrożeniom przestępczością na tle seksualnym i ochronie małoletnich (Dz. U. z 2024 r. poz. 560, znowelizowana w ramach tzw. Lex Kamilek). Zgodnie z art. 22b i 22c organizatorzy wydarzeń o charakterze naukowym, edukacyjnym lub opiekuńczym z udziałem małoletnich muszą opracować, wdrożyć i opublikować na stronie internetowej oraz wywiesić w miejscu zbiórki Standardy Ochrony Małoletnich (w wersji pełnej oraz skróconej – przeznaczonej dla dzieci). Ponadto art. 21 ust. 1 nakłada obowiązek uprzedniej weryfikacji każdego członka personelu i dorosłego wolontariusza dopuszczanego do działalności związanej z opieką lub edukacją dzieci w Rejestrze Sprawców Przestępstw na Tle Seksualnym (RPS) – w rejestrze z dostępem ograniczonym oraz odebrania zaświadczenia o niekaralności z Krajowego Rejestru Karnego (KRK). Jeśli pełnoletni wolontariusze sprawują funkcje koordynatorów małoletnich wolontariuszy, weryfikacja ta staje się wymogiem prawnym.

Dla celów dowodowych podczas kontroli Państwowej Inspekcji Pracy (PIP) lub ubezpieczyciela system informatyczny musi rejestrować sześć kategorii danych:

1. **Metadane zawarcia porozumienia:** znacznik daty i godziny zawarcia porozumienia, jego forma (ustna z potwierdzeniem akceptacji regulaminu lub skan umowy pisemnej) oraz potwierdzenie instruktażu BHP.
2. **Zgoda opiekuna prawnego:** cyfrowy wpis potwierdzający weryfikację pisemnej zgody rodzica, dane kontaktowe opiekuna, identyfikator koordynatora weryfikującego oraz odnośnik do zarchiwizowanego skanu dokumentu.
3. **Zrzeczenie się roszczeń finansowych:** flaga potwierdzająca odebranie pisemnego zrzeczenia się zwrotu kosztów i diet na podstawie art. 45 ust. 4.
4. **Rejestr polisy NNW:** numer grupowej polisy ubezpieczeniowej NNW zawartej przez organizatora oraz termin jej obowiązywania.
5. **Audyt weryfikacji RPS i KRK:** identyfikator zapytania systemowego potwierdzającego sprawdzenie w RPS z dostępem ograniczonym oraz termin ważności zaświadczenia z KRK dla dorosłych opiekunów.
6. **Precyzyjny rejestr czasu dyżurów:** ścisłe godziny rozpoczęcia i zakończenia zadań, kontrola przerw oraz znaczniki gwarantujące brak dyżurów małoletnich po godzinie 22:00 i zachowanie 14-godzinnej przerwy dobowej.

## 5. Architectural Constraints: The "Do Not Build" Framework

Columns: omitted component / perceived utility / failure mechanism in a zero-budget environment / zero-cost alternative.

- **Transactional email auth and magic links** / passwordless onboarding via institutional addresses / delivery failures from university spam filters, missing SPF/DKIM, third-party SMTP costs / deterministic badge tokens: passphrases printed on physical badges or QR codes scanned at arrival.
- **Constraint solvers and automated "AI" schedulers** / algorithmic optimal rotas from availability profiles / dynamic academic schedule shifts and presentation updates invalidate the model, forcing manual overrides / constrained self-claiming: volunteers claim shifts subject to validation guards enforcing hour caps and non-overlap.
- **Real-time WebSockets and native push gateways** / instant lock-screen alerts / WebSockets fail under congested conference Wi-Fi; APNs/FCM need paid developer subscriptions / pull-on-load polling and out-of-band broadcasts through existing Signal, Matrix or Telegram groups.
- **In-app peer-to-peer chat and direct messaging** / embedded coordination channels / message storage, state sync and active moderation to prevent unmonitored messaging involving minors / broadcast hub and physical helpdesk: a read-only announcement banner and a link to the organiser desk room.
- **Native mobile binaries** / polished native experience / annual developer fees ($99 USD for Apple), review bottlenecks, platform maintenance / a static Progressive Web App cached via Service Workers.
- **Government portal automation (RPS and KRK APIs)** / programmatic screening of adult volunteers / the Ministry of Justice exposes no free public API for ad-hoc tools / manual query auditing: organisers query the portal, file printouts and log confirmation IDs.
- **Financial ledgering and stipend calculators** / automated per diems and travel stipends / payouts shift volunteer status to commercial contracting (umowa zlecenie), triggering taxation and ZUS liabilities / statutory expense waiver under Art. 45(4), eliminating financial workflows.

Organizers often attempt to build passwordless magic-link onboarding, assuming that student volunteers can log in via their university email addresses. In observed practice, academic spam filters frequently quarantine automated transactional messages, while misconfigured DNS records cause message rejection. If a volunteer cannot receive a login link ten minutes before an 08:00 presentation track, the room's operations break down. The recommended zero-email architecture replaces email delivery with deterministic badge tokens: organizers assign a static passphrase or unique QR code printed on the volunteer's conference badge, which grants instant access upon scanning or entry.

Similarly, automated scheduling algorithms often break down when applied to small academic conferences. Student volunteers frequently adjust their commitments when senior researchers invite them to ad-hoc meetings, or when the conference schedule shifts. An optimization solver cannot account for these fluid priorities; instead, it generates rigid allocations that require manual unravelling. A self-claiming board with invariant validation provides better flexibility, allowing volunteers to claim open slots within the boundaries of minor working limits and non-overlapping schedules.

Finally, in-app messaging should be avoided due to the overhead of message synchronization, storage, and legal liabilities surrounding unsupervised contact with minors. Relying on a physical organizer desk room and existing third-party group chats (such as Signal or Matrix) provides reliable communication without adding complexity to the software.

## 6. Critical Operational Decisions and Trade-off Analysis

**1. Open self-claiming vs. centralized administrative allocation.** In a self-claiming model, organizers publish shifts several weeks prior to the event, allowing volunteers to choose assignments that accommodate their academic schedules, paper presentations, and personal interests. Validation rules enforce hour caps and rest intervals, while administrative intervention is limited to unstaffed shifts in the final 48 hours. Strongest counter-argument: selection bias and cherry-picking. Desirable, low-effort shifts (monitoring keynotes, quiet afternoon desks) are claimed within minutes; demanding or unsocial shifts (07:00 bag packing, wayfinding in bad weather, late tear-down) stay unstaffed. In cohorts of 5 to 40 this fosters friction and contentious day-of reassignments. Centralized allocation balances difficult duties but requires organizers to collect presentation times manually.

**2. Bilateral 1:1 swaps vs. unilateral drop-to-pool.** Under a bilateral model, a volunteer must identify a qualified replacement, secure their agreement in the application, and await coordinator approval, so every confirmed slot stays staffed during negotiation. Strongest counter-argument: significant friction during unexpected disruptions. A volunteer who falls ill or is delayed rarely has time to negotiate trades; when the software blocks unilateral drops, volunteers resort to unannounced no-shows. A drop-to-pool workflow exposes vacancies immediately on the master schedule, letting organizers deploy floating backups.

**3. Structural minor exclusion vs. supervised universal eligibility.** Structural exclusion prevents volunteers under 18 from viewing or claiming high-stress roles (solitary AV, speaker green rooms, tear-down), restricting them to low-risk front-of-house tasks. Strongest counter-argument: blanket exclusions reduce capacity and undermine the educational value for younger volunteers, who are often highly capable technically; banning them from technical stations pushes adults into roles they handle worse. Pairing minors with adult supervisors fulfils Lex Kamilek while keeping stations efficient.

**4. Physical badge scanning kiosks vs. passive trust-based hours logging.** Scanning a badge at the organizer desk at the start and end of each shift produces verified timestamps. Strongest counter-argument: kiosks create bottlenecks and an adversarial, surveillance tone; student volunteers are aspiring peers, not shift workers. Queuing to scan every 90 minutes disrupts movement between rooms and risks delaying sessions; if the coordinator is away, volunteers cannot check out and logs corrupt. In teams of 5 to 40, day captains have direct visual oversight, making passive check-ins with retrospective verification simpler and culturally appropriate.

**5. Deterministic badge authentication vs. third-party academic OAuth.** Badge authentication eliminates external dependencies and email deliverability issues: volunteers log in by scanning the onboarding QR code on their badge on arrival. Strongest counter-argument: it disrupts the pre-conference timeline. Shift selection should happen two to three weeks before the event; if authentication requires a badge that exists only at registration, advance scheduling becomes difficult, and distributing tokens digitally reintroduces manual coordination. Federated OAuth lets students sign in weeks in advance.

## 7. Epistemological Boundaries: Unresolved Domain Areas

1. **Jurisprudential status of minor peer volunteers under Lex Kamilek.** While the Act of 13 May 2016 (as amended by Dz. U. z 2024 r. poz. 560) mandates screening against the Sexual Offender Register for personnel admitted to activities involving the education, care, or custody of minors, there are no published Polish judicial rulings, Ministry of Justice binding interpretations, or PIP circulars addressing peer student volunteers at adult scientific conferences. It remains unsettled whether a 17-year-old assisting with session microphones requires every adult volunteer in that room to be screened, or whether the law applies only to dedicated youth activities. Commentators recommend conservative compliance; formal case law is absent.
2. **Comparative attendance rates in small cohorts: self-claiming vs. task bidding.** No peer-reviewed controlled studies compare no-show rates between first-come self-claiming boards (Engelsystem style) and day-ahead auction bidding (CHISV style) within cohorts of 5 to 40. Existing research covers thousands of workers at congresses and festivals, or student pools at mega-conferences above 5,000 attendees. The behavioural impact on small symposia is an engineering inference.
3. **Evidentiary enforceability of electronic checkboxes for expense waivers under Polish law.** Under Article 45(4) a volunteer may release the organizer from travel and per diem obligations only "in writing under pain of nullity". Under Articles 78 § 1 and 78¹ of the Civil Code, satisfying the written form electronically requires a qualified electronic signature. No definitive case law confirms whether a checkbox inside a web application protects against retrospective per diem claims. Current practice advises collecting ink signatures on printed forms at on-site registration.
