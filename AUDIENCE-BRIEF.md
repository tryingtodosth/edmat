# EdMat as a lifelong-learning portal — design note before code

Written 2026-09-09, on `main` at `5dfec99`, for review by Piotr before anything is built. It is the
"step 1" the plan agreed on: audience bands, guardian accounts, the events/registration/submission
schema with its state machines, and the four additions Piotr named the same day (sorting, content
language, comment attachments, a rich-text editor). Everything below is grounded in the models that
exist today (`events`, `accounts`, `community`, `taxonomy`, `config/sanitize.py`), and reconciled against
the Gemini report (`gemini.md`, gitignored, temporary) in §11 — the parts it adds are folded into §3
below, and the one place it contradicts a decision Piotr has taken is stated, not hidden.

**Decisions already taken by Piotr, not reopened here:** the audience widens to toddlers, school
students, seniors and career changers; the events area gets a real conference-style overhaul;
work proceeds without further check-ins until a live server is ready. **Assumed, and easy to
reverse:** no payments — prices stay display-only everywhere, as they are today.

---

## 1. The audience band — one axis, on everything

Today "difficulty" means *relative to a university course*. A ten-year-old and a career changer
need a stated audience on every piece of content, or the homepage becomes noise for everyone.

**One enumerated field, `audience`, on every content-bearing model:** Exercise, Material,
TaughtCourse, Event (and Session), Service, Post, ExerciseSet. Values, in order:

| value | who | notes |
|---|---|---|
| `early_years` | 0–6, via an adult | consumed through a parent/teacher account; never a login target |
| `primary` | 6–12 | Polish szkoła podstawowa I–VI |
| `secondary` | 12–19 | szkoła podstawowa VII–VIII + liceum/technikum; matura prep lives here |
| `university` | students and staff | the entire existing corpus; **the migration default** |
| `adult` | career changers, returners | self-paced, no institution assumed |
| `senior` | 60+ | distinct because content pacing and UI needs differ, not because maths does |
| `all` | genuinely age-agnostic | rare; a submitter has to pick it on purpose |

- **A single value, not a range or a multi-select.** Content aimed at "primary and secondary" is
  two pieces of content in practice, and a range makes every filter a two-ended comparison. `all`
  is the escape hatch.
- **Difficulty stays**, but is read *within* a band: "hard" for primary is not "hard" for university.
  The badge renders as "Primary · hard" so the two are never confused.
- **Migration**: everything existing becomes `university`. That is true of the 742-exercise corpus,
  every course, listing and event this site has ever had.
- **Facet everywhere**: browse pages, `/search`, the random picker, the homepage tabs, the activity
  feed, tutor listings. **Every submit form asks for it** (required, no default in the form — a
  default is how everything ends up `university`).
- **A viewing preference, `Profile.audience_filter`** (list, default empty = show all), so a parent
  can pin the site to `early_years`+`primary` and a senior to `senior`+`adult`. Guests get a
  band chip row on the homepage that sets a localStorage version of the same thing.

## 2. Accounts for minors — the legal part comes first

GDPR Article 8, as transposed in Poland, sets the consent age at **16**. A child under 16 cannot
lawfully register alone. This is a new accounts model, and it has to exist before any child logs in.

- **`Guardianship(guardian → child, consent_given_at, consent_method, revoked_at)`** in `accounts`.
  A guardian creates child accounts from their own settings page; a child has a username and
  password and **no email** (nothing is ever mailed to a child).
- **Registration asks for a birth *year*, not a date** (data minimisation), and only to branch:
  under 16 → "ask your parent or guardian to create your account", with a short explanation; 16+ →
  the existing flow. The year is not stored; only `Profile.is_minor` (bool) is.
- **Minor-safe defaults, enforced server-side, not just hidden in the UI:** no messaging in either
  direction, no public profile (`show_profile_publicly` locked false), no tutoring listing, no
  event hosting, comments and posts allowed but **always pending** review (the ordinary
  non-verified path, just with the auto-publish exemption never granted), no avatar upload
  (identicon placeholder instead — the first real reason to build one), no location sharing.
- **The guardian sees and can delete everything the child made**, and can delete the account.
  Deleting a guardian account cascades to its children unless a second guardian exists.
