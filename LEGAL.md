# EdMat — legal and compliance

Everything about this project that is a legal commitment rather than an engineering one: who
operates the service, what licence the code and the content are under, the still-unresolved
copyright question hanging over the seed corpus, and the three regulatory surfaces that are
actually built (DSA notice-and-action, GDPR, minors).

Split out of `CLAUDE.md` on 2026-09-19. Where a feature is described here in summary, the full
build reasoning is in `HISTORY.md` under the section named.

> **None of this has been reviewed by a lawyer.** The one place that matters most — the corpus
> copyright question below — rests on a commissioned research report that says, in its own words,
> that it must be reviewed before anything irreversible is executed. Treat this file as a design
> position, not cleared advice.

---

## 1. Who operates the service

From `frontend/src/lib/content/privacy.ts` and `legal.ts`, which are the pages a visitor actually
reads (`/privacy`, `/legal`), in both locales:

- **Operator:** Ośrodek Komputerowy Wydziału Fizyki Uniwersytetu Warszawskiego — the Computer
  Centre of the Faculty of Physics, University of Warsaw, which administers the systems this runs
  on.
- **Built by:** students of the Faculty.
- **Contact point for a student's request or complaint:** Dziekanat Studencki, the Student Dean's
  Office, which passes requests on.
- **Supervisory authority named to the user:** Prezes Urzędu Ochrony Danych Osobowych.

That identity is stated in exactly one place per locale and reused; `/legal` (the DSA point of
contact page) deliberately reuses the same strings rather than inventing a second operator identity.

**Corrected 2026-10-14 (`ANALYTICS-LAW.md` §4.2), not yet confirmed.** The Ośrodek is an
organisational unit without legal personality, so it can be neither a party to the terms of use nor
the GDPR controller. `/terms` (§ 2), `/privacy` and `/legal` now name **Uniwersytet Warszawski,
ul. Krakowskie Przedmieście 26/28, 00-927 Warszawa** as service provider and controller, with the
Ośrodek running the service on its behalf. The address is the research note's, marked unverified
there. Three data the law requires are still **visible placeholders** on those pages: a contact
e-mail address (u.ś.u.d.e. art. 5; `no-reply@edmat.net` is send-only), IOD UW's contact details
(GDPR art. 13(1)(b)), and — implicitly — IOD UW's agreement that the University is the controller at
all. The Dziekanat Studencki is no longer named as the contact point; it never agreed to be one.

---

## 2. Licences

### The code

**MIT** (`LICENSE`, "Copyright (c) 2026 tryingtodosth"). This has one real consequence that has
already decided a dependency choice twice: **GPL code is not bundled into this app's build.**

| Decision | Chosen | Rejected, and why |
|---|---|---|
| Rich-text editor (§17AS) | **Tiptap 2**, MIT | TinyMCE 7 — GPL-or-commercial, and its maths plugin is paid |
| Chemistry editor (§17AV) | **Ketcher**, Apache 2.0 (EPAM) | ChemDoodle Web Components — GPL. It was vendored, wired up, verified in a browser and removed the same afternoon on Piotr's "drop the GPL chemdoodle. we are mit" |

Other notable third-party terms the app is bound by:

- **OpenStreetMap data is ODbL** (§17R). Attribution is not optional, and it is returned *with* the
  geocoding data rather than hardcoded in the UI so the two cannot drift; Leaflet renders its own
  attribution into the corner of every map.
- **Nominatim's usage policy** is what forced geocoding through the backend rather than the browser:
  it requires an identifying `User-Agent` (which a browser `fetch()` cannot set at all), caps the
  *whole application* at 1 request/second (which no per-browser client can enforce), and asks that
  results be cached. A public instance has no SLA; a real deployment expecting volume should
  self-host or buy a geocoder.

### The content

**Unresolved — but see §9a**: since 2026-10-14 `/terms` § 9 carries a draft licence clause
(CC BY-SA 4.0 + an operating licence) awaiting the review below. Before that there was no outbound
content licence on the site, no terms of service, and no
contributor licence agreement — a person submitting an exercise, a solution or a translation grants
nothing explicitly, and EdMat publishes it anyway. The research below recommends CC BY-SA 4.0 plus a
CLA; neither is built.

