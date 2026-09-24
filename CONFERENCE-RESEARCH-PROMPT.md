# Deep Research prompt — conference management on EdMat

Paste everything between the two rulers into Gemini Deep Research (or any deep-research agent).
Written 2026-09-23. The previous Gemini report on the audience widening was reconciled into
`AUDIENCE-BRIEF.md` §11; do the same with this one — a `CONFERENCE-BRIEF.md` with a "reconciled"
section, so that agents build from a decision, not from a report.

---

## Context — who is asking and what already exists

I run EdMat, a non-commercial, bilingual (Polish/English) education platform built by a
university physics faculty community in Warsaw. It is a Django REST Framework API with a
SvelteKit single-page frontend, SQLite in production, no payment processing of any kind (by
policy, permanently), and currently no outgoing email. It serves adults, university students and,
under guardian accounts, minors under 16 (GDPR Article 8 as transposed in Poland).

It already has an **events** module that is a light conference system:

- an event with status (draft / published / cancelled), visibility, one or many days, on-site /
  online / hybrid, an audience band, and a feature kill switch;
- **event staff roles**: organiser, reviewer, volunteer (the host is an immutable organiser);
- a **programme**: tracks, sessions with their own time / room / capacity, speakers who may or may
  not have an account, links from a session to teaching material, per-session Q&A, bookmarks, a
  personal agenda, `.ics` export;
- **registration** in three modes (RSVP / organiser approval / custom form with the organiser's
  own fields plus baseline questions: attendance mode, accessibility needs, consent line), a
  waiting list with 24-hour seat offers, per-session seats, a CSV export, and **check-in** as a
  timestamp that any staff member including volunteers may set or undo;
- a **call for contributions**: talk / workshop / poster proposals, single-blind review, accept
  with scheduling onto the programme, reject with a mandatory reason code;
- notifications inside the app, a scoped moderation system, a reporting channel, and a
  content-visibility rule that returns 404 rather than 403 to strangers.

Everything is role-based today: three fixed event roles, hard-coded capabilities. There is no
notion of a **venue** or **building** as its own thing with its own administrators, no documents
attached to an event, no QR codes, no per-role dashboards, no way for a building's administration
to hand organisers a standard checklist, and no way for an organiser to see the event as one of
their volunteers would.

## What I want to decide, and need evidence for

I am about to design the next layer and want to learn from how mature tools and real venues do
it before I commit to a data model. Please research the following, favouring **observed practice
in existing software and in real university / venue procedures** over generic advice. Where you
recommend something, say which observed practice it comes from.

### 1. Roles, permissions and per-role views

1. How do established conference and event tools model **who can do what**? Compare at least:
   Indico (CERN), pretalx, pretix, Eventyay / Open Event, frab, EasyChair, ConfTool, OpenConf,
   Sched, Whova, Cvent, Eventbrite, Tito, and one or two volunteer-management tools (e.g.
   Timecounts, Golden, Galaxy Digital / VolunteerLocal). For each: fixed roles vs. custom roles
   vs. per-capability checkboxes, whether permissions are scoped per event / per track / per
   room / per check-in list / per device, and how the UI presents it.
2. What is the practical experience with **"checkbox permission editors"** versus **role presets
   with a small number of overrides** (the Discord / GitHub / Notion lesson)? Which model do
   small volunteer-run organisations actually manage to keep correct?
3. What does a **volunteer dashboard** contain in these tools and in volunteer-management tools:
   shift / task lists, the briefing they must acknowledge, whom to call, the one or two actions
   they are allowed (scan, check in, undo, count heads), and what is deliberately hidden from
   them (registration answers, contact data, dietary / accessibility details)?
4. What is the **minimum personal data** each role needs to see at each moment (door, room,
   information desk, cloakroom, organiser, reviewer, venue administration)? Look for GDPR
   data-minimisation guidance applied to events, including from Polish sources (UODO) and from
   universities' own event procedures.
5. How do tools handle **staff who are also attendees or speakers** (one person, several roles
   at one event) without double-counting seats or leaking the staff view into the public one?

### 2. Cloakroom, badges and QR codes