- **A guardian registers a child for an event** (`Registration.registered_by`, §3.4), which is the
  only way an `early_years` or `primary` attendee ever ends up on a roster.
- **Moderation load rises and image review becomes mandatory** for anything a minor can see. The
  pre-publication image review §17AI deferred moves into scope: an image uploaded by a minor, or
  into an `early_years`/`primary`/`secondary` thread, is held until a moderator looks at it.

## 3. Events, overhauled

What exists: `Event` (draft/published/cancelled, private/public, one start + duration, one
location, capacity, `EventAttendance` going/not-going, `EventPost` updates with links and a
picture, three notification types, a kill switch, calendar integration). What is missing: any
notion of an agenda, speakers, a registration form, a waiting list, a call for contributions,
organiser roles beyond the host, or export.

### 3.1 Organisers — `EventStaff`, mirroring `CourseStaff`

`EventStaff(event, user, role: organiser | reviewer | volunteer, added_by)`. The host stays the
denormalised owner (every byline reads it) and gets an `organiser` row created in `save()`, exactly
the lesson `TaughtCourse` recorded. Organisers edit the event and agenda and decide registrations;
reviewers only see and decide contributions; volunteers only check people in. **Review is
single-blind**: reviewers see the submitter; the submitter sees the decision, the reason code and the
outgoing note, never who wrote it. The report's argument (interpersonal friction inside a cohort)
beats my first instinct to name the decider, and hiding it costs nothing.

### 3.2 Agenda — `Track`, `Session`, `SessionSpeaker`, `SessionLink`

- `Event` gains `ends_at` (nullable; a one-evening event keeps start + duration). A multi-day event
  is one event whose sessions span days.
- `Track(event, name, colour, order)` — optional; a single-track workshop never creates one.
- `Session(event, track?, kind: talk | workshop | poster | break | social | other, title, abstract,
  starts_at, duration_minutes, location_text, online_url, capacity, order)`. A session's own
  `capacity` is what makes "register for the 14:00 workshop" possible; 0 means the event's own.
- `SessionSpeaker(session, user?, name, affiliation, bio, order)` — **a speaker is a row that may
  point at a profile**, not a profile. Most speakers at a school science day have no EdMat account
  and never will; forcing one produces fake accounts.
- `SessionLink(session, material? | exercise? | exercise_set? | url, role, label, note, order)` —
  the thing a generic conference tool does not do: a session points at the corpus. `role` is the
  report's best idea: `prepare` (read/try before), `live` (worked through in the room), `homework`,
  `slides`, `recording`, `solutions` — it drives grouping on the session page and lets an exercise
  or material page list every session it appears in, both directions. "Add this session's
  exercises to My Set" is one button over the same rows. Slides go up as a Material
  and the session links it; a workshop links the exercise set it works through; afterwards the
  recording is a link. Same exactly-one-target constraint pattern `Post` anchors use.
- Timetable views reuse `CalendarWeek`/`CalendarMonth` (already domain-free) plus a "by track" list.
  A signed-in person can **bookmark sessions** (`SessionBookmark`), which is what feeds their
  `.ics` export and the "my agenda" view. A session also gets a Q&A thread (the generic `Comment`
  with the existing votes) so questions can be asked and upvoted during the room.

### 3.3 Registration — `EventAttendance` grows into it, not a second model

One row per person per event is already the invariant; the states widen rather than a
`Registration` model appearing beside it:

```
 (none) ──► going ─────────────────────────────────► not_going / cancelled
    │         ▲  ▲                                        (seat freed → promote oldest waitlisted)
    ├──► pending ┘  │  (approval mode: organiser accepts)
    └──► waitlisted ┴─► promoted (24h claim) ──► going | expired ──► next in line
 going ◄──► checked_in   (volunteer/organiser, day of; never automatic; undo allowed)
 going ──► waitlisted    (capacity cut below confirmed: LIFO demotion, notified)
```