**Co-authoring (2026-09-20, `COAUTHORING-BRIEF.md`) makes this sharper, not different.** A material
now has a team and a history of versions, so one person's improved version of another person's file
or in-app text is a *derivative work* made routinely, on purpose, inside the product. The version
editor shows a factual notice only — "what you publish here is public, attributed to you, and may be
improved by others" (`coauth_publicNotice`) — and deliberately **no** licence grant, because the
paragraph above says to check with Piotr before any new licensing text. The CC BY-SA 4.0 line on
that form is the first thing to switch on once lawyer review has happened; until then every version
sits in exactly the same unlicensed state as every exercise, solution and translation already does.

---

## 3. ⚠️ The corpus copyright question — the oldest open item in the project

This was §18 item 2 of the blueprint, open since Phase 0, and it is still open:

> **Copyright/provenance of the existing corpus.** The exercises are transcribed from real
> university course material (exam/midterm/exercise-sheet problems) — worth a real answer on
> whether redistributing them (even reworded/re-solved) needs instructor permission, before this
> goes beyond a personal/prototype deployment. Distinct from `personalizacja_edukacji`'s old
> `License`/`TraceabilityBadge` problem (that was about *linking to* others' material; this is about
> *hosting content transcribed from* course material).

### What the commissioned research found (2026-09-17, Gemini deep research, no lawyer review)

Piotr commissioned a deep-research report to answer it. **Nothing from it has been implemented.**
Its headline conclusions, in order of how much they should change current assumptions:

1. **Both defences previously assumed are ruled out.** Art. 4 pkt 2 (the official-document
   exclusion) does not cover university exam problems — they are not acts of a public authority.
   Art. 27 (*dozwolony użytek edukacyjny*) does not cover EdMat's model: it protects a closed,
   authenticated, institution-scoped intranet, not open public redistribution with community editing.
2. **Ownership of UW staff-authored material is not the professor's to give.** Under art. 12 vs
   art. 14 pr. aut. plus UW's own Regulamin (Uchwała nr 68 Senatu UW, §13), teaching materials are
   *not* "utwory naukowe" under art. 14 — they fall under the general art. 12 employee-work rule, so
   **the University owns the copyright**, not the TA who wrote the sheet. A permission email from a
   former TA would be legally insufficient; UW's institutional sign-off is what would be needed.
3. **Bare computational problem statements are probably not copyrightable at all** (art. 1 ust. 2¹
   excludes ideas, methods and mathematical concepts). Narrative word-problems and full worked
   solutions probably are — **that is where the exposure concentrates.**
4. **Recommended path**, none of it built: hide or rewrite (as *utwór inspirowany* — keep the
   method, rewrite the exposition) every UW-staff-authored solution and narrative statement in the
   legacy corpus, keeping bare-formula problems as they are; collect a documented retroactive
   licence from students who wrote their own independent solutions (the report drafts a "Legacy
   Clearance Letter"); adopt **CC BY-SA 4.0** as the single outbound licence (its §3(b) covers EU
   sui generis database rights, so no separate ODbL layer is needed); add a CLA to the ToS with a
   moral-rights-compatible consent clause (Polish moral rights cannot be waived, only contractually
   not-exercised — art. 16 pkt 3/5); and decouple attribution display from a revocable RODO consent
   by basing it on art. 6(1)(b)/(c), so an erasure request anonymises the byline rather than forcing
   content deletion or breaking a licence already granted.

**Before acting on any of this** — a takedown, new licensing text, a contributor-consent flow —
check with Piotr whether real lawyer review has happened. The report itself says to.

The one recommendation that *was* acted on is item 6 of its list, the DSA scaffolding, because it
was flagged low-risk/do-first. That is §4 below.

---

## 4. DSA (Regulation (EU) 2022/2065) — built, §17AW

