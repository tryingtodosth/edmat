# Gemini Deep Research report — conference and venue management on EdMat

Received 2026-09-23 in answer to `CONFERENCE-RESEARCH-PROMPT.md` (sections 1–5). The shift
scheduling follow-up is answered in `CONFERENCE-RESEARCH-REPORT-SHIFTS.md`. Pasted from the
Gemini output, which lost its line breaks and table grid; headings and paragraph breaks were
restored by hand, the wording is Gemini's. Tables are given as one row per line. Citations were
not preserved by the paste — treat every legal citation and statistic as **unverified** until
checked against the statute or the tool's documentation. Not yet reconciled; see the "After the
report" section of the prompt.

---

# Architectural Analysis and Systems Engineering for Conference and Venue Management on the EdMat Platform

## 1. Roles, Permissions, and Per-Role Views

### Comparative Permission Architectures in Conference and Event Software

Conference and event management systems employ widely divergent authorization models, reflecting whether their architectural genesis lies in academic peer review, commercial ticketing, community hackathons, or volunteer scheduling.

In academic peer-review systems, authorization is organized hierarchically around the event lifecycle and scientific artifacts. Indico, engineered at CERN, models access through explicit Access Control Lists (ACLs) bound to structural nodes: Categories, Events, Sessions, and Contributions. Category administrators possess cascading rights over all descendent events. Within a specific event, Indico enforces predefined functional roles, notably Event Manager, Session Coordinator, Session Convener, Contribution Author, and Paper Reviewer. Its scoping is strictly object-bound; for example, a Session Coordinator's administrative capabilities apply exclusively to their designated session block and its assigned contributions. The interface reflects this by embedding management controls directly into the contextual timetable and contribution views. Pretalx similarly aligns permissions with academic workflows but structures access via event-level teams. Each team is assigned an archetype—Administrator, Reviewer, or Custom—where custom configurations allow granular boolean toggles over submission viewing, review submission, talk editing, and schedule manipulation. Crucially, pretalx permits team scoping by submission track, ensuring that reviewers in multidisciplinary events are restricted exclusively to proposals aligned with their domain expertise.

Ticketing-centric platforms prioritize financial isolation, admission integrity, and multi-tenant management. Pretix organizes permissions across two principal tiers: Organizer teams and Event teams. An Organizer team grants cross-event administrative privileges, whereas an Event team restricts capabilities to designated events. Pretix replaces broad presets with discrete per-capability checkboxes grouped by operational domains: event settings, order viewing, order modification, check-in list administration, and financial auditing. Furthermore, pretix implements device-level scoping through a dedicated Device API. A hardware scanner or mobile client running pretixSCAN authenticates via an initialization handshake that issues an operational token bound to an immutable scope: a designated Gate and Check-in List. This ensures the terminal possesses strictly the capabilities required to redeem admission tokens without read access to customer orders or broader configuration endpoints. Tito and Eventbrite utilize coarser administrative profiles; Tito defines account administrators and check-in assistants scoped per event, while Eventbrite provides organization-level role definitions with static on-site staff profiles designed for mobile entry apps.

Legacy academic systems such as EasyChair, ConfTool, and OpenConf enforce rigid, non-configurable state machines. EasyChair and OpenConf lock capabilities into immutable roles: Super-Chair, Track Chair, Program Committee Member, and Author. System permissions cannot be overridden, and scoping is strictly limited to paper assignment matrices and track boundaries. ConfTool permits modular capability adjustments through an extensive global configuration interface, but user roles remain bound to fixed academic classifications. Frab, developed for hacker conferences, mirrors an early single-track model where administrators, coordinators, and reviewers hold fixed, hard-coded event capabilities.

Commercial event suites such as Cvent, Whova, and Sched provide enterprise role-based access control (RBAC). Cvent allows enterprise administrators to construct custom security profiles with field-level permissions across registration, travel, housing, and on-site check-in modules. Sched and Whova maintain simplified role presets—Organizer, Speaker, Sponsor, Volunteer/Staff, and Attendee. In Sched and Whova, volunteers access mobile scanner views locked to specific session rosters, while overarching administrative permissions remain reserved for event hosts.

Volunteer-coordination platforms, including Timecounts, Golden, and Bloomerang Volunteer (formerly InitLive / VolunteerLocal), decouple staff shift management from registration. In these systems, permissions are organized around operational shifts, roles, and physical stations. Volunteers possess no administrative portal access; their user experience consists of a mobile or progressive web application displaying upcoming assignments, briefing acknowledgments, and operational scan buttons. Operational leads receive scoped supervisor interfaces restricted to taking roll calls or reassigning volunteer shifts within their designated operational zone.

### Checkbox Permission Editors Versus Role Presets with Overrides

The design of administrative access interfaces presents a documented trade-off between configuration flexibility and operational integrity. Systems exposing large arrays of naked per-capability checkboxes—where an organizer configures twenty to fifty independent booleans such as can_edit_session, can_view_orders, can_export_csv, or can_manage_rooms—experience severe configuration drift and accidental privilege escalation when managed by volunteer teams.

The operational history of systems like Discord, GitHub, and Notion reveals that non-technical and volunteer administrators struggle to evaluate the transitive security impacts of granular checkboxes. When an operational station fails due to a missing permission during live event execution, administrators under stress routinely resort to privilege creep: checking adjacent or elevated permissions until the error clears, thereby granting persistent administrative rights to operational staff. Over successive events, these manual modifications accumulate, leading to permission rot and inconsistent capability profiles across volunteers performing identical duties.

In contrast, platforms that converge on Role Presets with Limited Overrides achieve significantly higher authorization reliability. Under this model, the system defines immutable, conceptually coherent base archetypes: Event Organiser, Reviewer, and Volunteer (further subdivided by station: Door, Room, Info Desk, Cloakroom). Each archetype carries an immutable baseline of least-privilege capabilities necessary for the function. Overrides are treated as explicit, auditable exceptions bound to specific structural scopes—such as granting an Info Desk volunteer temporary access to a specific room check-in list, or scoping a Reviewer to an additional scientific track. By restricting operational adjustments to predefined scope bindings rather than arbitrary capability permutations, the system maintains structural invariants and prevents security regressions.

### Composition of the Volunteer Dashboard

Operational event tools strictly decouple the volunteer interface from the primary administrative console. The volunteer dashboard is engineered around contextual immediacy: delivering the specific operational tools required for the active time window while eliminating extraneous navigation and concealing sensitive participant data.

The functional composition of a mature volunteer dashboard includes:

- **Contextual Shift and Station Roster:** A real-time chronological schedule displaying the volunteer's active and upcoming shifts, physical room or gate assignments, and supervisor contact metadata.
- **Safety and Operational Briefing Panel:** A prominent notification area displaying facility-specific emergency procedures, fire safety protocols, and operational workflows, requiring digital acknowledgment before action tools unlock.
- **Operational Escalation Directory:** An immediate contact directory providing direct telephony or in-app calling links to station supervisors, the building facility manager, campus security, and first-aid staff.
- **Station-Specific Execution Views:** High-speed, focused interfaces restricted strictly to the volunteer's assigned post:
  - Door Station: A camera-driven QR scanner providing immediate visual and acoustic feedback (valid, already used, invalid), manual alphanumeric token entry, an undo toggle for accidental check-ins, and a real-time aggregate admittance counter.
  - Room Station: A simple occupancy increment/decrement tally counter displaying live room capacity against statutory fire thresholds.
  - Cloakroom Station: A rapid deposit/retrieval scanner mapping luggage tokens to rack numbers.

The system deliberately withholds sensitive information from the volunteer view:

- Full attendee registration profiles, survey responses, and demographic data.
- Attendee personal contact details, including phone numbers and email addresses.
- Unredacted medical declarations and dietary notes: rather than exposing medical diagnoses (such as celiac disease), the interface displays only aggregated catering summaries or binary meal voucher entitlements.
- Financial data, reviewer scoring, speaker honoraria, and private organizing committee discussions.

### Minimum Personal Data per Role and GDPR Data Minimisation

Under the General Data Protection Regulation (GDPR / RODO Art. 5(1)(c)), the principle of data minimisation mandates that personal data must be adequate, relevant, and limited to what is strictly necessary in relation to the operational purposes for which they are processed. Guidance from the Polish Personal Data Protection Office (Urząd Ochrony Danych Osobowych – UODO) and academic Data Protection Officers emphasizes that event software must enforce technical boundaries preventing staff from accessing central participant registries.

The distribution of minimum personal data across operational roles (columns: role / minimum data displayed / deliberately withheld / legal foundation):

- **Door / Gate Check-in** — Full Name, Registration State (Valid/Cancelled), Ticket Category (e.g., General, Speaker), Scan Timestamp. — Withheld: contact coordinates, physical address, guardian identities, survey responses, dietary/medical disclosures. — Identity verification and perimeter admission control; auxiliary data is extraneous to ticket validation (GDPR Art. 5(1)(c)).
- **Room Usher / Capacity Monitor** — Real-time Room Headcount, Room Fire Evacuation Threshold. Optional: Presenter Name for speaker introductions. — Withheld: all participant identities, personal attendee lists, registration statuses. — Enforcement of building fire safety limits (Rozporządzenie MSWiA nt. ochrony ppoż.).
- **Information / Help Desk** — Full Name, Affiliation/Badge Name, Session Allocation, Badge Printing Status, Re-issuance Token. — Withheld: special category medical disclosures, guardian personal details, paper review feedback. — Participant orientation and lost-credential replacement.
- **Cloakroom Attendant** — Anonymous Token Identifier, Rack/Shelf Slot ID. In lost-token recovery: Name verified against external photo ID. — Withheld: attendee registration registry, contact details, ticket category, session enrolments. — Wardrobe deposit constitutes a bailment contract (Kodeks cywilny Art. 835); processing personal data is redundant when bearer tokens suffice.
- **Scientific Reviewer** — Anonymized Proposal Title, Abstract, Submitted File Attachments (single-blind review workflow). — Withheld: Author Name, Email Address, Institutional Affiliation, Guardian records. — Evaluation integrity and bias mitigation; personal identifiers are irrelevant to scientific assessment.
- **Venue Administrator** — Aggregate Hourly Headcounts per Room, Fire Evacuation Log, Event Host Contact Name and Phone, Schedule. — Withheld: individual attendee names, participant email addresses, paper abstracts, attendee demographics. — Facility safety, emergency egress planning, and physical room management.
- **Event Organiser** — Full Registration Record (Name, Contact, Accessibility Requests), Submission Details, Guardian Approvals for Minors. — Withheld: platform-wide administrative credentials, server infrastructure keys, unrelated tenant data. — Legal liability, duty of care under child protection laws, and overall conference execution.

### Managing Dual-Role Personas (Staff as Attendees and Speakers)