- `Event.registration_mode`: `rsvp` (today's behaviour) | `approval` | `form`. A `form` event has a
  `RegistrationForm(event)` with `RegistrationField(label, kind: text | choice | multi | checkbox,
  required, options, order)`; answers land in `EventAttendance.answers` (JSON, keyed by field id).
  This is the Indico pattern cut down to what a small organiser uses.
- **Waiting list resolves the open 17V.7 question: first-asked wins.** A freed seat promotes the
  oldest `waitlisted` row automatically and notifies them; a promotion has a 24h confirm-or-lose
  window (`promotion_expires_at`), else the row becomes `expired` and the next in line is promoted.
  Reducing capacity below the confirmed count demotes the most recent registrations to the waiting
  list, last-in first-out, with a notification saying why. Check-in can be undone by an organiser
  (wrong person); the seat is never released by that. "First to click" is a lottery for whoever happens to be online.
- **Per-session choices** for capped workshops: `SessionAttendance(session, attendance)` with the
  same capacity check the event has, re-run against the database on every write.
- `registered_by` (nullable) for a guardian registering a child; `checked_in_at` and
  `checked_in_by` for the day itself. A **roster export** (CSV/JSON, organisers only) with the
  answers, and an optional masked public list (first name + last initial) the organiser turns on.
- **Baseline fields every form has** (report §"Registration Form Schema", trimmed of its
  UW-specific affiliation list): name and email pre-filled from the profile, attendance mode for
  hybrid events, accessibility needs (free text, organisers only), and a consent checkbox naming
  the organiser as the person who will see the answers. Affiliation and student number are
  optional fields the organiser adds, not built-in — most events here will never need them.
- **Capacity is checked on every path** — RSVP, approval, promotion, session choice — the rule
  `TaughtCourse` already states.

### 3.4 Contributions — the call for papers, small

```
 draft ◄──► submitted ──► under_review ──► accepted ──► scheduled (session set)
   ▲ (author pulls back      │        ▲        │                │ (session deleted → accepted)
   │  before review)         │        └── revisions requested   ▼
   │                         └──► rejected (reason code + note)  withdrawn (slot vacated, flagged)
```

`Contribution(event, submitter, kind: talk | workshop | poster | other, title, abstract, audience,
status, session?, reason_code, review_note, decided_by, decided_at, co_authors JSON ≤5,
notes_to_organiser)`. `Event.cfp_open` + `cfp_deadline` gate submission. Reason codes are a small
fixed list (out of scope, duplicate topic, no room in the programme, needs revision, other) so a
rejection is never a bare "no". **Visibility**: submitter + event staff until `accepted`; then it is public and
"schedule it" turns it into a `Session` with the submitter as its speaker. A rejection carries a
note the submitter sees — the same discipline every moderation queue here already holds itself to.

### 3.5 Export, notifications, and what is reused

- `.ics` for one event, for one session, and for "my agenda" (bookmarked sessions across events)
  at `/api/events/{id}/ics/` and `/api/my-agenda.ics?token=`. Nothing here has ever had this.
- New notification types: `registration_confirmed`, `registration_waitlisted`,
  `registration_promoted`, `contribution_decided`, `session_changed` (time/place only, the
  `event_updated` rule). All under the existing `notify_on_event` category.
- **Reused unchanged**: `EventPost` for announcements, `Comment` for the event thread (still
  unwired — wire it), `notify()`, the kill switch, the tutor-calendar integration (a host's
  sessions block bookable time exactly as the whole event does today), `imaging.py` for pictures,
  the report system once `Event` and `Contribution` join `REPORT_KIND_MODELS`.

## 4. Sorting exercises

`GET /api/exercises/` knows `?sort=top|recent` and nothing else, and the branch page under
`/disciplines/…` exposes neither. Add, server-side, with a `<select>` on every exercise list:

| key | order | note |
|---|---|---|
| `number` | course number asc (default on a branch page) | the order the corpus was written in |
| `title` | locale-aware A–Z | needs the resolved translation title annotated, not a Python sort |
| `difficulty` | easy → hard, then number | |
| `rating` / `reviews` | average desc / count desc | `top` is `rating` today |
| `solutions` | count of visible published entries desc | "most explained" |
| `views` | `ContentView` count desc | "most read", the one signal nobody has surfaced |
| `verified` | verified first, then chosen secondary | a toggle, not a sort |
| `recent` | created desc | kept |

Direction is a separate `&dir=asc|desc`. The chosen sort persists in the URL (shareable, like the
homepage tab) and the last choice is remembered in localStorage. Sets and materials get the same
control with the keys that apply to them.

## 5. Content language follows the interface language

Today `?lang=` resolves each item's *text* to the reader's locale and falls back to the original,
so an English-interface reader sees 742 Polish exercises with Polish text. The new rule: **a list
shows only items that have a published version in the interface language**, unless the reader
opts into more.

- `Profile.content_locales` (list; empty = "same as interface") and a Settings row "Also show
  content in: ☐ Polski ☐ English …". Guests get the same in localStorage.
- Every list endpoint filters on it; every detail page still resolves and falls back as today, so a
  shared link never 404s — it shows a banner "This is in Polish; you are reading the English
  interface" with a one-click "show Polish content too".
- Every list renders a quiet count: "**412 items in other languages are hidden** — show them",
  because a list that silently drops most of the site reads as an empty site.
- **Which models carry a language today**: translations tables for Exercise/Material/taxonomy;
  `Event.language`, `TaughtCourse.language`. **Missing and to add**: `Service.language`,
  `Post.language`, `ExerciseSet.language` (derived from its exercises), `SolutionEntry` already has
  `locale`. Comments follow their thread and are never filtered.
- **The consequence Piotr should see before saying yes**: on day one the English interface shows a
  near-empty site, because almost nothing has an English version. Two mitigations, both cheap:
  the hidden-count banner above, and the machine-translation draft path §10 flagged years ago
  (a `pending` translation row with `translated_by=null`, reviewed by a human) — still not built,
  but this rule is the first thing that makes it worth building.

## 6. Pictures and small PDFs on comments

`CommentAttachment(comment, file, kind: image | pdf, original_name, size_bytes, order)`, at most
**3 per comment**, images **≤ 5 MB re-encoded through `imaging.py`** (EXIF gone, bounds enforced,
never the uploaded bytes — a sketch of a triangle is exactly the whiteboard-shaped picture
`events/postimage.py` already handles), PDFs **≤ 5 MB through `materials/validators.py`** (libmagic
sniff, ClamAV when present, UUID filename). Rendered as thumbnails with the existing `PdfViewer`
for PDFs. Counted against `Profile.material_upload_quota_bytes`. Reportable with the comment;
removed with its tombstone. Minors' uploads and uploads into minor-band threads are held for
review (§2). The multipart shape `EventPost` already accepts (body + files + links) is reused.

## 7. A rich-text editor for people who will never type LaTeX

The new audiences will not write `\frac{a}{b}`. **Storage does not change**: Markdown-with-HTML
passthrough, sanitized by `bleach` on write and DOMPurify on read, math as `\( \)`/`\[ \]`. A
rich editor is a second *input* for the same field, emitting HTML the sanitizer already allows.

- **Not TinyMCE, unless Piotr has a reason.** TinyMCE 7 is GPL-2.0-or-later *or* commercial; the
  maths plugin is the paid Wiris MathType, and bundling GPL code into this app's own build is a
  licence question a student project should not have to answer. **Tiptap (MIT, ProseMirror-based)**
  gives the same toolbar, a `Mathematics` extension that renders with the KaTeX already shipped, an
  image node that can upload through the attachment endpoint in §6, and clean HTML out. Quill (BSD)
  is the fallback if Tiptap's Svelte wrapper proves awkward.
- **Two modes on every content field, remembered per account**: "Editor" (rich) and "Source"
  (today's textarea + live preview). Switching from rich to source shows the HTML; switching back
  re-parses it. University users keep exactly what they have.
- **Maths for non-LaTeX users**: a toolbar button opening a small palette (fraction, power, root,
  ±, ×, ÷, Greek letters) that inserts KaTeX under the hood. Not a full equation editor.
- **Sanitizer widening**, deliberately small: `figure`/`figcaption`, `img` restricted to this
  site's own `/media/` origin, `table` attributes it lacks, no `style`, no `iframe`. Every widening
  gets a test that the thing it does not allow is still refused.
- **Loaded lazily** like KaTeX and Leaflet: a reader never downloads the editor.

## 8. Accessibility and plain language — a constraint, not a pass

Applies across everything above rather than as a step of its own: 44px targets, a font-size
control in the header (three steps, persisted), a high-contrast theme beside light/dark, no menu
deeper than two levels for the band-filtered views, plain-language copy for `early_years`/`primary`
/`senior` surfaces (both locales), and the existing axe audit extended to every new page.

## 9. Order and rough cost

| step | what | sessions |
|---|---|---|
| 1 | this note; audience field + migration + facets + submit forms | 1–1.5 |
| 2 | events: staff, agenda, speakers, links, timetable, bookmarks, `.ics` | 2–3 |
| 3 | events: registration modes, forms, waiting list, session capacity, check-in | 1.5–2 |
| 4 | events: contributions and review | 1 |
| 5 | guardian accounts and minor-safe defaults, image hold queue | 2 |
| 6 | sorting; content-language rule with hidden-count banner | 1 |
| 7 | comment attachments | 0.5–1 |
| 8 | rich editor (Tiptap), mode switch, maths palette, sanitizer widening | 1.5–2 |
| 9 | accessibility constraint pass, obvious fixes and redesigns | 1–2 |
| 10 | e2e for all of it, deploy bundle, runbook | 1 |

Roughly 13–17 sessions. Steps 2–4 and 6–8 are independent of each other and can run on separate
worktrees in parallel once step 1 has landed the audience field they all read.

## 10. Questions for Piotr — defaults I will use if unanswered

0. **Audience scope**: literally toddlers (`early_years`, adult-mediated) or "school and up"? —
   default: the full list as decided, `early_years` included.
1. **Editor**: Tiptap (MIT) rather than TinyMCE — default yes.
2. **Waiting list**: first-asked wins with a 24h claim window (the report's number) — default yes.
3. **Content language day-one consequence** (§5): accept the near-empty English site with the
   hidden-count banner, or build the machine-translation draft path in the same pass — default:
   banner now, MT drafts as a follow-up.
4. **Minors' comments always pending** (§2) — default yes; it is the only defensible starting point.
5. **Payments** stay out — default yes.

## 11. The Gemini report, reconciled

The report (`gemini.md`) arrived after the first draft of this note. What it adds is above; what it
gets wrong, and where it disagrees with a decision already taken, is here.

**Adopted from it** — the 24h claim window and `expired` state; LIFO demotion when capacity is cut;
check-in undo; the revisions loop and `scheduled`/`withdrawn` states with the slot-vacated rule;
single-blind review with a required reason code; the masked public roster; CSV export; a `role` on
every session link and the reverse listing on exercise/material pages; "add this session to My
Set"; session Q&A with upvotes; its explicit list of Indico machinery **not** to build (referee
matrices, badge printing, multi-room balancing, offline bundles) — which matches §3 as written.

**Corrected** — it believes the events area is "a static route with no schemas"; `Event`,
`EventAttendance`, `EventPost`, capacity, notifications, the kill switch and the calendar
integration all exist, and §3 builds on them rather than from zero. Its registration schema hard-
codes University of Warsaw affiliations and a six-digit index format; that is one organiser's form,
not the platform's. Its facet vocabulary ("Mathematical Analysis I, II … Quantum Mechanics") is a
guess at the taxonomy that `Discipline/Branch/Topic` already holds. UUID primary keys and
"Postgres/Elastic indexing" are not this codebase. It calls for SAML/OIDC SSO as backlog item 8;
§17S records exactly why that is blocked on per-institution credentials, not on code.

**The disagreement that needs Piotr, not me.** The report's opening section argues the
toddler-to-senior scope is "an architectural anti-pattern" and that EdMat should stay with
university STEM, olympiad-track secondary students, educators, and technically-minded career
changers. Its reasons are real: pre-literate and senior interfaces want opposite things, and both
want less density than a LaTeX corpus can give. **Piotr decided the wider audience on 2026-09-09
and this note is built for it** — the audience band (§1) and guardian accounts (§2) are what make
the wide scope survivable rather than what the report feared. But the report is right that the
cost is not zero: §2 alone is two sessions and a moderation burden that never goes away. If the
real intent is "school students and adults too" rather than literally toddlers, `early_years` can
be dropped and §2 shrinks to the under-16 rule, which is still mandatory for secondary students.
That is the one question in §10 worth answering before step 1 starts.

**Its ranked backlog against §9** — its items 1–5, 7, 9, 10 are steps 2–4 here; item 6 (faceted
search with live counts and mobile filter sheets) is folded into the audience facet work in step 1
and the sorting work in step 6; item 8 (SSO) stays where §17S left it.
