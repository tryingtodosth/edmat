# EdMat — what it is, who it is for, and what it promises

The product spec: where the project came from, what it is trying to be, who uses it, and the
requirements that follow. Split out of `CLAUDE.md` on 2026-09-19 — §§1–7 of the old blueprint,
verbatim.

`CLAUDE.md` holds the engineering contract, `HISTORY.md` the build log, `LEGAL.md` and
`FINANCES.md` the non-engineering commitments. The audience widened well past this document's
original "university exercises" framing on 2026-09-09; `AUDIENCE-BRIEF.md` is the design note for
that, and §17AL onward in `HISTORY.md` is what has been built of it.

**Naming caveat**, as everywhere outside `backend/`: the taxonomy was renamed after this was
written — *kierunek* is `taxonomy.Discipline` (was `Field`), *przedmiot* is `taxonomy.Branch` (was
`Course`), and a user-run *kurs* is `courses.Course`.

---

## 1. Grounding — what this project is built from

Three things already exist in `/home/alojzy/Zrzut_Na_Hosta/` and this project is a deliberate
synthesis of all three, not a from-scratch idea:

1. **`edmat/Database-of-Student-Exercise/`** ✅ — a real, working, git-tracked static-site generator
   containing **740 hand-written, LaTeX-formatted university exercises** (see Section 3 for the full
   inventory) plus a small Python/YAML content pipeline (`build.py`, `generator/builder.py`) that
   validates and renders them into a static HTML site today. **This is EdMat's seed content corpus**
   — the reason this project doesn't start from an empty database. It stays in place, untouched, as
   the source-of-truth export/migration target (Section 12); EdMat does not fork or rewrite it.
2. **`personalizacja_edukacji/CLAUDE.md`** ✅ — an earlier, **mocked-frontend-only** SvelteKit
   exploration of essentially this same idea, under the same working title ("EduMat"), but scoped to
   *linking to and reviewing external educational material* (articles/videos/games found around the
   web, with license/provenance tags) rather than *hosting a real, original exercise database*. This
   document **supersedes it** for anything the two disagree on, but keeps three things from it
   deliberately: (a) the "detached, fully-mocked SvelteKit frontend with a strict service-layer
   boundary" build discipline (Section 13), (b) the community layer shape — reviews, threaded
   comments, edit suggestions — adapted here to exercises instead of external links, and (c) its
   light/dark theming token-bridge pattern (Section 13). Its `License`/`TraceabilityBadge` concept
   (is this link legally reusable?) does **not** carry over — EdMat's content is either originally
   authored for this project or migrated from the existing, already-owned exercise corpus, so
   external-link licensing isn't the same problem here (see Section 18's copyright note for the one
   real question that *does* carry over).
3. **`2donet/` and `sveltev04/`** ✅ — an unrelated cooperative-platform project ("2do.net"), but its
   SvelteKit scaffold has a **working, proven Paraglide/inlang i18n setup** (`en` base + `pl`,
   `hooks.server.ts`/`hooks.ts` middleware, `messages/{locale}.json`, `project.inlang/settings.json`)
   that is reused verbatim as EdMat's own i18n scaffold (Section 10) — copying the *setup*, not the
   todo-network domain model, which has nothing to do with this project.

---

## 2. Vision

Good exercises with correct, well-explained solutions already exist — scattered across scanned PDFs,
one-off course websites that vanish after a semester, and private files TAs hand out to whoever
happens to ask. `Database-of-Student-Exercise` already solved the "get 740 of them into one
consistent, LaTeX-rendered, browsable place" problem for one department's worth of courses. What it
can't do as a static site is the part that makes a database like this actually improve over time:
**nobody can flag a wrong solution, propose a clearer one, discuss where they got stuck, or translate
it for a classmate who studies in a different language** — every edit today requires someone with
git access hand-editing a Markdown file.