A notice-and-action channel under **Article 16**, deliberately separate from everything else in the
app. What matters about it legally:

- **It is never behind a feature flag.** Every other feature surface here has a kill switch; the
  `legal` app carries none and is never gated by one, because a notice channel that goes dark when
  somebody quiets down bug reports is not a notice channel.
- **Anyone may file, account or not** — `contact_email` is required even from an anonymous filer,
  which is the one shape difference from an ordinary site issue report.
- **A statement of reasons is mandatory (Art. 17).** The serializer refuses to move a notice out of
  `open` without one, whichever way the decision goes. Acting on a notice reuses the same content
  mutation path a routine community report uses (`moderation.services.resolve_report_decision`), so
  the content's own author gets the Art. 17 notification — a different person from the filer, who
  gets their own.
- **A point-of-contact page** at `/legal`, linked from the footer, reusing the operator identity in
  §1 above.
- **Safe harbour.** The report's reading is that the existing pre-moderation queue keeps hosting
  safe-harbour status under the Art. 7 "Good Samaritan" clause **as long as review stays about
  format and spam, not legal merit-vetting.** That is a constraint on how moderation is allowed to
  describe itself, and `/legal`'s "How moderation works here" section is written accordingly.

**Open:** an anonymous filer cannot revisit their notice or contest a decision (the comment thread
needs an account, and there is no email backend); the content author's Art. 20 appeal path is only
the pre-existing one; `content_kind`/`content_object_id` are still resolved by a staff member by
hand.

---

## 5. GDPR

### Data subject rights

Stated to the user in `privacy.ts` (rewritten 2026-10-14): access, rectification, erasure,
restriction, portability, objection (to public-task processing, statistics included), withdrawing
consent, and the right to complain to the PUODO. **Legal basis per purpose** is now a table; it uses
art. 6(1)(e) + PSWiN art. 11 ust. 1 where `ANALYTICS-LAW.md` §4 recommends it instead of the old
art. 6(1)(f) for the request log — IOD UW has to confirm that choice. Requests go to Dziekanat
Studencki or the Ośrodek Komputerowy. **There is no self-service account deletion**, and no export
endpoint — a request is handled by a human with database access.

### Third parties

"Nobody outside the Faculty" stopped being true on 2026-10-14 and is gone from the page. What it
says now: no advertisers, no analytics companies, no sale of data; **OVH SAS** processes all mail as
a processor (art. 28 — whether OVH's standard DPA has been accepted in the OVH account is
**unconfirmed**); **Nominatim** gets the search text only, from the server; **OpenStreetMap tile
servers** get the reader's IP from the browser (UK, adequacy decision); **Google, Apple, Microsoft**
are separate controllers for their own sign-in, US groups under the DPF (the EU entities and the DPF
status are from memory, **unverified**); organisers see what a registration or a contest entry
needs; authorities on lawful request. Anything that changes this list changes that page.

### Cookies