1. How do existing systems implement a **cloakroom / wardrobe / luggage desk**: a QR or numbered
   ticket per item, scan to deposit and scan to return, who may operate the desk, what happens
   when the ticket is lost (identity fallback), end-of-day reconciliation, whether items are
   linked to a person at all or to an anonymous token only? Include any open-source or hobbyist
   projects, and non-conference examples (theatres, museums, festivals, Polish "szatnia" systems).
2. For **check-in and badge QR codes**: what should the code encode? Compare opaque random id,
   signed token, and identifier-plus-checksum designs; anti-forwarding and re-entry rules;
   scanning from the attendee's phone screen vs. a printed badge; accessibility fallbacks (name
   search, manual code entry). How do pretix's check-in lists, Indico's check-in app, Eventbrite
   Organizer and similar apps handle **offline operation and later sync** and **simultaneous
   scanners at several doors**? What throughput does a door realistically need (people per minute)
   and what do they do when the network fails?
3. Given that we send **no email**, how do tools deliver a ticket / QR without email: in-app page,
   printable PDF, wallet passes (Apple / Google), a link the attendee saves? Which of these are
   feasible with no third-party account and no payment?
4. **Per-session scanning** (capped workshops, attendance certificates): how is it done and is it
   worth it for volunteer-run events?
5. **Badge printing**: on-site vs. pre-printed vs. none; what data goes on a badge for a minor.

### 3. Venue / building administration — templates and checklists

1. In real universities and public venues (Poland first — University of Warsaw and other Polish
   universities' "procedura organizacji wydarzeń" / "zgłoszenie wydarzenia" pages — then the
   UK, Germany, the US), what does a **building's administration require from an organiser**
   before, during and after an event? Collect actual checklists and forms: room booking and
   approval, expected headcount, opening hours and after-hours access, keys / access cards,
   fire safety and evacuation briefing, first aid, security notification, cleaning, waste,
   catering and alcohol rules, parking, deliveries and loading, signage and posters, Wi-Fi
   for guests, accessibility of the route and rooms, photography and filming consent notices,
   insurance, damage liability, hazardous materials in labs, and post-event reporting.
2. Polish law thresholds that change the paperwork: when does an event become an **"impreza
   masowa"** under the Ustawa o bezpieczeństwie imprez masowych (headcount thresholds indoors and
   outdoors, exemptions for universities' own scientific and educational events), and what other
   rules apply below the threshold (fire regulations for public gatherings, the building's own
   "instrukcja bezpieczeństwa pożarowego", RODO information duties, filming consent)? Cite the
   statutes and give the current thresholds; flag anything that changed recently.
3. How do software tools model a **template → instance checklist**? Look at event-ops and
   general tools (Cvent, Bizzabo, Eventbrite's guides, Asana / Notion / Trello templates, Planning
   Pod, Monday event templates, and open-source checklist engines). What fields does an item
   carry (owner role, due-relative-to-event date such as "T minus 14 days", required / optional,
   "not applicable" with a reason, evidence such as an attached document or a checkbox with
   a timestamp and who ticked it, sign-off by the venue)? How are templates versioned when the
   venue changes its rules after an organiser already started?