A structural flaw in early conference management systems is the conflation of a user account's administrative capabilities with their event participation status. When an individual serves simultaneously as an organizer or volunteer while presenting a paper or attending sessions, systems frequently double-count capacity or leak operational controls into the public interface.

Mature architectures resolve this tension through three technical patterns:

1. **Decoupling Identity from Event Participation:** The system maintains an account entity (User) representing the global authentication identity, while instantiating two distinct relational entities for a given event: an operational authorization binding (EventStaffRole) and a participation binding (Registration). A volunteer delivering a talk holds a User identity, an EventStaffRole(role='VOLUNTEER'), and a Registration(type='SPEAKER').
2. **Independent Capacity Decrementing:** The registration engine manages seat availability strictly by aggregating active Registration records. Holding an EventStaffRole conveys zero implied admission rights; if an organizer or volunteer intends to occupy a physical seat in a capped lecture hall, they must register an explicit Registration record, decrementing available capacity correctly. Staff members who do not occupy seats (such as roaming network engineers or security stewards) hold staff role bindings without corresponding registrations, preventing seat inflation.
3. **Context-Aware View Separation:** The client application separates the participant interface from the operations console. When browsing the public conference schedule or personal agenda, the interface renders strictly the participant view, displaying personal bookmarks and QR badges. Operational capabilities (such as badge scanning or review scoring) are encapsulated within a dedicated Operations Workspace, accessible only via explicit navigation. This structural boundary ensures that administrative tools never leak into public display screens when a staff member views the program.

## 2. Cloakroom, Badges, and QR Codes

### Cloakroom and Wardrobe Management Systems

Academic and public facilities across Poland universally operate cloakroom facilities (szatnia), legally categorized under Polish civil law as a contract of bailment (umowa przechowania, Art. 835–845 of the Polish Civil Code / Kodeks cywilny). Real-world implementations across university faculties, museums, and conference centers reveal established models for managing garment custody, lost tokens, and reconciliation.

Operational models fall into two primary designs:

- **Anonymous Dual-Token Systems:** The traditional approach utilizes physical paired tokens (numerki szatniowe). One token attaches to the coat hanger or luggage, while the matching token is held by the visitor. Modern digital implementations replace or augment physical tokens with thermal-printed paper receipts or reusable plastic cards encoded with 2D barcodes. The attendant uses a handheld scanner to link the storage slot identifier (e.g., "Rack 4, Hanger 12") to the scanned token barcode. Item retrieval requires only scanning the bearer token, which reveals the rack location, clears the assignment, and releases the slot.
- **Attendee-Linked Wardrobe Management:** In unified event suites, the wardrobe attendant scans the attendee's personal event badge to assign a coat rack. While eliminating separate tokens, this design introduces severe operational friction: every garment drop-off and retrieval requires badge lookup, creating ingress bottlenecks. Furthermore, it creates avoidable GDPR exposure by unnecessarily binding personal identities to garment custody records.

The optimal model for academic venues is an Anonymous Bearer Token with an Exception Identity Fallback:

- **Normal Operation:** Luggage and coats are deposited anonymously. The attendant scans a static rack barcode, scans an anonymous card token handed to the visitor, and hangs the item. The database captures only (item_id, event_id, rack_slot, token_hash, status, check_in_time).
- **Lost-Token Fallback Procedure:** When an attendee loses their wardrobe token, the bailment contract requires proof of title before property can be surrendered. To maintain queue flow, the attendee is held until the primary arrival or departure rush subsides. The attendant then initiates an exception workflow: the attendee describes the item, presents external identification (national ID, student ID, or authenticated platform profile), and signs an exception declaration. The operator logs the attendee's name, verified ID type, item description, and timestamp, clears the rack, and permanently blacklists the lost token hash to prevent third-party redemption.
- **End-of-Day Reconciliation:** Upon conference adjournment, the attendant generates a wardrobe reconciliation log. Items remaining in STORED status represent abandoned property. In Polish university buildings, abandoned property is formally inventoried and transferred to the campus lost-and-found repository (Biuro Rzeczy Znalezionych) alongside an audit export of unclaimed slots.

### Check-in and Badge QR Codes: Cryptographic and Operational Architectures

The selection of QR code payloads directly governs offline validation capability, forgery resilience, and scanning throughput.

Platforms employ three distinct payload structures:

1. **Opaque Random Identifiers:** The QR code encodes a high-entropy pseudo-random string (e.g., 32 alphanumeric characters, as used in pretix's default secrets). Strengths: highly compact barcode density, rapid camera acquisition, zero exposure of personal data within the barcode image, and complete stability if attendee details change. Limitations: scanners must query a local or remote lookup table mapping the secret to admission state. Offline validation requires synchronizing the ticket registry to the device prior to scanning.
2. **Cryptographically Signed Tokens:** The QR code contains structured binary data (ticket ID, event ID, sub-event flags) accompanied by an asymmetric cryptographic signature, specifically Ed25519. Strengths: terminals validate ticket authenticity offline using solely the organizer's public key, without downloading participant databases. Limitations: substantially larger barcode density slows camera acquisition. Furthermore, offline signed tokens cannot prevent duplicate presentation (ticket forwarding or replay attacks) across disconnected doors without a shared revocation log.
3. **Identifier-Plus-Checksum:** The QR code encodes a sequential integer with an error-detecting checksum (e.g., CRC32 or Luhn algorithm). Strengths: trivial implementation and minimal visual density. Limitations: negligible security; trivial to guess or forge; unsuitable for regulated venues.

For EdMat, the optimal architecture is an Opaque Random Token cached locally on the scanning terminal.

Re-entry policies depend on event perimeter rules. For single-entry events, initial redemption permanently marks the ticket as CHECKED_IN. Subsequent scans trigger visual and acoustic warnings ("ALREADY CHECKED IN at Entrance A, 09:12"). For multi-entry conferences, the scanner supports dual operational modes: "Entry" and "Exit". Attendees crossing the perimeter outward scan out, transitioning the record to EXITED; re-entry is permitted only if the preceding state was EXITED.

Physical scanning dynamics differ markedly between phone displays and physical badges:

- Phone Screens: prone to glare, screen reflections, cracked glass, low battery, and display dimming. Scanners must support high dynamic range and adaptive exposure.
- Printed Badges: badges scan rapidly under ambient lighting but are subject to paper creases or lamination glare.
- Fallback Workflows: when a QR code fails to decode within five seconds, the terminal must provide two immediate manual overrides: alphanumeric entry (direct keyboard entry of the short code printed beneath the QR image) and roster lookup (querying the attendee's last name within the local cached check-in list).

Real-world throughput metrics establish that a volunteer utilizing a modern smartphone camera scanner processes 12 to 18 attendees per minute under steady queue conditions, rising to 25 to 30 attendees per minute when operating dedicated hardware terminals with integrated laser scan engines.

Offline synchronization across multiple doors presents a distributed concurrency challenge. When network connectivity drops, scanners operating at separate entrances cannot coordinate admission state in real time. Systems resolve this through optimistic local validation and idempotent synchronization:

1. **Local Data Caching:** The client application downloads the authorized check-in list prior to door opening.
2. **Optimistic Scan Commits:** Each scan executes against the local database. The terminal creates an immutable scan event containing a client-generated UUID (nonce), ticket secret, scan direction, and local ISO 8601 timestamp.
3. **Batch Reconciliation:** Upon network restoration, the client transmits queued scan events to an idempotent synchronization endpoint. If identical tickets were scanned at separate doors during an offline period, the server accepts the chronologically earlier scan, flags subsequent scans as collisions, records the event in an audit log, and notifies organizers.

In the context of EdMat's single-writer SQLite production infrastructure, a burst of 300 attendees arriving over 15 minutes generates an average rate of 0.33 writes per second, with peak bursts reaching 10 to 15 writes per second. While SQLite in Write-Ahead Logging (WAL) mode sustains several hundred sequential write transactions per second on NVMe disks, concurrent write requests across multiple web worker processes will encounter database lock contention errors (sqlite3.OperationalError: database is locked).

To eliminate this bottleneck without deploying external database engines:

- Scanning devices must not submit synchronous, single-scan HTTP requests directly to SQLite.
- Clients must buffer scan events locally and push batched sync requests every 3 to 5 seconds.
- The Django back-end handles incoming batches inside an explicit, short-lived transaction (transaction.atomic()), executing bulk insertions (bulk_create) that commit in under three milliseconds.
- The database engine must be configured with PRAGMA journal_mode = WAL;, PRAGMA synchronous = NORMAL;, and an explicit busy timeout (PRAGMA busy_timeout = 5000;).

### Ticket and QR Code Delivery Without Outgoing Email

Operating EdMat under a strict policy prohibiting outgoing email requires resilient, on-screen and printable distribution mechanisms:

- **Responsive In-App Ticket Console:** Upon registration or waitlist promotion, the platform renders a dedicated /events/[id]/ticket route within the SvelteKit application. Utilizing Service Workers and the Cache API, this view is cached locally, enabling attendees to display their QR badge at the venue even when mobile data reception is absent.
- **Standardized Printable PDF:** The system provides a direct, server-rendered PDF download (using headless engines such as WeasyPrint). The document formats the admission token on an A4 sheet containing the scannable QR code, building arrival instructions, room maps, and a foldable badge template.
- **Tokenized Static Link:** Attendees can bookmark a lightweight URL (e.g., /t/[opaque_secret]). The endpoint serves a minimal, self-contained HTML page containing the pre-rendered SVG barcode and a script that caches the token in browser localStorage.

Technical Assessment of Mobile Wallet Passes:

- **Apple Wallet (.pkpass):** Deploying Apple Wallet passes requires constructing a cryptographically signed ZIP archive containing pass.json and visual assets. The manifest must be signed using a certificate issued under an active Apple Developer Program account ($99 USD annual fee). iOS strictly rejects self-signed wallet passes. Generating native Apple Wallet passes without an institutional developer subscription is technically impossible.
- **Google Wallet:** Google Wallet relies on the Google Wallet REST API. While free of direct developer subscription fees, it requires enterprise account registration in the Google Pay Business Console and Google Cloud Platform service account authentication.

Given EdMat's zero-budget and vendor-independent mandate, the platform must rely exclusively on offline-cached PWA web views and printable PDFs, bypassing proprietary mobile wallet infrastructures.

### Per-Session Scanning: Feasibility and Operational Costs

Restricting entry to high-demand breakout workshops, accredited continuing education tracks, or computer laboratories with hard capacity limits is frequently requested by academic organizers.

In software, per-session scanning requires dividing the event into distinct sub-event check-in lists and configuring scanners to validate specific session entitlements.

However, implementing door scanning at individual breakout rooms in volunteer-run academic conferences introduces unsustainable operational overhead. It requires staffing a volunteer equipped with a scanning device at every classroom door. Attendees moving between consecutive sessions create corridor bottlenecks. If scanners encounter connectivity delays or volunteer error, room entry stalls, directly disrupting lecture timetables.

Recommendation: For volunteer-led academic conferences, per-session door scanning should not be built. Session capacity should be enforced upstream by capping pre-registration seats in the software. On-site verification inside rooms should rely on passive rosters (printed participant lists provided to session chairs) or simple head-count tallying logged on the volunteer dashboard, preserving scanning hardware exclusively for the main building entrance.

### Badge Printing Paradigms and Safeguarding Minors' Identifiers

Conferences manage physical credential production through three distinct paradigms:

1. **On-Site Thermal Printing:** High-speed direct thermal or dye-sublimation printers (e.g., Brother QL, Zebra) print adhesive badges upon QR scan at the door. Strengths: eliminates waste from no-shows; supports real-time name changes. Limitations: high hardware cost, vulnerability to mechanical paper jams, driver dependencies, and initial registration desk delays.
2. **Pre-Printed Badges:** Badges are batched, printed on heavy card stock, alphabetized, and laid out on registration tables prior to attendee arrival. Strengths: zero hardware dependencies at the venue; immediate fallback during power or network failure. Limitations: substantial paper waste from no-shows; manual alphabetized search causes queue delays; inability to handle last-minute replacements.
3. **Digital / Bring-Your-Own-Device (BYOD):** The conference dispenses with physical badges entirely. Attendees display digital tickets on their smartphones or carry printed A4 slips for perimeter entry, utilizing blank self-service sticky labels for informal name tags.

Safeguarding Considerations for Minors on Physical Badges. When minors (individuals under 18, and particularly minors under 16 under Polish GDPR transposition) attend academic events, physical badges introduce severe child protection vulnerabilities:

- **Data Minimization:** Badges worn around the neck are visible in public corridors, transit stops, and cafeteria lines. Badges for minors must never display full legal names, personal email addresses, phone numbers, or school affiliations.
- **The "Stranger Approach" Risk:** Displaying a child's full name enables unknown adults to address them familiarly, establishing unearned trust. Best practice in youth safeguarding mandates printing only the child's first name and an internal alphanumeric identifier on the front face of the badge.
- **Concealed Emergency Contact:** The reverse side of the badge must contain emergency contact coordinates: the legal guardian's or chaperone's telephone number, labeled as "W nagłym wypadku / In Emergency."
- **Visual Role Differentiation:** In compliance with university child protection standards, minor badges should feature a distinct visual border or lanyard color (e.g., bright yellow) to alert faculty, staff, and security that the attendee is a minor under institutional protection policies.

## 3. Venue and Building Administration: Templates and Checklists

### Administrative and Procedural Requirements in Polish and International Venues

In university facilities and public venues across Poland, including the University of Warsaw (Uniwersytet Warszawski – UW), organizing an event is governed by university rector orders (zarządzenia rektora), faculty dean regulations, and campus security guidelines. At UW, this framework is anchored by Zarządzenie nr 110 Rektora UW z dnia 12 września 2022 r. w sprawie zasad organizacji i bezpieczeństwa imprez (Order No. 110 of the Rector of UW on the rules of event organization and safety), working in concert with Article 50 and Article 52 of the Law on Higher Education and Science (Prawo o szkolnictwie wyższym i nauce).

University procedures distinguish between standard curriculum teaching and non-standard gatherings, enforcing an administrative pipeline across three operational phases:

**Pre-Event Phase (Planning and Authorizations):**

- Formal Event Submission (Zgłoszenie wydarzenia / Wniosek o wynajem sali): Submitted to the Facility Head (Kierownik jednostki / Administrator obiektu) 14 to 30 days prior to the event. The application requires: explicit schedule, room selections, exact program, anticipated maximum concurrent headcount, identification of the designated safety manager (Kierownik ds. bezpieczeństwa), and disclosure of any high-profile guests or external media.
- Rector / Dean Approval: Under UW Zarządzenie nr 110 § 2–4, non-didactic gatherings require written approval from the facility head. Events involving external political or commercial entities require Rector authorization. Under Art. 52 of Prawo o szkolnictwie wyższym i nauce, any formal assembly (zgromadzenie) organized by academic community members requires notifying the Rector at least 24 hours in advance, or obtaining explicit consent if held inside university facilities.
- Fire Safety Compliance (Ochrona przeciwpożarowa): Compliance with the building's Fire Safety Manual (Instrukcja Bezpieczeństwa Pożarowego – IBP) is mandatory. Room occupancy cannot exceed statutory evacuation limits calculated from doorway widths and corridor clearances. Temporary structures (poster boards, registration tables) must not impede escape routes or fire hydrants.
- Campus Security Coordination (Straż Uniwersytecka): Notifications covering after-hours access, exterior door unlocking, vehicle loading dock permits (przepustka wjazdowa), and parking reservations.
- Catering and Alcohol Regulations: Authorization for external catering setups, power draw verification for food warmers, waste handling, and absolute enforcement of alcohol policies (serving alcohol on campus requires an explicit formal waiver approved by the Rector under national restrictions on academic alcohol consumption).
- GDPR and Media Notices: Signage notifying attendees of photography and filming policies under RODO Art. 13.
- Child Safeguarding Protocols: Following the 2023/2024 legislative revisions ("Ustawa Kamilka"), organizers must file documentation verifying adherence to institutional Standards for the Protection of Minors (Standardy Ochrony Małoletnich), including criminal background verification of staff engaging with children.

**On-Site / Execution Phase:**

- Handover Protocol (Protokół zdawczo-odbiorczy pomieszczeń): Joint physical walkthrough with facility staff prior to entry, recording baseline room condition, audiovisual hardware operation, and access card handovers.
- Safety and Marshall Briefing: Mandatory confirmation that all operational volunteers know the locations of manual fire alarm buttons (ROP), extinguishers, and assembly points.
- Headcount Monitoring: Continuous monitoring ensuring lecture halls do not exceed seated capacity.

**Post-Event Phase:**

- Room Handover and Damage Inspection: Joint walkthrough with facility management to verify furniture reinstatement, waste clearance, key surrender, and formal logging of any property damage.
- Reporting: Filing final attendance figures and incident reports with campus administration.

International practices mirror these structures. In the United Kingdom, universities enforce "Room Booking & Code of Practice on Freedom of Speech" protocols alongside Health & Safety Risk Assessment Forms. In Germany, the Versammlungsstättenverordnung (VStättVO – Assembly Place Ordinance) imposes rigid occupancy thresholds, mandatory Veranstaltungsleiter (event director) appointments, and fire watch personnel (Brandsicherheitswache). In the United States, university facility departments demand Certificates of Insurance (COI) naming the institution as additional insured, coupled with NFPA 101 Life Safety Code enforcement.

### Polish Legal Thresholds and Statutory Regulations

Navigating Polish statutory frameworks is essential to avoid administrative and penal liability under public safety statutes.

**Mass Events Legislation (Ustawa o bezpieczeństwie imprez masowych).** The governing statute is the Ustawa z dnia 20 marca 2009 r. o bezpieczeństwie imprez masowych (Dz.U. z 2023 r. poz. 616, as amended). Under Article 3 of the Act, an event is classified as an "Impreza Masowa" (Mass Event) when it reaches statutory headcount thresholds:

- Artistic and Entertainment Events (Masowa impreza artystyczno-rozrywkowa): held indoors in a building or sports hall: not fewer than 500 participants (calculated according to building and fire regulations); held outdoors (stadium, field, public square): not fewer than 1,000 participants.
- Mass Sports Events (Masowa impreza sportowa): held indoors: not fewer than 300 participants; held outdoors: not fewer than 1,000 participants.
- High-Risk Mass Events (Impreza masowa podwyższonego ryzyka): held indoors: not fewer than 200 participants; held outdoors: not fewer than 300 participants.

Statutory Exemptions and Academic Applicability. Article 3(1) contains specific statutory exemptions. Events organized in theaters, operas, cinemas, museums, libraries, cultural centers, and art galleries are excluded from the definition of a mass event.

For universities, scientific conferences, symposia, congresses, and didactic lectures organized within university buildings do not constitute mass artistic-entertainment events under the Act, even if attendance exceeds 500 individuals. This principle is affirmed by UW Rector Order No. 110 § 2(2)(3), which explicitly excludes conferences, congresses, symposia, and academic lectures from the scope of standard recreational event restrictions, classifying them as core academic activities governed by university self-governance.

However, if an academic entity or student association organizes an artistic concert, festival, or sports competition (juwenalia, music performances) crossing the 500-seat indoor or 1,000-seat outdoor threshold, the Ustawa o bezpieczeństwie imprez masowych applies in full. In such cases, the organizer must:

- Apply to the municipal mayor (wójt, burmistrz, prezydent miasta) for a permit at least 30 days in advance.
- Obtain safety opinions from the State Fire Service (PSP), State Police, emergency medical services (Pogotowie Ratunkowe), and the State Sanitary Inspectorate (Sanepid).
- Appoint a licensed Safety Manager (Kierownik ds. bezpieczeństwa).
- Deploy certified security stewards (Służba porządkowa) and informational stewards (Służba informacyjna) conforming to statutory ratios (minimum 10 stewards for the first 300 attendees, plus 1 steward per each additional 100 attendees, with at least 20% being licensed security personnel).

**Sub-Threshold Regulations and Building Safety.** When an academic event does not cross the mass-event threshold, it remains subject to general safety statutes:

- Fire Safety: Governed by the Ustawa z dnia 24 sierpnia 1991 r. o ochronie przeciwpożarowej (Dz.U. z 2024 r. poz. 275) and the Rozporządzenie MSWiA z dnia 7 czerwca 2010 r. w sprawie ochrony przeciwpożarowej budynków, innych obiektów budowlanych i terenów (Dz.U. z 2010 r. Nr 109, poz. 719). The gathering must adhere to room capacities defined in the building's Instrukcja Bezpieczeństwa Pożarowego (IBP). Escape routes and fire-fighting equipment must remain unobstructed.
- Public Assemblies (Prawo o zgromadzeniach): Governed by the Ustawa z dnia 24 lipca 2015 r. – Prawo o zgromadzeniach (Dz.U. z 2022 r. poz. 1389). Assemblies on public streets require municipal notification. Assemblies within university grounds are carved out and governed exclusively by Article 52 of Prawo o szkolnictwie wyższym i nauce, requiring notification to the Rector.
- Child Safeguarding ("Ustawa Kamilka"): Effective across 2024 (Ustawa z dnia 28 lipca 2023 r. o zmianie ustawy – Kodeks rodzinny i opiekuńczy oraz niektórych innych ustaw, Dz.U. z 2023 r. poz. 1606). All entities conducting educational, recreational, or scientific activities involving minors are legally mandated to implement Standardy Ochrony Małoletnich (Standards for the Protection of Minors). Staff and volunteers engaging with children must be vetted against the National Register of Sexual Offenders (Rejestr Sprawców Przestępstw na Tle Seksualnym - RSPTS) and supply criminal record certificates.
- Image and Recording Rights: Article 81 of the Ustawa z dnia 4 lutego 1994 r. o prawie autorskim i prawach pokrewnych dictates that disseminating an individual's image requires consent, unless the person is an accidental detail of a public gathering, assembly, or landscape (szczegół całości). Event signage must prominently display RODO Art. 13 notices regarding photographic documentation.

### Modeling Template-to-Instance Checklists in Software

Operational event platforms model facility compliance via template-to-instance workflows. A venue defines master checklist templates, which instantiate into stateful, auditable checklists whenever an event is scheduled.

Structural Architecture of a Checklist Item. To support real-world facility compliance, each item in a checklist instance carries specific metadata: id; template_item_id (reference to originating template item); title (e.g., "Fire Warden Walkthrough"); description (explanatory instructions, statutory citations, or reference URLs); owner_role (ORGANISER, VENUE_ADMIN, VOLUNTEER_LEAD); due_offset (relative scheduling offset, modeled as a duration relative to the event's start or end anchor, e.g., T - 14 days, T - 2 hours, T + 1 day); computed_due_date; status (PENDING, IN_PROGRESS, COMPLETED, WAIVED_NA, REJECTED); is_mandatory (whether completion is a hard prerequisite for event publication or venue sign-off); na_allowed; na_reason (mandatory text justification whenever status is WAIVED_NA); evidence_type (NONE_CHECKBOX_ONLY, FILE_UPLOAD, URL_LINK, DIGITAL_SIGNATURE); evidence_attachment; completed_by_user; completed_at; requires_venue_signoff; signed_off_by_user; signed_off_at.

Template Versioning Strategies. When a venue administration modifies its master compliance checklist, active events in planning must maintain data integrity:

- **Snapshot / Fork Pattern:** When an event is instantiated, the system duplicates the template items into concrete ChecklistInstanceItem records bound to the event. The instance is decoupled from the master template.
- **Schema Versioning:** Master templates carry an incrementing integer version. If the venue introduces critical statutory updates, the software flags active events with an advisory banner. The Venue Administrator can selectively trigger a reconciliation migration, which appends newly mandated items into the event's checklist instance without overwriting or resetting previously completed tasks.

### Venue Ownership Architecture and Multi-Stakeholder Governance

Enterprise facilities management suites (e.g., Skedda, Robin, Momentus Technologies, EMS Software) and academic platforms (e.g., Indico Room Booking Module, Booked Scheduler) model the physical building as a first-class entity distinct from transient events.

Governance Split Across Stakeholders:

- **Venue Administrator (Facility Lead, Building Manager, Dean's Office).** Scope: physical real estate (Buildings, Wings, Floors, Rooms, Audiovisual Equipment). Capabilities: creates and updates room metadata (seated capacities, technical equipment, accessibility ratings); creates and maintains master compliance checklist templates; reviews and formally approves event room reservations; issues building access sign-offs; logs damage reports post-event; exercises unilateral authority to cancel or revoke an event's room reservation for safety or legal non-compliance.
- **Event Organiser (Academic Chair, Student Society Leader).** Scope: the temporary event instance (Title, Public Schedule, Contributions, Attendee Registrations, Volunteer Teams). Capabilities: requests room reservations from the venue pool; fulfills assigned checklist requirements and submits evidence; schedules talks into approved rooms; manages admission badges and on-site staff. The organizer cannot alter room fire capacities, bypass mandatory checklist gates, or override venue safety rules.
- **Platform Moderator / Super-Administrator.** Scope: platform-wide operational health, tenant boundaries, user account abuse, legal compliance escalation. Capabilities: resolves jurisdictional disputes between organizers and venues, manages global role assignments, and executes audit log reviews.

In Booked Scheduler and Indico, this relationship is modeled through approval workflows. An Event Organiser drafts an agenda and places a provisional reservation on a lecture hall. The reservation remains in a PENDING_APPROVAL state. The Venue Administrator reviews the event parameters (headcount, purpose, checklist completion status) and either confirms or rejects the room allocation. Once approved, the room is locked exclusively to that event block on the campus master schedule.

### Reusable Venue Compliance Documents and Acknowledgement Tracking

To streamline operational onboarding, university building administrations publish reusable reference materials directly to event organizers within the software:

- Room Technical Data Sheets (Karty sal): floor plans, fixed seating charts, maximum fire capacities, projector connectivity specs, audio PA capabilities, and accessibility ingress paths.
- Building Evacuation and Fire Maps (Plany ewakuacyjne obiektu): designated fire exit pathways, fire extinguisher and ROP button locations, and primary external assembly muster points.
- House Rules and Facility Regulations (Regulamin obiektu): rules regarding building opening hours, furniture movement restrictions, poster affixing policies, and after-hours key management.
- Standard Safety Briefing Text (Instruktaż BHP i ppoż. dla wolontariuszy): standardized text covering emergency protocols, campus security contact numbers, and reporting workflows for incidents involving minors.

Acknowledgement Tracking Architecture. Verifying that staff, organizers, and volunteers have reviewed compliance documents requires an explicit DocumentAcknowledgement ledger:

1. When an operational user (e.g., a volunteer assigned to a door or room) logs into the system, the platform intercepts the session if mandatory safety briefings remain unacknowledged.
2. The user is presented with the full briefing document text.
3. The user must execute a verifiable confirmation action (checking an explicit affirmation box and clicking "Confirm Acknowledgement").
4. The database captures an immutable audit record: (user_id, document_id, document_version, ip_address, timestamp). If the building administration subsequently releases an updated version of the safety document, previous acknowledgements are flagged as stale, prompting an updated confirmation prompt upon the user's next session.

## 4. Documents and Data Attached to an Event

### Role-Based Document Visibility and Access Control

Event systems handle diverse documentation ranging from public promotional schedules to sensitive facility damage reports. Storing these files requires an object-level access control model built into the document storage pipeline.

Document visibility categories must be delineated across four operational tiers:

- **Public Documents:** Open to unauthenticated external visitors. Examples include the conference program brochure, keynote speaker abstracts, and campus public transit maps.
- **Attendee-Only Documents:** Visible exclusively to authenticated users who possess an approved Registration record for the event. Examples include local guest Wi-Fi connection credentials, private workshop preparation materials, reading lists, and digital participant certificates.
- **Staff-Only Documents:** Restricted to users holding an operational staff role (ORGANISER, REVIEWER, VOLUNTEER). Examples include internal run-of-show spreadsheets, volunteer shift rosters, escalation contact sheets, radio communication frequencies, and catering distribution schedules.
- **Venue-Administration Documents:** Restricted to the VENUE_ADMIN and the primary EVENT_ORGANISER. Examples include the formal room rental contract, building inspection certificates, public liability insurance policies, waste disposal receipts, and post-event room damage assessment logs.

Technical Enforcement in Django REST Framework. Documents should not be exposed via unauthenticated static storage URLs. Instead, document downloads must route through a protected DRF endpoint (e.g., /api/events/{id}/documents/{doc_id}/download/). The view validates the user's active role binding against the document's visibility_tier attribute before serving the file via an X-Accel-Redirect (Nginx) or streaming HTTP response, guaranteeing that unauthenticated direct URL guessing is blocked with an HTTP 404 response.

### Analytical Exports and Privacy Leak Vectors

Organizers and facility managers rely on analytical data exports to execute physical operations, catering, and campus reporting. However, poorly structured CSV/Excel exports represent one of the most frequent vectors of accidental GDPR violations in academic environments.

Standard operational exports encompass:

- Registration Roll: participant full names, ticket types, and check-in statuses used for door verification.
- Anonymized Dietary and Accessibility Aggregations: operational summaries provided to third-party catering and facility teams (e.g., "Main Hall: 14 Gluten-Free, 22 Vegan; Room 104: 2 Wheelchair Access Accommodations").
- Room Headcount and Capacity Log: hourly occupancy figures derived from check-in scans and room tally monitors, used for facility compliance reports.
- Cloakroom Reconciliation Sheet: storage slot utilization, abandoned item serials, and lost-token resolution logs.

Common Accidental Personal Data Leak Vectors in Exports:

- **Exporting Complete Database Dumps:** Generating a single monolithic CSV export containing all registration fields. In this scenario, catering volunteers or external sandwich vendors inadvertently receive attendees' private phone numbers, home addresses, institutional affiliations, and full text responses to survey questions.
- **Unredacted Special Category Health Data:** Exporting dietary and accessibility fields alongside attendee names. Under GDPR Art. 9, dietary needs linked to medical conditions (e.g., "Severe Celiac Disease") or religious requirements constitute special category personal data. Merging names with medical needs in an unencrypted CSV distributed to student volunteers violates RODO data minimization mandates.
- **Guardian Identity Exposure:** Exporting minor participant rosters with parental email addresses, telephone numbers, and custody notes visible to general event staff.

System Safeguards. The platform must enforce Role-Scoped Export Templates:

- The Catering Export must be strictly programmatically aggregated: SELECT dietary_option, COUNT(*) GROUP BY dietary_option, outputting zero individual attendee identifiers.
- Door Check-in Exports accessible to volunteers must strip all columns except Registration ID, Full Name, Ticket Category, and Check-in Status.
- Detailed Exports containing personal contact data must be restricted exclusively to the primary EVENT_ORGANISER role and logged in an immutable system audit trail.

### Data Retention and Purging Lifecycles

In accordance with the storage limitation principle of GDPR (Art. 5(1)(e)), personal data must be erased or anonymized as soon as the specific purposes for which they were processed have been completed. Guidance from Polish universities and UODO indicates that holding detailed attendee records indefinitely after an academic gathering concludes lacks legal basis.

The EdMat platform should implement a tiered retention schedule:

- **Ephemeral Operational Data (Purged T + 14 to 30 Days):** check-in scan timestamps and device telemetry; temporary dietary requirements and special assistance requests (erased immediately once physical catering and accessibility delivery concludes); cloakroom deposit logs and lost-token recovery identity records (retained for 30 days to cover property claims, then purged).
- **Academic Record and Contribution Archive (Retained 1 to 5 Years):** public conference schedules, scientific contribution abstracts, paper review feedback, and speaker attribution details form part of the permanent academic record and scientific citation index. These can be retained under legitimate interest and academic research exemptions.
- **Accounting and Legal Evidence (Retained 5 Years):** while EdMat processes zero payments, formal room rental contracts, campus facility damage claims, and institutional facility agreements must be retained for 5 years in alignment with the Polish Civil Code statute of limitations on civil claims (przedawnienie roszczeń).
- **Minors' Personal Records (Immediate Post-Event Scrubbing):** contact data, birthdates, and guardian personal data collected solely to verify child attendance must be purged or irreversibly anonymized within 14 days following event closure. Exception: formal records of parental legal consent for unaccompanied minor participation and records of child safeguarding incident reports (Standardy Ochrony Małoletnich) must be sealed and archived in restricted administrative custody for the duration of the statutory civil liability period for personal injury, inaccessible to general organizers or volunteers.

## 5. Testing as Another User: "View As" Architecture and Security

### Role Preview Versus Session Impersonation

Software platforms adopt two fundamentally distinct patterns to allow an administrative user to inspect the interface from another perspective:

**Pattern 1: Role Preview (Capability Masking).** Mechanism: the user remains authenticated entirely within their own session and account identity. The application applies a client-side or server-side permission filter (a "role mask") that temporarily restricts rendered UI components and API capabilities to match the target role. Implementations: Discord (Server Settings → "View Server as Role"), pretix ("Preview Mode"), Indico (switching layout preview), Moodle ("Switch role to..."). Security Profile: high safety. Because the user's cryptographic session token remains their own, no privilege escalation occurs. The user cannot access private personal records of other real individuals; they simply observe how layout structures render for a generic persona holding that role tier.

**Pattern 2: Session Impersonation ("Login As" / Masquerade).** Mechanism: the administrator's session actively issues an authentication token or session cookie belonging to a specific target user. The server executes incoming requests within the target user's security context. Implementations: WordPress User Switching, Drupal Masquerade, Salesforce "Login As", Canvas "Act as User", Google Workspace Admin Console. Security Profile: high vulnerability risk. If the target user possesses private messages, personal identifying documents, or sensitive academic drafts, the impersonating admin gains direct read and write access.

Security Controls for Impersonation Systems. Where full impersonation is implemented, robust security architectures demand strict programmatic constraints:

- **Complete Prohibition of State-Altering Writes:** When an impersonation token is active, all HTTP mutation requests (POST, PUT, PATCH, DELETE) directed at business endpoints must be blocked with an HTTP 403 Forbidden, forcing an immutable read-only session.
- **Exclusion of Regulated Endpoints:** Impersonated sessions must be strictly forbidden from accessing private communications, password resets, account deletion, signing legal waivers, or consenting to GDPR policies.
- **Persistent Visual UI Frame:** The interface must render a high-contrast, unclosable persistent top banner across all pages (e.g., a solid amber bar displaying: "IMPERSONATING USER: John Doe. READ-ONLY MODE. Click here to return to your administrative console").
- **Explicit Exit Mechanism:** A single-click exit trigger that instantly destroys the temporary token and restores the administrator's original security context.
- **Comprehensive Audit Trails:** Every single HTTP GET request executed under an impersonation context must be logged into an append-only audit ledger recording: (admin_user_id, target_user_id, impersonation_session_id, request_path, query_params, ip_address, timestamp).

### Vulnerability Analysis: The 2018 Facebook "View As" Security Incident

The extreme security hazard of combining user impersonation with client-side feature interaction was demonstrated in the September 2018 Facebook security breach, which compromised the access tokens of nearly 50 million user accounts.

The breach was not caused by a simple authorization bypass, but by the emergent interaction of three distinct software components:

1. The "View As" feature was conceived strictly as a read-only privacy tool, allowing User A to see what their personal profile looked like to User B.
2. A video uploader module, embedded on the profile page, mistakenly rendered an interactive birthday greeting composer within the "View As" mode.
3. The video composer embedded the Facebook Mobile Single Sign-On (SSO) JavaScript SDK. When loaded within the "View As" interface, the SDK generated an authentication access token not for User A (the viewer), but for User B (the viewed user), exposing the bearer token directly in the browser HTML source code.

The Exploit: attackers wrote automated scripts that executed "View As" lookups against their friends, scraped the returned valid access tokens from the HTML response, used those tokens to query the Graph API to obtain friends-of-friends, and iteratively harvested 50 million fully privileged account tokens.

Core Design Principles Derived from the Facebook Post-Mortem:

- **Architectural Separation of Viewing State:** A "View As" mode must never execute real underlying client-side SDK initializations or generate user-scoped authorization tokens.
- **Complete Suppression of Interactive Elements:** When an interface is viewed under a preview or impersonation mask, all interactive plugins, client-side OAuth injectors, and write endpoints must be completely stripped out at the template rendering layer.
- **Never Conflate Masking with Token Swapping:** Previews should be generated by passing a boolean parameter (e.g., ?preview_role=VOLUNTEER) that filters the current user's read access down, rather than generating an active session token representing another human being.

### Lightweight Alternative: Seeded Demo Events with Named Personas

For a volunteer-run academic platform such as EdMat, implementing production session impersonation represents an unjustifiable security and maintenance risk. The vastly superior and lighter alternative is the deployment of Seeded Persona Fixtures on a staging environment or within an isolated "Sandbox Event" on production.

Preset Archetype Personas. The application test runner or database seeder creates an isolated sandbox event populated with deterministic, named fictional personas:

- dr_anna_organiser: primary event host with full management privileges.
- tomasz_volunteer_door: volunteer restricted to the front entrance scanner view.
- karol_szatniarz: volunteer assigned strictly to the wardrobe desk.
- prof_nowak_reviewer: academic reviewer assigned to physics papers.
- student_kasia_attendee: standard confirmed registered student.
- junior_antoni_minor: minor attendee (age 14) registered under a guardian.
- ewa_guardian: guardian account managing Antoni.
- mgr_kowalski_venue: facility manager of the Physics Faculty building.

Sandbox Isolation and Real-Data Protection:

- **Deterministic Tagging:** All seeded persona accounts use explicitly flagged usernames and email addresses within the .test or .example reserved domains (e.g., persona.door@edmat.example).
- **Sandbox Event Constraints:** Personas are authorized only within an explicitly flagged sandbox event (is_sandbox = True). They possess zero permissions across active real-world conferences.
- **Single-Click Dev Switcher:** In development and staging environments, a dedicated dev bar allows developers and organizers to click "Switch to Tomasz (Door Volunteer)" to instantly reload the interface within that persona's pre-configured state, without exposing any real attendee's production account to tampering or snooping.

### Automated Testing of Permission Matrices

To ensure that role-based access control never regresses as new endpoints are introduced, mature open-source conference systems utilize automated permission matrix test runners.

Rather than authoring hundreds of fragmented, repetitive integration tests, systems model permissions as a declarative tabular matrix. In a Django test suite, this is implemented via parameterized test harnesses (e.g., pytest.mark.parametrize): the test suite defines a structured dataset mapping (Role, API Endpoint, HTTP Method, Payload, Expected HTTP Status); a single parameterized test function iterates over the matrix, instantiates a client authenticated as the specified Role, executes the specified HTTP request against the API endpoint, and asserts that the response matches the expected status (e.g., HTTP 200 for authorized roles; HTTP 403 or 404 for unauthorized roles).

Example matrix (role / endpoint / method / expected / rationale):

- Anonymous Visitor / /api/events/1/programme/ / GET / 200 OK / Public conference agenda is unauthenticated.
- Anonymous Visitor / /api/events/1/registrations/ / GET / 404 Not Found / Tenant isolation; strangers receive 404 rather than 403.
- Anonymous Visitor / /api/events/1/checkin/redeem/ / POST / 404 Not Found / Scanner endpoints are invisible to unauthenticated traffic.
- Registered Attendee / /api/events/1/ticket/ / GET / 200 OK / Attendees can view their personal admission credentials.
- Registered Attendee / /api/events/1/registrations/ / GET / 403 Forbidden / General participants cannot inspect other registrants.
- Registered Attendee / /api/events/1/checkin/redeem/ / POST / 403 Forbidden / Admission redemption restricted to authorized staff.
- Door Volunteer / /api/events/1/checkin-list/ / GET / 200 OK / Scanners require admission lookup registries.
- Door Volunteer / /api/events/1/checkin/redeem/ / POST / 201 Created / Door staff are authorized to redeem valid tickets.
- Door Volunteer / /api/events/1/submissions/ / GET / 403 Forbidden / Paper review workflows strictly segregated from door staff.
- Door Volunteer / /api/events/1/rooms/ / POST / 403 Forbidden / Physical room configuration restricted to venue admins.
- Venue Administrator / /api/events/1/checklists/ / GET / 200 OK / Facility admins inspect compliance checklists.
- Venue Administrator / /api/events/1/checklists/1/sign/ / POST / 200 OK / Facility admins execute compliance sign-offs.
- Venue Administrator / /api/events/1/submissions/ / GET / 403 Forbidden / Facility management has no access to scientific reviews.

## 6. Synthesis

### Comprehensive Comparative Matrix

Columns: Platform / Role Model / Scope Granularity / Volunteer View / Check-in-QR Token Model / Offline Scanning / Cloakroom / Role-Based Documents / Checklists-Templates / Venue as Object / View-As / Open Source & Licence / Self-Hostable.

- **Indico (CERN)** / Fixed presets with object ACLs / Category, Event, Session, Contribution / Minimal (session convener view) / Opaque numeric or barcode lookup / Limited (mobile app relies on live sync) / None / Yes (fine-grained ACLs per material) / None / Yes (dedicated Room Booking engine) / Display preview mode / Yes (MIT) / Yes (Python, Postgres).
- **pretalx** / Preset teams + custom capability flags / Event and Track / None (focused strictly on CFP and review) / None (requires external ticketing integration) / None / None / Limited to public talk attachments / None / No (rooms are text attributes under event) / Internal schedule preview / Yes (GPLv3) / Yes (Django, Postgres).
- **pretix** / Capability checkboxes + device auth / Organizer, Event, Check-in List, Gate-Device / High (pretixSCAN device mode) / Opaque random secret or Ed25519 signed token / High (full local SQLite sync and proxy caching) / None (external add-on hack only) / Limited (ticket PDF layouts per product) / None / No (events contain rooms and locations) / Preview mode for web store / Yes (RPL, pretix Enterprise) / Yes (Django).
- **Eventyay (Open Event)** / Fixed roles (Admin, Organizer, Co-organizer, Attendee) / Event / Basic volunteer-organizer app / Opaque string QR lookup / Moderate (mobile app offline queue) / None / Limited (speaker slide uploads) / None / No (rooms belong to event tracks) / None / Yes (GPLv3) / Yes (Flask).
- **frab** / Fixed roles (Admin, Coordinator, Reviewer) / Global and Conference / None / None / None / None / None / None / No (rooms tied to conference) / Read-only schedule preview / Yes (MIT) / Yes (Ruby on Rails).
- **EasyChair** / Rigid academic workflow roles / Conference, Track, bidded Paper / None / None / None / None / Restricted to author papers and review forms / None / No / None / Proprietary / No (SaaS only).
- **ConfTool** / Predefined functional roles / Event and Submission Track / None / Basic barcode on invoice or badge / Minimal / None / Paper and invoice attachments / None / No / Administrative user switch (limited) / Proprietary (Pro, Standard) / Yes (PHP, MySQL on-premise licence).
- **OpenConf** / Fixed roles (Chair, Reviewer, Author) / Submission category / None / None / None / None / Manuscript uploads only / None / No / None / Proprietary / Yes (PHP).
- **Sched** / Fixed presets (Admin, Speaker, Volunteer) / Event and Session / Simple mobile session check-in / Barcode or QR scan to session roster / Low (requires periodic connectivity) / None / Session presentation files (public, attendees) / Basic onboarding checklist / No (rooms are schedule attributes) / None / Proprietary / No (SaaS only).
- **Whova** / Fixed enterprise profiles / Event and Booth / Dedicated volunteer scanner app / Opaque QR code badge scan / Moderate (local app caching) / None / Document center with audience segmentation / None / No / None / Proprietary / No (SaaS only).
- **Cvent** / Granular custom enterprise RBAC / Organization, Event, Module, Device / Comprehensive on-site staff app / Encrypted barcode, QR, RFID / High (enterprise on-site local server hubs) / None (treated as custom tracked asset) / Enterprise document library with ACLs / Extensive workflow and milestone checklists / Enterprise facility catalog add-on / Administrative impersonation mode / Proprietary / No (multi-tenant cloud).
- **Eventbrite** / Coarse-grained roles (Admin, Staff) / Organization and Event / Eventbrite Organizer app (entry only) / Opaque ticket barcode QR / High (app caches guest list) / None / None / None / No / None / Proprietary / No (SaaS only).
- **Tito** / Fixed roles (Admin, Check-in Assistant) / Account and Event / Tito Check-in app / Opaque ticket token / Moderate (offline sync in check-in app) / None / None / None / No / None / Proprietary / No (SaaS only).
- **VolunteerLocal** / Shift coordinators vs volunteers / Opportunity, Shift, Location / High (personalized shift dashboard) / Volunteer check-in via PIN or QR / Low (mobile app requires internet) / None / Shift orientation document downloads / Volunteer onboarding task checklist / No / Administrative volunteer view / Proprietary / No (SaaS only).

### Recommended Role × Capability Matrix for EdMat

The recommended matrix balances robust institutional safety with operational simplicity. Capabilities marked Fixed are hard-coded in the Django permission classes to preserve system security and legal compliance; capabilities marked Settable can be toggled by the Event Organiser in the event settings. Precedents from observed platforms (Indico, pretix, Booked Scheduler, VolunteerLocal) justify each architectural binding.

Column order: Platform Moderator / Venue Admin / Event Organiser / Reviewer / Vol: Door / Vol: Room / Vol: Info / Vol: Cloak / Speaker / Attendee / Guardian (Minor) / Anonymous — Precedent.

- Manage Platform Users & Sanctions: Yes / No / No / No / No / No / No / No / No / No / No / No — Indico System Admin.
- Define Physical Buildings & Rooms: No / Yes / No / No / No / No / No / No / No / No / No / No — Booked, Indico RB.
- Approve / Reject Room Reservations: No / Yes / No / No / No / No / No / No / No / No / No / No — Booked Resource Admin.
- Manage Venue Checklist Templates: No / Yes / No / No / No / No / No / No / No / No / No / No — Planning Pod, Cvent.
- Sign Off Mandatory Checklist Items: No / Yes / No / No / No / No / No / No / No / No / No / No — UW Event Protocol.
- Edit Event Metadata & Settings: Yes / No / Yes / No / No / No / No / No / No / No / No / No — pretix Event Admin.
- Assign Event Staff & Volunteers: No / No / Yes / No / No / No / No / No / No / No / No / No — pretalx Team Admin.
- Submit Proposals / Edit Own Proposal: No / No / Settable / No / No / No / No / No / Yes / Yes / No / No — pretalx, frab.
- Blind Review Assigned Submissions: No / No / Yes / Yes / No / No / No / No / No / No / No / No — Indico, EasyChair.
- Access Full Registration Database: No / No / Yes / No / No / No / No / No / No / No / No / No — GDPR data minimisation.
- Scan & Validate Door Check-ins: No / No / Yes / No / Yes / No / Settable / No / No / No / No / No — pretixSCAN device.
- Undo Door Check-in Scan: No / No / Yes / No / Yes / No / No / No / No / No / No / No — pretixSCAN.
- Log Room Headcount Tally: No / No / Yes / No / No / Yes / No / No / No / No / No / No — Sched monitor.
- Query Attendee Name / Reissue Badge: No / No / Yes / No / No / No / Yes / No / No / No / No / No — Cvent on-site info.
- Intake / Return Cloakroom Items: No / No / Yes / No / No / No / No / Yes / No / No / No / No — anonymous bailment.
- Log Lost Cloakroom Token Recovery: No / No / Yes / No / No / No / No / Yes / No / No / No / No — facility lost and found.
- View Attendee-Only Documents: No / No / Yes / Yes / Yes / Yes / Yes / Yes / Yes / Yes / Yes / No — Indico ACLs.
- View Staff-Only Run-of-Show Documents: No / Yes / Yes / No / Yes / Yes / Yes / Yes / No / No / No / No — Timecounts briefings.
- View Venue Legal & Damage Docs: No / Yes / Yes / No / No / No / No / No / No / No / No / No — UW administration.
- Sign Safety Briefing Acknowledgment: No / No / Yes / No / Yes / Yes / Yes / Yes / No / No / No / No — VolunteerLocal.
- Register / Cancel Own Ticket: No / No / Yes / Yes / Yes / Yes / Yes / Yes / Yes / Yes / No / No — standard registration.
- Manage Child's Ticket & Consent: No / No / No / No / No / No / No / No / No / No / Yes / No — Standardy Ochrony.
- View Public Agenda & Abstracts: Yes for every role including Anonymous — public core.

### Conceptual Data Model Sketch

**Venue** — a physical university facility, building complex, or campus site. Attributes: id, name, slug, address, contact_email, campus_security_phone, is_active, created_at. Has many Room, VenueAdministrator bindings, ChecklistTemplate. Invariants: cannot be deleted if active or future event reservations are bound to any of its rooms; campus_security_phone must be non-empty before the venue can host events.

**Room** — a lecture hall, laboratory, or seminar space within a Venue. Attributes: id, venue_id, name, room_number, floor, seated_capacity, fire_evacuation_capacity, has_av_equipment, is_wheelchair_accessible, is_active. Has many Session bindings and RoomBookingRequest. Invariants: seated_capacity cannot exceed fire_evacuation_capacity; overlapping CONFIRMED booking requests for the same space and time block are barred.

**ChecklistTemplate** — a master checklist defined by a Venue or platform default. Attributes: id, venue_id (nullable for system defaults), name, description, version, event_type_applicability, is_active. Has many ChecklistTemplateItem (id, template_id, title, description, owner_role, due_offset_days, is_mandatory, na_allowed, evidence_type, requires_venue_signoff).

**ChecklistInstance** — the concrete checklist for one Event (one-to-one). Attributes: id, event_id, source_template_id, template_version_applied, is_fully_cleared. Has many ChecklistInstanceItem (id, instance_id, title, owner_role, computed_due_date, status PENDING / IN_PROGRESS / COMPLETED / WAIVED_NA, na_reason, evidence_file, completed_by_user_id, completed_at, signed_off_by_user_id, signed_off_at). Invariants: a mandatory item in PENDING blocks DRAFT → PUBLISHED (or venue sign-off); WAIVED_NA requires a non-empty na_reason of at least 15 characters; requires_venue_signoff items cannot reach COMPLETED without a signer holding VENUE_ADMIN.

**EventDocument** — a file or link attached to an event with access gating. Attributes: id, event_id, venue_id (nullable), title, file_attachment, visibility_tier (PUBLIC, ATTENDEE_ONLY, STAFF_ONLY, VENUE_ONLY), requires_acknowledgement, document_version, created_at. Has many DocumentAcknowledgement. Invariant: downloads are verified against the requester's role; unauthenticated requests for non-public files return 404.

**DocumentAcknowledgement** — immutable record of a user reading and accepting a briefing. Attributes: id, document_id, user_id, document_version, ip_address, acknowledged_at. Invariants: duplicates for the same (document, user, version) are rejected; volunteer tools block until every mandatory briefing is acknowledged.

**CloakroomItem** — a deposited item. Attributes: id, event_id, rack_identifier, token_hash, status (STORED, RETURNED, UNCLAIMED_ABANDONED), deposited_at, returned_at, deposited_by_volunteer_id, returned_by_volunteer_id, exception_recovery_notes. Invariants: a rack_identifier cannot be reused while another item on it is STORED for that event; token_hash unique among active STORED items; exception_recovery_notes must be populated when an item is RETURNED without the matching token.

**ScanEvent** — immutable record of a badge or ticket redemption. Attributes: id, event_id, registration_id, scanner_device_id, scanned_by_user_id, scan_type (ENTRY, EXIT), client_nonce, client_timestamp, server_timestamp, is_offline_sync, is_duplicate_collision. Invariants: client_nonce unique across all scans (idempotent batch sync); a second ENTRY without an intervening EXIT is persisted with is_duplicate_collision = True and raises an alert.

**ImpersonationAuditLog** — append-only log of role masking or persona switches. Attributes: id, actor_user_id, impersonated_role, target_user_id (nullable for role-only masks), request_path, request_method, ip_address, timestamp. Invariants: append-only at the schema level; any mutation under an impersonation session is blocked and logged as a violation.

### Bilingual Checklist Starter Templates

Operationalizations of Polish university regulations (UW Zarządzenie nr 110, fire safety regulations, child safeguarding acts). Format: English item / Polish item / (Owner | Due | Mandatory | Sign-off) / Source.

**Template 1: One-Room Guest Lecture** (UW Zarządzenie nr 110 § 2, Prawo o szkolnictwie wyższym i nauce art. 52, faculty room administration guidelines)

1. Reserve lecture hall and verify seated capacity. / Rezerwacja sali wykładowej i weryfikacja liczby miejsc siedzących. / Organiser | T - 14 days | Yes | Venue Admin / IBP and faculty room reservation rules.
2. Test audio-visual equipment and guest Wi-Fi access. / Weryfikacja sprawności sprzętu AV oraz dostępu do sieci Wi-Fi dla gości. / Organiser | T - 2 days | No | None / faculty technical support protocols.
3. Display GDPR Art. 13 photography and recording information notices at the entrance. / Wywieszenie klauzuli informacyjnej RODO (art. 13) o rejestracji foto/wideo przy wejściu do sali. / Organiser | T - 1 hour | Yes | None / UODO event guidelines and Art. 81 Prawo autorskie.
4. Reinstatement of lecture hall furniture and key surrender. / Przywrócenie pierwotnego układu sali i zdanie kluczy na portierni. / Organiser | T + 1 hour | Yes | Venue Admin / Regulamin obiektu.

**Template 2: One-Day Workshop with Catering** (BHP rules, campus security guidelines, sanitary waste protocols)

1. File catering service notification and verify electrical power capacity for warming units. / Zgłoszenie firmy cateringowej i weryfikacja dopuszczalnego obciążenia instalacji elektrycznej dla podgrzewaczy. / Organiser | T - 10 days | Yes | Venue Admin / campus technical infrastructure and fire safety regulations.
2. Submit external delivery vehicle registration for loading dock gate access. / Zgłoszenie numerów rejestracyjnych pojazdów dostawczych cateringu do Straży Uniwersyteckiej (przepustka wjazdowa). / Organiser | T - 3 days | Yes | Venue Admin / Straż Uniwersytecka vehicle access rules.
3. Ensure unobstructed escape routes in catering and foyer zones. / Kontrola drożności ciągów ewakuacyjnych w strefie cateringu i foyer (brak zastawiania dróg ewakuacyjnych stolikami). / Organiser | T - 1 hour | Yes | Venue Admin / Rozporządzenie MSWiA w sprawie ochrony przeciwpożarowej budynków § 4.
4. Segregated waste disposal verification and post-event foyer cleaning. / Protokół uprzątnięcia odpadów pocateringowych i selektywna zbiórka śmieci w foyer. / Organiser | T + 2 hours | Yes | Venue Admin / municipal waste obligations and campus hygiene rules.

**Template 3: Two-Day Multi-Room Academic Conference** (UW Zarządzenie nr 110, Prawo o szkolnictwie wyższym i nauce, campus administrative standards)

1. Formal event submission and safety concept filing with the Faculty Dean / Building Head. / Formalne zgłoszenie wydarzenia i przedłożenie koncepcji bezpieczeństwa Dziekanowi / Kierownikowi jednostki. / Organiser | T - 30 days | Yes | Venue Admin / UW Zarządzenie nr 110 § 3–4.
2. Verify aggregate concurrent attendance remains below statutory mass event thresholds. / Weryfikacja, czy przewidywana liczba jednoczesnych uczestników nie przekracza limitów ustawy o bezpieczeństwie imprez masowych. / Organiser | T - 14 days | Yes | Venue Admin / Ustawa o bezpieczeństwie imprez masowych art. 3.
3. Deliver mandatory fire evacuation and emergency contact briefing to operational volunteers. / Przeprowadzenie instruktażu z zakresu dróg ewakuacyjnych i procedur awaryjnych dla wolontariuszy i służby informacyjnej. / Organiser | T - 1 day | Yes | None / IBP and volunteer training guidelines.
4. Pre-event physical room condition walkthrough and audio-visual handover protocol. / Protokolarne przejęcie sal i sprzętu multimedialnego od administratora budynku. / Organiser | T - 2 hours | Yes | Venue Admin / university asset management procedures.
5. End-of-day wardrobe reconciliation and transfer of unclaimed garments to campus lost-and-found. / Rozliczenie szatni po zakończeniu konferencji i protokolarne przekazanie rzeczy znalezionych do depozytu uczelni. / Organiser | T + 3 hours | Yes | Venue Admin / Kodeks cywilny art. 835 and university property regulations.
6. Joint damage inspection walkthrough and formal facility release. / Końcowy protokół zdawczo-odbiorczy obiektu i weryfikacja ewentualnych uszkodzeń mienia. / Organiser | T + 1 day | Yes | Venue Admin / civil liability and faculty room lease regulations.

**Template 4: School Science Day with Minors** ("Ustawa Kamilka", lab safety regulations, UODO minor guidance)

1. Verify staff and volunteers against the National Register of Sexual Offenders (RSPTS) and collect child protection policy acknowledgements. / Weryfikacja personelu i wolontariuszy w Rejestrze Sprawców Przestępstw na Tle Seksualnym (RSPTS) oraz odebranie oświadczeń o zapoznaniu się ze Standardami Ochrony Małoletnich. / Organiser | T - 14 days | Yes | Venue Admin / Ustawa z dnia 13 maja 2016 r. o przeciwdziałaniu zagrożeniom przestępczością na tle seksualnym i ochronie małoletnich (t.j. Dz.U. z 2024 r. poz. 560).
2. Collect signed digital guardian consent forms and emergency contact numbers for all participating minors. / Weryfikacja posiadania zgód rodziców/opiekunów prawnych na udział małoletnich oraz rejestracja telefonów kontaktowych ICE. / Organiser | T - 3 days | Yes | None / Kodeks rodzinny i opiekuńczy and institutional standards.
3. Chemical and laser safety assessment for hands-on physics/chemistry laboratory workshops. / Protokół bezpieczeństwa chemicznego, radiologicznego lub laserowego dla pokazów laboratoryjnych z udziałem młodzieży. / Organiser | T - 7 days | Yes | Venue Admin / Regulamin pracowni fizycznych/chemicznych.
4. Badge minimization verification: minor badges display first name only and carry concealed emergency contact data. / Weryfikacja minimalizacji danych na identyfikatorach: wyłącznie imię dziecka na awersie, telefon do opiekuna ukryty na rewersie. / Organiser | T - 2 hours | Yes | None / UODO child data guidance and Standardy Ochrony Małoletnich.
5. Designated minor safe-haven and lost child operational procedure briefing. / Wyznaczenie punktu opieki nad zagubionym dzieckiem i instruktaż procedury reagowania na incydenty krzywdzenia dzieci. / Organiser | T - 1 hour | Yes | Venue Admin / Procedura interwencji w ramach Standardów Ochrony Małoletnich.

### "Do Not Build" Recommendations

1. **Native Mobile Wallet Pass Generation (.pkpass / Google Wallet APIs).** iOS .pkpass files need a paid Apple Developer Account ($99 USD/year) for trusted signing certificates; Google Wallet needs OAuth integration and commercial business console registration. Offline-cached PWA web tickets and printable PDFs fulfil admission requirements with zero vendor fees.
2. **Dynamic Checkbox Permission Customization.** Fine-grained capability toggles create configuration drift, authorization rot, and privacy leaks in volunteer-run environments. Enforce bounded Role Presets with contextual assignment scoping.
3. **Direct Synchronous Multi-User Door Scanning to SQLite.** Unbuffered commits from 5 or 10 simultaneous scanners trigger lock contention during burst entries. Decouple via client-side batching and optimistic synchronization.
4. **Administrative Session Impersonation ("Login As User").** Token substitution exposes private communications, drafts, and guardian records, as the 2018 Facebook breach showed. Support only read-only Role Previews and Seeded Persona Sandboxes.
5. **Mandatory Per-Session Door Scanning.** Scanning at every breakout door collapses volunteer bandwidth and congests corridors. Enforce capacity upstream at registration; keep scanners at the main entrance.
6. **Integrated Email Blast and Marketing Campaigns.** Violates the permanent no-outgoing-email architecture. Communication stays pull-based.
7. **Attendee-Linked Wardrobe Management.** Binding identities to garment custody slows queues and violates data minimisation. Anonymous dual-token systems are faster and legally sound under the Civil Code.

### Ten Most Consequential Decisions

1. **Role Authorization Paradigm.** Recommendation: Role Presets with Contextual Scoping Overrides (Organiser, Reviewer, Volunteer [Door, Room, Info, Cloakroom], Venue Admin), rejecting per-capability checkbox editors. Counter-argument: prevents bespoke hybrid roles, requiring two assignments instead of one custom profile.
2. **QR Token Cryptographic Architecture.** Recommendation: opaque random token (32 alphanumeric characters) validated against a locally cached lookup table. Counter-argument: Ed25519 signed tokens validate authenticity without a pre-synced attendee database.
3. **Badge Delivery Vector Under Zero-Email Policy.** Recommendation: in-app responsive web views cached offline via Service Workers plus server-rendered printable PDFs; abandon wallet passes. Counter-argument: wallet passes give lock-screen geofenced notifications and one-touch retrieval.
4. **Concurrency and SQLite Write-Lock Mitigation.** Recommendation: scanning clients buffer locally and sync in idempotent batches every 3 to 5 seconds. Counter-argument: a 3 to 5 second lag during which one ticket could be presented at two doors before the collision is registered.
5. **Cloakroom Identity Architecture.** Recommendation: anonymous bearer token with identity lookup only as the lost-token exception. Counter-argument: badge-linked coats eliminate manufacturing and replacing physical tokens.
6. **Venue Administrative Autonomy.** Recommendation: Venue as a first-class entity with its own administrator holding veto authority over reservations, checklist sign-offs and compliance. Counter-argument: bureaucratic overhead; organisers cannot publish until an external administrator approves.
7. **Checklist Template Versioning Strategy.** Recommendation: snapshot/fork on instantiation, decoupled from later template edits. Counter-argument: an urgent statutory update to the master template does not reach events already in planning unless manually reconciled.
8. **User Testing and Preview Architecture.** Recommendation: read-only role masking and staging persona sandboxes; reject session impersonation. Counter-argument: moderators cannot directly diagnose bugs tied to a specific attendee's idiosyncratic data state.
9. **Minor Safeguarding and Identification on Badges.** Recommendation: first name only, guardian contact concealed on the reverse, a distinct lanyard colour. Counter-argument: in formal academic settings a full name and school affiliation confer recognition and presentation dignity.
10. **Breakout Session Access Control.** Recommendation: enforce room capacity at registration; no QR scanning at breakout doors; passive head-count tallies. Counter-argument: does not stop unregistered attendees from walking into high-demand workshops.

## Appendix: Polish Legal Thresholds and Checklist Templates (Załącznik Prawny)

### Progi Prawne i Regulacje Krajowe

**1. Ustawa o bezpieczeństwie imprez masowych.** Zgodnie z art. 3 ustawy z dnia 20 marca 2009 r. o bezpieczeństwie imprez masowych (t.j. Dz.U. z 2023 r. poz. 616 ze zm.), status imprezy masowej zależy od charakteru wydarzenia oraz progów liczbowych:

- Masowa impreza artystyczno-rozrywkowa: w budynku, hali sportowej lub innym obiekcie zamkniętym od 500 miejsc udostępnionych przez organizatora (ustalonych zgodnie z przepisami budowlanymi i ppoż.); na stadionie, innym obiekcie niebędącym budynkiem lub terenie otwartym od 1000 miejsc.
- Masowa impreza sportowa: w hali sportowej lub innym budynku od 300 miejsc; na stadionie lub terenie otwartym od 1000 miejsc.
- Impreza masowa podwyższonego ryzyka: w budynku od 200 miejsc; na terenie otwartym od 300 miejsc.

Wyłączenia ustawowe dla uczelni. Zgodnie z art. 3 pkt 1 lit. a-c ustawy, przepisów nie stosuje się m.in. do imprez organizowanych w teatrach, operach, kinach, muzeach, bibliotekach, domach kultury i galeriach sztuki. Na uniwersytetach, zgodnie z utrwaloną linią orzeczniczą oraz regulacjami wewnętrznymi (np. Zarządzenie nr 110 Rektora UW z dnia 12 września 2022 r. § 2 ust. 2 pkt 3), konferencje naukowe, sympozja, zjazdy i wykłady dydaktyczne nie stanowią imprez w rozumieniu przepisów o imprezach masowych, lecz stanowią realizację podstawowej misji uczelni wyższej w ramach jej autonomii (art. 9 i art. 50 ustawy Prawo o szkolnictwie wyższym i nauce). Jeżeli jednak wydarzenie organizowane na terenie uczelni ma charakter koncertu, festiwalu kulturalnego (juwenalia) lub zawodów sportowych i przekracza próg 500 osób w sali lub 1000 osób w plenerze, organizator podlega pełnemu rygorowi ustawy (wymóg zezwolenia prezydenta miasta, powołania kierownika ds. bezpieczeństwa oraz zapewnienia koncesjonowanych służb porządkowych).

**2. Prawo o szkolnictwie wyższym i nauce (Zgromadzenia).** Zgodnie z art. 52 ustawy z dnia 20 lipca 2018 r. – Prawo o szkolnictwie wyższym i nauce (t.j. Dz.U. z 2024 r. poz. 1571 ze zm.): członkowie wspólnoty uczelni mają prawo do organizowania zgromadzeń na terenie uczelni; zorganizowanie zgromadzenia w lokalu uczelni wymaga zgody Rektora; o zamiarze zorganizowania zgromadzenia na terenie otwartym uczelni organizatorzy zawiadamiają Rektora co najmniej na 24 godziny przed rozpoczęciem zgromadzenia; Rektor odmawia zgody lub zakazuje zgromadzenia, jeżeli jego cel lub program naruszają przepisy prawa.

**3. Standardy Ochrony Małoletnich ("Ustawa Kamilka").** Zgodnie z ustawą z dnia 13 maja 2016 r. o przeciwdziałaniu zagrożeniom przestępczością na tle seksualnym i ochronie małoletnich (t.j. Dz.U. z 2024 r. poz. 560, ze zmianami wprowadzonymi ustawą z dnia 28 lipca 2023 r., Dz.U. z 2023 r. poz. 1606): od dnia 15 lutego 2024 r. (z okresem dostosowawczym do 15 sierpnia 2024 r.) każdy podmiot prowadzący działalność oświatową, opiekuńczą, wychowawczą, rekreacyjną lub naukową z udziałem dzieci ma bezwzględny prawny obowiązek wdrożenia Standardów Ochrony Małoletnich; przed dopuszczeniem pracownika lub wolontariusza do pracy z małoletnimi organizator ma prawny obowiązek uzyskania informacji z Rejestru Sprawców Przestępstw na Tle Seksualnym (RSPTS) oraz weryfikacji zaświadczenia o niekaralności z Krajowego Rejestru Karnego (KRK); standardy muszą określać zasady bezpiecznych relacji personel–dziecko, procedury podejmowania interwencji w sytuacji podejrzenia krzywdzenia oraz zasady ochrony wizerunku i danych małoletnich.

**4. Ochrona Przeciwpożarowa (Przepisy Podprogowe).** Wydarzenia niespełniające kryteriów imprezy masowej podlegają przepisom rozporządzenia Ministra Spraw Wewnętrznych i Administracji z dnia 7 czerwca 2010 r. w sprawie ochrony przeciwpożarowej budynków, innych obiektów budowlanych i terenów (Dz.U. z 2010 r. Nr 109, poz. 719): liczba osób w pomieszczeniu nie może przekraczać wielkości wynikającej z parametrów dróg ewakuacyjnych oraz bilansu wentylacji określonych w Instrukcji Bezpieczeństwa Pożarowego (IBP) danego budynku; zabrania się zastawiania korytarzy, drzwi ewakuacyjnych oraz dostępu do podręcznego sprzętu gaśniczego i hydrantów stoiskami wystawienniczymi, plakatami czy stolikami cateringowymi.

### Wzory Szablonów List Kontrolnych

**Szablon 1: Wykład Gościnny w Pojedynczej Sali**

1. Rezerwacja sali i weryfikacja pojemności: złożenie wniosku o rezerwację auli z uwzględnieniem liczby miejsc siedzących określonych w Instrukcji Bezpieczeństwa Pożarowego. (Organizator | T - 14 dni | Wymagane: Tak | Zatwierdzenie: Administrator Obiektu)
2. Weryfikacja techniczna AV i sieci: sprawdzenie sprawności rzutnika, nagłośnienia, mikrofonów bezprzewodowych oraz konfiguracji kont gościnnych w sieci Wi-Fi. (Organizator | T - 2 dni | Nie | Brak)
3. Klauzula informacyjna RODO: wywieszenie przy wejściu do auli czytelnej informacji o rejestracji fotograficznej/wideo na podstawie art. 13 RODO oraz art. 81 Prawa autorskiego. (Organizator | T - 1 godzina | Tak | Brak)
4. Zdanie sali i odbiór kluczy: wizualna kontrola stanu sali, wyłączenie aparatury multimedialnej, zamknięcie okien i zwrot klucza do portierni. (Organizator | T + 1 godzina | Tak | Administrator Obiektu)

**Szablon 2: Jednodniowe Warsztaty z Usługą Cateringową**

1. Zgłoszenie firmy cateringowej: zgłoszenie zapotrzebowania na wjazd pojazdów dostawcy oraz weryfikacja dopuszczalnej mocy przyłączy elektrycznych dla podgrzewaczy potraw. (Organizator | T - 10 dni | Tak | Administrator Obiektu)
2. Przepustki wjazdowe Straży Uniwersyteckiej: przekazanie numerów rejestracyjnych i danych kierowców dostarczających sprzęt i wyżywienie. (Organizator | T - 3 dni | Tak | Administrator Obiektu)
3. Kontrola drożności dróg ewakuacyjnych: sprawdzenie, czy bufet cateringowy oraz stoliki koktajlowe nie zawężają wymaganej szerokości korytarzy ewakuacyjnych. (Organizator | T - 1 godzina | Tak | Administrator Obiektu)
4. Uprzątnięcie i segregacja odpadów: protokolarne potwierdzenie wywozu odpadów spożywczych i przywrócenia czystości w przestrzeni wspólnej. (Organizator | T + 2 godziny | Tak | Administrator Obiektu)

**Szablon 3: Dwudniowa Konferencja Wielosesyjna**

1. Wniosek o organizację wydarzenia: złożenie formalnego wniosku do Dziekana/Kierownika Jednostki ze szczegółowym programem i planem wykorzystania sal. (Organizator | T - 30 dni | Tak | Administrator Obiektu)
2. Oświadczenie o charakterze imprezy: potwierdzenie, że wydarzenie ma charakter naukowy i nie podlega rygorom ustawy o bezpieczeństwie imprez masowych. (Organizator | T - 14 dni | Tak | Administrator Obiektu)
3. Szkolenie wolontariuszy z procedur ppoż.: zapoznanie służby informacyjnej z rozmieszczeniem wyjść ewakuacyjnych, ręcznych ostrzegaczy pożaru (ROP) i numerami alarmowymi. (Organizator | T - 1 dzień | Tak | Brak)
4. Protokół przejęcia pomieszczeń: spisanie stanu początkowego sal wykładowych, korytarzy, wyposażenia szatni i sprzętu laboratoryjnego. (Organizator | T - 2 godziny | Tak | Administrator Obiektu)
5. Rozliczenie szatni i depozytu: komisyjne zamknięcie szatni, spisanie rzeczy nieodebranych i przekazanie ich do Biura Rzeczy Znalezionych uczelni. (Organizator | T + 3 godziny | Tak | Administrator Obiektu)
6. Protokół zdawczo-odbiorczy obiektu: końcowy przegląd techniczny z udziałem administratora budynku i podpisanie protokołu braku zniszczeń. (Organizator | T + 1 dzień | Tak | Administrator Obiektu)

**Szablon 4: Dzień Nauki dla Szkół z Udziałem Małoletnich**

1. Weryfikacja w rejestrze sprawców (RSPTS): obowiązkowa weryfikacja w RSPTS wszystkich pracowników, studentów i wolontariuszy mających bezpośredni kontakt z małoletnimi. (Organizator | T - 14 dni | Tak | Administrator Obiektu)
2. Odebranie zgód rodzicielskich i kontaktów ICE: zebranie cyfrowych oświadczeń opiekunów prawnych na udział dzieci oraz numerów kontaktowych w nagłych wypadkach. (Organizator | T - 3 dni | Tak | Brak)
3. Weryfikacja BHP pokazów fizycznych: zatwierdzenie instrukcji bezpiecznego przeprowadzania demonstracji kriogenicznych, laserowych lub wysokich napięć z udziałem publiczności. (Organizator | T - 7 dni | Tak | Administrator Obiektu)
4. Identyfikatory bezpieczne dla dzieci: przygotowanie identyfikatorów zawierających wyłącznie imię uczestnika na awersie oraz numer ICE na odwrocie. (Organizator | T - 2 godziny | Tak | Brak)
5. Wyznaczenie punktu opieki i koordynatora ds. małoletnich: wskazanie oznakowanego pomieszczenia bezpiecznego pobytu dla dzieci odłączonych od grup oraz powołanie osoby odpowiedzialnej za procedury ochrony małoletnich. (Organizator | T - 1 godzina | Tak | Administrator Obiektu)

## Unanswered Questions and Research Gaps

1. **Internal SQLite stress limits under single-writer concurrency.** WAL benchmarks on fast disks show several hundred transactions per second, but there is no empirical data on the failure threshold for Django REST Framework with bulk-insertion transactions against SQLite under concurrent worker processes on commodity hardware. Benchmarks simulating 10 parallel scanner threads pushing batched check-ins must be run during staging load testing.
2. **Automated integration between academic room booking and campus physical access cards.** No standardized, vendor-neutral protocol is documented for synchronizing room approval states into proprietary campus lock ecosystems (Salto, Assa Abloy, Roger) common in Polish universities. Key and card management remains a manual concierge process.
3. **National judicial precedent on "Ustawa Kamilka" in university contexts.** Because mandatory enforcement took full effect only in mid-2024, appellate case law and formal UODO audits on the boundary of child protection standards during irregular scientific festivals and open campus lecture series remain sparse. Compliance models rely on ministerial guidelines and conservative interpretations by university legal counsels.