EdMat turns that static corpus into a real, living platform: the same browsing experience (field →
course → exercise, filtered by topic/difficulty/source), plus a community layer on top — ratings,
threaded discussion per exercise, community-submitted corrections and new exercises (moderated, not
a free-for-all, matching the existing corpus's own `verified` quality bar), and first-class
**translation of exercise content itself** — not just an English/Polish interface, but an English
version of a Polish-authored exercise (and vice versa) that a moderator or the community can review,
independent of whichever language the reader's own interface happens to be in.

---

## 3. The existing exercise corpus (as of this writing)

Concrete numbers, not estimates — pulled directly from `content/` in `Database-of-Student-Exercise`:

| Field (kierunek) | Course (przedmiot) | Exercises | Topics | Notes |
|---|---|---|---|---|
| Matematyka | Analiza Matematyczna II (`uw-matematyka-am2`) | 383 | 31 | full course, `dozwolone_dzialy.yaml` + `mapa_rozdzialow.yaml` chapter map present |
| Matematyka | Rachunek Prawdopodobieństwa I (`uw-matematyka-rp1`) | 357 | ~19 | full course, 5 supporting PDF materials (skrypty, zadania z kolokwiów/egzaminów) |
| Informatyka | Analiza Matematyczna I (`uw-informatyka-am1`) | 1 | 2 | stub/placeholder — field started, not populated |
| Fizyka | Analiza I (`uw-fizyka-analiza1`) | 1 | 2 | stub/placeholder — field started, not populated |

**Difficulty distribution:** 142 `latwe` (easy), 441 `srednie` (medium), 159 `trudne` (hard) —
skewed medium, as expected for real course material.

**Source-type distribution:** 565 `Ćwiczenia` (exercise sheets), 110 `Egzamin` (exam), 65
`Kolokwium` (midterm).

**Exercise schema, exactly as it exists today** (front-matter YAML + 4 Markdown/HTML/LaTeX
sections, `content/courses/<course>/zadania/NNNN.md`):

```yaml
---
id: uw-matematyka-am2-0001          # {course-id}-{4-digit-number}, unique
number: 1                            # must match the filename
title: Aksjomaty normy euklidesowej
topics: [normy-iloczyn-skalarny]     # must be a subset of course.yaml's own `topics[].id`
difficulty: latwe                    # latwe | srednie | trudne
source:
  type: Ćwiczenia                    # Ćwiczenia | Egzamin | Kolokwium
  name: 'Analiza Matematyczna II - ... Zadanie 1'
  collection: Analiza Matematyczna II
  original_problem_number: 1
  pages: '5'
  chapter: 1
tags: [norma-euklidesowa, aksjomaty-normy]
published: true
verified: true                       # true only if a full, correct solution/answer exists
---
## Treść        (Statement — required)
## Wskazówka    (Hint — optional)
## Odpowiedź    (Answer — optional; left empty for "prove/show that" exercises)
## Rozwiązanie  (Solution — usually present when verified: true)
```

Body content is **HTML fragments with literal LaTeX delimiters** — `<p>…</p>` paragraphs,
`\( … \)` inline math, `\[ … \]` display math — never Markdown syntax, always hand-written. This
detail matters directly for the content pipeline decision in Section 11.

**Materials** (`materialy/`) are a separate, lighter object: a PDF plus `material.yaml` (title, type,
description, author, topics[], published, featured, order) — course scripts ("skrypty"), formula
sheets, and past-exam/midterm compilations. RP1 has 5, AM2 has at least 2.

**Also present in the source repo, not yet decided whether EdMat keeps it (see Section 16, "Left for
later"):** a `zestaw` ("my set") feature — client-side `localStorage`-backed exercise selection with
a PDF export (`html2pdf.js`) for building a printable study sheet, and a `mapa_rozdzialow.yaml`
chapter-to-textbook-page map per course. Both are real, working features worth carrying forward as
user stories (Section 6), not losing in the rewrite.

---

## 4. Scope — goals and non-goals for v1

**In scope:**
- Browse the existing corpus (field → course → exercise), with topic/difficulty/source filters,
  exactly matching what the static site already does today, as the baseline UX bar.
- Exercise detail page: full LaTeX-rendered statement/hint/answer/solution, source attribution.
- A translatable interface: every UI string routed through the i18n layer, English + Polish at
  launch (Section 10).
- Translatable exercise **content** — a given exercise can have more than one language version, each
  independently reviewable (Section 10).
- Community layer: star rating + threaded discussion per exercise.
- Community content submission: new exercises, and edit suggestions against existing ones — both
  moderated before publishing, mirroring the existing corpus's own `verified`/`published` discipline.
- "My set" — build a personal exercise collection and export it as a printable study sheet, carried
  forward from the existing static feature.
- Registered accounts (needed for authored reviews/comments/submissions to mean anything), with a
  moderator role for the review queue.
- Django REST Framework backend serving a real database, SvelteKit frontend consuming it.

**Explicitly out of scope for v1** (real decisions, not oversights):
- University SSO / institutional login — plain email+password to start (Section 18, open question).
- Real-time collaborative editing of a solution.
- Auto-grading, quizzes, or any assessment/testing functionality — this is a *reference and
  discussion* database, not an exam platform.
- Machine translation — v1 translation is human-submitted and human-reviewed only (Section 10 notes
  where a machine-assist could slot in later without a redesign).
- Any content beyond math/physics/CS university exercises — no k-12 material, no non-STEM fields, no
  video/interactive content (that was `personalizacja_edukacji`'s scope, not this one, per Section 1).
- Mobile apps — responsive web only.

---

## 5. Roles & personas

| Role | Can do |
|---|---|
| **Anonymous visitor** | Browse, search, filter, read exercises + materials, read reviews/discussion, build a local (browser-only) "my set" and export it to PDF. |
| **Registered user** | Everything above, plus: leave a rating/review, post/reply in discussion threads, submit a new exercise, suggest an edit to an existing one, submit a translation, save "my set" server-side under a name, and — since 2026-09-22 (`COAUTHORING-BRIEF.md`) — propose an improved version of any material, or co-author one as a member of its project. |
| **Verified contributor** *(a lightweight reputation tier, not a separate account type — a flag a moderator grants)* | ✅ **Resolved, Section 18 item 4.** A brand-new exercise submitted by this tier publishes immediately, no queue. Edit suggestions and translations from the same person still queue regardless — trust in new work doesn't extend to an unreviewed change to something already published. |
| **Moderator** | Everything above, plus: approve/reject new-exercise submissions, edit suggestions, and translation submissions; toggle `published`/`verified` on any exercise; moderate flagged discussion content. |
| **Admin** | Everything above, plus: manage fields/courses/topics (the controlled vocabularies), manage user roles. |

---

## 6. User stories

Grouped by epic, each tagged with the role it's written for.

### Browsing & discovery
- As an **anonymous visitor**, I can pick a field, then a course, and see its exercises, so I can
  find material for the class I'm actually taking.
- As **any user**, I can filter a course's exercise list by topic, difficulty, and source type
  (exercise sheet / midterm / exam), matching the exact filter set the current static site already
  offers, so the rewrite isn't a step down in usability.
- As **any user**, I can free-text search across exercise titles/tags/topics, so I don't have to
  browse a 383-exercise list by hand to find "that Cauchy-Schwarz one."
- As **any user**, I can see a course's chapter/topic map against its source textbook (carried over
  from `mapa_rozdzialow.yaml`), so I know where in the book a topic comes from.

### Exercise detail & LaTeX
- As **any user**, I can view an exercise's statement, and progressively reveal hint → answer →
  solution (not all four blasted onto the page at once), so I can try it myself before seeing the
  answer.
- As **any user**, all math renders correctly and legibly (inline and display), on both desktop and
  mobile, so the platform is actually usable for its core content.
- As **any user**, I can see an exercise's source (which exam/midterm/exercise sheet, which chapter,
  original problem number), so I can find it in the original material if needed.

### My Set / study sheet
- As an **anonymous visitor**, I can add exercises to a personal set while browsing and export the
  set as a PDF, without creating an account — matching the existing feature exactly.
- As a **registered user**, I can save a named set server-side (e.g. "Kolokwium 2 review") and come
  back to it from another device, instead of losing it when I clear my browser storage.

### Community review & discussion
- As a **registered user**, I can leave a star rating and optional written review on an exercise, so
  others can gauge quality/difficulty from real students, not just the metadata.
- As a **registered user**, I can post a comment on an exercise (e.g. "I don't follow step 3") and
  reply to others' comments in a thread, so a stuck student can get unstuck without leaving the page.
- As **any user**, I can see whether an exercise is `verified` (a full, correct solution exists) at a
  glance, so I know how much to trust the solution before relying on it.

### Content submission & moderation
- As a **registered user**, I can submit a brand-new exercise (with the same fields the existing
  corpus already requires: title, statement, topics, difficulty, source), so the database keeps
  growing beyond what the original two courses seeded.
- As a **registered user**, I can suggest an edit to an existing exercise (a typo, a clearer
  solution step, a missing hint) without needing direct write access, so quality control doesn't
  require moderator bandwidth for every trivial fix.
- As a **moderator**, I can review a queue of pending submissions/edit-suggestions/translations and
  approve or reject each with an optional note, so nothing publishes without a second pair of eyes —
  this matters more here than in a typical UGC app, since a wrong "solution" actively misleads a
  student studying for an exam.
- As a **moderator**, I can un-publish or un-verify an exercise that turns out to be wrong, so a bad
  solution doesn't sit live indefinitely once flagged.

**Co-authoring a material** (added 2026-09-22; the design and its decisions are in
`COAUTHORING-BRIEF.md`, the build in `HISTORY.md` §17BC):
- As a **registered user**, I can propose an improved version of any published material — a new
  file, a link, or text written here — and the people who look after it accept or reject it with a
  reason, so a material with a mistake in it is not stuck with the mistake.
- As a **registered user**, I can start a material *with other people*: a project with a team, an
  invite link, and a first version a moderator reads before it becomes a material.
- As a **co-author**, I can publish a new version without waiting for a moderator, because somebody
  already vouched for this material and its history says who changed what.
- As **anybody**, I can see what a material used to be and who changed it, because every version is
  kept rather than overwritten.
- *Not* real-time editing, which stays out of scope above: collaboration is turn-based, and a save
  written against an older version is refused rather than silently winning.

### Translation
- As a **registered user** fluent in a second language, I can submit a translation of an exercise's
  title/statement/hint/answer/solution into another supported locale, so a classmate who studies in
  that language can use the same exercise.
- As **any user**, I can switch which language version of an exercise I'm reading (independent of my
  own interface language — I might use the English UI but want to read the original Polish
  statement, or vice versa), and see who translated it.
