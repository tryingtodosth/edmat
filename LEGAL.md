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

**Unresolved.** There is no outbound content licence on the site today, no terms of service, and no
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

Stated to the user in `privacy.ts`: access, rectification, erasure, objection to
legitimate-interest processing, and the right to complain to the PUODO. Requests go to Dziekanat
Studencki or the Ośrodek Komputerowy. **There is no self-service account deletion**, and no export
endpoint — a request is handled by a human with database access.

### Third parties

The privacy page's claim is that no data goes to advertisers, analytics providers or anyone outside
the Faculty, and that exactly two external services are contacted in ordinary use, neither of which
is told who the user is: **Nominatim** (the search text only, when creating a tutoring listing) and
**OpenStreetMap tile servers** (which the browser contacts directly, and therefore learns its IP).
Anything that changes this — adding analytics, a CDN, an email provider — changes that page.

### Cookies

The consent banner discloses something real rather than an invented category: Paraglide's
`PARAGLIDE_LOCALE`, which predates the banner and had never been disclosed. The
"analytics & non-essential" category is **honestly empty** — EdMat sets no tracking cookie — and is
labelled as forward-looking. The consent decision itself is stored in a real cookie, not
`localStorage`, on the grounds that a consent decision is the one thing here that could plausibly
matter server-side one day.

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

## 8. Still open

- **The corpus question itself** (§3) — the report exists, no lawyer has reviewed it, nothing is
  implemented.
- **No terms of service, no CLA, no outbound content licence.**
- **No email backend**, which is why an anonymous DSA filer and a guardian both have gaps above, and
  why the password-reset endpoint is still an honest always-200 stub.
- **No self-service data export or account deletion.**
- **Not everything public is reportable.** `REPORT_KIND_MODELS` (`backend/moderation/services.py`)
  is the whole list, and it grew per feature rather than by default — so an avatar, a private
  message, a booking, an event update (`EventPost`) and a user-run course currently have no report
  path. Each gap is named in its own `HISTORY.md` section.