4. What is the right **ownership split**: a venue-level administrator who owns rooms, rules,
   templates and approvals across every event held in the building, versus the event's
   organisers, versus the platform's moderators? Find examples of tools with a **venue as a
   first-class object** with its own staff (Skedda, Robin, Momentus / Ungerboeck, EMS, university
   room-booking systems like Indico's room booking module or Booked Scheduler) and describe how
   their venue role relates to event roles.
5. What do venues typically **publish to organisers as reusable documents**: room sheets with
   capacity and equipment, floor plans, evacuation plans, house rules, a standard safety
   briefing text for volunteers, a poster template? How should acknowledgement be recorded
   ("I have read the safety briefing", per volunteer, per event)?

### 4. Documents and data attached to an event

1. How do tools attach **documents with per-role visibility** to an event: public (programme,
   map), attendees-only (Wi-Fi code, joining instructions), staff-only (run-of-show, emergency
   contacts, radio channels), venue-only (insurance, damage report)? Any pattern of an
   acknowledgement or read-receipt per person?
2. Which **exports** do organisers and venues actually use (registrations, dietary /
   accessibility summaries anonymised, headcount per room per hour, check-in log, cloakroom
   reconciliation), and which fields regularly leak personal data by accident?
3. **Retention**: how long do tools and university procedures keep registration and check-in
   data after the event, and what is the practice for minors' data?

### 5. Testing as another user ("view as")

1. How do products let an administrator **see the product as a specific role or person**:
   Facebook's retired "View As", Salesforce "Login as", Drupal Masquerade, WordPress User
   Switching, Moodle "Switch role to", Canvas "Act as user", Google Workspace, Discord's role
   preview, Indico and pretix preview modes. For each: is it a **role preview** (same account,
   a role mask) or a **session impersonation** (acting as that user)? What is audit-logged, what
   is blocked while impersonating (messaging, consent, purchases), how is it shown on screen,
   and how is it exited?
2. What went wrong in known incidents (the 2018 Facebook "View As" breach and others) and what
   design rules follow from them?
3. What is the lighter alternative for a volunteer-run project: a seeded **demo event with
   named personas** (an organiser, a volunteer, a cloakroom desk, an attendee, a minor with a
   guardian, a venue administrator) that anybody can log into on a staging server? Who does
   this and how do they keep the demo data from being mistaken for real?
4. For automated testing, how do these tools **test permission matrices** (one table of role ×
   action × expected outcome driven through the API), and do any publish theirs?

### 6. Volunteer shift scheduling

Today a volunteer is a role on an event with no time attached: the system knows *that* somebody
volunteers, not *when* or *where*. A real conference runs on a rota.

1. How do volunteer-run events model **shifts**? Study in depth the open-source **Engelsystem**
   (Chaos Communication Congress: angel types, shifts per room, needed count per type,
   self-sign-up, restricted types that need confirmation after a briefing, overlap prevention,
   night-shift multipliers, the "Himmel" help desk, hour tallies, T-shirt and meal entitlements,
   no-show / freeloader handling), then the volunteer tools (Timecounts, Golden, Bloomerang
   Volunteer / InitLive, VolunteerLocal, Galaxy Digital, SignUpGenius, Volunteer Scheduler Pro)
   and how large community conferences without dedicated software do it (FOSDEM, DebConf,
   PyCon, EMF Camp, Polish events such as Pyrkon or WOŚP finals). For each: who creates shifts,
   whether volunteers pick their own or are assigned, how gaps are found and filled, and what
   the volunteer's own view shows.
2. The **data model**: a shift type or station (door, room, info desk, cloakroom, runner,
   set-up / tear-down) with prerequisites (briefing acknowledged, training, minimum age, a
   supervisor present), a shift with start / end / place / needed head-count per type, an
   assignment with its own state (offered / taken / confirmed / no-show / done), swap and drop
   requests, an hours log. Which invariants do the tools enforce: no overlapping assignments
   for one person, a rest gap between shifts, a maximum of hours per day, a minimum of adults
   per shift when minors volunteer, a shift tied to a session so that moving the session moves
   the shift?
3. **Coverage for the organiser**: how is under-staffing shown (a grid of rooms × hours, a
   heat-map, a list of open slots), how are last-minute gaps broadcast without email, how are
   swaps approved, and what does a printed rota for the wall look like?
4. **The volunteer's day**: check-in to a shift (does the volunteer scan in, and with what),
   handover notes between shifts, whom to call, what to do when nobody relieves you, and how
   the tools keep a volunteer from seeing other volunteers' contact data while still letting
   them find their supervisor.
5. **Recognition without money**: hours certificates (in Poland the *zaświadczenie o
   wykonywaniu świadczeń wolontariackich*), meals and T-shirts as entitlements tied to hours,
   references, ECTS or "wolontariat" credit at Polish universities — what do organisers
   actually hand out and what data does the software need to keep to hand it out honestly?
6. **Polish law on volunteers** (Ustawa o działalności pożytku publicznego i o wolontariacie):
   when a written agreement (*porozumienie*) is required, the organiser's accident-insurance
   (NNW) duty for short engagements, guardian consent and any age floor for minors, the
   volunteer's right to a certificate, and whether a student association or a faculty can be
   the *korzystający*. Cite the statute and flag recent changes. Say what the software must
   record so the organiser can prove compliance.
7. **Fairness and burnout**: what do the tools do to stop the same five people taking every
   shift, and to stop a night shift landing on a minor?

### 7. Synthesis I want from you

1. A **comparison matrix** of the tools above on: role model, scope granularity, volunteer
   view, check-in / QR approach, offline support, cloakroom support (almost always none — say
   so), documents with per-role visibility, checklists or templates, venue as an object,
   **shift scheduling** (self-sign-up, assignment, coverage view, hours log), view-as support,
   open source or not, self-hostable, licence.
2. A recommended **role × capability matrix** for our case, with these roles at least: platform
   moderator, venue administrator, event organiser, reviewer, volunteer (with sub-kinds if the
   evidence supports them: door, room, information desk, cloakroom), speaker, attendee,
   guardian-of-an-attending-minor, anonymous visitor. Mark for each cell whether it should be a
   fixed rule or an organiser-settable option, and say which observed tool does it that way.
   Include the shift actions: create shifts, sign up for an open shift, confirm a restricted
   sign-up, swap or drop, mark a no-show, see the coverage grid, log and certify hours.
3. A **data model sketch** in words (no code): venue, room, template checklist, checklist item,
   document, acknowledgement, cloakroom item, scan event, impersonation audit row, **shift
   type / station, shift, shift assignment, hours log** — with the relationships and the two
   or three invariants each must hold.
4. A **starter set of checklist templates** in both English and Polish, one each for: a
   one-room guest lecture, a one-day workshop with catering, a two-day conference in several
   rooms, a school science day with minors. Base them on the real university procedures you
   found and cite each item's origin.
5. A **"do not build"** list: features these tools have that a volunteer-run, no-money,
   no-email platform should skip, with the reason.
6. The **ten decisions** you consider most consequential, each with your recommendation and the
   strongest argument against it.

## Constraints to respect throughout

- No payments, ticket sales, sponsorship management or marketing automation — ever.
- No email today; assume in-app notifications, on-screen and printable artefacts. Say
  explicitly which recommendations depend on email and what the workaround is.
- SQLite with a single writer: point out where a burst (a door opening to 300 people) meets
  that limit and how other tools designed for it.
- Polish law and Polish university practice first, then EU, then others. Both languages in any
  template text.
- Minors may attend and may volunteer with a guardian's consent; note anywhere this changes a
  rule.
- Prefer primary sources: the tools' own documentation and source repositories, universities'
  published procedures, statutes. Mark clearly what is an observed fact, what is a vendor claim,
  and what is your inference. Where sources disagree, say so rather than averaging.

## Output format

An English report with a Polish appendix for the legal thresholds and the template texts.
Sections in the order of the questions above, then the synthesis. Tables for the comparison
matrix and the role × capability matrix. Every factual claim carries a citation. Length is not
a goal; completeness of the matrices and the checklist templates is. End with a list of the
questions you could not answer from available sources.

---

## After the report

Reconcile it into `CONFERENCE-BRIEF.md` (accept / reject / defer per recommendation, with the
reason), the way `AUDIENCE-BRIEF.md` §11 did for the last one. Likely follow-up prompts once the
first report is in hand: (a) a deep dive on offline QR scanning designs alone; (b) the exact
Polish paperwork for a school science day with minors at a university building; (c) a
security review of the chosen "view as" design.

---

## Follow-up prompt — volunteer shift scheduling alone

The first report (saved as `CONFERENCE-RESEARCH-REPORT.md`, 2026-09-23) did not cover shifts;
the follow-up's answer is saved as `CONFERENCE-RESEARCH-REPORT-SHIFTS.md`.
Paste the block below on its own rather than re-running the whole study; it restates the
context the second run needs.

---

I run EdMat, a non-commercial bilingual (Polish/English) education platform of a university
physics faculty community in Warsaw: Django REST Framework, SvelteKit, SQLite, no payments
ever, no outgoing email, adults and minors under 16 through guardian accounts. Its events
module already has organiser / reviewer / volunteer roles, a programme with rooms and
sessions, registration with a waiting list, door check-in by any staff member, and a call for
contributions. A previous research report recommended: fixed role presets with station
sub-kinds for volunteers (door, room, information desk, cloakroom) instead of permission
checkboxes; a safety-briefing acknowledgement that must be recorded before a volunteer's tools
unlock; anonymous bearer tokens for the cloakroom; opaque QR tokens scanned from a locally
cached list and synced in batches; a venue as a first-class object with its own administrator
and checklist templates; role preview and seeded personas rather than "log in as".

What it did not cover is **time**: a volunteer is a role, not a rota. Research volunteer shift
scheduling for a volunteer-run academic conference of 50 to 500 people with 5 to 40
volunteers, some of them minors with a guardian's consent.

[Then paste section 6 above, items 1–7, verbatim.]

Deliver: (a) a comparison table of Engelsystem and the volunteer tools on the points in item 1;
(b) a data model in words for shift type / station, shift, assignment, swap request and hours
log, with invariants; (c) the volunteer-facing and organiser-facing screens as a list of what
each shows and hides; (d) the Polish legal requirements with citations, and what the software
must store to prove them; (e) a "do not build" list for a no-money, no-email project; (f) the
five decisions that matter most, each with the strongest counter-argument. English, with the
legal section also in Polish. Mark observed practice, vendor claims and your inference
separately. End with what you could not find.

---

## Follow-up prompt — sample data for a demo conference

`CONFERENCE-BRIEF.md` records that all seven steps (venues, preview, documents, tickets,
shifts, cloakroom, exports) are built and merged. `manage.py seed_conference_personas` seeds
seven accounts and one bare sandbox event for the permission matrix, but nothing that looks
lived-in: no checklist instance with real items, no documents, no filled rota, no cloakroom
activity, no real-shaped programme. Screenshots, QA and onboarding currently stare at empty
tables or invented-sounding placeholder text. Paste the block below on its own.

---

I run EdMat, a non-commercial bilingual (Polish/English) education platform of a university
physics faculty community in Warsaw: Django REST Framework, SvelteKit, SQLite, no payments
ever, no outgoing email, adults and minors under 16 through guardian accounts. Its conference
layer is now built: a venue with rooms and a checklist template it hands the organiser; event
documents with four visibility tiers and an acknowledgement ledger; opaque-QR tickets scanned
from a locally cached, batch-synced list; a rota of station → shift → assignment with
self-claim and drop-to-pool; a cloakroom by anonymous bearer token; role-scoped CSV exports.

I want to seed one realistic demo conference — 50 to 300 people, one to three days, at a
real-shaped university venue in Warsaw — so the app has believable content to show rather than
empty tables. Research and produce, favouring real observed examples over invented ones:

1. A realistic **checklist** a Polish university building actually hands an event organiser
   before a conference (fire safety sign-off, room capacity confirmation, AV check, catering
   delivery window, accessibility walk-through) — item wording and typical T-minus offsets.
2. Realistic **document titles and content shape** for the four visibility tiers (public /
   registered / staff / organiser-only) at an academic conference — e.g. a volunteer safety
   briefing, a speaker AV guide, a fire evacuation plan, a catering headcount memo.
3. A realistic **rota**: station names (registration desk, room chair, AV, cloakroom,
   information desk) for a 2-day, 150-person conference, shift lengths, how many volunteers per
   station per hour, and what a filled shift versus a short-staffed one actually look like.
4. Realistic **cloakroom** numbers for a conference this size: items checked in per hour at
   peak, typical claim rate by closing, how many lost-token exceptions per event.
5. A realistic **programme**: track names, session titles and lengths, speaker count, for a
   50–300 person academic (physics or general STEM) conference — enough to seed a believable
   `Track` / `Session` / `SessionSpeaker` set, Polish and English titles both welcome.
6. Typical **registration numbers**: the RSVP vs. organiser-approval vs. waiting-list-with-offer
   split, and the checked-in percentage by the end of day one.

Deliver: a single Markdown table or list per item above, concrete enough to type directly into
a Django fixture or a `seed_conference_demo` management command — not advice, not a survey of
what other tools do. English, with Polish venue and session names where natural. Mark clearly
what is observed or adapted from a real programme versus synthesised to be merely plausible.
End with what you could not find a real example for.

---