- As a **moderator**, I can review a submitted translation before it goes live, since a subtly wrong
  translation of a math statement is worse than no translation at all.

### Interface & accounts
- As **any user**, I can switch the entire interface between English and Polish, and every label,
  button, and system message follows — no hardcoded strings anywhere.
- As a **visitor**, I can register with an email + password and log in, so my reviews/comments/
  submissions are attributable to me.

---


## 7. Functional requirements

1. Browse fields → courses → exercises/materials with the filters in Section 6 (topic, difficulty,
   source type), plus free-text search.
2. Render exercise content (title + 4 sections) with correct LaTeX, both inline and display math.
3. Progressive reveal of hint/answer/solution on the exercise detail page (not all rendered open by
   default) — a pedagogical requirement, not just a UI nicety: seeing the solution before attempting
   the problem defeats the point of a practice database.
4. Every user-facing string routed through the i18n layer — **no hardcoded UI text anywhere**, in
   either English or Polish, checked the same way `2donet`'s own blueprint enforces it: a component
   should never contain a literal user-facing string.
5. Every exercise (and material) can have more than one language version; the reader can pick which
   one to view; a version's own translator/reviewer is attributed.
6. Star rating + threaded comments per exercise, with reply nesting.
7. New-exercise submission form and edit-suggestion flow, both landing in a moderation queue before
   publishing.