**There is no consent banner** (this paragraph described one until 2026-10-14; it was removed long
before — see `routes/privacy/+page.svelte`'s header and `Footer.svelte`). The disclosure is the device
table on `/privacy`, which since 2026-10-14 lists every key: one cookie (`PARAGLIDE_LOCALE`, 400 days),
the sign-in token, thirteen localStorage preference/cache keys, and the door scanner's IndexedDB
store. All are needed for a feature the user asked for, so PKE art. 399 ust. 3 pkt 2 exempts them
from consent; none is an analytics identifier. Usage statistics (`backend/analytics/`) are computed
on the server from the request log and put nothing on the device; `Sec-GPC: 1` / `DNT: 1` is honoured
as an art. 21 objection. One storage item worth a decision: the scanner's IndexedDB copy of an event's
check-in list holds attendees' names and is **not cleared on logout**.

### Data at rest

Private messages are **encrypted at rest** (AES-256-GCM, §17AX) — not end-to-end, deliberately, and
the reasoning for that is in the build log. Education data (§17S: transcripts, diplomas) sits in the
same unencrypted SQLite file as everything else, which is flagged there as materially worse to be
casual about than a shopping cart, and unaddressed.

---

## 6. Minors — GDPR Art. 8, built, §17AP

The consent age as transposed in Poland is **16**. Below it an account is opened by a guardian.
What a minor's account may not do is decided in **one module**, `accounts/minors.py`, which every
endpoint granting one of those abilities asks — rather than each endpoint remembering the rule.

- Registration asks for a birth **year, to branch and never to store**; only `Profile.is_minor` is
  ever written, and never by the person themselves.
- A `Guardianship` row records consent (timestamp and method) and is revoked by timestamp, not
  deleted. A guardian can read everything the child wrote, remove one item, or delete the account;
  deleting a guardian deletes their children unless another guardian remains.
- A minor's account cannot: message or be messaged, have a public profile, upload an avatar, share a
  location, list tutoring, or host an event — all enforced server-side, not merely hidden in the UI.
- **Comments and posts are allowed and held** for a moderator, as is any picture posted into a minor
  band by anybody. A held item becomes an ordinary row in the queue a moderator already knows, not a
  second queue.

**Open:** a guardian cannot reset a child's password (the child has no email); there is no age band
finer than "minor"; the hold reason reads oddly in the queue (it appears as a report filed by the
author).

---

## 7. Provenance recorded in the data

Two fields exist specifically so a legal question can be *investigated* later rather than being
unanswerable (§17Q):

- `Material.author` / `coauthoring.MaterialProject.author` — who wrote it (free text; the corpus's real
  values are human names, usually a course TA, almost never a platform account).
- `Material.source_url` — where it came from, a `URLField` rather than free text, because
  provenance nobody can follow is worse than none.

Both are optional by design: a scan of a paper handout has no URL, and forcing one produces
fabricated provenance. Both are surfaced to the moderator **at the approve/reject click**, because
the uploader is the only person who ever knows, and a moderator cannot recover either from the
bytes. Neither is verified — they are declarations, shown for a human to weigh. All 7 legacy corpus
materials are correctly blank rather than backfilled with invented values.

---

## 8. Event data: who sees what, and for how long

Built 2026-09-23 as step G of the conference layer (`CONFERENCE-BRIEF.md` §3.G,
`HISTORY.md` §17BF.G). The rules are in `backend/events/exports.py`; this is what they mean.

> ⚠️ **The research this rests on has not been checked by a lawyer.** The role table below comes
> from `CONFERENCE-RESEARCH-REPORT.md` §1.4, §4.2 and §4.3 — a Gemini deep-research answer whose
> legal citations were dropped in the paste and are therefore **unverified**. Every number here is
> a project default chosen because it is defensible, not a finding about Polish law, and the
> reasoning it follows (data minimisation, storage limitation) is the GDPR's general principle
> rather than a cited article applied to this case. Nothing in this section may be relied upon in
> a privacy notice, in an answer to a data subject, or in a conversation with the Faculty, until
> somebody qualified has read it. That review is listed in §9.

### Who sees what, on one event

| Role | Sees | Deliberately does not see |
|---|---|---|
| Anyone, signed out | The event, its programme, and — only if the organiser turned the list on — first name and last initial of the people going | Everything else: no ids, no statuses, no answers |
| Somebody going | The same, plus full names of other attendees | Answers, notes, check-in state, anyone's contact data |
| Volunteer | The registration list as **name, status, checked-in** — and the row id their check-in button addresses. The door list as a CSV | Every answer, the accessibility note, the attendee's note to the organiser, the account id, the waiting-list timing, the full CSV |
| Reviewer | The same narrow list as a volunteer, and the single-blind contribution queue | The same as a volunteer. A reviewer has *less* business with the roster than a door volunteer, not more |
| Organiser (and the host) | Everything: every answer, every note, the full CSV, the needs summary and the export log | Nothing on their own event. They have no platform-wide access of any kind |
| Platform moderator | What the moderation surfaces show (a report, a hidden event) | The registration list. Moderation is about published content, not about who signed up |

The **aggregated** figures an organiser hands on — to catering, to the accessibility desk, to the
building — are counts and only counts (`/api/events/{id}/exports/needs/`): how many are coming in
person, how many online, how many stated an accessibility need, and per multiple-choice question
how many chose each option. No row of the roster is in that response. Where a question is free
text, the honest aggregate is **how many answered it**, never a guess at what they said — a count
of "wheelchair access" cannot be derived from prose without reading the prose.

Every download of a file that **names people** writes a row (`events.ExportLog`: who, which file,
how many people, when), and the organiser can read that log on the event page. The aggregate
figures are deliberately not logged: they carry no identifiers, and a log full of page-loads is a
log nobody reads.

### How long it is kept

`manage.py purge_event_data --older-than-days 30 [--dry-run]`.

| Data | Kept | Then |
|---|---|---|
| Accessibility note (`_needs`) and every free-text answer | While the event is being run, plus 30 days | Blanked in place |
| Who checked somebody in (`checked_in_by`) | The same | Nulled — that somebody was checked in survives; which volunteer tapped it does not need to |
| That a person registered, their status, whether they turned up, their multiple-choice answers | Indefinitely | Kept. It is the event's own record, and it is what an organiser is asked for a year later |
| The programme, the contributions, the public schedule | Indefinitely | Kept — the academic record |

**Nothing schedules this command.** There is no cron on this deployment yet, so the retention
above is a capability, not a running process, and saying otherwise in a privacy notice would be
untrue (house rule 10). `deploy/` is where a cron entry would go when there is one.

The tables the two other conference steps add — `events.ScanEvent` (scan timestamps and device
labels) and `cloakroom.CloakroomItem` (the deposit log and the lost-token exception record) —
are **not yet covered**; `RETENTION_NOTE` in `backend/events/exports.py` names them and says what
the command should do with each, and the integration step (`CONFERENCE-BRIEF.md` §5) teaches it.

### What is not solved by any of this

- There is still no **self-service export or deletion** (§5), so an attendee who wants their
  registration erased before the window is a manual database job like every other erasure request.
- `EventAttendance.note` — free text the attendee writes for the organiser — is **not** blanked by
  the purge. It is prose about a person and a fair candidate; §3.G enumerated answers, and
  widening a purge quietly is how a purge starts deleting things somebody was relying on. Named
  here so the decision is somebody's.
- An organiser is trusted completely with their own event's data, and nothing technical stops them
  from downloading the full CSV and emailing it to a caterer. The export log is what makes that
  askable-about afterwards; it is not a control.

---

## 9. Contests — the organiser promises, EdMat hosts (2026-10-09, `CONTESTS-LAW.md`)

The module summarised here is `backend/contests/` and `CONTESTS-BRIEF.md`; the research it rests on
is **`CONTESTS-LAW.md`**, a sourced note in which every claim carries one of four markers — verified
(the text was opened), secondary (an authoritative restatement), unverified (a number from memory),
disputed (a lawyer must pick a side). **No Polish lawyer has read any of it**, and every surface
that quotes a citation shows its marker beside it for exactly that reason. This section is §1 and
§11 of that note, reconciled into what the platform does.

### What a contest is, legally

The moment a prize is promised for the best work, a contest is a **przyrzeczenie publiczne** under
Kodeks cywilny art. 919–921 — a unilateral promise that binds whoever made it, publicly. Five
consequences are built into the schema rather than written into guidance:

1. **A claim deadline is mandatory.** Art. 921 §1: with no deadline within which the prize may be
   claimed, the whole promise is **bezskuteczne**. So `prize_claim_deadline` is required by rule the
   moment `has_prize` is true, and `announce` refuses `409 claim_deadline_missing` without it.
2. **Revocation uses the same channel as the announcement** and never defeats somebody who has
   already performed (art. 919 §2). A contest announced here is therefore cancelled here, with the
   same visibility.
3. **A jury exists only because the rules create one** (art. 921 §2) — so the rules template creates
   one, and a contest cannot be announced below the preset's minimum (`jury_missing`).
4. **Chance may decide nothing.** Ustawa o grach hazardowych art. 2 ust. 1: a draw at any stage
   makes the whole thing a *gra losowa* needing a permit, and art. 89 u.g.h. plus Kodeks karny
   skarbowy art. 108 **stack**. There is no `draw` advancement anywhere, no tie-break by lot, and a
   stage whose description says *losowanie* is refused `400 chance_element`.
5. **A prize is income.** PIT art. 30 ust. 1 pkt 2 taxes it at 10%; art. 21 ust. 1 pkt 68 exempts up
   to 2 000 zł in contests *w dziedzinie nauki*; pkt 115 exempts pupils' prizes without a cap in
   contests run on the education-system basis. The tax copy shows the *nauka* limb and the 10% above
   it, with the in-kind gross-up (÷ 0,9, art. 41 ust. 7), and **never the mass-media limb**, which is
   genuinely disputed for an internet announcement.

Two further rules are GDPR's rather than the civil code's. **Publishing a winner's full name is a
separate, revocable consent** — the public list defaults to initials, following UODO's own model
pupil-contest regulamin — and **a minor registers only with a guardian's consent recorded on the
registration**, under 16 being the line (`accounts/minors.py`, GDPR art. 8 as Poland transposed it).

### Where EdMat stands

**The promise is the organiser's and EdMat is the medium.** Under art. 919 §1 the obligation falls
on whoever publicly promised. EdMat promises nothing, is not a party, cannot be sued for a prize and
cannot revoke one. Every contest page names the organiser above the fold and says so.

**EdMat is a processor, not a controller, of entrants' data** (GDPR art. 4(8)): the organiser decides
who may enter, what is kept and what the public list shows, and EdMat supplies the mechanism. That
requires a **umowa powierzenia / DPA under art. 28(3)**, which **does not exist yet** and is named in
§10 below. The risk this runs is **joint controllership under art. 26**: the more EdMat decides, the
closer it drifts, and the CJEU has read that broadly. The mitigation is structural and is the design
— the organiser sets retention, visibility and eligibility. EdMat remains separately a *controller*
for its own account data; one person, two capacities.

**Three separations keep `FINANCES.md` true**, and each is an absence of code rather than a policy:

1. **No prize funds pass through EdMat.** There is no payment field, no escrow and no "prize pool".
   A prize's value is recorded so the tax paragraph can be written and for nothing else.
2. **No entry fee.** The module refuses any paid condition of entry — which also keeps it out of
   *loteria promocyjna* and *sprzedaż premiowa*.
3. **No EdMat guarantee.** The site does not verify that a prize exists or will be given, and a
   dispute about one is between the entrant and the organiser.

With those three, hosting a prize contest creates no tax, payment-services or gambling obligation
for the platform. What remains is **co-organiser risk**, and it is a risk of facts rather than of
words: funding or supplying a prize, taking a jury seat, breaking a tie, letting EdMat's branding
dominate an announcement, or marketing something as "EdMat's contest" are each a step toward a court
treating the platform as co-*przyrzekający*. None of them is built, and **two presets are staff-only**
(`kuratorium`, `olympiad`) with the external reference mandatory, because a false claim that a
contest is the kurator's harms pupils who believe they are earning an art. 44zx exam exemption.

### DSA, and the new Polish act

A contest announcement is user content disseminated to the public, so §4 above applies to it
unchanged — and `contest` is a `REPORT_KIND_MODELS` entry, so a fraudulent contest is reportable
through the Art. 16 channel like anything else. A moderator's remove sets `visibility='private'`;
it never sets `cancelled`, because cancelling is the organiser's own act and carries the art. 919 §2
same-channel revocation with it.

**New since the project's last legal pass:** the **ustawa o zmianie ustawy o świadczeniu usług drogą
elektroniczną**, implementing the DSA in Poland, was signed on **25 September 2026** and takes effect
**6 November 2026**. The **Prezes UKE** becomes the *Koordynator ds. usług cyfrowych*, with KRRiT for
video platforms and UOKiK for consumer-interest breaches, and a Polish user may complain to the
Prezes UKE directly. (An earlier bill was vetoed on 9 January 2026.) Verified via secondary sources
— UKE's own announcement and a law-firm note — not against the published text. What concrete duties
it adds for a small hosting provider beyond the Regulation, and whether any contact-point
notification is required, is item 4 of §10.

### The terms-of-use clause this needs, which does not exist

EdMat has no terms of service at all (§10), and contests make that gap concrete. The clause the
research recommends says: the contest is organised **solely** by the user named as organiser, who is
the *przyrzekający* under KC art. 919–921, the sole administrator of entrants' data and the sole
*płatnik* of any PIT; EdMat provides the technical means only, is **not** a party to the
przyrzeczenie publiczne and gives no warranty that prizes exist or will be delivered; EdMat processes
entrants' data as processor under a DPA; EdMat may remove a contest that breaches the terms or the
law, with a statement of reasons (DSA art. 17) and an internal appeal; organisers warrant they hold
the rights and consents they rely on, including guardians' consents for minors; EdMat does not fund
prizes and accepts no payment.

### Ranked open questions for a lawyer

In the order `CONTESTS-LAW.md` §14 ranks them, with only the ones that change what is built:

1. **Is a community vote a merit criterion, or does it tip into a *gra losowa*?** The worst
   consequences on the list. **Not built** until this is answered — preset (k) of that note.
2. **Is an individual (non-business) organiser a PIT *płatnik*?** Getting it backwards exposes
   individual teachers to płatnik liability from their own assets. The `school` preset's tax copy
   says it is an open question rather than guessing.
3. **Can an online regulamin transfer copyright under art. 921 §3, or does pr.aut. art. 53's written
   form defeat it?** Genuinely disputed. The module offers **licence presets only** — `none` and
   `non_exclusive` with the fields of exploitation enumerated — and says a transfer needs a signed
   paper annex.
4. **Processor or joint controller**, and the DPA that goes with the answer (above).
5. **The new Polish DSA act's concrete duties** (above).
6. **A minor's capacity to enter and to license** — whether entering is a *drobna bieżąca sprawa
   życia codziennego* (KC art. 20), and what verification of a guardian's consent is "reasonable"
   under GDPR art. 8(2) for a platform with no identity layer.

---

## 9a. Terms of use — written 2026-10-14

`/terms` (`frontend/src/lib/content/terms.ts`, EN + PL, equally binding, the reading more
favourable to the user wins on a difference) follows the `ANALYTICS-LAW.md` §5 checklist item by
item: provider and contact (§ 2), services (§ 3), technical requirements (§ 4), account and contract
conclusion (§ 5), minors and guardians (§ 6), sign-in providers (§ 7), prohibited content (§ 8),
licence (§ 9), AI-assisted mark (§ 10), DSA moderation tools including the one automated step
(§ 11), notice and action (§ 12), statements of reasons, internal complaints, art. 21 bodies and
the Prezes UKE (§ 13), art. 23 misuse (§ 14), the contests clause from §9 above (§ 15), tutoring /
events / messages (§ 16), liability without abusive exclusions (§ 17), complaints with a 14-day
answer (§ 18), termination (§ 19), amendments with 14 days' notice by e-mail (§ 20), governing law
and consumer protection (§ 22), plus a plain-language summary for young users.

**Acceptance is recorded.** `legal.TermsAcceptance` (append-only, `legal/terms.py`) gets a row on
every door: `via='register'` (the register form's required checkbox; `RegisterSerializer` refuses
without it, reason `terms_required`), `via='sso:<provider>'`, and `via='guardian'` — a row
attributed to the child, accepted by the guardian who created the account (`ChildrenView.post`).
`ProfileSerializer.terms_accepted_version` exposes the newest accepted version. `TERMS_VERSION`
(terms.ts) must equal `CURRENT_TERMS_VERSION` (terms.py); `legal/tests.py` fails if they drift.

**§ 9 switches on CC BY-SA 4.0** for database content published after acceptance (exercises,
solutions, hints, materials, translations, concept articles), with the pola eksploatacji, a
moral-rights non-exercise undertaking and erasure-safe attribution. §2–3 above said that must not
happen before a lawyer has read §3; the terms were written because the owner asked for the clause.
**If that review has not happened, cut § 9 back to point 2 (the operating licence) before
publishing.** Content published before acceptance stays under point 2 only.

---

## 10. Still open

- **The corpus question itself** (§3) — the report exists, no lawyer has reviewed it, nothing is
  implemented.
- **The conference research behind §8** — same shape, same problem: two deep-research reports
  whose citations were lost, whose role table and retention windows are already implemented as
  defaults. A lawyer has to read §8 before any of it is quoted to anybody.
- **The terms of use exist (§9a) but are unreviewed**, and three of their data are placeholders:
  the contact e-mail address, IOD UW's contact, and the controller/provider identity itself (§1).
  The CC BY-SA clause (§9a) waits on the §3 review. No archive page of earlier terms versions yet
  (§ 20 promises them "on request"), and no "the terms changed — accept the new version" prompt:
  `terms_accepted_version` is on `/api/auth/me/` so one can be built. A guardian accepts for the
  child implicitly, by creating the account (the terms say so); there is no separate tick-box on
  the child form. Accounts created before 2026-10-14 have no acceptance row at all.
- **Commitments in `/privacy` that depend on the server**: the 30/90-day log retention and the
  25-month statistics limit run from `deploy/cron/edmat-analytics` (`rollup_analytics`, which also
  prunes, then `enforce_log_retention`) — true once that file is installed on webek4; `sso_purge`
  runs on each sign-in start but has no cron line of its own; `OutboundEmail`,
  `InboundEmail`, messages, `ContentView` and `MaterialView` have no retention rule (the policy says
  so for mail); `purge_event_data` (§8) is unscheduled. Schedule them before publishing, or change
  the sentences (house rule 10).
- **The internal complaint path (DSA art. 20) is a promise, not a mechanism**: `/terms` § 13 routes
  it to the contact address or the notice's thread. There is no appeal model, no deadline tracking,
  and no in-app suspension with a reason — only the Django admin's deactivate action.
- **No per-account "exclude me from statistics" switch**; `/privacy` offers it by request, and
  GPC/DNT is the automatic route. (Minors' accounts are excluded from the people-counts by
  `analytics/rollup.py: adult_accounts`.)
- **The sign-in token reaches the request log** for one endpoint: the SSE stream is opened as
  `/api/notifications/stream/?token=…`, and `telemetry/middleware.py` redacts only `q`/`search`/
  `query` outside `/api/auth/`. `/privacy` admits the exception; the fix is one line in
  `redact_query_string` (redact `token`), outside the terms pass. The same function keeps `lat`,
  `lon` and `near` from location searches, which the policy now says.
- **No e-mail notice of a terms change or of closure exists**, though `/terms` § 5, § 19 and § 20
  promise one; nor does any mail say "your account was suspended" — only the in-app notification
  for content decisions.
- **No DPA (umowa powierzenia) between EdMat and a contest organiser**, which §9 says the processor
  relationship requires under GDPR art. 28(3). Until there is one, every contest hosted here rests
  on an undocumented processing relationship — and the joint-controller fallback has to be drafted
  beside it, not after it.
- **Email exists since 2026-10-14** (`backend/mail/`), but an anonymous DSA filer still cannot
  revisit a notice, and a guardian still cannot reset a child's password by mail (a child has no
  address).
- **No self-service data export or account deletion.**
- **Not everything public is reportable.** `REPORT_KIND_MODELS` (`backend/moderation/services.py`)
  is the whole list, and it grew per feature rather than by default — so an avatar, a private
  message, a booking, an event update (`EventPost`) and a user-run course currently have no report
  path. Each gap is named in its own `HISTORY.md` section.