8. Translation submission flow, also moderation-gated before it's the version readers see by default.
9. "My set": add/remove exercises to a working collection; guest sets live in `localStorage`;
   registered users can persist a named set server-side; export a set to PDF.
10. Auth: register, log in, log out, password reset. Role-gated moderation UI, hidden entirely from
    non-moderators (not just disabled).
11. Admin/moderator surface for managing fields, courses, topics (the controlled vocabularies exercises
    are validated against — matching the existing `course.yaml`/`dozwolone_dzialy.yaml` discipline),
    and the review queues from items 7–8.

---

## 8. Non-functional requirements

- **i18n-first:** no component may contain a literal user-facing string; every string is a message
  key resolved through the i18n layer, in both `en.json` and `pl.json` in the same change that
  introduces it (matching the "never English-only" discipline the `2donet` blueprint enforces on
  itself, Section 10 explains the mechanism).
- **LaTeX correctness & performance:** math must render correctly for every exercise already in the
  corpus without hand-editing content (Section 11's format decision is driven by this), and
  rendering a exercise list page with dozens of formulas shouldn't visibly jank — batch/typeset once
  per page load, not once per formula.
- **Content integrity:** user-submitted content (new exercises, translations, comments) is untrusted
  input — sanitize on write (backend) and defensively on read (frontend), given the content model
  deliberately allows a constrained set of HTML+LaTeX, not plain escaped text (Section 11).
- **Accessibility:** keyboard-navigable filters/forms, sufficient contrast in both light and dark
  themes (theming carried over from `personalizacja_edukacji`, Section 13), alt-text-equivalent
  handling for rendered math (KaTeX ships this if configured, not automatic — a real setup task, not
  assumed).
- **No silent data loss on moderation:** rejecting a submission/edit/translation should keep a record
  of what was rejected and why, not just delete it — matters for a system where "who submitted what,
  when, and was it accepted" is part of the trust model.
- **Migration fidelity:** every field in the existing 740-exercise corpus (Section 3's schema) must
  have a home in the new data model — nothing silently dropped during migration (Section 12).

---

---

**Working title: "EdMat"** (Edukacja + Matematyka / Educational Materials) — the folder name this
project inherited from `personalizacja_edukacji`, which already explored a lighter version of this
same idea (see Section 2). Rename freely if something better surfaces; nothing below depends on the
name.
