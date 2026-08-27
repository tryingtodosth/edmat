# EdMat — Project Blueprint

## The shared task boards — read these first, every session

This project is worked on by many agents at once (31 git worktrees at the time of writing). Three
files are how they see each other:

| File | Holds |
|---|---|
| `/home/alojzy/Wymiana_VM/edmat-boards/todo.md` | work that is waiting, for anyone |
| `/home/alojzy/Wymiana_VM/edmat-boards/doing.md` | what is in flight right now, one entry per agent |
| `/home/alojzy/Wymiana_VM/edmat-boards/done.md` | what landed, newest first |

**The rule.** At the start of a session, read all three. When you start a task, move it from
`todo.md` into `doing.md` **in the same edit**, stamped with your branch and worktree — a task in
both places is the one state that makes the boards lie. When you finish, move it to `done.md` with
the commit and what you actually verified, and put anything you deliberately left open into
`todo.md`. If you abandon it, move it back to `todo.md` and say what you learned.

**Keep `doing.md` to one task per agent.** If you are doing two things, the second is not started;
leave it in `todo.md` where somebody else can take it.

**Do not take anything already in `doing.md` under another branch** without checking whether that
branch has moved recently — sessions end without cleaning up, so stale entries are normal. Say so
in the file rather than silently taking the work.

**They live outside the repo on purpose**, and are not tracked by git: a tracked board forks the
instant two agents branch, so each would read a snapshot of whenever their branch started — exactly
the question the boards exist to answer, answered wrongly — and 31 branches editing one file means a
conflict on every merge. `edmat-boards/README.md` records that reasoning and its cost. Each board
also restates its own rules at the top, so an agent that opens one needs nothing else.

---
**New to this file?** `CLAUDE_MAP.md` is a ~57 KB orientation map — repo layout, every backend app and
frontend layer summarized, the recurring lessons — meant to be read first for a fast, current-state
picture. This file is what it points back to: the full chronological build log, authoritative
whenever the two disagree.

**Status:** ✅ Phase 1 (frontend, fully mocked), Phase 2 (Django REST Framework backend, real
migrated corpus), and Phase 3 (frontend wired to the real backend, mocks deleted) all built — see
`frontend/` and `backend/`. **Phase 4 (hardening) is done.** The LaTeX/KaTeX compatibility sweep
(Section 11's own ⚠️), a real accessibility audit, the moderation-queue synthetic load test, and a
real multi-moderator concurrent-access test are done, see Sections 17D/17E/17F/17I. The material
detail page (Section 17G), real-time notification delivery via SSE (Section 17H, Section 18 item 9),
and server-side "my set" sharing (Section 17J, closing the last item Section 16 had flagged as
deliberately deferred) are also built. **The corpus-retirement question (Section 12's own ⚠️) is
resolved: retire `Database-of-Student-Exercise`'s static site now** — see Section 12 and Section 18
item 3 for the decision and what it changed. The translation-publish race (and a more severe,
non-concurrent bug found while chasing it) is fixed, and this project's first real automated test
suite exists — see Sections 17K/17L. **Node governors — a scoped, per-Field/Course moderator role,
full stack (backend + a real admin page) — are also built** (92 tests total then), see Section 17M.
**Real material uploads (exams/tests/etc. as PDF/PNG/LaTeX/Word, content-sniffed and, where a real
ClamAV daemon exists, scanned) are also built** (110 tests total now), see Section 17N. **Material
requirements (loose, free-text prerequisites, with a governor-only edit path for an already-published
Material), a confirmed-real threaded/reportable coverage discussion (plus a real cross-target
`parent`-validation gap closed in both the material-coverage and exercise comment endpoints), and an
optional price/time-estimate on Material are also built. A follow-up pass closed out that feature's
own "Left open" list in full: the moderation queue's Materials tab now surfaces a pending
submission's requirements/price/time-estimate to the reviewing moderator, `price_currency` is now a
real, curated `choices=` field with a matching `<select>` everywhere it's edited, `RequirementsEditor`
gained real drag-and-drop plus keyboard Up/Down reordering, a case-insensitive duplicate-label guard
now rejects (not silently dedupes) on both the governor-edit and submission-time write paths, and the
governor-edit endpoint's delete+recreate is wrapped in `transaction.atomic()` with the resulting
lost-update race genuinely reproduced (not just theorized) and confirmed safe, see Section 17O.
**Tutoring/services listings (course-scoped, browsable, filterable) and real user-to-user
messaging (built over django-postman) are also built, full stack — both apps' own automated test
suites (services/messaging/tests.py) and their entire frontend (browse/create/manage a listing,
send/reply/view messages) were added this pass, see Section 17P** — both features landed on
separate branches and were merged together locally into one before pushing, then re-verified
together: **175 tests total, all passing**, migrations clean, frontend check/lint/build all clean.
**A whole-project security scan then found four real sanitization/validation gaps, all now closed:
server-side `bleach` sanitization and the `renderContent.ts` SSR bypass in one pass, then avatar
uploads (a real crop step, plus the file validation `Profile.avatar` had entirely lacked) and auth
rate limiting in the next, alongside author/source-link provenance on material submissions —
311 tests total, all passing, see Section 17Q.**
**Tutor offers then gained a real online/in-person/hybrid distinction with OpenStreetMap-backed
locations — a Nominatim address search and a Leaflet map picker, plus a "within N km" filter —
337 tests total, all passing, see Section 17R.**
**Those offers can now be booked: a tutor publishes weekly hours plus one-off blocks and openings, and
decides PER OFFERING whether the availability students see is their real free time minus what is taken
(`derived`) or a fixed published window that keeps showing regardless (`declared`) — two genuinely
different promises, both stated in words on screen so nobody mistakes one for the other. Availability
then gained the two views people already know — a week against a time axis and a month at a glance,
on both sides of the feature — 24-hour and Monday-first by default, with 12-hour and Sunday as real
settings rather than whatever the interface language implies. 564 tests total, all passing, see
Section 17U.**
**Then: one-off events (a guest lecture, a workshop, an exam-prep meetup) as their own `events` app —
deliberately neither a course nor a booking, with attendance, capacity, a private-to-attendees roster,
its own kill switch that removes every LINK to the feature as well as the pages behind it, and a real
decision recorded about whether they occupy a tutor's schedule (they appear on it; they never withdraw
hours students are offered). Shipped alongside a navbar rebuilt from a flat row of ten links into three
groups — browse, one "Add…" menu, one account menu — and a homepage that is now five tabs rather than
exercises alone. 624 tests total, all passing, see Section 17V.**
This document is the living spec for
everything that follows: requirements, user stories, data model, and the build plan. It is annotated
inline with a status legend (below) so it can keep serving as the source of truth as later phases
proceed — the same "one consistent, current-state document" convention already used successfully in
this environment's other blueprints (`2donet/CLAUDE.md`, `personalizacja_edukacji/CLAUDE.md`).

**Working title: "EdMat"** (Edukacja + Matematyka / Educational Materials) — the folder name this
project inherited from `personalizacja_edukacji`, which already explored a lighter version of this
same idea (see Section 2). Rename freely if something better surfaces; nothing below depends on the
name.

### Legend

| Mark | Meaning |
|---|---|
| ✅ | Exists today, verified by direct inspection of the source repo/data. |
| 🆕 | New, planned — not built yet. Everything under "Data Model," "Architecture," and later sections is 🆕 unless marked otherwise. |
| ⚠️ | Open question — a real decision that needs making before or during the phase it blocks, not a rhetorical aside. |

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
| **Registered user** | Everything above, plus: leave a rating/review, post/reply in discussion threads, submit a new exercise, suggest an edit to an existing one, submit a translation, save "my set" server-side under a name. |
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

## 9. Data model (Django, sketch — field types indicative, not final)

Structural metadata lives on `Exercise` itself; **all human-language text lives in a separate
translation table**, one row per (exercise, locale) pair, including the *original* language — see
Section 10 for why this isn't split "original fields on `Exercise`, translations elsewhere."

```python
# taxonomy — mirrors content/fields/*.yaml and course.yaml's own topics[] exactly
class Field(models.Model):            # kierunek — matematyka / informatyka / fizyka
    slug = models.SlugField(unique=True)
    published = models.BooleanField(default=True)
    # name/description: translatable, see FieldTranslation

class Course(models.Model):           # przedmiot
    slug = models.SlugField(unique=True)
    field = models.ForeignKey(Field, related_name='courses', on_delete=models.PROTECT)
    university = models.CharField(max_length=200)   # free text for v1, e.g. "Uniwersytet Warszawski"
    published = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

class Topic(models.Model):            # dział — COURSE-SCOPED, matching the existing data exactly
    slug = models.SlugField()
    course = models.ForeignKey(Course, related_name='topics', on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)
    class Meta: unique_together = [('course', 'slug')]

class Chapter(models.Model):          # from mapa_rozdzialow.yaml — optional, textbook cross-reference
    course = models.ForeignKey(Course, related_name='chapters', on_delete=models.CASCADE)
    number = models.PositiveIntegerField()
    start_page = models.PositiveIntegerField(null=True, blank=True)
    topics = models.ManyToManyField(Topic)
    # title: translatable

# the exercise itself — structural fields only
class Exercise(models.Model):
    course = models.ForeignKey(Course, related_name='exercises', on_delete=models.CASCADE)
    number = models.PositiveIntegerField()             # unique per course, matches filename today
    topics = models.ManyToManyField(Topic)
    difficulty = models.CharField(choices=[('easy', ...), ('medium', ...), ('hard', ...)])
    tags = models.ManyToManyField('Tag', blank=True)
    published = models.BooleanField(default=True)
    verified = models.BooleanField(default=False)       # same meaning as today: a full, correct solution exists
    original_locale = models.CharField(max_length=8)    # which ExerciseTranslation row is canonical, e.g. 'pl'
    submitted_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)  # null for migrated legacy content
    created_at, updated_at = ..., ...
    class Meta: unique_together = [('course', 'number')]

class ExerciseSource(models.Model):    # 1:1 with Exercise — mirrors the existing `source:` block exactly
    exercise = models.OneToOneField(Exercise, related_name='source', on_delete=models.CASCADE)
    type = models.CharField(choices=[('exercises', ...), ('midterm', ...), ('exam', ...), ('other', ...)])
    collection = models.CharField(max_length=200, blank=True)
    original_problem_number = models.PositiveIntegerField(null=True, blank=True)
    pages = models.CharField(max_length=20, blank=True)
    chapter = models.PositiveIntegerField(null=True, blank=True)
    # name: translatable, since it's often a human sentence, e.g. "Analiza II - Normy w R^n, Zadanie 1"

# THE translation table — the one place title/statement/hint/answer/solution live, for every locale
# including the original. Status makes a submitted-but-unreviewed translation a real, queryable thing.
class ExerciseTranslation(models.Model):
    exercise = models.ForeignKey(Exercise, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)              # 'pl', 'en', ... — not constrained to the UI's own locale list
    title = models.CharField(max_length=300)
    statement = models.TextField()                       # Markdown + LaTeX source, see Section 11
    hint = models.TextField(blank=True)
    answer = models.TextField(blank=True)
    solution = models.TextField(blank=True)
    status = models.CharField(choices=[('published', ...), ('pending', ...), ('rejected', ...)])
    translated_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)  # null for the migrated original
    reviewed_by = models.ForeignKey(User, null=True, related_name='+', on_delete=models.SET_NULL)
    review_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: unique_together = [('exercise', 'locale', 'status')]  # at most one PUBLISHED version per locale
```

**Materials, community, and submission models** — same shape, briefer:

```python
class Material(models.Model):          # materiał dydaktyczny
    course = models.ForeignKey(Course, related_name='materials', on_delete=models.CASCADE)
    slug = models.SlugField()
    type = models.CharField(choices=[('script', ...), ('formula_sheet', ...), ('other', ...)])
    topics = models.ManyToManyField(Topic, blank=True)
    file = models.FileField(upload_to='materials/')
    author = models.CharField(max_length=200, blank=True)
    published, featured, order = ..., ..., ...
    # title/description: translatable, MaterialTranslation, same pattern as ExerciseTranslation

class Review(models.Model):            # star rating + optional text — targets an Exercise (Material later if needed)
    exercise = models.ForeignKey(Exercise, related_name='reviews', on_delete=models.CASCADE)
    author = models.ForeignKey(User, on_delete=models.CASCADE)
    rating = models.PositiveSmallIntegerField()  # 1-5
    body = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: unique_together = [('exercise', 'author')]  # one review per user per exercise

class Comment(models.Model):           # threaded discussion — content_type/object_id kept generic
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)  # Exercise or Material
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    parent = models.ForeignKey('self', null=True, related_name='replies', on_delete=models.CASCADE)
    author = models.ForeignKey(User, on_delete=models.CASCADE)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    is_removed = models.BooleanField(default=False)   # tombstone, not hard-delete — preserves thread structure

class ExerciseSubmission(models.Model):  # a brand-new exercise, pending review before becoming a real Exercise
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    submitted_by = models.ForeignKey(User, on_delete=models.CASCADE)
    payload = models.JSONField()          # draft of everything Exercise + ExerciseTranslation would need
    status = models.CharField(choices=[('pending', ...), ('approved', ...), ('rejected', ...)])
    reviewed_by = models.ForeignKey(User, null=True, related_name='+', on_delete=models.SET_NULL)
    review_note = models.TextField(blank=True)
    resulting_exercise = models.ForeignKey(Exercise, null=True, on_delete=models.SET_NULL)  # set once approved

class EditSuggestion(models.Model):     # a proposed change to an EXISTING exercise/translation
    exercise = models.ForeignKey(Exercise, related_name='edit_suggestions', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)             # which translation this edits
    field = models.CharField(max_length=30)              # 'statement' | 'hint' | 'answer' | 'solution' | ...
    proposed_value = models.TextField()
    reason = models.TextField(blank=True)
    submitted_by = models.ForeignKey(User, on_delete=models.CASCADE)
    status = models.CharField(choices=[('pending', ...), ('approved', ...), ('rejected', ...)])
    reviewed_by = models.ForeignKey(User, null=True, related_name='+', on_delete=models.SET_NULL)

class ExerciseSet(models.Model):        # "Mój zestaw" — server-side, for registered users only
    owner = models.ForeignKey(User, related_name='exercise_sets', on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    exercises = models.ManyToManyField(Exercise, through='ExerciseSetItem')
    created_at = models.DateTimeField(auto_now_add=True)

class Tag(models.Model):
    slug = models.SlugField(unique=True)   # tags are free-form today (per-exercise, not course-scoped) — kept global
```

**Users:** Django's built-in `auth.User` plus a `Profile` (`display_name`, `avatar`, `preferred_locale`,
`is_verified_contributor`, `joined_at`) — no need to reinvent auth from scratch; DRF has
well-trodden token/session auth support (Section 18 flags the specific choice as open).

---

## 10. i18n & content-translation architecture — two deliberately separate axes

This is the same distinction `2donet`'s blueprint draws explicitly and it applies here just as
directly, worth stating up front so it never gets conflated during implementation:

- **Interface language** — a small, curated, developer-maintained set of UI strings ("Log in,"
  "Filter by difficulty," error messages), one message catalog per locale, switched by the reader for
  the whole session. This is `en.json`/`pl.json` + Paraglide (below) — nothing about it is
  community-editable.
- **Content translation** — an unbounded number of Exercise/Material rows, each with its own,
  independently community-submitted and moderator-reviewed set of language versions
  (`ExerciseTranslation`, Section 9). A reader's chosen *interface* language and the *content*
  language they're currently viewing are related but genuinely independent — someone reading the
  English UI might deliberately want the original Polish statement, and vice versa.

Conflating the two — trying to route exercise content through the same message-catalog mechanism as
UI strings — doesn't work: a message catalog is a small, bounded, curated set; exercise translations
are large, free-form, submitted by anyone, and need their own review workflow. They get two separate
mechanisms on purpose.

**Interface i18n (frontend), reusing `2donet`'s proven scaffold directly:**
- **Paraglide/inlang**, `baseLocale: 'en'`, `locales: ['en', 'pl']` — same package
  (`@inlang/paraglide-js`), same `project.inlang/settings.json` shape, same
  `messages/{locale}.json` file pair, same `hooks.server.ts`/`hooks.ts` middleware
  (`paraglideMiddleware` + `deLocalizeUrl`) copied from `2donet/src/`.
- **Standing rule, copied verbatim from `2donet`'s own house rule because it's exactly right here
  too:** any new or changed user-facing string is a message key added to both `en.json` and `pl.json`
  in the same change — never English-only. A key with no Polish counterpart is an incomplete change,
  not a follow-up to file later.
- Every `m.*()` call site gets a trailing `// "Original text"` comment (script blocks) or
  `<!-- "Original text" -->` (markup) — same convention, same reasoning: lets a reader see what
  actually renders without opening the catalog.

**Content translation (both frontend + backend):**
- Backend: `ExerciseTranslation` (Section 9) — one row per (exercise, locale), `status` field gating
  what's live. A reader always sees the `published` row for their chosen content-locale, falling back
  to `original_locale` if no translation exists yet for that locale (exactly the "resolve, fall back
  to original" behavior a reasonable reader expects).
- Frontend: an exercise detail page reads `?lang=` (or a per-exercise language picker, independent of
  the Paraglide interface toggle) and requests that translation from the API; a small badge shows
  "Original" vs. "Translated by {name}, reviewed" so trust is never ambiguous.
- Submitting a translation is a registered-user action, landing as a `pending` `ExerciseTranslation`
  row — invisible to ordinary readers until a moderator flips it to `published`.
- ⚠️ **Left open, not designed further for v1:** machine-translation assistance (pre-filling a draft
  via an API before a human edits it) is a plausible phase-2 addition that slots cleanly into this
  same `status: pending` mechanism without a redesign — a machine-drafted translation is just another
  `pending` row with `translated_by = null`. Not building it now; flagging that the data model
  already accommodates it.

---

## 11. LaTeX & content-format pipeline

**Storage format: Markdown source with literal LaTeX delimiters (`\( … \)`, `\[ … \]`), raw HTML
passthrough allowed** — not a custom format, and deliberately not pure sanitized-HTML-only either.
Reasoning: the existing 740 exercises are already written as `<p>…</p>` blocks with literal LaTeX —
which is, unmodified, **already valid input to any Markdown parser that passes raw HTML through**
(CommonMark's own defined behavior). This means the migration (Section 12) requires **zero content
rewriting** — every existing `.md` body copies into `ExerciseTranslation.statement` etc. byte-for-byte
and renders correctly under this same pipeline. New submissions, from students who may not want to
hand-write `<p>` tags, can instead just write plain Markdown paragraphs (no tags needed) plus the
same LaTeX delimiters — both styles render through the identical path.

**Rendering pipeline (frontend):**
1. Markdown → HTML via a small, dependency-light parser (e.g. `markdown-it` or `micromark`) that
   passes raw HTML through unchanged.
2. Sanitize the resulting HTML (e.g. `DOMPurify`) — required the moment any of this content can come
   from a non-moderator-reviewed source (a submitted exercise sits `pending` before publish, but a
   moderator viewing the pending queue still renders untrusted HTML, so sanitization isn't optional
   even pre-publish).
3. Typeset math over the sanitized DOM via **KaTeX's auto-render extension**, configured with the
   same delimiter pairs the existing content already uses (`\( \)` inline, `\[ \]` display) — KaTeX
   chosen over MathJax (which the current static site uses) for load performance: MathJax's runtime
   is materially heavier, and KaTeX's synchronous rendering avoids the current site's dependency on a
   CDN script tag per page. ✅ **Resolved (Phase 4, see Section 17D) — confirmed clean, not assumed.**
   The real, mechanical check this item called for (batch-render every exercise, log any unsupported
   command) was run against the full, real 756-row corpus twice over — once statically (importing the
   actual `renderContent.ts`/`renderTitle` pipeline directly, not a re-implementation of it) and once
   in a real headless browser against 43 live exercise pages — with a conclusive **zero** genuine
   KaTeX-compatibility issues found either way. A permanent, re-runnable checker
   (`frontend/scripts/check_katex_compatibility.ts`, `npm run check:katex`) now exists specifically so
   this stays a real, cheap, repeatable check after any future bulk import or edit, not a one-time
   audit that quietly goes stale.

**Write side (backend):** sanitize submitted Markdown/HTML on save too (defense in depth, e.g. via
`bleach` with an allowlist matching what the frontend's parser actually needs) — never trust that the
frontend's sanitization pass is the only one that runs, since the API is a second, independent entry
point once it exists.

**Editor UX for new submissions:** a textarea with a live-rendered preview pane (same
Markdown-in → KaTeX-out pipeline as the read view), not a WYSIWYG rich-text editor — matching the
audience (university math/CS students already comfortable writing LaTeX by hand) and avoiding the
real complexity a full WYSIWYG-with-embedded-math editor would add for comparatively little payoff
at this stage.

**✅ Built (Phase 1, `frontend/src/lib/utils/renderContent.ts`) — one real, load-bearing deviation
from the plan above, found via a live user report, not caught by the original build/check/lint/build
verification pass.** The pipeline is NOT "Markdown → HTML → typeset math over the result" as
originally sketched (step 3 above) — it's **extract and KaTeX-render every `\( … \)`/`\[ … \]`
segment FIRST, stash each result behind an inert placeholder token, run the *remaining* text through
`markdown-it`, then splice the real KaTeX HTML back in over the placeholders, and only then
sanitize.** Reason: CommonMark's own inline backslash-escape rule treats `\[`, `\]`, `\(`, `\)` as
*escaped punctuation* (backslash + ASCII punctuation → print the punctuation, drop the backslash) the
instant that text is parsed as an ordinary Markdown paragraph rather than passed through as a raw
HTML block. A chunk of the real corpus has exactly that shape — e.g. `uw-matematyka-am2-0049`'s
statement is `<p>Niech</p>\n\n\[\nf:\mathbb{R}^n\to\mathbb{R}\n\]\n\n<p>…</p>`, where the `\[ … \]`
sits as **bare paragraph text between two `<p>` blocks**, not wrapped in one itself — under the
originally-planned "typeset after Markdown" order, `markdown-it` silently stripped the backslashes
before `[`/`]` (turning `\[` into a bare `[`), while the *inner* LaTeX commands (`\mathbb`, `\to`)
survived untouched (backslash + a letter is never a CommonMark escape) — which is exactly why the
corruption looked so selective and easy to miss: `[ f:\mathbb{R}^n\to\mathbb{R} ]`, brackets stripped
of their backslashes, math commands still backslashed, rendering as inert text instead of typeset
math. Content already wrapped in literal `<p>` tags (like exercise `0001`'s original fixture) was
never affected — CommonMark's HTML-block recognition passes that content through raw, bypassing
inline escape processing entirely — which is exactly why the bug shipped past every check this app's
own build already ran (`svelte-check`, `eslint`, a full production build, and 19 Playwright
end-to-end checks, none of which happened to load an exercise whose display math sat *outside* a
literal `<p>` tag) and was only caught once a real user hit a real exercise page. Extracting math
before `markdown-it` ever sees it sidesteps the whole question of whether a given `\[ \]` block
happens to sit inside a `<p>` tag or as bare text between two of them — both are now protected
identically. **Verified afterward against the real corpus, not just the one reported exercise:** 36
of the 38 mock fixtures contain `\[ \]` display math; a full-corpus sweep plus direct HTML inspection
of exercises across all 4 courses (including the originally-reported `uw-matematyka-am2-0049` and the
originally-working `uw-matematyka-am2-0001`, to rule out a regression) all render real KaTeX with no
literal, un-rendered delimiters anywhere.

---

## 12. Content migration plan

A one-time (repeatable) Django management command, `import_legacy_corpus`, run against
`Database-of-Student-Exercise/content/` directly (that repo stays where it is, untouched — this reads
it, never writes to it):

1. Parse `content/fields/*.yaml` → `Field` rows.
2. Parse each `content/courses/<id>/course.yaml` → `Course` + `Topic` rows (topics stay course-scoped,
   matching the source data exactly), and `mapa_rozdzialow.yaml` → `Chapter` rows where present.
3. Parse each `zadania/NNNN.md` (reusing the same front-matter-plus-`##`-sections split logic already
   proven in `generator/builder.py`'s `parse_problem`) → one `Exercise` row (structural fields,
   `difficulty`/`source.type` mapped Polish→English codes: `latwe→easy`, `srednie→medium`,
   `trudne→hard`; `Ćwiczenia→exercises`, `Egzamin→exam`, `Kolokwium→midterm`) plus **one**
   `ExerciseTranslation` row with `locale='pl'`, `status='published'`, `translated_by=null` (it's the
   original, not a translation of anything) — and set `Exercise.original_locale = 'pl'`.
4. Parse each `materialy/<id>/material.yaml` + its PDF → `Material` rows, PDF re-uploaded into Django's
   own `MEDIA_ROOT`.
5. Validation mirrors `generator/builder.py`'s existing checks (unknown topic ids, duplicate exercise
   ids, missing required sections) — reuse the *logic*, not the code, since the target is Django ORM
   objects, not a JSON catalog.
6. Idempotent: re-running against updated source content should upsert by `(course, number)`, not
   duplicate — since the source repo may keep receiving edits during the migration/parallel-run
   period before it's fully retired as the content authority.

✅ **Resolved (Phase 4): retire it now, not a parallel mirror/fallback.** EdMat becomes the sole
source of truth immediately — no dual-maintenance, no ambiguity about which site is authoritative,
and nothing left to keep in sync. `import_legacy_corpus` (Phase 2) stays exactly as built: it was
already idempotent regardless of how this question was answered, so this decision required no code
change to the importer itself, only to the migration's own framing — it's now correctly understood as
a one-shot historical import, not an ongoing sync against a still-live source. Two real, concrete
changes made alongside the decision, not just a note in this document: `Database-of-Student-Exercise/`
(the static generator/site/build tooling — not `content/`, which stays vendored here for migration
provenance, see Section 17) now carries a real retirement notice — a banner at the top of its own
`README.md`, in Polish matching the rest of that repo, pointing to EdMat as the successor and telling
a future reader not to publish a new build; and `generator/builder.py`'s own page `shell()` gained the
identical notice as a persistent banner rendered into every generated page, so a rebuild-and-manually-
republish scenario (the only real publish path that project ever had — no CI/CD, Section 18 item 3)
still carries the notice even if this document itself is never consulted. The `build/` output already
sitting in that directory was regenerated once, confirmed to carry the new banner. Nothing about
`Database-of-Student-Exercise/content/` (the vendored source data this migration reads) changed — it
stays exactly where it is, untouched, as the historical record of what was migrated.

---

## 13. Technical architecture & stack

**Backend — Django + Django REST Framework** ✅ built (Phase 2), SQLite for this local/prototype
deployment (Section 18 item 5 — a real deployment would want PostgreSQL, not attempted here). DRF's
built-in `ModelViewSet` + `ModelSerializer` cover the CRUD surface for every model in Section 9
directly; nested/translated resources (an `Exercise` with its resolved-per-locale text) use small
custom serializers, matching the "resolve, fall back to original" behavior from Section 10. Auth
(Section 18 item 1, resolved): DRF `TokenAuthentication`, `SessionAuthentication` kept alongside it
for the Django admin / browsable API.

**Frontend — SvelteKit + TypeScript + Svelte 5 (runes)**, built **detached and fully mocked first**
(Phase 1), exactly matching `personalizacja_edukacji`'s own proven discipline (its Section 1/6, quoted
in spirit): every component talks to a `src/lib/services/*.ts` layer, never to the underlying data
source directly and never with its own inline fetch logic. Every service function is `async` — in
Phase 1, wrapped in an artificial delay so its *shape* already matched a real `fetch()` call; in
Phase 3 (✅ built), that internal delay was swapped for a real HTTP call to the Django API through a
new `lib/api/client.ts`/`lib/api/mappers.ts` layer — **zero route or component call sites needed to
change** to make that swap (two narrow exceptions: `login`/`register`'s own page components needed
`handleSubmit` to become `async`, since logging in now genuinely means a network round-trip — see
Phase 3's own writeup in Section 16 for the full list of what changed and why). This is the direct,
load-bearing payoff of the "frontend, then backend" build order: the frontend's own architecture was
designed so that decision cost nothing later, and it didn't.

- **i18n:** Paraglide, copied setup from `2donet` (Section 10).
- **Math:** KaTeX + `markdown-it`/`micromark` + `DOMPurify` (Section 11).
- **Theming:** light/dark/system, token-bridge pattern copied from `personalizacja_edukacji`
  (`_tokens.scss` defining `$light-*`/`$dark-*` pairs, `_theme.scss` as the only file that reads them
  and re-exposes everything as CSS custom properties, `data-theme` attribute swap, no-flash inline
  script in `app.html`) — proven working there, reused wholesale rather than redesigned.
- **Adapter:** `adapter-static` in SPA fallback mode (`{ fallback: '200.html' }`) — **kept
  unchanged through Phase 3**, a deliberate non-change: this section originally expected switching to
  `adapter-node` once a real backend existed, but nothing about the Phase 3 swap actually needs
  server-side rendering or a server `load` function — every request still originates client-side via
  `fetch()` against a separate-origin API (CORS configured for exactly this in Phase 2), so
  `adapter-static`'s SPA-fallback mode continues to be the right, simpler choice.

**Note on the `venv`/`.venv` duplication** — ✅ resolved (Phase 2, see Section 18 item 5): both
turned out stale/mismatched: rebuilt as one working `.venv`.

---

## 14. API surface (✅ built — Phase 2/3)

```
GET  /api/fields/                              list published fields
GET  /api/fields/{slug}/courses/                courses in a field
GET  /api/courses/{slug}/                       course detail (topics, chapters)
GET  /api/courses/{slug}/exercises/             filterable: ?topic=&difficulty=&source_type=&q=&lang=
GET  /api/exercises/{id}/                       resolved for ?lang=, falls back to original_locale
GET  /api/exercises/{id}/translations/          all locales + their status (for the language picker)
POST /api/exercises/{id}/translations/          submit a translation (auth required) → status=pending
GET  /api/exercises/{id}/reviews/                POST to add one (auth required)
GET  /api/exercises/{id}/comments/               POST to reply (auth required), threaded
POST /api/exercise-submissions/                  submit a new exercise (auth required) → moderation queue
POST /api/edit-suggestions/                      suggest an edit (auth required) → moderation queue
GET  /api/moderation/queue/                      pending submissions+edits+translations (moderator only)
POST /api/moderation/{kind}/{id}/approve/        moderator only
POST /api/moderation/{kind}/{id}/reject/         moderator only
GET  /api/materials/, /api/courses/{slug}/materials/
POST /api/exercise-sets/                         registered users only; guests use localStorage
GET  /api/auth/... (register/login/logout/password-reset — exact shape depends on the auth library choice, Section 18)
```

---

## 15. Frontend routing (sketch)

Locale-prefixed per Paraglide's own convention (`/{locale}/...`, matching the working `2donet` setup).
URL *segments themselves* deliberately use neutral English technical names, not the Polish domain
terms the content happens to use today (`/fields/...` not `/kierunki/...`) — a judgment call, not a
forced convention: the app is bilingual from day one, so its URL structure shouldn't quietly encode
one language as more "native" than the other.

```
/                              home — field picker, top-rated / recently-added exercises
/fields/{field}                course list for a field
/courses/{course}              exercises + materials tabs, filters (mirrors today's course page)
/exercises/{id}                exercise detail — progressive reveal, reviews, discussion, language picker
/my-set                        set builder + PDF export
/submit                        new-exercise submission form
/login /register /settings
/moderation                    queue — hidden entirely from non-moderators, not just access-denied
```

---

## 16. Build order / phased plan

Per explicit instruction: plan → frontend → backend.

- **Phase 0 (this document).** Requirements, user stories, data model, plan. ✅ this file.
- **Phase 1 — Frontend, fully mocked.** ✅ **Built — `frontend/`.** SvelteKit + Svelte 5 runes +
  TypeScript, Paraglide i18n scaffold copied verbatim from `2donet` (`en` base + `pl`, both message
  catalogs fully populated — every UI string routed through `m.*()`, none hardcoded), theming
  token-bridge copied from `personalizacja_edukacji` (light/dark/system, no-flash). Mock fixtures are
  a real, stratified 38-exercise slice of the actual corpus (`scripts/extract_mock_exercises.py`,
  reusing `Database-of-Student-Exercise/generator/builder.py`'s own parsing logic) — not synthetic
  filler, per the "use real content" instinct `personalizacja_edukacji` already validated. Every
  route/component talks only to `lib/services/*.ts` (the mock ↔ real-API boundary, Section 13).
  Every Section 6 user story has a working, mocked implementation: browse/filter/search, progressive
  reveal, KaTeX-rendered LaTeX (Markdown + raw-HTML passthrough, sanitized via DOMPurify, Section 11),
  the content-language picker independent of the interface locale (Section 10's "two axes," with one
  real English translation + one pending one seeded for the demo), star ratings, threaded discussion,
  guest + registered "My Set" with browser print-to-PDF export, new-exercise submission, edit
  suggestions, translation submissions, mocked auth (register/login/logout, demo password
  `password123`), and a moderator-only queue (approve/reject submissions, edits, translations).
  **Verified end-to-end with headless Chromium** (19 Playwright checks across multiple sessions —
  anonymous browsing, guest My Set, full moderator lifecycle, non-moderator denial, registration),
  `npm run check`/`lint`/`build` all clean. **One real bug found and fixed during verification, worth
  recording:** the exercise detail page's `$effect(() => loadAll(page.params.id!))` re-fired
  spuriously even with no navigation at all, silently reverting a just-picked content-language switch
  back to the interface locale a moment later — fixed with an id-changed idempotency guard (`if (id
  === loadedForId) return;`), applied to all three dynamic-route pages (field/course/exercise) since
  the same class of bug could otherwise resurface anywhere a `$effect` keys off `page.params`.
- **Phase 2 — Backend.** ✅ **Built — `backend/`.** Django 5.2 + DRF 3.17 + django-cors-headers +
  django-filter + Pillow + PyYAML, seven apps (`accounts`/`taxonomy`/`exercises`/`materials`/
  `community`/`moderation`/`study`, mirroring Section 9's own model groupings 1:1). Every model in
  Section 9 built exactly as sketched, plus two deliberate, flagged refinements found while
  grounding the sketch against the real corpus rather than left as gaps: `Course`/`Topic` both got
  their own translation table (`CourseTranslation`/`TopicTranslation`), matching `Field`'s own
  `FieldTranslation` pattern — the sketch's own silence on this wasn't a decision, real
  `course.yaml`/topic entries carry a Polish `name`/`description` exactly like `Field` does, so
  leaving them as untranslatable `CharField`s would have been an oversight, not a choice.
  `Material.type` was widened from the sketch's own `script`/`formula_sheet`/`other` to `script`/
  `exam_collection`/`midterm_collection`/`exercise_collection`/`other` — the real corpus's own
  `material.yaml` `type:` values (`skrypt`/`egzaminy`/`kolokwia`/`zbior-zadan`) never once produce a
  formula sheet, so the sketch's own guess didn't match reality once checked.

  **Auth (Section 18 item 1) resolved:** DRF `TokenAuthentication` (the "simple" option that section
  itself named), `SessionAuthentication` kept alongside it so the Django admin and DRF's own
  browsable API keep working in dev. `/api/auth/register/|login/|logout/|me/|password-reset/` built
  — `password-reset` is an honest stub (always returns 200, no real email backend exists yet, same
  "flag it, don't fake it" discipline this doc already applies elsewhere), the other four are real.
  "Moderator" is, for this prototype, Django's own `is_staff` flag — a coarser, adjacent concept to
  the separate verified-contributor tier Section 18 item 4 resolves (Phase 4).

  **`import_legacy_corpus` (Section 12) built and run against the full real corpus** — idempotent
  via `update_or_create` keyed by each model's own natural key, verified by running it twice in a
  row and confirming identical counts both times (no duplication). Imported: 3 fields, 4 courses, 50
  topics, 42 chapters, **742 exercises** (383 AM2 + 357 RP1 + 1 each for the two stub
  courses — matches Section 3's own per-course table exactly), 7 materials, all PDFs re-uploaded
  into `MEDIA_ROOT`. **One real, found-during-import data-quality bug in the source corpus itself,
  not in the importer's first-draft logic:** two genuinely different materials under
  `uw-matematyka-am2/materialy/` (`analiza-matematyczna-ii-cwiczenia/`, a ćwiczenia PDF, and
  `am2-skrypt-dla-debila/`, a different skrypt PDF — different `title`/`type`/`file`, confirmed by
  reading both `material.yaml`s directly) share an identical, copy-pasted `id:` value. The first
  importer draft used that `id:` field as the natural upsert key, which silently collapsed both into
  one DB row (7 files processed, only 6 `Material` rows resulted) — caught by comparing the
  command's own reported stats against a direct DB count after the first run, not assumed correct.
  Fixed by keying on the material's own directory name instead (`mdir.name` — two sibling
  directories can never collide, unlike a free-text field a source file merely claims); re-verified
  clean (7 files → 7 rows) after the fix.

  **API surface (Section 14) built essentially as sketched**, one seam ordering decision worth
  recording: `GET/POST /api/exercises/{id}/random/` is a list-level DRF `@action`, registered by the
  router *before* the `{pk}` detail route in generation order — confirmed via a direct URL-pattern
  dump that `exercises/random/` resolves to the random action and not a `pk=random` lookup attempt,
  the one real footgun this URL shape invites. `GET /api/exercises/random/` mirrors
  `lib/services/exercises.ts`'s `getRandomExercise` algorithm *exactly* (prefer-unseen-first, then a
  weighted roulette-wheel pick where weight = `1 + Σ topic-affinity`), accepting `seen=`/`affinity=`
  query params as the server-side equivalent of the frontend's own `browsingHistoryStore` — same
  algorithm, only the input's origin changes, exactly per that store's own `@mock` doc comment.

  **Verified end-to-end against the real running dev server** (not just `manage.py check`): every
  read endpoint (fields/courses/exercises/materials, `?lang=` resolution, `?q=` text search,
  `?difficulty=`/`?course=`/`?tag=` filtering, `sort=top`/`sort=recent`); the full moderation
  lifecycle — a newly `register()`ed student submits a brand-new exercise (`POST
  /api/exercise-submissions/`), a non-moderator is correctly `403`'d from `/api/moderation/queue/`,
  the moderator (`u-kasia`, seeded via a new `seed_demo_users` command mirroring
  `lib/mocks/users.ts`'s 5 identities exactly, same shared `password123`) approves it and a real,
  numbered `Exercise` + published `ExerciseTranslation` row results; an edit suggestion on an
  existing exercise's `hint` field, approved, actually mutates that field; a submitted English
  translation of a Polish original, approved, correctly supersedes as the `?lang=en` response and
  the old Polish `published` row is *not* left dangling (the `(exercise, locale, status)` uniqueness
  constraint is honored by demoting/deleting the prior published row on promotion, not erroring). A
  review POST correctly updates the exercise's own live `average_rating`/`review_count`
  (DB-annotated, not cached); a root comment plus a threaded reply both render correctly nested via
  `parent`. `ExerciseSet` creation (`POST /api/exercise-sets/`) with nested `ExerciseSetItem`s works
  for a registered user. Zero errors across the whole pass.

  **Python environment note, since it took real effort to unblock:** this sandbox has no
  `sudo`/root access and no interactive TTY (`sudo apt install python3.12-venv` fails outright
  here) — `.venv` was built via `python3 -m venv --without-pip` (succeeds without `ensurepip`) plus
  manually bootstrapping `pip` from `get-pip.py`, entirely without any system-level package install.
  Worth remembering for any future dependency needs in this same environment.
- **Phase 3 — Integration.** ✅ **Built.** Every `frontend/src/lib/services/*.ts` function's
  internals swapped from mock-store reads to real `fetch()` calls against the Phase 2 API — by
  construction (Section 13), **zero route or component files needed structural changes** beyond two
  narrow, unavoidable exceptions (below). `lib/state/mockData.svelte.ts` and the whole `lib/mocks/`
  fixture tree are deleted outright — nothing imports them anymore.

  **New client-side pieces**, all under `lib/api/` (this app's first real HTTP layer):
  - `lib/api/client.ts` — the one `fetch()` wrapper: `PUBLIC_API_BASE_URL` prefix (`.env`), DRF
    `Authorization: Token …` header injection, JSON (de)serialization, and a real `ApiError` class
    carrying the parsed DRF error body (`{field: [messages]}` or `{detail: "..."}`) so callers can
    branch on *which* field failed, not just that something did.
  - `lib/api/mappers.ts` — one JSON→TS function per domain type (Field/Course/Topic/Exercise/
    Material/Review/Comment/ExerciseSubmission/EditSuggestion/ExerciseTranslation/ExerciseSet/User),
    kept together since several services need the identical "raw exercise JSON → ResolvedExercise"
    shape (course listings, top-rated, recent, random). **id-format convention:** Field/Course ids
    stay the backend's own slug (already what both sides key URLs by — the mock's own ids were
    already slugs, so this needed zero adapter cleverness); every other id (Topic/Exercise/Review/
    Comment/User/...) is the backend's numeric PK converted via `String(n)` — opaque everywhere in
    this app, never parsed back into a number outside `lib/api/`.
  - `lib/state/token.svelte.ts` — the raw auth token, deliberately split out from `auth.svelte.ts`
    itself: `client.ts` needs to *read* it (every request's header) and `auth.svelte.ts` needs to
    *write* it (login/register/logout), and `auth.svelte.ts` itself calls `apiClient` — putting the
    token inside `auth.svelte.ts` would have been a circular import. Persisted to `localStorage`, a
    deliberate reversal of Phase 1's own "session-only" mock auth (real login now survives a reload,
    like any real app's login does — there's no longer "no real-world cost" to losing it).
  - `lib/state/auth.svelte.ts` — rewritten for real `POST /api/auth/login|register|logout/` calls
    plus a new `init()` (called once from the root layout's `onMount`) that hydrates `user` from a
    persisted token on app start. `login`/`register` are now genuinely `async` — the two narrow,
    unavoidable component changes live here: `routes/login/+page.svelte` and
    `routes/register/+page.svelte` both needed their `handleSubmit` to `await` a real network call
    instead of reading a synchronous mock result, and `register/+page.svelte` gained a real password
    field (Phase 1's mock register never asked for one — there was nothing yet for a password to
    protect). `lib/demo.ts` carries `DEMO_PASSWORD` forward from the deleted `lib/mocks/users.ts`
    purely so the login page's own "try these demo accounts" hint still renders something true.

  **Backend refinements found necessary once a real client actually had to consume these
  endpoints** — small, targeted, each with a real reason, not a redesign:
  - `DEFAULT_PAGINATION_CLASS` turned off globally (`config/settings.py`) — every real list this
    frontend calls is already bounded by construction (course-scoped, a `limit=` top-N query, one
    moderator's own queue, one user's own sets), never the "browse an unbounded feed" shape
    pagination exists for; leaving it on would have meant a `{count,next,previous,results}` envelope
    on some endpoints and a plain array on the several custom `@action`s that already bypassed it,
    a real, avoidable inconsistency.
  - `ExerciseListSerializer`/`ExerciseDetailSerializer` gained `course_slug`/`submitted_by` (List)
    and `translated_by`/`available_locales` (Detail-only — resolving these needs a full per-locale
    translation walk, so a 383-exercise course listing doesn't pay for something no list view reads).
  - `ExerciseSubmissionSerializer.course` widened from a PK-based FK to a `SlugRelatedField` — every
    other course reference this frontend already round-trips (`Course.id`, `course_slug`) is a slug,
    so submitting/reading a submission's own course needed no separate slug↔PK lookup either.
  - `moderation/views.py`'s `_apply_submission` widened to actually store the submission's full
    `source` metadata (collection/pages/chapter/original_problem_number, plus an
    `ExerciseSourceTranslation` for the source name) — the original Phase 2 version only ever
    captured `source.type`, silently dropping the rest of what a real submission form collects.
  - **A real, found-before-first-use data-model gap:** `EditSuggestion` had no `review_note` field
    at all, even though the frontend's own `EditSuggestion` type has carried an optional
    `reviewNote` since Phase 1 (matching `ExerciseSubmission`'s own shape) — a moderator's note on an
    edit-suggestion decision would have been silently discarded. Added the field, migrated, and
    fixed `ModerationActionView`'s edit-approve branch to actually save it (the reject branch already
    did, generically, via `hasattr`).
  - **A real, found-before-first-use serializer bug:** `ProfileSerializer.id` returned Profile's own
    auto-PK, not the User's — every other "user id" in this API (`Review.author`,
    `ExerciseSubmission.submitted_by`, `ExerciseTranslation.translated_by`/`reviewed_by`, ...) is a
    **User** pk, and the two sequences only happened to align by accident of insertion order (the
    `post_save` signal creating each Profile immediately after its User). Fixed with
    `id = serializers.IntegerField(source='user.id', ...)` before this was ever load-bearing enough
    to produce a wrong-user bug silently.
  - `LoginView` now resolves an email to its real username before calling Django's own
    `authenticate()` — the login form has only ever asked for an email (Phase 1's own UX, kept
    unchanged), so this is what lets that stay true against a backend whose real auth is
    username-based.
  - A new, public `GET /api/users/{id}/` (`UserPublicView`) — needed to resolve a review/comment/
    translation author's display name for anyone, not just the account owner (`getUserById`, called
    from the exercise detail and moderation pages). Deliberately blanks `email` in the response even
    though the field is still present in the shape (nothing in the UI ever reads another user's
    email, only `authStore.user.email` — the current user's own).
  - `RegisterSerializer` gained a real `validate_email` (case-insensitive duplicate check, mirroring
    the mock's own `findUserByEmail` behavior the frontend's `'emailTaken'` error path already
    expected) and an optional `preferred_locale`, so the register form's own locale picker actually
    persists onto the new Profile instead of being silently discarded.
  - `ExerciseSetSerializer` gained a real `update()` — the default DRF M2M handling for a
    `through`-model relationship would have left every `ExerciseSetItem.order` at its own default
    (0) on a `PATCH`, losing whatever order the frontend sent; written explicitly instead.
  - `lib/types/material.ts`'s `MaterialType` union widened from Phase 1's own guess
    (`'script' | 'formulaSheet' | 'other'`) to match what Phase 2's real model settled on once
    grounded against the actual corpus (`'script' | 'examCollection' | 'midtermCollection' |
    'exerciseCollection' | 'other'`) — the original guess predates that grounding pass.
  - `MaterialCard.svelte`'s download link, a deliberately non-functional placeholder since Phase 1
    ("no file server exists yet"), is now a real, working link — the Django dev server's own
    `MEDIA_ROOT` genuinely serves the PDFs now.

  **Verified end-to-end against both real servers running together** (Playwright, headless
  Chromium — not just `npm run check`/`build`): anonymous browsing of real fields/courses/exercises
  from the live API; a real difficulty filter round-trip (384 → 76 results); exercise `#51`'s real
  KaTeX rendering with zero leaked literal delimiters; registering a brand-new account (real password
  validation, a real duplicate-email rejection, session surviving a hard reload via the persisted
  token); logging in by email and having it resolve to the real seeded account
  (`u-kasia`/`password123`, `seed_demo_users`); logging out; posting a real comment, review (create
  *and* the upsert-on-resubmit path), edit suggestion, and translation, each confirmed via its own
  real `201 Created` response; the Random Exercise picker's quick-roll hitting the real
  `/api/exercises/random/` endpoint end-to-end; submitting a brand-new exercise and having a real
  moderator (`u-kasia`) see it in a real, live `/api/moderation/queue/` and approve it with **no
  reload/crash**; a non-moderator (`u-ola`) correctly denied `/moderation`; a guest's "My Set"
  resolving real exercises via per-id fetches; and a material's download link actually serving a
  real PDF byte stream from `MEDIA_ROOT`. Two real, found-and-fixed bugs surfaced by this pass, not
  assumed away: `topicIdToSlug`'s course-scoped topic-slug resolution (documented inline,
  `lib/services/exercises.ts`) and the `ProfileSerializer.id`/`EditSuggestion.review_note` gaps
  above, both caught before they ever reached a real user path, not after.

  **Deliberately unchanged:** `adapter-static` stays — Phase 1's own plan flagged switching to
  `adapter-node` as likely once a real backend existed, but nothing about this swap actually needs
  server-side rendering or a server `load` function; every request still originates client-side via
  `fetch()` against a separate-origin API (CORS already configured for this in Phase 2), so
  `adapter-static`'s SPA-fallback mode continues to be the right, simpler choice — flagged here as a
  deliberate non-change, not an oversight.
- **Phase 4 — Hardening.** ✅ **Done.** LaTeX-compatibility sweep across the full migrated corpus
  (Section 11's own ⚠️) ✅ **done, see Section 17D.** A real accessibility audit ✅ **done, see
  Section 17E.** A moderation-queue synthetic load test ✅ **done, see Section 17F** (found and fixed
  a real N+1 on both the backend and the frontend). A real multi-moderator concurrent-access test
  ✅ **done, see Section 17I** (found and fixed a real race condition in submission approval — a
  genuine `IntegrityError`/500 under simultaneous requests, not a theoretical concern). The
  `Database-of-Student-Exercise` retirement question ✅ **resolved, see Section 12 — retire now.**

**Left for a later phase, not v1, flagged so they aren't silently forgotten (both are real, working
features in the current static site — Section 3):**
- ~~Server-side "my set" sharing (a link to someone else's set, not just your own saved one).~~
  **✅ Resolved (Phase 4), see Section 17J.**
- The chapter/textbook page-map (`Chapter` model) surfaced as its own browsable UI, not just backing
  data — v1 only needs it to exist in the schema for migration fidelity.

---

## 17. Reused-assets ledger

| Source | What EdMat reuses | What it does *not* reuse |
|---|---|---|
| `Database-of-Student-Exercise` | The entire 740-exercise content corpus (Section 3); the front-matter/section schema as the `Exercise`/`ExerciseTranslation` model's own shape (Section 9); the migration logic pattern from `generator/builder.py`'s `parse_problem`/`collect` (Section 12); the "my set" + PDF-export feature as a user story (Section 6). | The static-site generator itself (`build.py`, `site/assets/*.js`) — EdMat is a real DRF+Svelte app, not a static-site generator; no admin/DB there to build on. |
| `personalizacja_edukacji` | The mocked-frontend-first build discipline and its service-layer boundary (Section 13); the community-layer shape (reviews, threaded comments, edit suggestions) adapted from external-material to exercises; the light/dark theming token-bridge pattern. | Its `EducationalMaterial`/`License`/`TraceabilityBadge` domain model — that was for aggregating external links, not hosting original content; not applicable here. |
| `2donet` / `sveltev04` | The working Paraglide/inlang i18n scaffold verbatim (config, hooks, message-catalog convention, the "never English-only" standing rule) — Section 10. | Everything else — its entire cooperative-platform ("2do.net") domain model (Projects/Tasks/Needs/Plans/RBAC/etc.) is unrelated to this project and none of it should leak in by habit just because it's the most recently-touched codebase in this environment. |

---

## 17A. Feature: the Random Exercise picker (✅ built, post-Phase-1)

A navbar dice button (`🎲`, `lib/components/layout/RandomExerciseButton.svelte`), mounted in
`Header.svelte`'s always-visible action row (not the collapsible nav, so it's reachable on mobile
too). Two real behaviors layered on one algorithm, not two separate features:

- **Click the dice icon directly** → an immediate, no-filter smart roll: navigates straight to
  `/exercises/[id]` for a randomly-chosen exercise.
- **Click the small `▾` chevron next to it** → opens a popover covering every `Exercise` field
  that's actually meaningful to filter a random pick by — Field, Course (cascading from Field),
  Topic (cascading from Course), Difficulty, Source type, Tag, and a "Verified solutions only"
  checkbox — with its own "Get random exercise" button applying whatever's selected. Deliberately
  **not** literally every model field: `id`/`number`/`createdAt`/`submittedByUserId`/`originalLocale`
  aren't sensible "give me a random exercise like ___" filter dimensions, left out on purpose, not
  overlooked — see `RandomExerciseFilters`'s own doc comment (`lib/services/exercises.ts`).

**The picking algorithm (`getRandomExercise`, `lib/services/exercises.ts`) — two "tries to," not
"always" heuristics, both soft preferences layered on top of whatever explicit filters were chosen:**

1. **Prefers an exercise the visitor hasn't opened yet.** `lib/state/browsingHistory.svelte.ts`
   (a new, localStorage-backed store, same honesty as `guestSetStore`/`themeStore` — no real
   backend to persist this to yet) records every exercise id a visitor's own exercise-detail page
   successfully loads. If at least one filtered candidate is unseen, the pool narrows to unseen
   candidates only; if every filtered candidate has already been seen, it falls back to the full
   filtered set rather than returning nothing — a repeat beats an empty result.
2. **Weights the remaining pool toward topics the visitor has actually been reading**, instead of a
   uniform random pick. The same store also counts, per topic id, how many times a viewed exercise
   touched that topic (`topicAffinity`). Each candidate's selection weight is `1 + sum of the
   visitor's own view-count for each of its topics` — a genuine weighted-random (roulette-wheel)
   selection, not a hard filter, so a low-affinity exercise can still come up, just less often.

Both signals are read fresh on every roll (`browsingHistoryStore.seenIds`/`.topicAffinity`), and
`markSeen` is called once per real navigation to an exercise (`loadAll` in
`routes/exercises/[id]/+page.svelte`) — deliberately **not** from `switchLocale` on that same page,
since reading a translation of something you're already viewing isn't a second "view" for
personalization purposes.

**`@mock` boundary, same discipline as every other service function:** `getRandomExercise`'s own doc
comment flags that `seenIds`/`topicAffinity` would become a server-side signal derived from the
authenticated user's real view history once Phase 2 exists, not values threaded in from browser
`localStorage` — the algorithm itself (prefer-unseen, then weighted-random by topic affinity)
doesn't need to change, only where its two inputs come from.

**A third occurrence justified a small extraction:** `DIFFICULTIES`/`DIFFICULTY_LABELS`/
`SOURCE_TYPES`/`SOURCE_TYPE_LABELS` were duplicated in `FiltersSidebar.svelte` and the submit-exercise
form before this feature became the third component needing the exact same lists — pulled out into
`lib/utils/labels.ts` and all three call sites refactored to import it, per this codebase's own
"three strikes" convention for when a repeated pattern earns a shared utility.

**Verified end-to-end with headless Chromium**, not just by inspection: the popover renders every
filter field; a `difficulty=hard` roll lands on a hard-badged exercise; an impossible combination
(Informatyka field + hard difficulty — that field's one real fixture is `easy`) shows the "no
match" notice without navigating; "clear filters" resets the form; and — the one that actually
exercises the personalization logic, not just the UI shell — narrowing to a real course+difficulty
combo, visiting every candidate but one, then rolling with the same filter **deterministically**
lands on the one remaining unseen exercise every time (a real, reproducible check of the "prefer
unseen" branch, not an assumption that it works because the code reads correctly).

---

## 17B. Feature: Notifications, Public Profiles, Privacy Settings, Donation Links & Cookie Consent (✅ built, post-Phase-3)

Grounded directly in EdMat's own real event set (moderation decisions, the reporting/auto-hide
system, threaded comments) rather than a generic notion of "notifications" — informed by the sibling
`2donet` project's own `Notification`/`.svelte.ts` rune-store/popover-plus-inbox architecture
(referenced explicitly per the task that drove this feature), adapted to this app's actual data
model rather than ported wholesale (no `NotificationGroup` clustering, see below for why).

### Backend — a new `notifications` app

`Notification(recipient, actor, type, target_label, exercise, note, is_read, created_at)` —
**deliberately denormalized, not a `GenericForeignKey`** the way `Comment`/`Report` resolve their
own polymorphic target: `target_label` is captured once at creation time (the "carry a label, avoid
a lookup" reasoning `2donet`'s own blueprint already documents for its `targetLabel`), and
`exercise` is a plain nullable `SET_NULL` FK — genuinely optional, since a REJECTED submission never
becomes a real `Exercise` at all, so there's nowhere real to link a rejection notification to.

**Ten real event types**, each with a real, wired trigger — not a speculative "notifications system"
with no producers:

| Type | Recipient | Trigger |
|---|---|---|
| `submission_approved` / `submission_rejected` | the submitter | `ModerationActionView` (submission decision) |
| `edit_suggestion_approved` / `edit_suggestion_rejected` | the suggester | `ModerationActionView` (edit decision) |
| `translation_approved` / `translation_rejected` | the translator | `ModerationActionView` (translation decision) |
| `comment_reply` | the parent comment's author | `ExerciseViewSet.comments` / `MaterialCoverageViewSet.comments` (a new comment has a `parent_id`) |
| `content_auto_hidden` | the content's own author/submitter | `moderation/services.py`'s `check_auto_hide`, the instant it actually fires |
| `content_restored` / `content_removed` | same | `ReportActionView` (a moderator's restore/remove decision) |

`notify()` (`notifications/services.py`) is the ONE place every row gets created — every call site
above goes through it, never constructs a `Notification` directly, so three real guards can never be
bypassed by a future call site forgetting one: `recipient=None` silently no-ops (the honest, common
case for the 742 migrated corpus exercises, which have no real `submitted_by`, and for a legacy
`translated_by=None` original), `actor == recipient` silently no-ops (nobody gets notified of their
own decision), and — the real, load-bearing piece — a **privacy-preference check**
(`_PREFERENCE_FIELD_FOR_TYPE`) that means turning a category off in Settings means that TYPE of
`Notification` row is **never created in the first place**, not merely hidden client-side after the
fact. `ModerationActionView._notify_decision` is the one shared helper for the 3-kind × 2-outcome
decision matrix (approve/reject × submission/edit/translation), rather than repeating the same
recipient/label lookup six times over.

**No `NotificationGroup` clustering, unlike `2donet`'s own architecture — a deliberate, flagged
deviation, not an oversight.** `2donet`'s own reasoning for grouping ("Ania and 2 others replied to
your comment") answers a real problem at ITS event volume; EdMat's real per-user volume (a handful of
moderation decisions, occasional replies) doesn't warrant the added complexity yet — a plain
reverse-chronological list is honest and sufficient. Flagged explicitly in the model's own doc
comment so a future session doesn't assume this was forgotten rather than deliberately deferred.

### Backend — `Profile` grows privacy & notification-preference fields, plus `DonationLink`

Four new `Profile` booleans: `show_profile_publicly` (default `True`) and three `notify_on_*` fields
(`comment_reply`/`moderation_decision`/`content_action`, all default `True`). `show_profile_publicly`
gates the DEDICATED public profile page's *extra* info only (join date, role badges) — **never
basic attribution** (a comment/review byline, `display_name`/`avatar` on `GET /api/users/{id}/`),
since hiding *that* would break every comment/review/submission byline throughout the app, not just
the profile page. `PublicProfileSerializer` was rewritten as its own serializer (not inheriting
`ProfileSerializer`, Phase 3's original version was) specifically so the `notify_on_*` fields — a
stranger's own private settings — simply never appear in a public response's `Meta.fields` at all,
rather than needing an exclude-after-the-fact. `MeView` gained a real `PATCH` (self-service editing,
narrowly scoped via `ProfileUpdateSerializer` — `id`/`email`/`is_moderator`/`is_verified_contributor`
stay whatever they already are, the same "moderator-granted, not self-service" discipline
`RegisterSerializer` already established for those same two role fields).

**`DonationLink`** — "users can set multiple donation links that [a visitor] can choose from," per
the explicit follow-up request mid-build, then refined again ("payu, blik, paypal, card, apple pay,
google pay, but also buy coffee or whatever") into a real, curated `platform` choice field (PayPal/
PayU/BLIK/card/Apple Pay/Google Pay/Buy Me a Coffee/Ko-fi/Patreon/GitHub Sponsors/bank transfer/
other) rather than pure free text — lets the frontend render a recognizable icon/name per platform
while an optional `label` still allows a custom override (e.g. distinguishing two PayPal links) or a
fully custom name when `platform='other'`. A `DonationLinkViewSet` (self-service CRUD, always scoped
to `request.user.profile` via `get_queryset`, never a `profile` id accepted from the client) backs
the settings page's own editor; `PublicProfileSerializer.donation_links` embeds the list on
`GET /api/users/{id}/`. **Shown regardless of `show_profile_publicly`, deliberately** — that flag
withholds identity/activity info a visitor didn't ask this account to publish; a donation link is the
opposite, something the account holder actively chose to add specifically so it WOULD be shown. A
private profile with zero donation links simply has none to show; adding one is itself the opt-in.

A latent Phase-3 gap fixed while touching these views: `MeView`/`RegisterView`/`LoginView` all
manually instantiate `ProfileSerializer` without passing `context={'request': request}` — harmless
today (every demo account's `avatar` is `null`), but DRF's `ImageField` needs request context to
serialize an absolute URL rather than a bare relative media path; fixed at the same time, before it
was ever load-bearing enough to produce a broken avatar URL silently.

### Frontend

`notifications.svelte.ts` — a Svelte 5 rune module, this app's now-Nth `.svelte.ts` global-state
module (alongside `theme.svelte.ts`/`auth.svelte.ts`/`token.svelte.ts`/`browsingHistory.svelte.ts`).
**Deliberately does NOT import `authStore`**, even though "is logged in" would be the obvious guard
for `refresh()` — `auth.svelte.ts` would need to import THIS module right back to clear it on logout
(a real circular import), so every call site is instead responsible for its own
`{#if authStore.isAuthenticated}` guard, which they all already needed anyway (`Header.svelte`'s
bell, the root layout's mount, `/notifications` itself). `cookieConsent.svelte.ts` follows the exact
same rune-module idiom, persisted via a REAL cookie (`lib/utils/cookies.ts`, SSR-guarded the same way
`theme.svelte.ts`'s own `localStorage` reads already are) rather than `localStorage` — deliberately,
since a consent *decision* is the one thing in this app that could plausibly matter server-side one
day, the same reasoning Paraglide's own pre-existing `PARAGLIDE_LOCALE` cookie already uses a cookie
for locale persistence rather than `localStorage`.

**The cookie-consent banner discloses something real, not an invented placeholder category.** Before
this feature, nothing in this app had ever told a visitor that Paraglide's own i18n scaffold
(`en`/`pl`, copied verbatim from `2donet`, Section 10) already sets a real, load-bearing
`PARAGLIDE_LOCALE` cookie — a genuine, pre-existing thing worth disclosing, not a category invented
for this feature. The "Analytics & non-essential" category is honestly empty — EdMat sets no
tracking/analytics cookie today — flagged as forward-looking rather than gating something real,
matching `2donet`'s own precedent for its identically-empty category.

`NotificationBell.svelte`/`NotificationPopover` (folded into the bell component)/`NotificationCard`
— the same "anchored popover, `bind:this` container + a window click/keydown listener" pattern
`RandomExerciseButton.svelte` already established, reused rather than invented a second way. A real,
found-live bug fixed during end-to-end verification, not shipped broken: clicking "Mark all read"
drives `unreadCount` to 0 synchronously, which un-renders the very button just clicked (its own
`{#if unreadCount > 0}` guard) — by the time the bubbled window-level click listener ran,
`event.target` was already detached from the DOM, so `container.contains(event.target)` always read
`false`, misreading a legitimate inside click as an outside one and slamming the popover shut before
the "view all" link could ever be reached. Fixed with `event.composedPath()` (captured once at
dispatch time, stable regardless of any DOM mutation a listener along the way causes) instead of
`.contains()` — the standard fix for this exact class of bug, not a one-off workaround.

A second real bug, also caught live: the root layout's own `onMount` only fires once, on the very
first page load — logging in later in the SAME session (not a fresh reload) never re-triggered a
notification fetch, so the bell's unread badge stayed stale until a visitor happened to open it
themselves at least once. Fixed by calling `notificationStore.refresh()` directly from
`login/+page.svelte` and `register/+page.svelte`'s own success handlers, right after `authStore`
confirms the session — the same class of fix, at the same layer, as the fix already documented in
Phase 1's own "id-changed idempotency guard" note for a different `$effect` timing bug.

`routes/users/[id]/+page.svelte` — a new public profile page, same "`$effect` keyed off
`page.params`, with an id-changed idempotency guard, no `+page.ts`" pattern the exercise/course
detail pages already establish (this app has no server-rendered-auth story to back a real load
function, Section 13/16). Comment/review author names throughout the app (`CommentNode.svelte`,
`ReviewList.svelte`) now link here — previously plain, non-interactive `<span>`s.

### Verified end-to-end

**Backend**, live, multi-user, via `curl` against the running dev server (not just `manage.py
check`): every one of the ten notification types triggered for real and delivered to the correct
recipient — submission approve/reject, edit-suggestion approve/reject, translation approve, a
comment reply (plus the preference gate proven both ways: turning `notify_on_comment_reply` off
suppressed a reply notification that a re-enabled preference then correctly let through), a real
auto-hide (3 distinct reporters + 3 recorded `ContentView`s, `actor: null` confirmed for the
system-triggered case), a self-moderated restore (correctly suppressed by the `actor == recipient`
guard — a real, intentional no-op, not a bug), and a cross-user remove (a moderator removing another
user's already-auto-hidden review, confirmed delivered with the right `actor`/`note`). `PATCH
/auth/me/` confirmed to update real fields and silently ignore a `is_moderator: true` self-escalation
attempt. `DonationLink` CRUD confirmed with real ordering, `display_label` resolution, cross-account
protection (a 404, not a 403, matching the queryset-scoping-not-permission-checking pattern), and
public embedding — including the privacy interaction specifically (`show_profile_publicly=False`
correctly blanks `joined_at`/role badges while `donation_links`/`display_name` stay fully visible).

**Frontend**, headless Chromium (`playwright-core` driving a cached browser binary, since this
sandbox has neither a full `playwright` install nor a running X server) — 21 real end-to-end checks
across three isolated browser contexts: the cookie banner's full lifecycle (shows on first visit,
Accept-all hides it, the real cookie persists across a hard reload); Ola logging in and seeing a
correct unread badge **immediately**, with no manual bell click needed (the login-refresh fix,
verified against a freshly self-seeded comment reply so the check is idempotent across reruns rather
than depending on a prior run's own side effects); the popover opening, showing real messages, Mark
All Read working end-to-end through to the full `/notifications` inbox (the composedPath fix,
verified); Michal's public profile showing his real 3 donation links with correct icons/labels; a
comment author byline resolving to a real `/users/[id]` link; and the full settings-page loop for a
third account (Bartek) — toggling privacy off, confirming the public profile correctly shows the
private notice while the display name still renders, toggling back on, then adding and removing a
real donation link through the UI. `npm run check`/`lint`/`build` and `manage.py check` all clean
throughout.

### Per-type notification granularity (✅ built, Phase 4)

The three coarse `notify_on_*` booleans above were, until now, the ONLY lever a user had — "mute all
moderation-decision alerts" meant losing all six of `submission_approved`/`submission_rejected`/
`edit_suggestion_approved`/`edit_suggestion_rejected`/`translation_approved`/`translation_rejected`
at once, with no way to peel off just one. `Profile.muted_notification_types` (a `JSONField`, plain
list of `Notification.type` strings, new migration `0004_profile_muted_notification_types`) is a
second, finer layer on TOP of the three booleans, not a replacement for them — `notify()`
(`notifications/services.py`) checks the coarse category FIRST and still short-circuits everything
under it when that's off, then checks this list SECOND, so muting a specific type only ever peels one
thing off an otherwise-active category, never the reverse. `notify_tag_followers` gained the
identical check for `new_tagged_content` specifically — that type has no coarse category at all (its
real gate is each follower's own per-tag `TagFollow.notify`, unchanged), so this is a genuine, new
capability: an account-wide "never notify me about ANY newly-tagged content" override, layered on top
of (not replacing) the per-tag choice the "my followed tags" settings section (above) already offers.

`notifications/services.py` gained one small, deliberate refactor alongside the new field: `_PREFERENCE_FIELD_FOR_TYPE`'s own
9 entries plus `new_tagged_content` are now also exposed as `NOTIFICATION_TYPES`, a single list built
FROM the existing dict (not a second, hand-maintained copy) — the one place a future notification
type should be registered, so nothing has to independently remember to update both the coarse-gating
dict and the fine-grained catalog. The frontend mirrors this same 10-type catalog by hand in
`lib/utils/labels.ts`'s new `NOTIFICATION_TYPE_CATEGORY`/`NOTIFICATION_TYPE_LABELS` — flagged
in-line as the one place drift between backend and frontend could creep in if a type is ever added
without updating both, the same "mirrored small enum" convention `DONATION_PLATFORMS` already
established in the same file, not a new pattern invented for this.

Frontend: the settings page's existing Notifications section gained a nested "fine-tune" checkbox
list under each of the two multi-member coarse categories (moderation-decision: 6, content-action:
3 — `commentReply` has no sibling in its own category, so its existing coarse checkbox already says
everything a per-type row would, no redundant single-item list added for it), plus a standalone row
for `newTaggedContent` since it has no parent category. The fine-tune list for a category collapses
when that category's own coarse checkbox is off (there's nothing to fine-tune once the whole thing
is muted already) — re-checking it correctly reveals the sub-list with whatever per-type mutes were
already set still intact, confirmed live, not assumed. `mutedTypes` is a `SvelteSet`, not a plain
`Set` in `$state()` — this project's own `eslint-plugin-svelte` config (`svelte/prefer-svelte-
reactivity`) flags calling `.add()`/`.delete()` on a bare `Set`, caught by a real lint failure during
this build, not a stylistic choice made up front; `SvelteSet` is reactive to in-place mutation
directly, so the toggle handler never needs to reconstruct-and-reassign the whole collection the way
`TagChip.svelte`'s own `addedIds`/`MaterialCard.svelte`'s `removedTags` (both plain-Set-via-spread,
which never call a mutating method directly and so never tripped this same rule) do elsewhere in
this app — three genuinely different, all-correct answers to "how do I hold a small reactive set,"
each fitting how it's actually used.

**Verified end-to-end, not just by inspection.** Backend, direct: muting one specific type inside an
otherwise-active coarse category correctly suppressed only that type (`notify()` returned `None`)
while a sibling type in the SAME category still fired normally; turning the whole coarse category off
correctly suppressed everything under it regardless of the per-type list; the new account-wide
`new_tagged_content` override correctly suppressed a tag-follow notification even with the relevant
`TagFollow.notify` still `True`, and correctly stopped suppressing once un-muted. Frontend, a real
headless-browser run against the live app: both fine-tune sub-lists render with the correct 9 labels
total; unchecking one specific type, saving, and reloading the page confirmed the mute genuinely
persisted server-side (not just a local UI state); unchecking the parent category correctly collapsed
its own sub-list, and re-checking it correctly restored the sub-list with the earlier per-type mute
still shown, unaffected by the toggle. `npm run check`/`lint` and `manage.py check` all clean
throughout.

## Courses, overhauled — many admins, contributed content, chapters, invite links (built)

The course feature above shipped with exactly one privileged person, content only its instructor
could add, no grouping, and no way in except asking. Four things changed, and they interlock.

### Many people run one course (`CourseStaff`)

`TaughtCourse.instructor` stays as the denormalized owner — every existing byline, listing and
`mine=teaching` filter already reads it — but permissions now come from a real `CourseStaff` row per
person. **Three roles, not a boolean**, because the useful distinction is not "trusted or not" but
which job somebody was brought in to do: an `assistant` curates content and acts on participants, an
`admin` also changes the course itself and its staff, and the `owner` additionally can delete it.

- **The owner row is real data, not an implied special case**, so `role_of()` is one lookup with no
  "…or the instructor field" branch at every call site. A partial unique index enforces one owner per
  course in the database rather than in whichever view remembers.
- **`TaughtCourse.save()` creates it, not the viewset.** The first attempt put it in `perform_create`
  and 16 existing tests broke — the honest signal that "every course has an owner" is an invariant of
  the model, since seed commands, fixtures and the admin create courses too. Every one of them would
  otherwise have produced a course nobody, including its author, had any permission over.
- **The owner can never be demoted or removed through the API.** A course whose owner a co-admin could
  evict is a course that can be taken hostage, and it would leave nobody able to grant roles back.
- **Promoting a participant retires their enrolment**, so one person never counts twice against
  capacity — the same rule `enrollment_block_reason` already stated for the instructor, now true for
  every member of staff.
- Eight scattered `instructor_id == user.pk` checks became `can_administer` / `can_curate` /
  `is_staff_member`, each picked for what that endpoint actually guards. That scattering is precisely
  the shape that goes wrong when a second kind of privileged person appears.

### Content can be contributed, and usually waits (`CourseItem`)

One model for two jobs that turn out to be the same job: staff filing content into a chapter, and a
participant offering something for review, differ only in what `status` starts as. Splitting them
would mean an approved contribution became a different row, losing who submitted it — the single most
useful thing to keep.

`contribution_policy` is `staff` / `approval` / `open`, defaulting to **`approval`** because it is the
only value safe to pick on somebody's behalf: an unattended course neither accepts strangers' uploads
silently nor silently refuses a participant who has something worth adding.

- **Content is referenced, never copied**, exactly as `Lesson` already does — a corrected exercise
  stays corrected everywhere and a course never becomes a diverging fork of the corpus.
- **Staff never queue behind themselves**: approving your own upload is a click that means nothing,
  and it would make the review queue mostly noise.
- **A pending item is visible to staff and to its own submitter, and to nobody else.** The submitter
  half matters: somebody who submits and then cannot find their material assumes it failed.
- **Every member of staff is notified**, not the owner alone — a queue that notifies one person is a
  queue that stalls whenever that person is away.
- A rejection carries a reason. Two partial unique constraints (not one over both columns) stop the
  same thing being added twice, because NULLs do not compare equal in SQL.

### Chapters, and dates that open them (`Chapter`)

Time-gating lives on the chapter rather than on each item, because that is how a course is actually
run: "week 3 opens on the 14th" is one decision about a group of things, and setting the same date
nine times is nine chances to get it wrong.

**A locked chapter still renders** — title, description and unlock date — while its contents do not.
Hiding it entirely would make a course look shorter than it is, and "there is a week 3 and it opens on
the 14th" is information a participant should have. Staff read it early, and are still told it is
shut, because they are the people who have to prepare it. `unlocks_at = NULL` means never gated, which
is genuinely different from a date that has passed.

Deleting a chapter keeps its content, unfiled — the deletion is a statement about the grouping, not
about what somebody put in it, which is why `CourseItem.chapter` is `SET_NULL`.

### Invite links (`CourseInvite`)

A token addressed directly (`/api/course-invites/<token>/`), not nested under a course id, because
somebody holding a link has the token and nothing else — that is what makes it shareable.

- **It bypasses the approval queue** — the sender already made that decision — but **never capacity**.
  Quietly seating an invited guest over the limit would break the promise the limit makes to everybody
  already in. The use count is incremented under `select_for_update`, so two people racing for the
  last use cannot both win.
- **`owner` is deliberately not an invite role.** Transferring a course is a decision about a named
  person, never something left lying in a URL.
- **Revoking is a timestamp, not a delete**, so a dead link keeps its use count and the record of who
  killed it.
- The preview is **readable logged out** — telling somebody to sign up without saying what for is how
  an invite gets ignored — and deliberately thin: a title and who runs it, never the roster or the
  content, because the token travels through group chats. The page is `noindex`.

### Also this round

The course author's name in the header is now a **link to their profile**. Split into a prefix plus
the name rather than interpolating one message, since only the name should be the link; safe for both
locales here because "Run by {name}" and "Prowadzi {name}" both end in the placeholder. The card in
listings deliberately keeps plain text — the whole card is already an `<a>`, and nesting anchors is
invalid HTML.

### Verified

**493 backend tests** (86 in `classroom`, up from 51) and **`e2e/classroom-overhaul.mjs`, 29 browser
checks, zero console/page errors**: a co-admin editing but not deleting, a locked chapter legible to
both sides, a contribution invisible until **the co-admin** (not the owner) approved it, a link
previewed logged out then followed into the course, and a revoked link refused. `e2e/classroom.mjs`
re-run: **44/44, no regressions**. `npm run check`: 0 errors, 0 warnings. `npm run build`: clean.

One diagnosis worth recording: the pre-existing browser script began failing at registration
mid-session with no code change involved. It was the real per-IP registration throttle, exhausted by
this session's own runs — the app working as designed. Restarting the API clears the cache it lives
in. Also, editing files while a browser script runs triggers a Vite HMR reload underneath it and
produces failures that look like regressions and are not.

### Left open, not built

- **No people search**, so adding staff is by account id from a profile URL. The honest stopgap, but
  the first thing a real deployment would need.
- **No content picker**: contributing is likewise by material/exercise id. The submit flow for genuinely
  new uploads is still the existing `/submit-material`, untouched.
- **Chapter locking does not reach lesson content.** A material inside a locked chapter is still
  reachable if staff also attached it to a lesson. That is a configuration somebody chose rather than a
  bypass, but the two surfaces do not know about each other.
- **Chapters cannot be reordered or edited in place** from the UI — only created and deleted. `order`
  and `description` exist on the model and in the API.
- **No transfer of ownership**, by design for now: the owner row is immutable through the API, so
  handing a course over needs a real "transfer" action that does not exist yet.
- **An invite cannot be edited** — no changing its expiry or use count after minting. Revoke and mint
  another.
- **Unlock dates have no timezone UI.** The input is the browser's local time and the API stores an
  aware datetime; a course run across timezones would want to say which one it means.

### Left open, not built

- **Real-time/push delivery and email** — see Section 18 item 9's own detailed writeup (Django
  Channels vs. SSE, Web Push, and the shared missing piece with `PasswordResetView`'s own stub: a
  real email backend). Deliberately documented, not built, per the explicit "to do info" request.
- **No `NotificationGroup`-style clustering** — a plain list, deliberately, see the note above.
- **No donation-link reordering UI** — `order` exists and is honored by the public display, but
  there's no drag-and-drop; a newly-added link just appends after whatever's already there.
- ~~**No avatar upload UI anywhere** — `Profile.avatar` predates this feature and stays untouched;
  only its URL-resolution correctness (the missing `context={'request': ...}` fix above) changed.~~
  **✅ Resolved, see Section 17Q** — built with a real crop step, and with the file validation the
  field had entirely lacked. Worth noting *why* this stayed safe in the meantime: the complete
  absence of a write path is the only reason a validation-free `ImageField` was never exploitable,
  which is exactly why the checks had to land in the same change as the feature.
- **`NOTIFICATION_TYPE_CATEGORY`/`NOTIFICATION_TYPE_LABELS` (frontend) is a hand-maintained mirror
  of the backend's own `NOTIFICATION_TYPES` catalog, not fetched from an endpoint** — a real, if
  small, drift risk flagged in both files' own comments rather than silently left unstated; a
  dedicated read-only endpoint would remove the risk entirely but felt disproportionate for 10 rarely
  -changing rows, the same "mirror it by hand, flag the risk" call this codebase already made for
  `DONATION_PLATFORMS`/`SOURCE_TYPES`.

---

## 17C. Feature: Expanded Material Types, and the Tag Hover-Menu — Follow / Notify / Save for Later / Add to Different Content (✅ built)

Two grounded features, built together since the second (a real Follow/Notify/apply system) is what
finally gives `Material.tags` — added here, not before — somewhere real to attach.

### Expanded material types

`MATERIAL_TYPE_CHOICES` (`backend/materials/models.py`) grew from the original 5 (all derived
narrowly from what the 7-material real corpus happened to contain) to 13: `formula_sheet` (restored
from the very first Section 9 sketch — dropped once, only for not matching the tiny original
corpus, not because it's a bad category), `lecture_slides`, `solution_guide`, `syllabus`,
`practice_test`, `recording`, `textbook_excerpt`, `code_dataset`, alongside the original 4 real
corpus types + `other`. **A real, found gap closed alongside the expansion, not left invisible:**
`Material.type` was never rendered ANYWHERE in the frontend before this — an expanded-but-invisible
enum would have been a hollow improvement, so `MaterialCard.svelte` now shows a real type badge
(`MATERIAL_TYPE_LABELS`, `lib/utils/labels.ts`, matching the existing `DIFFICULTY_LABELS`/
`SOURCE_TYPE_LABELS` convention).

### `Material.tags` — the same free-form vocabulary Exercise already has

A plain `ManyToManyField` to `exercises.Tag` (`related_name='materials'`), read-only on
`MaterialSerializer` — Material has no create/update endpoint at all (`MaterialViewSet` is a
`ReadOnlyModelViewSet`), so the only way a tag is ever attached is the new tag-hover menu's own
"add to different content" action, never through `MaterialSerializer`'s own write path.

### The tag-hover action menu (`TagChip.svelte`)

Every tag pill throughout the app (previously a bare, non-interactive `<span>`, both on the exercise
detail page and now on `MaterialCard.svelte`) is a `TagChip` — hover-to-open with a leave-delay (so
crossing from the pill into the menu itself doesn't close it), plus click-to-toggle as the
accessible/touch fallback (touch has no hover at all). Four actions, each resolved as follows,
grounded in what this app already has rather than invented fresh:

- **Follow / Unfollow** — a new `exercises.TagFollow(user, tag, notify)` model. `notify` is a
  **separate, mutable** control from following itself, not the same toggle — following puts a tag
  on a "followed tags" list regardless of whether you want to be pinged, `notify` (default `True`
  the moment you follow, independently togglable afterward without unfollowing) is what actually
  gates whether new tagged content produces a real `Notification`. Read directly off the request's
  own wording ("follow, set notifications") as two related but distinct actions, not one toggle.
- **Save for later** — bulk-adds every exercise carrying this tag into the CURRENT working set
  (`guestSetStore`, the same client-side store `ExerciseCard.svelte`'s own single-exercise "add to
  set" button already writes to) — reusing the exact mechanism a per-exercise save already uses,
  not a second, parallel one. Works for guests too, since the working set already does.
- **Add to different content** — `AddTagToContentModal.svelte`: a course-agnostic search
  (`searchExercises`/`searchMaterials`, both new — neither existed as a cross-course lookup before
  this needed one) across Exercises or Materials, applying the tag on selection via a new
  `POST/DELETE /api/tags/{slug}/apply/` endpoint. Open to any authenticated user, not
  moderation-gated — the same trust level `MaterialCoverage`'s own community proposals already get
  (additive, reversible, low-stakes organizational metadata, not content itself).

**New notification type, `new_tagged_content`** — the one type in this app whose recipient is a
*follower*, not a participant in the underlying event. `Notification` gained a second, symmetric
`material` FK (nullable, `SET_NULL`, same shape as the existing `exercise` one) since a followed tag
can now land on either content type. `notify_tag_followers()` (`notifications/services.py`) is
called from both real trigger points — a moderator approving a submission whose payload carries tags
(`_apply_submission`), and the new tag-apply endpoint itself — and is gated by each follower's own
`TagFollow.notify` flag directly in its own loop, **deliberately not** through `notify()`'s existing
account-level `_PREFERENCE_FIELD_FOR_TYPE` gate (2.14's own note: that's for a blanket account-wide
category; a per-tag mute is a narrower, different axis).

### A real, load-bearing `apiClient` gap closed along the way

`apiClient.delete()` never accepted a request body — every pre-existing caller only ever deletes by
id-in-URL. The tag-apply endpoint's own `DELETE` (removing a tag from a specific piece of content)
needs to carry `{kind, object_id}`, the same shape its `POST` sibling already sends. Widened
`delete<T>(path, data?)` to match `post`/`patch`'s own signature — `fetch()`'s own `RequestInit.body`
already works with any HTTP method, this was just never plumbed through until a real caller needed it.

### Verified end-to-end

**Backend**, live via `curl`: follow/unfollow, muting/unmuting notifications on an existing follow
(confirmed both directions — muted correctly suppresses, unmuting correctly lets a later apply
through), applying and removing a tag on both an Exercise and a Material, the new `?q=` material
search, and the full 13-value expanded type enum.

**Frontend**, headless Chromium (`playwright-core`) — 13 real end-to-end checks: a material card
shows its real type badge and a real clickable tag chip; hovering a tag chip on the exercise detail
page opens the menu; Follow flips to Unfollow and reveals the Notify checkbox (checked by default);
unchecking it and using Save for later correctly grows the real `localStorage` working set with an
honest "Added N" confirmation; and Add to different content opens a real modal, returns real search
results, and marks a picked result as Added after a real `POST`. `npm run check`/`lint`/`build` and
`manage.py check` all clean throughout.

### Left open, not built

- ~~No UI for removing an already-applied tag~~ **✅ Resolved (Phase 4).** `TagChip.svelte` gained
  an optional `appliedTo: { kind, objectId, onRemoved }` prop — both real call sites
  (`exercises/[id]/+page.svelte`, `MaterialCard.svelte`) already had the exercise/material id in
  scope, so nothing new needed fetching. A "Remove this tag" row (danger-toned, matching this app's
  own destructive-action color convention) appears in the hover menu whenever that context is
  present and the viewer is authenticated, calling the `removeTagFromContent` service function that
  already existed, unused, at the API-client layer — only the UI affordance was ever missing, as
  originally noted. The exercise detail page updates its own owned `exercise.tags` state directly on
  removal; `MaterialCard` (a plain, possibly-shared `material` prop, not owned state — it renders in
  both a feed/grid and a detail context) uses a local session-only "removed this round" `Set`
  overlay instead, the same subtract-shaped sibling to its own pre-existing `coverageOverlay`
  add-shaped pattern. Verified end-to-end with real logged-in requests on both an Exercise and a
  Material — a scratch tag applied via the API, removed through the actual rendered menu in a real
  headless-browser run (confirmed the real `DELETE` request fired and the chip disappeared), and the
  backend row confirmed genuinely gone afterward, not just hidden client-side. A real, pre-existing
  interaction quirk was found (not introduced) while building this test, worth recording rather than
  silently working around: `TagChip`'s hover-to-open then click-to-toggle behavior means a
  synthetic/automated click on the trigger ITSELF re-closes a menu hover just opened (Playwright's
  own `.click()` hovers before clicking, hitting this) — harmless in real usage, since a real user
  who's just hovered the trigger open clicks a menu ITEM next, never the trigger again, but flagged
  here since it's a genuine, if narrow, edge case in the pre-existing component, not something this
  pass's own changes touched.
- ~~No "my followed tags" dashboard/settings-page list~~ **✅ Resolved (Phase 4).** A new
  `TagFollowsEditor.svelte` component, embedded as its own "Followed Tags" section on `/settings` —
  the same "a dedicated editor embedded as a settings section" shape `DonationLinksEditor` already
  established (list + per-row actions, no new route or nav link needed), not a separate top-level
  page. Lists every followed tag with its own notify checkbox and unfollow (×) button, both reusing
  `tagFollowStore`'s existing mutation methods unchanged (`setNotify`/`unfollow` — the exact same
  ones `TagChip`'s own hover menu already calls), plus a "Save all for later" quick action reusing
  the identical bulk-add-to-working-set mechanic the hover menu's own row already offers. The only
  new surface needed was a `list` getter on `tagFollowStore` (`Object.values(follows)`) — every
  other consumer only ever needed a per-tag lookup, which is why enumerating the whole set hadn't
  been exposed until this needed it. Verified end-to-end with real follows created via the live
  API and a real headless-browser run: the list renders both tags correctly, toggling notify
  off and unfollowing one both fire real requests and are reflected correctly in the database
  afterward — not just the local UI. One real, self-inflicted bug caught and fixed during this same
  verification pass, not shipped broken: two new message keys were added to `en.json`/`pl.json`
  *after* an intermediate `paraglide-js compile` had already run, so the generated messages were
  briefly stale and the settings page threw `m.settings_tagsHeading is not a function` — caught by
  the same page's own body-text sanity check this app's own accessibility script already established
  (Section 17E), not silently missed; recompiling once more with every key present resolved it.
- ~~`new_tagged_content` notifications about a Material have no link~~ **✅ Resolved (Section 17G's
  own material detail page).** `NotificationCard.svelte` now resolves `notification.materialId` to
  `/materials/[id]` — this bullet had gone stale (the material page it was waiting on already shipped
  a separate session) and is corrected here rather than left misleading.
- ~~`applyTagToContent` has no de-duplication warning in the UI~~ **✅ Resolved (Phase 4).**
  `AddTagToContentModal.svelte` already had everything it needed to know this ahead of time — both
  `ResolvedExercise`/`Material` search results already carry their own real `tags: string[]` (the
  same field `TagChip` itself already reads), so no backend change was needed, just checking it
  before the button ever renders as clickable. A result that already carries the tag now shows a
  plain, non-interactive "Already tagged" label instead of "Add" — genuinely pre-empting the
  confusing interaction (clicking Add and seeing "Added" appear as if it were new) rather than just
  reacting to it after the fact with a toast. Deliberately kept "Already tagged" (a pre-existing
  fact) visually and textually distinct from "Added" (the same session's own just-clicked
  confirmation) — collapsing the two into one label would have lost exactly the honesty this item
  asked for. Verified end-to-end with real, live search results: a result already carrying the tag
  correctly showed no clickable button at all; a genuinely untagged result still showed a normal,
  clickable "Add" that correctly transitioned to "Added" once clicked, confirming the ordinary flow
  wasn't disturbed by the new check.

---

## 17D. Phase 4: the LaTeX/KaTeX compatibility sweep (✅ done)

The first item in Phase 4 hardening, and the specific "real, mechanical check... not assumed clean"
Section 11 has flagged as owed since Phase 1. Two independent checks, both against the FULL real
corpus (not a sample), both ending in a genuine zero — not a check that was skipped because it
seemed likely to pass.

**A new, permanent Django management command, `dump_text_fields`**
(`backend/exercises/management/commands/dump_text_fields.py`) — dumps every `ExerciseTranslation`'s
`title`/`statement`/`hint`/`answer`/`solution` and every `MaterialTranslation`'s `title`/
`description`, across every locale and status, as one JSON blob (`--out`, default
`/tmp/edmat_text_fields.json`). Kept as a real, reusable command rather than a one-off script — a
corpus-wide compatibility check is exactly the kind of thing worth re-running after any future bulk
import or edit, not something to hand-roll again from scratch each time. Run against the real,
current database: **756 rows** (749 exercise + 7 material translations).

**A new, permanent frontend script, `frontend/scripts/check_katex_compatibility.ts`** (`npm run
check:katex`) — the actual check, and the reason `tsx` (`^4.23.1`) was added as a new devDependency:
it **imports `renderContent`/`renderTitle` directly from the real
`frontend/src/lib/utils/renderContent.ts`**, not a duplicated, driftable re-implementation of that
pipeline's logic. Scans every field's rendered output for two real failure signatures: a
`.katex-error` element (KaTeX's own `throwOnError: false` behavior for a malformed/unsupported
command never throws, it renders visible red error text instead), and a literal, unprocessed `\(
\) \[ \]` delimiter surviving into the output. **A real false-positive class was found and fixed
while building this checker, worth recording so it isn't rediscovered from scratch:** KaTeX's own
`<annotation encoding="application/x-tex">` element faithfully echoes the raw TeX SOURCE back into
the DOM (for accessibility/copy-paste) — and this corpus's real, legitimate `\\[2mm]`-style LaTeX
line-break-with-spacing syntax (routine inside `cases`/`array` environments, used throughout the
corpus's real piecewise-function exercises) contains the substring `\[` as its own 2nd/3rd
characters once written that way. The checker strips `<annotation>...</annotation>` content before
running the leftover-delimiter regex, so "KaTeX correctly rendered this and is just quoting its own
source back" is told apart from "a delimiter genuinely never got processed." Result against the
full, real corpus: **"Checked 756 translation rows across the corpus. Found 0 field(s) with a real
rendering issue."**

**A second, independent real-browser spot-check** — headless Chromium (`playwright-core`, a
pre-cached binary, since this sandbox has no global `playwright` install) driving 43 real live
exercise pages (every exercise id the original false-positive investigation had flagged, plus a
spread across the full id range), clicking each page's own Show hint/answer/solution buttons
(content that doesn't render into the DOM until revealed) and scanning the real, live DOM for the
same two signatures. This check exists specifically to catch anything the static Node-based check
can't — real DOMPurify sanitization (`renderContent.ts` explicitly no-ops that step outside a real
`window`), and any real browser-specific KaTeX rendering quirk. **The identical false-positive class
reappeared here too, for a related but distinct reason:** `textContent`/`allTextContents()` (the
first version of this check) picks up KaTeX's own visually-hidden-but-DOM-present `<annotation>`
text regardless of its CSS visibility; `innerText` respects visibility the same way a real reader's
own eyes would, and was the fix. Result: **"Checked 43 real exercise pages in a live browser. 0 had
a real issue."** (This spot-check script remains scratchpad-only, not committed — the permanent,
committed, re-runnable asset is the static `check_katex_compatibility.ts`/`dump_text_fields`
combination above; the real-browser pass was a one-time, deeper confirmation of the same conclusion,
not a second ongoing tool.)

**Conclusion: the corpus is genuinely KaTeX-compatible, corpus-wide, confirmed twice over, not
assumed.** Section 11's own long-standing ⚠️ is resolved. Re-run `check:katex` (after a fresh
`dump_text_fields`) any time the corpus changes meaningfully — a bulk import, a batch edit, a large
wave of new community submissions.

## 17E. Phase 4: a real accessibility audit (✅ done)

The second Phase 4 hardening item, per Section 8's own "keyboard-navigable filters/forms,
sufficient contrast in both themes" non-functional requirement — a real, mechanical audit against
the actual running app, not a manual eyeball pass or an assumption that the framework/component
library gets this right by default (there is no component library here — every element is
hand-written).

**A new, permanent frontend script, `frontend/scripts/check_accessibility.ts`** (`npm run
check:a11y`) — drives real headless Chromium (`playwright-core`, the same pre-cached binary the
KaTeX sweep's own browser spot-check already uses) against the app's real, running dev servers and
runs the real **axe-core** engine (`axe-core`, a new devDependency, injected in-page via
`page.addScriptTag`) directly against the live DOM, both anonymous and authenticated (a real
moderator session, seeded by logging in for real against the backend and writing the resulting
token to `localStorage` under `token.svelte.ts`'s own real persistence key). Covers every route in
Section 15's own routing sketch plus the two Section 17B additions (`/users/[id]`,
`/notifications`) — 12 distinct pages, plus a 13th: the exercise-detail page audited a *second*
time with its hint/answer/solution sections actually clicked open (Section 7's progressive-reveal
requirement means that content never enters the DOM until interacted with, so auditing only the
collapsed state would silently skip it). Deliberately targets the **richest real course** across
every field (most exercises, resolved by walking the real `/api/fields/`→courses→exercises graph
at runtime, not hardcoded) rather than one of the two 1-exercise stub courses (Section 3) — a
meaningful, content-heavy page, not a near-empty one that would trivially pass.

**A real false-negative risk was found and guarded against while building this, not assumed away:**
a page that silently fails to render (a thrown error mid-mount, a blank 404) would trivially "pass"
axe-core with zero violations simply because there's nothing left on the page to audit — the exact
same class of blind spot the KaTeX sweep's own real-browser spot-check already had to guard
against, for the identical underlying reason. The checker tracks console/page errors and a real
body-text-length sanity floor (80 chars — the header/nav chrome alone already clears this on any
real render) per page, and treats either signal as its own hard failure, separate from and in
addition to axe's own violations.

**That guard immediately caught a real, if minor, gap, not a false alarm:** every audit run showed
an intermittent `console error: Failed to load resource: ... 404` on the very first page of a
fresh browser context, never on any subsequent page in the same run. Traced to a genuine cause, not
assumed: `curl http://localhost:5174/favicon.ico` really does 404 — `frontend/static/` was
completely empty, and `app.html` had no `<link rel="icon">` at all, so a browser's own implicit
first-navigation favicon probe was failing for real, on every fresh session, just not always
observed by a `page.on('response')` listener depending on exactly when in the navigation it fired.
**Fixed with a real, permanent asset**, not suppressed: `frontend/static/favicon.svg`, reusing the
header's own "∫" brand mark and `$light-accent` teal, wired via a real `<link rel="icon">` in
`app.html`. Re-verified clean across 3 consecutive fresh-browser runs after the fix (previously
intermittent, ~1-in-8 runs) — confirmed present in the real production `adapter-static` build
output (`build/favicon.svg`, `build/200.html`'s own `<link>` tag) too, not just the dev server.

**Real axe-core violations found and fixed, not just infrastructure:**

- **`color-contrast` (serious) — the "Verified solution" badge and every button/border sharing its
  color token.** `$light-status-success` (`#1a8a4a` on `#e5f6ec`) measured at **3.92:1**, below the
  4.5:1 WCAG AA threshold for normal-size text. Every other status-pill color pair
  (danger/warning/info) was spot-checked at the same time, not just the one axe happened to render
  on the audited pages, and all three already cleared 4.5:1. Fixed by darkening the token to
  `#146e3b` (**5.63:1**, real margin, same green hue) — one token-level fix that cascaded correctly
  to every real consumer sharing it (`VerifiedBadge`, the moderation queue's own "Restore" button,
  `TagChip`, `CoverageVoteWidget`, `/my-set`, `/settings`), confirmed by axe reporting zero
  remaining `color-contrast` violations anywhere in the app afterward, not just on the one badge
  first flagged. The dark-theme counterpart was checked too (composited against its own semi-
  transparent badge background) and was already fine (7.74:1) — left untouched.
- **`landmark-unique` (moderate) — the main nav and every breadcrumb nav.** Four `<nav>` elements
  app-wide (`Header.svelte`'s `.site-nav`, plus a `.breadcrumb` nav on the field/course/exercise
  detail pages) all shared the same missing-accessible-name problem — two or more unlabeled `<nav>`
  landmarks are indistinguishable to a screen-reader user navigating by landmark. Fixed with two new
  i18n message keys (`nav_mainNavigation`/`nav_breadcrumb`, both locales, per this doc's own
  "never English-only" standing rule) wired as `aria-label` on all four elements.
- **`aria-required-children` (**critical**) — the moderation queue's own tab switcher.** `role="tablist"`
  on a `<div>` whose children were plain `<button>`s with no ARIA role at all — an invalid ARIA
  tree, not a cosmetic issue. Fixed with a real, complete WAI-ARIA tabs pattern: each button gained
  `role="tab"`/`id`/`aria-selected`/`aria-controls`, and the (previously four separate, now one
  shared, since only one is ever rendered at a time) tab content area became a real
  `role="tabpanel"` with `aria-labelledby` tracking whichever tab is actually active.
- **`heading-order` (moderate) — the same moderation queue, `<h1>` jumping straight to `<h3>` per
  queue item with no `<h2>` between them.** Not a cosmetic linter-pleasing fix: the active queue
  section (Reports/New exercises/Edit suggestions/Translations) genuinely IS a level-2 section of
  "Moderation queue," and each item's own title genuinely nests under it — the document outline was
  wrong, not just under-labeled. Fixed with a real `<h2>` (visually hidden via this codebase's own
  existing `mix.visually-hidden` SCSS mixin/per-component convention — the tabs' own active-state
  styling already communicates the same boundary visually, so the heading text doesn't need to be
  seen too, only present in the DOM for heading-navigation).

**Verified end-to-end, not assumed from the fixes reading correctly:** re-ran the full, hardened
checker three consecutive times after every fix — **"Audited 13 pages (0 had a load problem). 0
critical/serious violation node(s), 0 moderate/minor violation node(s)"** every time, against the
real, richest course (`matematyka`/`uw-matematyka-am2`, 383 exercises) with hint/answer/solution
genuinely revealed. `npm run check`/`lint`/`build` all clean throughout, including the production
`adapter-static` output.

### Left open, not built

- **`axe-core` catches roughly a third of real WCAG issues by its own documented design** — it's a
  real, load-bearing first pass (and this one found four genuine bugs, not zero), not a substitute
  for a manual keyboard-only walkthrough or a screen-reader smoke test (NVDA/VoiceOver), neither of
  which was performed here.
- **No color-blindness simulation** — contrast ratios were checked and fixed for luminance, not for
  any specific color-vision-deficiency simulation.
- **The exercise-detail page's authenticated state (logged-in review/comment composer, "add to my
  set" button) wasn't separately audited** — only its anonymous state, plus the anonymous revealed
  hint/answer/solution state. The Notifications/Settings pages already cover the bulk of this app's
  real authenticated-only UI surface, but a logged-in exercise-detail visit specifically wasn't
  added as its own 14th audit target.
- **The checker takes roughly 1–2 minutes per run** (walking every field/course/exercise via real
  API calls to find the richest content, then a real page load + axe run for 13 pages) — a real,
  known cost of the "audit the real, running system" choice, not something to optimize away by
  reintroducing the false-negative risk a hardcoded/stub target would bring back.

## 17F. Phase 4: the moderation-queue synthetic load test (✅ done)

The third Phase 4 hardening item — seed a real, large, realistic-shaped pending backlog and measure
`GET /api/moderation/queue/` and the `/moderation` page under it, specifically to verify or refute
`moderation/services.py`'s own `build_report_queue()` docstring, which used to claim its per-target
N+1 query pattern was "fine at this app's real scale." It wasn't — the measurement refuted that
claim outright, and this item's real work was fixing what it found, not just reporting it.

### Seeding — a real, permanent, manifest-tracked tool

**`backend/moderation/management/commands/seed_moderation_load_test.py`** (`manage.py
seed_moderation_load_test [--reports N] [--submissions N] [--edits N] [--translations N]
[--clear]`) — seeds real, distinct rows against the real, already-migrated 742-exercise corpus
(never synthetic filler exercises of its own): ~200 pending Report **groups** (the unit
`build_report_queue()` actually iterates, not raw rows — real Comments/Reviews used first, since
there's a limited real supply of both, the rest filled with real Exercises; ~20% of groups get 2-3
reports from distinct demo users so the aggregation logic is exercised for real, not just the
single-reporter case) plus 60 each of pending ExerciseSubmissions/EditSuggestions/
ExerciseTranslations. Every row created is tracked by primary key in a manifest file
(`/tmp/edmat_loadtest_manifest.json`) — `--clear` deletes **exactly** those rows and nothing else,
regardless of what real pending items a moderator or an earlier verification pass left behind in
the same tables. Real run: 242 Report rows across 198 groups, 60/60/60 of the other three — a
substantial, realistic backlog, not a toy sample.

### Measurement — a real, permanent tool, not a one-off

**`backend/moderation/management/commands/measure_moderation_queue.py`** (`manage.py
measure_moderation_queue`) — uses `CaptureQueriesContext` (forces query logging regardless of
`settings.DEBUG`, the correct tool for this, not a `DEBUG=True` workaround) to measure the real SQL
query count and wall-clock cost of `build_report_queue()` alone and the full
`build_moderation_queue_payload()` response (the exact function `ModerationQueueView.get()` itself
calls now — see below), against a stated, real threshold (under 1000ms / 300 queries reads as
"FINE" for a moderator-only, low-traffic admin page; this app has never claimed to optimize for
high-concurrency throughput).

**Before any fix:** `build_report_queue()` alone — **820 SQL queries, 1452ms**, for 198 report
groups. The full moderation queue response — **879 queries, 1542ms**. Both verdict: **CONCERNING**.
The docstring's own "fine at this app's real scale" claim was wrong, not confirmed.

### The real fix — `build_report_queue()` rewritten from O(4·N) to O(few)

`build_report_queue()` (moderation/services.py) was doing, per report GROUP: a `model.objects.get()`
to resolve the target, a separate `Report.objects.filter(...)` for the reasons list, an
`exercise.views.count()` for the viewer-pool percentage, and (via `_describe`) an
`exercise.translations.filter(...)` to resolve the title — 4 real queries × 198 groups. Rewritten to
do a small, fixed number of BULK queries instead: one target-resolving query per involved kind (at
most 3 — Exercise/Comment/Review — never one per group), one bulk `ContentView` count aggregate, one
bulk `ExerciseTranslation` fetch, and one bulk "reasons" fetch grouped in Python. The one deliberate
exception, not chased further: a Comment's own generic `target` (which Exercise's viewer-pool it
borrows) still costs one real query per COMMENT-kind group — Comments are the minority target kind
in this app's real data (Exercise/Review resolve for free from the bulk fetch), and fully
eliminating that last handful would mean bulk-prefetching an arbitrarily-recursive
`GenericForeignKey` chain for a marginal additional gain over the real, measured win of collapsing
`O(4·N)` into `O(few + comment_count)`.

**Rigorously verified for correctness, not just re-measured for speed** — a real requirement for any
query-optimization refactor, since a faster function that returns wrong data is worse than a slow
correct one. The pre-edit implementation was extracted from git history under a renamed function and
run against the exact same live DB state as the new one; the first diff found a real, genuine bug
the rewrite introduced (`view_count` read `None` instead of `0` for an exercise with zero recorded
views — a real, meaningful distinction this app's own percentage calculation depends on, conflated
by a bare `.get(pk)` instead of `.get(pk, 0)`), fixed, and re-diffed to a clean **"MATCH: every row
identical... sort order identical: True"** across all 198 real groups, `last_reported_at` included.

**A second N+1 found and fixed in the same pass:** the full queue response's own submissions list
used `ExerciseSubmissionSerializer.course` (a `SlugRelatedField`, resolving `.course.slug` per row)
with no `select_related('course')` — a real, separate per-row query for all 60 pending submissions.
Fixed alongside the report-queue rewrite.

**Deduplicated the two query-building paths, not left as two copies that could silently drift:** the
same logic `ModerationQueueView.get()` runs now lives in one place —
`build_moderation_queue_payload()` (moderation/services.py) — imported and called identically by
both the real view and `measure_moderation_queue`, so there's only ever one real code path to keep
correct/optimized, not a hand-copy in the measurement tool that a future fix to the view could
silently stop reflecting.

**After the fix:** `build_report_queue()` alone — **33 queries, ~91-131ms**. The full moderation
queue response — **32 queries, ~103-160ms**. Both verdict: **FINE**. A real ~25× query reduction, a
real ~15× wall-time reduction, against the exact same 198-group seeded backlog. Confirmed live
against the real running server too, not just the internal measurement: `GET
/api/moderation/queue/` via `curl` — **210ms** end-to-end HTTP round trip, correct counts, `view_count:
0` (not `null`) correctly present for a genuinely zero-view exercise.

### The frontend's own, separate N+1 — found while verifying the real page, not assumed fixed

Fixing the backend alone left the real `/moderation` page rendering in **10.4–16 seconds** on a
fresh load — a real, substantial gap between "the backend responds in ~200ms" and "the page is
actually usable" that a purely backend-side measurement would have missed entirely, which is exactly
why this item's own instruction was to measure the PAGE, not just the endpoint. Investigated
methodically, not guessed: a real A/B test (temporarily bypassing `DOMPurify.sanitize()` in
`renderTitle`, re-measuring, restoring) ruled out title-rendering cost as the cause (~11s either
way); a real network trace found the actual cause — `moderation/+page.svelte`'s own `load()`
function was resolving every distinct Exercise referenced by a pending edit-suggestion or
translation via `Promise.all(exerciseIds.map((id) => getExerciseById(id, 'pl')))`, firing **115
individual `GET /api/exercises/{id}/` requests** under the real seeded backlog — a frontend-side N+1
the exact same shape as the backend one, just never measured before because nothing had previously
exercised the moderation queue at real volume.

**Root cause traced to an assumption that was true for its original caller, but not for a second one
that started relying on the same function without re-checking it.** `getExercisesByIds` (a
pre-existing helper, `lib/services/exercises.ts`) already did this exact N-fetch fan-out — its own
doc comment explicitly reasoned "a set [My Set] is typically a handful of exercises... simple and
fast enough rather than adding a bespoke bulk endpoint for one caller." True for My Set's own
real-world scale; the moderation page never actually called this shared helper at all — it had its
own separate, inline copy of the identical N-fetch pattern, which is what let the assumption go
unchallenged even as this session's own load test proved it wrong at real scale.

**Fixed with a real bulk endpoint, not a workaround:** `GET /api/exercises/bulk/?ids=1,2,3&lang=pl`
(new `@action(detail=False)` on `ExerciseViewSet`) — resolves every requested id in one request,
using `ExerciseDetailSerializer` (not the lighter List shape `list()` uses — My Set's own real PDF
export needs the full statement/hint/answer/solution content, and sharing one endpoint for both
callers is simpler than a second, narrower one for a difference that's already cheap once genuinely
bulk-optimized). `getExercisesByIds` was rewritten to call it (one request instead of N); both real
callers — My Set and the moderation page, the latter now routed through the shared helper instead of
its own separate inline copy — benefit, not just the one that motivated the fix. Deliberately does
**not** call `ContentView.get_or_create` the way `retrieve()` does — a bulk resolve for a queue
listing or a study sheet isn't a real "viewed this exercise's own detail page" event.

**A second, serious, latent correctness bug found and fixed while building the bulk endpoint, before
it ever shipped:** `ExerciseDetailSerializer`'s own translation-resolution helper cached its result
on `self` (`self._cached_translation`) — safe for the two single-instance callers that existed
before (`retrieve()`, `random()`), but silently **wrong** the instant this serializer is used with
`many=True`: DRF's `ListSerializer` reuses **one shared child serializer instance** across every row
(`self.child.to_representation(item)` per item), so every exercise past the first in a bulk response
would have shown the *first* exercise's own statement/hint/answer/solution instead of its own — a
real data-integrity bug, not a performance one, caught specifically because this new `bulk` endpoint
was the first place this serializer was ever used with `many=True`. Fixed by caching on the per-row
`obj` instead (a real, distinct object per row) — verified live: 115 real exercises resolved through
the bulk endpoint, every title confirmed genuinely distinct, none repeated.

**Fully query-optimized, not just correctness-fixed, verified by direct measurement rather than
assumed from reading the field list:** unified `title`/`resolved_locale`/`statement`/`hint`/
`answer`/`solution`/`translated_by`/`available_locales` onto one shared, per-object-cached,
prefetch-cache-friendly translation resolver (reading `obj.translations.all()`, which Django serves
from a `prefetch_related('translations')` cache with zero extra queries when the caller requests
one, rather than `.filter(status='published')`, which always issues a fresh query regardless of any
prefetch). The `bulk` action's own queryset adds `select_related('course', 'source')` +
`prefetch_related('translations', 'topics', 'tags', 'source__translations')` — every relation the
Detail serializer touches. Measured directly (`CaptureQueriesContext`) against the real 115-id set:
**5 queries total, 125ms** — a fixed, small cost independent of row count, not a reduced-but-still-
per-row one.

**End-to-end result, verified via real headless-Chromium network traces, not assumed from the
backend numbers alone:** backend API requests fired by one `/moderation` page load dropped from
**127 to 13** (the 115 individual exercise fetches collapsed into the one `bulk` call); zero
console/page errors; every edit-suggestion/translation row's title confirmed real, correctly
resolved, and non-blank. Full page render time (all 198 report items in the DOM) improved from a
consistent **10.4–16s down to a consistent ~5.6–7.3s** — a real, roughly 2× improvement, verified
across multiple repeated runs, not a one-off measurement.

**The remaining ~5.6-7.3s was investigated, not left unexplained, and found to be dev-tooling
overhead unrelated to anything this item could further fix.** Profiling isolated it precisely:
`/api/auth/me/` — the very first request any page fires — took over 4 seconds to even begin
resolving under Playwright's own network trace, yet the exact same request measured **28-59ms** via
a direct, isolated `curl` call. Testing three entirely unrelated, simple pages (`/`, `/fields`,
`/login`) with a fresh browser context showed the identical multi-second-before-first-request
characteristic, confirming this is Vite's own dev-server cold module-graph compilation cost per
fresh browser session — not a `/moderation`-specific problem, not a backend query cost (already
independently measured at ~100-200ms via `curl` and `CaptureQueriesContext`, both outside any
dev-server bootstrap path), and not present in the real production build (`npm run build`, already
verified clean throughout this work). Flagged honestly rather than chased further or silently
omitted from the numbers.

### Cleanup

The seeded synthetic backlog was cleared via `manage.py seed_moderation_load_test --clear` once
measurement and verification were complete — the manifest-based deletion removed exactly the 242
Report rows / 60 submissions / 60 edits / 60 translations this command created, confirmed by
re-checking pending counts landed back at the exact real baseline (1/0/1/1) from before seeding. Both
management commands stay in the repo as real, permanent, reusable tools — re-run
`seed_moderation_load_test` then `measure_moderation_queue` after any future change to the
moderation-queue logic, the same "worth re-running, not a one-time audit" discipline the KaTeX
sweep's own tooling already established.

### Left open, not built

- ~~`build_report_queue()`'s one remaining real query-per-group case (Comment targets resolving
  their own generic `target`) was deliberately left as-is~~ **✅ Resolved, follow-up pass.** Bulk-
  resolved one hop further down, the same "group by content type, bulk-fetch by kind" pattern
  already used for the top-level report targets — a Comment's own `content_type_id`/`object_id`
  are plain columns already on the fetched row, no query needed to read them. Re-measured against a
  real seeded backlog (197 report groups, 22 of them real Comment-kind targets): `build_report_queue()`
  alone dropped from 33 queries to **13 queries** (~69ms). Correctness re-verified the same rigorous
  way as the original rewrite — a live diff against the exact pre-edit implementation on the same DB
  state, 0 mismatches across all 197 rows, sort order and `last_reported_at` both identical. The one
  case still genuinely per-object (a Comment whose own target is ANOTHER Comment, a real recursive
  chain) is deliberately left as a single real query rather than a third bulk-fetch layer — not
  present in this app's real data today (every real Comment targets an Exercise or a
  MaterialCoverage directly), resolved correctly via the original `resolve_view_scope_exercise` for
  the rare case it ever does occur, not silently dropped.
- ~~No real load-testing with actual volunteer moderators — this environment has no real moderators
  to recruit; the synthetic seeded backlog is a real, substantial stand-in, but a genuine multi-user
  concurrent-access test (several moderators acting on the same queue at once) wasn't and couldn't be
  performed here at the time this note was originally written.~~ **✅ Resolved, see Section 17I** — a
  real simulated version (genuinely simultaneous requests, not mocked), which found and fixed a real
  race condition this note's own absence of testing had left undetected.
- **The Vite dev-server cold-load overhead (~3-5s per fresh browser session, confirmed general, not
  moderation-specific) is unaddressed, deliberately** — it isn't present in the production build,
  and isn't caused by anything this item's own scope (backend queries, frontend request fan-out)
  covers.
- **`getExercisesByIds`'s own doc comment previously reasoned specifically about My Set's small
  scale** — that reasoning is now genuinely outdated by the fix (the function is bulk-optimized for
  any real scale now), and the comment was rewritten to reflect the real history, not left
  contradicting the code underneath it.

## 17G. Feature: the material detail page (✅ built)

The one real gap Section 17C's own "Left open" list had explicitly flagged: "This app has no
standalone material detail route at all (confirmed: none exists anywhere in `routes/`)... A real
fix would need a material detail page first, out of scope for this feature." Built now,
`routes/materials/[id]/+page.svelte`.

**A genuinely thin route, not a rebuild — every real piece it needs already existed.** The backend's
`GET /api/materials/{id}/` (`materials/views.py`'s `MaterialViewSet`, already a real
`ReadOnlyModelViewSet`), the frontend's own `getMaterialById` service (`lib/services/materials.ts`),
and — the actual reason this page's own body is so small — `MaterialCard.svelte` itself, which
already renders everything a material has: title, description, a type badge, every coverage claim
(topic/subtopic/level, with `CoverageBadge`/`CoveragePopover`/`CoverageVoteWidget`, vote counts, and
a per-claim discussion thread), tags (via `TagChip`, the follow/notify/save-for-later hover menu),
and a real, working download link. The page reuses this same component directly rather than
re-implementing any of it — the same "one card component, reused at a different weight/context"
economy `ExerciseCard`/the exercise detail page already establish.

**Follows the exact same route pattern every other detail page in this app already uses** — a plain
`+page.svelte` (no `+page.ts`, this app's own established "no server-rendered-auth story to back a
real load function" reasoning), an `$effect` keyed off `page.params.id` with the same id-changed
idempotency guard the exercise detail page's own Phase 1 bug fix already established (a plain
`$effect(() => loadAll(page.params.id!))` re-fires spuriously even with no navigation), a real
breadcrumb (Home → Field → Course, `aria-label={m.nav_breadcrumb()}` — the same accessible-landmark
fix Section 17E already applied to every other breadcrumb in this app), and a real not-found state
for an id that doesn't resolve.

**`MaterialCard.svelte` gained a real `linkTitle` prop** (default `true`) — before this, its title
was a bare, non-navigating `<h3>` everywhere, including on the course page's own Materials grid,
which had no way to reach a material's own page at all even once one existed. `linkTitle={true}`
(the course-page grid's own default) wraps the title in a real `<a href={resolve('/materials/[id]',
...)}>`, matching `ExerciseCard`'s own established title-link convention exactly; the new detail
page itself passes `linkTitle={false}` — linking a material's own title back to the very page it's
already on would be a pointless, confusing self-link, not a real navigation affordance.

**Closes a second, explicitly-flagged real gap in the same pass:** `NotificationCard.svelte`'s own
`newTaggedContent` template used to fall through to a non-navigating, mark-as-read-only card the
instant a followed-tag notification targeted a Material instead of an Exercise, with its own doc
comment stating plainly why ("this app has no standalone material page to link to at all"). Now
resolves `notification.materialId` to a real `resolve('/materials/[id]', ...)` link, the same as
`notification.exerciseId` already did.

**One new i18n key** (`material_notFound`, both `en.json`/`pl.json`, per this app's own "never
English-only" standing rule) — every other string the page needs (`common_home`, `common_loading`,
`nav_breadcrumb`, `material_heading`, `common_appName`) already existed.

### Verified end-to-end against the real running app, not assumed from the code alone

Headless Chromium (`playwright-core`): direct navigation to a real material (`/materials/1`) renders
the correct title, a correct three-level breadcrumb (Home › Matematyka › Analiza Matematyczna II),
and a real download link; a non-existent id (`/materials/999999`) shows the real "Material not
found." message, not a crash; clicking a material's title from the course page's own Materials tab
correctly navigates to `/materials/1` and renders the same content a direct visit does — the whole
point of wiring `linkTitle` in, confirmed as a real click-through, not just an href string check;
the detail page's own title correctly renders WITHOUT a self-link (`linkTitle={false}` verified,
0 `.material-card__title-link` elements present there, vs. 1 present on the course page's grid).

**The `newTaggedContent` → Material link verified through the real backend flow, not faked:** a real
`TagFollow` (Kasia following a fresh test tag) and a real `notify_tag_followers()` call (Michał
"applying" that tag to a real material) produced a genuine `Notification` row with `material_id`
set; logging in as Kasia and opening `/notifications` showed the real notification with a working
`/materials/1` link, and clicking it landed on the real material page with the correct title. All
test data (the tag, the follow, the notification) was cleaned up afterward, confirmed removed.

`npm run check`/`lint`/`build` and `manage.py check` all clean throughout.

### Left open, not built

- **No material-level top-level discussion** — this app's real backend only ever gave a Material's
  own per-`MaterialCoverage`-claim discussion a comment endpoint (`MaterialCoverageViewSet.comments`);
  there is no `GET/POST /api/materials/{id}/comments/` for the material as a WHOLE the way an
  Exercise gets. The new detail page doesn't invent one — it shows exactly what the real API
  supports (coverage-level discussion, via the same `CoveragePopover` the card already had), not a
  fabricated top-level thread with nothing real backing it.
- **No star-rating/review system for materials** — `Review.exercise` is a real, direct FK (Exercise
  only, Section 9's own data model), not generic; materials were never in scope for that system, and
  this page doesn't add one.

## 17H. Feature: real-time notification delivery via SSE (✅ built)

Closes the last item from the explicit "Phase 4 then, material detail page, then real-time
notification delivery" directive, and the specific gap Section 18 item 9 already documented in
detail: before this, a new `Notification` row was only ever discovered on the next explicit fetch
(a page mount, opening the bell, a fresh login) — `notify()` genuinely created it, but nothing told
a connected browser tab it existed. Built exactly per that item's own recommendation: **Server-Sent
Events, a DB-polling loop, no Django Channels/Redis** — the lighter of the two real options that
section's own writeup weighed, chosen for the same reason stated there: SSE is a single long-lived
HTTP response DRF can serve directly, no new infrastructure dependency, whereas Channels would be a
real architectural addition (a second server process, a channel layer) disproportionate to this
app's own real event volume.

### Backend — `GET /api/notifications/stream/?token=...`

`NotificationStreamView` (`notifications/views.py`) — a plain DRF `APIView` whose `get()` returns a
raw `StreamingHttpResponse` directly (DRF's own `finalize_response` only touches an `isinstance(...,
Response)` object, so a raw Django response passes through completely unmodified — confirmed, not
assumed, by real end-to-end testing). The generator polls `Notification.objects.filter(recipient=
user, id__gt=last_id)` every `SSE_POLL_INTERVAL_SECONDS` (3s), yielding each new row as a real SSE
`data:` frame (`NotificationSerializer`'s own JSON, unchanged), and a `: keep-alive` comment line
between polls (the standard SSE practice for connections behind a proxy — none exists in this dev
setup, but it's correct regardless of deployment). Capped at `SSE_MAX_CONNECTION_SECONDS` (600s) —
`EventSource`'s own native auto-reconnect (using the `retry: 3000` directive the stream's first
frame sends) makes this a bounded, invisible reconnect rather than a real interruption, and it's
what keeps a long-idle connection from holding a Django dev-server thread open forever. Only
notifications created *after* the stream opens are ever sent — the client's own initial `GET
/api/notifications/` (unchanged, still the one place full history loads) already covers everything
older.

`notify()` itself, the `Notification` model, and every existing call site (moderation decisions,
auto-hide, comment replies, tag-follow pushes) are **completely unchanged** — this hooks in as a
pure reader of the same table every other notification surface already reads, exactly the "no
redesign of how/when a notification gets created" property Section 18 item 9 already called for.

**The honest limitation, stated plainly rather than oversold:** "real-time" here means a new
notification becomes visible within `SSE_POLL_INTERVAL_SECONDS`, not literally the instant it's
created — a genuine, bounded latency from DB-polling, not true push. Verified concretely: a
notification created mid-test, with the browser tab never touched, appeared in the UI within 4
seconds with zero manual action.

**The token-in-query-param auth tradeoff, documented honestly, not silently accepted** — exactly as
Section 18 item 9 already flagged this would be needed. `QueryParamTokenAuthentication`
(`notifications/views.py`) reads the token from `?token=...` instead of the `Authorization` header,
because the browser's native `EventSource` API cannot set custom request headers *at all* — a real,
permanent limitation of that API, not a workaround for something DRF could otherwise do. A token in
a URL can end up in server access logs, browser history, and a `Referer` header in a way a header
never does — mitigated two real ways: this authentication class is wired onto **only** this one
view, never added to the global `DEFAULT_AUTHENTICATION_CLASSES` (every other endpoint keeps
requiring the real, header-based token); and the code's own doc comment names the better real fix (a
short-lived, purpose-scoped SSE ticket minted just before opening the stream) as a genuine follow-up
this prototype's own auth infrastructure doesn't yet support, not a solved problem.

### A real bug found and fixed during browser verification, not shipped broken

Manual `curl` testing of the raw endpoint looked completely correct — real, live, incrementally-
flushed SSE frames, a genuinely working push when a notification was created mid-stream. **A real
headless-browser test caught what `curl` couldn't**: `EventSource` sets `Accept: text/event-stream`
on every request it makes, a header `curl`'s own default `Accept: */*` never sends — and DRF's
content negotiation, which runs *before* `get()` is ever called, was rejecting that exact header
with a **406 Not Acceptable**, since neither of the view's default renderers (`JSONRenderer`,
`BrowsableAPIRenderer`) declared `text/event-stream` as an accepted media type. Reproduced
deterministically (`curl -H "Accept: text/event-stream"` → 406, confirming the exact browser
behavior) before fixing it — not just patched and hoped. Fixed with a real, minimal
`EventStreamRenderer` (declares `media_type = 'text/event-stream'`, its own `render()` is never
actually called since this view bypasses DRF's render step entirely — it exists purely to satisfy
negotiation), added to `NotificationStreamView.renderer_classes`. Re-verified with the exact same
`Accept` header afterward: a real, correctly negotiated, long-lived 200 stream.

### Frontend — `EventSource`, wired into the existing store, not a new UI

`connectNotificationStream(token)` (new export, `lib/services/notifications.ts`) — a thin,
one-line `EventSource` construction, matching this app's own "the service layer owns every real
fetch/connection, components/stores never touch one directly" discipline. `notificationStore`
(`lib/state/notifications.svelte.ts`) gained a private `connectLiveStream()` (opens the connection
once, parses each `message` event through the existing `mapNotification`, and prepends the result to
`items` — deduplicated against a same-id race with a manual `refresh()`) and now calls it from
inside `refresh()` itself, rather than requiring every one of `refresh()`'s three real call sites
(root layout mount, login, register) to separately remember to also connect the stream — a single,
robust integration point instead of three places that could drift.

**Imports `tokenStore` (`token.svelte.ts`), deliberately not `authStore`** — the exact same
"avoid a circular import" reasoning this module's own pre-existing doc comment already gave for
never importing `authStore` directly. `token.svelte.ts` is a genuinely dependency-free leaf module
(its own doc comment: "has no dependency on either, breaking the cycle"), so importing it here
carries zero risk, while still getting the raw token this feature needs.

**`clear()` (called from `logout()`) now also closes the live connection**, not just the local
cache — a real correctness property, not a nicety: without it, a stream authenticated as the
*previous* account would keep running (or silently fail to reconnect as a new one) after the session
that opened it had already ended. Verified precisely: exactly one SSE connection opens per login;
zero new stream requests fire in the 4 seconds following a real logout (proving the connection was
genuinely closed, not merely left to auto-reconnect, which *would* have produced a new request).

### Verified end-to-end, headless Chromium against the real running app, not assumed from the code alone

A real notification created **entirely server-side, mid-test, with the browser tab never touched** —
no click, no manual refresh, no reload — correctly appeared in the reactive unread-count badge
(`1` → `2`) within the poll interval, confirmed via the exact DOM element the badge actually renders
(`.notification-bell__toggle .badge`), not a loose selector that could have matched something else.
Zero console/page errors on the post-fix run (the pre-fix run's own single error was the 406 above,
confirming the fix closed the actual gap rather than one unrelated to it). All test notifications
created for verification were cleaned up afterward, confirmed removed. `npm run check`/`lint`/
`build` and `manage.py check` all clean throughout.

### Left open, not built

- **Email delivery** — the *other* piece of infrastructure Section 18 item 9 already flagged as
  missing (a real `EMAIL_BACKEND`, the same gap `PasswordResetView`'s own honest stub has had since
  Phase 2) remains unbuilt. Wiring one up would unblock both gaps at once, per that section's own
  note — not attempted here, since this directive's own scope was specifically the SSE piece.
- **Browser/OS-level push** (a notification even when the tab isn't open) still needs the Web Push
  API — a service worker, a stored push subscription per browser, `pywebpush` server-side — real,
  meaningfully more infrastructure than in-app delivery, and only worth it once there's a concrete
  reason a visitor needs to know without the tab open. Not built, as Section 18 item 9 already
  anticipated.
- **The short-lived SSE ticket this feature's own code flags as the real fix for the query-param
  token tradeoff** is a genuine follow-up, not a solved problem — this prototype has no session/
  ticket-minting infrastructure to build it on yet.
- **No load-testing of many simultaneous open SSE connections** — Django's dev server holds one
  thread per open connection with no async event loop; this is fine for the handful of demo users
  this environment has, and would be a real, separate concern (worth its own investigation, the same
  spirit as Section 17F's own load test) the moment this needed to support many real concurrent
  users.

## 17I. Real multi-moderator concurrent-access test (✅ built)

Section 17F's own "Left open" list flagged this honestly: a synthetic *volume* load test (many
pending items sitting in the queue) says nothing about *concurrent* access (several moderators
acting on the queue at the same instant) — no real moderators exist in this environment to recruit
for that, so this needed a genuinely simulated version instead: real, simultaneous `curl` processes
(backgrounded shell jobs + `wait`, not a mocked/serialized test) fired at
`ModerationActionView`/`_apply_submission` (`moderation/views.py`) against a real running dev server.

**A real bug, found on the first attempt, not assumed:** two genuinely simultaneous
`POST /api/moderation/submission/{id}/approve/` requests against the same pending submission
produced one HTTP 200 and one raw HTTP 500. The full server-side traceback (not just the exception
message) pinpointed it exactly: `_apply_submission`'s `next_number` — computed by reading the
current max `Exercise.number` for the course and adding one — is a plain read-then-write with no
locking at all, so both requests can read the identical value before either one's
`Exercise.objects.create()` commits; the loser hits `django.db.utils.IntegrityError: UNIQUE
constraint failed: exercises_exercise.course_id, exercises_exercise.number` (`(course, number)` is
the real uniqueness constraint) straight out of the view. A second, genuinely separate gap sat
alongside it: nothing stopped the SAME queue row from being approved/rejected twice at once at all
(a moderator double-click, or two moderators racing the same row) — every branch re-ran its full
apply logic unconditionally, risking two full `Exercise` rows built from one `submission` even
without a number collision.

**Two fixes, and one design detour worth recording so it isn't retried blind:**

- **The idempotency guard first went through `transaction.atomic()` + `select_for_update()`** — the
  textbook fix, and genuinely correct on a real production Postgres deployment. It made things
  *worse* here: this project's own dev database is SQLite, which has no row-level locking at all
  (`connection.features.has_select_for_update` is `False`; Django silently no-ops the call rather
  than raising on a backend that can't honor it), while Django's SQLite backend still holds a real,
  exclusive write lock for the *full duration* of an `atomic()` block, not just per statement — so
  wrapping `_apply_submission`'s own multi-statement work in one big transaction meant two genuinely
  concurrent requests could now both hit `sqlite3.OperationalError: database is locked` waiting on
  each other, a strictly worse failure than the one this was meant to fix. Confirmed directly, not
  guessed: re-running the exact same concurrent-request test against that version reproduced the new
  error in place of the old one.
- **What shipped instead: a single, small, unconditional `model.objects.filter(pk=pk,
  status='pending').update(status=target_status, reviewed_by=..., review_note=...)`** — no explicit
  transaction wrapper at all. A `QuerySet.update()`'s `WHERE`-clause evaluation is atomic at the
  database engine level on *every* backend, SQLite included, with zero reliance on row locking, and
  it only holds a write lock for the duration of that one fast statement rather than the whole slow
  apply sequence that follows. Exactly one concurrent request can ever see its own `UPDATE` affect a
  row still `'pending'`; every other one gets `0` rows affected and a clean `409 Conflict`
  (`"This item has already been reviewed by another moderator."`) instead of touching anything. The
  honest tradeoff, and how it's covered: this claims the *final* status before the apply logic that's
  supposed to justify it has actually run, so if `_apply_submission`/`_apply_edit_suggestion`/
  `_publish_translation` then fails for an unrelated reason, the claim is reverted back to
  `'pending'` in an `except` block, so a moderator can simply retry rather than the item being stuck
  silently "approved" with nothing behind it.
- **`_apply_submission`'s own number-allocation race is a *separate* problem the idempotency guard
  does nothing for** — two *different* pending submissions for the same course, approved by two
  different moderators at once, are both legitimately claimable; they just collide with each other on
  the shared `(course, number)` sequence. Fixed with a small, bounded (5-attempt) retry loop:
  re-reads the current max and retries the instant a collision is detected, each attempt in its own
  `transaction.atomic()` savepoint so a failed attempt doesn't poison whatever transaction the caller
  happens to be running in. Two distinct exceptions turned out to need catching here, both found by
  re-running the real test, not assumed up front — `IntegrityError` for the actual number collision,
  and (found the same way the `select_for_update()` detour was found) `OperationalError` for SQLite's
  own lock contention surfacing even for this one small statement under genuine concurrent write
  pressure.
- **`config/settings.py`'s `DATABASES['default']['OPTIONS']['timeout']`** was raised from Python's
  `sqlite3` module's own 5-second default to 20s — a real, standard SQLite+Django recommendation for
  concurrent-writer contention, not a defensive guess: the lock-contention failures above were
  measured happening at the 5-second default and stopped at 20s. Doesn't fix SQLite's inherent
  single-writer limitation (nothing can); makes a genuinely concurrent write wait its turn instead of
  failing outright, the right tradeoff for this app's real write volume (a moderation queue, not a
  high-frequency system) — a real production deployment on Postgres wouldn't need this at all.

**Verified with three separate real-concurrency scenarios, not one, against the running dev server:**
(1) two *different* pending submissions for the same course approved by two simultaneous requests —
both `200`, exercises created with distinct sequential numbers (385/386), zero errors; (2) three
simultaneous requests against the *same* single pending submission — exactly one `200` and two clean
`409`s, exactly one `Exercise` row created, zero duplicates; (3) a six-way simultaneous burst across
six different pending submissions on the same course — all six `200`, all six exercises created with
distinct sequential numbers (388-393), zero errors in the server log. All test submissions/exercises
were created and cleaned up directly via `manage.py shell`, confirmed removed with a real
zero-remaining check afterward — no scratch data left behind.

### Left open, not built

- **No formal automated test suite exists in this project at all** (`manage.py test` reports `Found
  0 test(s)`) — this fix, like everything else in this codebase, was verified against a real running
  server rather than a mocked/simulated one, matching the discipline every other feature in this
  document has already been held to; it isn't captured as a regression test a future change could
  accidentally break without anyone noticing.
- ~~The `_publish_translation`/`ExerciseTranslation` path has its own separate, unfixed race~~
  **✅ Resolved (Phase 4), see Section 17K** — and a real, MORE severe bug than "a rare concurrency
  edge case" was found while chasing it: the exact same collision happened on the very first,
  ordinary, single-moderator approval too, zero concurrency required.
- **The retry loop's 5-attempt bound is untested against genuinely higher contention** (more than 6
  simultaneous writers) — reasonable given this app's real moderator count, not validated at a scale
  this environment has no way to produce.

## 17J. Feature: server-side "my set" sharing (✅ built)

The last item from Section 16's own "real, working features in the current static site, deferred to
a later phase" list — "a link to someone else's set, not just your own saved one." Before this, an
`ExerciseSet` was fully server-side-persisted for a registered owner, but `ExerciseSetViewSet.get_queryset`
scoped EVERY action, including `retrieve`, to `owner=request.user` — there was no way for anyone but
the owner to view a saved set at all, let alone via a real link.

**Backend — one deliberate exception to an otherwise fully owner-scoped ViewSet.** `retrieve` alone
is now `AllowAny` and reads `ExerciseSet.objects.all()` (not the owner-filtered queryset); every
other action (`list`/`create`/`update`/`destroy`) is untouched — still `IsAuthenticated`, still
scoped to `owner=request.user`. This is the same "public GET, owner-scoped writes" split
`Exercise`/`Material` already use throughout this app, not a new trust model invented for this
feature — a set's own content (a name plus an ordered list of exercise references) was never
sensitive the way, say, a private message would be. The set's own plain numeric id IS the share
link; no separate opaque/unguessable token was added, since nothing about a set's CONTENT needs to
stay secret, only the ability to MODIFY someone else's does — and that stays fully protected,
unchanged, on every other action. `ExerciseSetSerializer` gained `owner_display_name` (the exact
`getattr(obj.owner.profile, 'display_name', '') or obj.owner.username` pattern
`community/serializers.py`'s `ReviewSerializer`/`CommentSerializer` already established), so a
shared view reads as "Kasia's set," not a bare numeric owner id.

**Frontend.** `getSharedSet(id)` (`lib/services/exerciseSets.ts`) — the one new public-read call,
same 404-swallowing shape `getExerciseById` already established (a bad/deleted id is an honest "not
found" the caller renders, not a thrown error). A new route, `/sets/[id]`, is the actual shared view
— reuses the same id-changed idempotency `$effect` guard `exercises/[id]/+page.svelte` already found
necessary for this exact `page.params.id` pattern (a bare effect reading `page.params.id` re-fires
spuriously on unrelated state changes on the same page, not just on a genuine navigation; guarding on
the id actually changing makes it idempotent regardless). Renders the set's name, the resolved
owner's display name, and the full exercise list (statement/difficulty, same rendering `/my-set`
itself already uses) — with two real actions, gated correctly for who's viewing:
- **"Load into my set"** — always available, works identically for a guest or a logged-in visitor,
  since it only ever writes to the CURRENT visitor's own `guestSetStore` (the same localStorage-
  backed working set `/my-set` already reads/writes) — the shared set becomes the visitor's own
  working set, ready to browse/print, without needing an account.
- **"Save a copy to my account"** — only shown when logged in (a real login-prompt hint renders for
  a guest instead); calls the EXISTING `createSet` unchanged, building a genuinely new, independently
  -owned `ExerciseSet` under the CURRENT viewer's own account with the same name/exercises — a real
  copy, not a reference to the original, so the original owner editing their own set later never
  retroactively changes what the copier saved.

`/my-set`'s own saved-sets list gained a **"Share"** button per set — builds the real URL via
`resolve('/sets/[id]', { id: set.id })` against `window.location.origin`, copies it to the clipboard
(`navigator.clipboard.writeText`), and shows a brief per-row "Link copied!" confirmation (keyed to
that specific set's own id, so sharing one set doesn't leave a stale confirmation next to a different
one below it).

**Verified end-to-end, not just by inspection — three separate browser contexts, not one.** Backend,
direct via `curl`: a real set created by Kasia was successfully retrieved BOTH by a completely
anonymous request AND by a different logged-in user (Ola), while `list` correctly still showed Ola
zero sets (Kasia's stayed invisible there) and a `DELETE` attempt by Ola on Kasia's own set correctly
404'd — the write protection is untouched. Frontend, three real Playwright browser contexts: (1)
Kasia logs in, saves a named set, clicks Share, and the clipboard is confirmed to contain the exact
correct `/sets/{id}` URL; (2) a fresh, entirely unauthenticated context navigates directly to that
URL and correctly sees the set name, "Shared by Kasia Wiśniewska," the exercise, no "Save a copy"
button but a real login hint instead, clicks "Load into my set," and a follow-up navigation to
`/my-set` AS THAT SAME GUEST confirms the exercise genuinely landed in their own working set; (3) a
different logged-in user (Ola) visits the same link, sees "Save a copy to my account" (not the load
button's guest-only sibling state), clicks it, and the backend confirms a real, fourth `ExerciseSet`
row now exists, independently owned by Ola, with the same name and exercises as Kasia's original. The
not-found case (a nonexistent set id) was also verified live, rendering the correct message rather
than crashing or hanging. All test data (3 scratch sets, across two owners) was cleaned up afterward,
confirmed only the one real, pre-existing "My exam prep" fixture remains. `npm run check`/`lint` and
`manage.py check` all clean throughout.

### Left open, not built

- **No "unshare"/revoke mechanism** — a set's `retrieve` is unconditionally public the instant it
  exists; there's no way for an owner to make a previously-shared set private again short of
  deleting it outright. Not asked for by the original feature request ("a link to someone else's
  set"), but a real, honest gap worth naming rather than silently leaving unstated.
- **No view/copy count, and no list of "sets shared with me"** — a copier's own new `ExerciseSet` is
  a completely independent row with no back-reference to where it came from; there's no way for the
  original owner to know their set was ever viewed or copied at all. The static site's own original
  feature (Section 3) wasn't described as having this either, so it's not a regression, just an
  honestly-scoped-out enhancement.
- **The share link has no expiry and no distinction between "share with a specific person" vs.
  "share with anyone who has the link"** — it's the latter, unconditionally, matching exactly what
  "a link to someone else's set" asked for and nothing more.

## 17K. Fix: the translation-publish race — and a more severe, non-concurrent bug found while chasing it (✅ done)

Section 17I's own "Left open" list flagged `_publish_translation`'s race honestly but narrowly —
framed as "two different translations for the same `(exercise, locale)` approved **concurrently**
could both momentarily claim `status='published'`." Investigating it properly (reproducing before
fixing, the same discipline every other bug fix in this document already holds itself to) turned up
something worse: **the identical collision happened on the very first, ordinary, single-moderator
approval too — zero concurrency involved.** Confirmed directly, not assumed, with a plain,
single-threaded shell script against a real copy of the live 742-exercise database: creating an
already-published translation for a locale, then a second pending one for the same locale, then
running the EXACT statement `ModerationActionView.post()`'s own claim step already ran
(`ExerciseTranslation.objects.filter(pk=new_pk, status='pending').update(status='published', ...)`)
raised a raw `django.db.utils.IntegrityError` immediately — the claim step set the new row's status
to `'published'` *before* `_publish_translation()` ever got a chance to delete the old published row
it was meant to supersede, so both rows briefly held `'published'` for the same `(exercise, locale)`,
violating the very constraint meant to prevent exactly that. Two more real, equally deterministic
collisions were found the same way, both stemming from the SAME root cause — the original
`unique_together = [('exercise', 'locale', 'status')]` (`exercises/models.py`) was strictly broader
than what its own Meta comment already claimed it did ("in practice this means at most one PUBLISHED
version per locale"): (1) submitting a second pending translation for a locale that already had one
pending 500'd outright at `POST /api/exercises/{id}/translations/`, since the plain `serializer.save()`
there does a blind create with no handling for this; (2) rejecting a resubmitted translation after an
EARLIER one for the same locale had already been rejected 500'd too, since old rejected rows are
never purged and the all-statuses constraint blocked a second `'rejected'` row for the same locale
just as much as a second `'pending'` or `'published'` one.

**The real fix, at the root — a genuine partial unique constraint, not a broader one papering over a
narrower intent.** `ExerciseTranslation.Meta` now declares
`constraints = [models.UniqueConstraint(fields=['exercise', 'locale'], condition=models.Q(status='published'), name='one_published_translation_per_locale')]`
(new migration, `exercises/migrations/0004_partial_unique_published_translation.py`) instead of the
old all-statuses `unique_together` — this is what the Meta comment always said the model did; the
`unique_together` declaration just never actually matched that stated intent. Applied cleanly against
a real copy of the live, migrated database with zero data loss or conflict (confirmed directly, not
assumed — every existing row already satisfies "at most one published row per locale," since that was
always true in practice even though the schema accidentally over-constrained the other two statuses
too). This alone fully resolves bugs (2) and (3) above — multiple pending or rejected rows for the
same locale were never actually meant to be blocked, so they simply aren't anymore, confirmed by
re-running both reproduction scripts against the newly-migrated schema with a clean, successful
result each time.

**Bug (1) — the approval-time collision — still needed an ordering fix, since the partial constraint
correctly keeps enforcing "at most one published row" (that part was always the real intent).**
`ModerationActionView.post()`'s generic claim step, which used to jump every kind/decision pair
straight from `'pending'` to its final status in one `UPDATE`, now carves out exactly one exception:
`kind == 'translation' and decision == 'approve'` claims only `reviewed_by`/`review_note`, leaving
`status` at `'pending'` — the actual flip to `'published'` is deferred entirely to
`_publish_translation()`, rewritten to (1) delete whatever else currently holds `'published'` for the
same `(exercise, locale)` FIRST, then (2) only THEN flip this row from `'pending'` to `'published'`
via its own atomic, WHERE-anchored `UPDATE` — the correct order the original code's own docstring
already claimed to follow but didn't actually enforce, since the caller had already jumped the row to
`'published'` before this function ever ran. That final flip is also now the one genuine ownership
claim for this specific case (returns `True`/`False`, not just mutated in place) — a **real,
simultaneous** double-approval of the exact same row (a moderator double-click, or two moderators
racing the same translation) is still correctly caught: only one of the two identical flip statements
can see `status='pending'` still true, and the loser gets the same clean 409 every other
double-decision race in this view already reports, not a false "success."

**Verified end-to-end against a real running server, not assumed from the code alone — the same
methodology Section 17I's own concurrent-request testing already established, reused here rather than
invented fresh.** A scratch copy of the real backend + the real, live 742-exercise database was
migrated and served on its own port so nothing in this pass touched the shared dev database:

1. **A single, ordinary approval superseding an existing published translation** (the deterministic
   bug — this used to 500 on literally every occurrence, not just under load): a real
   `POST /api/moderation/translation/{id}/approve/` against a live server correctly returned `200`
   with the new translation's data, and the superseded row was confirmed genuinely deleted afterward
   (exactly one row remained for that locale).
2. **The exact same single translation row approved by two genuinely simultaneous requests**
   (backgrounded `curl` processes + `wait`, the identical technique 17I's own submission-race test
   used): exactly one `200` and one clean `409`, zero crashes, exactly one published row at the end.
3. **Two DIFFERENT pending translations for the SAME `(exercise, locale)`, approved by two genuinely
   simultaneous requests:** both returned `200` — no crash, no moment where both rows held
   `'published'` at once (the original invariant violation this whole investigation started from is
   genuinely gone) — but the DB's own final state showed only ONE of the two survived; the other was
   deleted by the winner's own "delete superseded" step *after* it had already committed and returned
   its own `200` to its caller. **This residual outcome is honestly recorded, not silently smoothed
   over** — see "Left open" below for exactly what it means and why it wasn't chased further.

`manage.py check` and `manage.py makemigrations --check` both clean throughout; the one existing
caller of `_publish_translation`'s old two-argument signature (`ModerationActionView.post()` itself)
was updated to the new one-argument form, confirmed via a repo-wide grep — no other call site existed.

### Left open, not built

- **The cross-row race (two different, genuinely simultaneous approvals for the same locale) is now
  SAFE but not perfectly linearizable** — no crash, no moment of double-`'published'`, but whichever
  commits last silently deletes the other's already-committed, already-`200`-responded row. Matching
  Section 17I's own established judgment call for this exact scenario (flag it, don't chase it):
  fully eliminating this would need real cross-request mutual exclusion keyed on `(exercise, locale)`
  itself, not just on one row's own pk — and this codebase has ALREADY learned, the hard way (17I's
  own `select_for_update()`/`atomic()` detour), that reaching for SQLite locking primitives to solve
  a rare edge case can make things measurably worse under real concurrent write pressure rather than
  better. Two different translators racing to get the LAST word on the exact same locale at the exact
  same instant is a genuinely rare event this app's real moderator volume doesn't need to harden
  against further today; revisit if real usage ever shows otherwise.
- ~~No formal automated test suite exists yet to lock this fix in place~~ **✅ Resolved, see
  Section 17L** — the three deterministic bug scenarios above are now real, permanent regression
  tests, not just a one-time manual verification.

## 17L. This project's first real automated test suite (✅ done)

Every "Left open" note in this document that said "no formal automated test suite exists in this
project at all" (`manage.py test` used to report `Found 0 test(s)` everywhere, Sections 17F/17I/17K)
was accurate until now. Built using Django's own `TestCase`/DRF's `APITestCase`, both already
dependencies — no new package added, matching this project's own "every runtime dependency is a
flagged decision" discipline (the frontend's own `d3-force`/`fuse.js`/`tsx` notes).

**Scope, built in two passes rather than attempting exhaustive coverage in one.** The first pass
prioritized moderation (where this project's own history of found-and-fixed real bugs concentrates —
the submission number-collision race, Section 17I; the translation-publish race and the more severe,
non-concurrent bug found alongside it, Section 17K) plus the core exercise browsing/locale-resolution/
auth paths. A second pass — explicitly requested as a follow-up, not silently expanded on its own —
added the previously-uncovered community (comments/reviews), the reporting/auto-hide system,
materials (coverage claims + weighted voting), taxonomy, and study (My Set + its server-side sharing
feature). **66 tests, all passing, across seven files:**

- **`moderation/tests.py` (23 tests)** — the priority target, and now the largest file for a second
  reason too: the reporting/auto-hide system joined it (same app, `moderation/services.py`), not a
  separate app of its own. `TranslationApprovalTests` converts every one of Section 17K's
  manually-reproduced scenarios into a permanent test: approving a translation that supersedes an
  existing published one for the same locale (the deterministic bug), two pending translations for
  the same new locale coexisting, rejecting a resubmission after an earlier rejection, a
  double-decision on the same row correctly returning `409`, and a non-moderator correctly forbidden.
  `SubmissionApprovalTests` covers approve-creates-a-real-Exercise, reject-never-creates-one, the
  double-decision `409`, and a sequential-numbering check (a lighter-weight, single-threaded
  regression for Section 17I's own retry-loop fix — real concurrent reproduction stays documented
  there, not duplicated here as a flaky threaded test). `EditSuggestionApprovalTests` covers approve
  mutating the target field and reject leaving it untouched. `ModerationQueuePermissionTests` covers
  the `403`/`200` moderator gate. **New in the second pass:** `AutoHideTests` exercises the real
  `MIN_REPORTS_FOR_AUTO_HIDE = 3` / `AUTO_HIDE_THRESHOLD = 0.20` rule directly — below the report
  floor even at a high percentage doesn't hide; below the percentage even past the floor doesn't
  hide; crossing both does (and flips `Exercise.published` too); a reported Comment is correctly
  measured against its OWN Exercise's viewer pool (`resolve_view_scope_exercise`); a duplicate report
  by the same user is rejected; an already-hidden target isn't re-processed by a further report.
  `ReportActionViewTests` covers a moderator restoring an auto-hidden Exercise (reports resolved,
  `published` restored), permanently removing one, and a non-moderator correctly forbidden.
  `ReportQueueTests` exercises `build_report_queue`'s actual OUTPUT shape (Section 17F's own
  N+1-to-bulk-queries rewrite) — grouped report count, view count, and the computed percentage, not
  just that the endpoint returns `200`.
- **`exercises/tests.py` (7 tests)** — course-scoped listing and difficulty filtering;
  `?lang=` resolving to a real translation when one exists and falling back to the original locale
  when it doesn't; an authenticated user submitting a translation (`201`, `status: 'pending'`) vs. an
  anonymous one being rejected (`401`); and a direct regression test for the real, found-before-
  first-use data-integrity bug Section 17F documents (`ExerciseDetailSerializer` caching its
  resolved translation on `self`, which `DRF`'s `ListSerializer` shares as ONE instance across every
  row under `many=True` — every exercise past the first in a bulk response used to show the FIRST
  one's own content). This is a genuine data-CORRECTNESS bug, not a performance one, so it earns a
  permanent regression test rather than staying only a documented, one-time finding.
- **`accounts/tests.py` (4 tests)** — registering creates a real user and returns a working token;
  a duplicate email is rejected; logging in by email succeeds with the right password and fails
  cleanly with the wrong one.
- **`community/tests.py` (8 tests, new)** — Review/Comment have no `views.py` of their own (both are
  reached through `ExerciseViewSet`'s `reviews`/`comments` actions), so these exercise that real HTTP
  surface: creating a review; resubmitting one updates the existing row rather than duplicating it
  (`unique_together` on `(exercise, author)`, the view's own `existing`/`partial` logic); an anonymous
  reviewer is rejected; a removed review is excluded from the list. Posting a root comment; replying
  sets `parent` correctly; an anonymous commenter is rejected; a removed comment's `body`/
  `author_display_name` are correctly blanked in the API response (the tombstone behavior CLAUDE.md
  Section 9 describes — "preserves thread structure," not a hard delete).
- **`materials/tests.py` (12 tests, new)** — course-scoped material listing; `?q=` text search
  matching on title AND description; proposing a coverage claim; a duplicate `(material, topic,
  subtopic)` pairing correctly `409`s rather than silently overwriting; a topic from a DIFFERENT
  course is rejected; an anonymous proposer is rejected. Voting: agree/disagree counts computed
  correctly; a verified contributor's vote correctly counts double (`_vote_weight`); re-voting
  updates the existing vote rather than creating a second row; deleting a vote removes it. Commenting
  on a coverage claim (`MaterialCoverageViewSet.comments`, the same generic `Comment` GenericForeignKey
  mechanism Exercise/Material already share).
- **`taxonomy/tests.py` (4 tests, new)** — only published Fields are listed; a Field's own `courses`
  action only lists published Courses within it; a Course's detail response includes its own Topics;
  an unpublished Course correctly `404`s rather than leaking through.
- **`study/tests.py` (8 tests, new)** — creating a set with exercises; an anonymous user is rejected;
  listing only shows the CURRENT user's own sets; updating a set's `exercise_ids` correctly preserves
  the new order (the `through`-model `ExerciseSetItem.order` field the serializer's own `update()`
  writes explicitly, not DRF's default M2M handling); a non-owner can't delete someone else's set
  (`404`, matching the queryset-scoping-not-permission-checking pattern this app uses elsewhere).
  **The Section 17J sharing feature specifically:** an anonymous visitor CAN retrieve a set by id
  with no authentication at all, correctly sees the owner's own display name, and a nonexistent id
  still `404`s rather than leaking a stack trace.
- **`testing/factories.py`** — a small, shared, plain-function fixture module (`make_user`,
  `make_viewer`, `make_course`, `make_topic`, `make_exercise`, `make_material`) every app's own test
  module imports from, rather than each re-deriving its own Field/Course/Exercise/Material
  boilerplate. Deliberately plain functions, not a `factory_boy`/`model_bakery` dependency — the
  fixtures here are simple enough (a handful of model fields, no complex relationships) that a shared
  module of functions covers it without a new package, the same restraint this project already
  applies everywhere else. `make_viewer` is a real, measured performance fix, not a premature one:
  the auto-hide tests need up to 100 distinct "viewers" per test purely to exist as a `ContentView`
  FK target, and `make_user`'s real `create_user` call hashes a password (deliberately slow, to
  resist brute force) for every one — routing purely-decorative viewer fixtures through a bare
  `User.objects.create(username=...)` instead (no password hash at all, since nothing ever logs in as
  one) cut the moderation suite's own wall-clock time from **51.9s to 12.3s**, confirmed by timing
  both versions directly, not assumed from the change reading like an obvious improvement.

**Verified these are genuine regression tests, not trivially-passing ones — not assumed.** The five
translation tests were run a second time against a scratch copy of the PRE-FIX code (the exact
commit before Section 17K's own fix): 3 of 5 failed with the real `django.db.utils.IntegrityError`,
exactly matching the 3 deterministic bugs that fix found and resolved; the other 2 (double-decision,
non-moderator) correctly still passed, since they don't touch the code paths that fix changed. This
is the same "does this test actually catch the bug it claims to" discipline a real regression suite
needs to earn its own trust, applied here rather than assumed from the test reading correctly.

`manage.py test` (no args) runs the full suite (66 tests as of this section, ~22s; **92 as of
Section 17M**, ~34s, once the node-governor feature's own 26 tests joined it); `manage.py test <app>`
runs one app's own tests. `manage.py check` and `makemigrations --check --dry-run` both stay clean.

### Left open, not built

- ~~Materials, community (comments/reviews), taxonomy, study (My Set), and the reporting/auto-hide
  system have no dedicated test coverage~~ **✅ Resolved, see the second pass above** —
  `notifications` remains the one real gap: no dedicated test coverage exists for the SSE stream
  (Section 17H) or the ten notification-trigger event types (Section 17B/the per-type muting
  follow-up) yet. A real, worthwhile next target, not attempted in either pass so far.
- **No CI wiring** — these tests run locally via `manage.py test`, same as every other verification
  command in this project's own README; there's no GitHub Actions workflow (or equivalent) running
  them automatically on push/PR yet.
- **No frontend test suite either** — `npm run check`/`lint`/`build` all stay clean, but this project
  has never had a Vitest/Playwright-as-CI-gate suite; every frontend verification in this document
  has been a manual, one-off headless-Chromium pass (Sections 17A–17K's own "Verified end-to-end"
  writeups), not a committed, re-runnable test file.
- **The cross-row translation race (Section 17K's own "Left open" note) has no dedicated concurrency
  test in this suite** — Django's synchronous test client can't fire genuinely simultaneous requests
  the way the real `curl`-plus-`wait` methodology (17I, 17K) can, and that residual race was already
  a deliberate, documented, not-chased edge case; a threaded/multiprocessing test to exercise it here
  would add real complexity and flakiness risk for a scenario this project has already decided not to
  harden against further.
- **`MaterialCoverageProposalTests`/`MaterialCoverageVoteTests` don't cover the `subtopic_slug`
  get-or-create-on-the-fly path** (`MaterialViewSet.coverage`'s own "matching how a brand-new tag is
  created the first time someone proposes it" behavior) — only the plain `topic`-only case is tested;
  a real, small, worthwhile addition, not attempted here.

## 17M. Feature: node governors — a scoped moderator role (✅ built, full stack)

Every moderation permission in this project has, until now, been all-or-nothing: `is_staff` sees and
acts on the ENTIRE cross-course moderation queue, and nobody else can act on any of it. That's a real
gap once EdMat has more than a handful of Fields — a trusted contributor for, say, the "Algebra"
course shouldn't need full platform-wide staff status just to review submissions/translations/reports
scoped to their own course. This feature adds a genuinely scoped role instead: a **node governor**
holds moderation authority over ONE taxonomy node — a `Field` or a `Course` — not the whole platform.

**Scope decisions, made explicitly before building (not defaulted to without asking):** full stack
(a real backend model/permission engine AND a real SvelteKit admin page, not backend-only with no
UI); and a Field-level grant cascades down to every Course under it, so granting someone "Algebra"
the FIELD doesn't mean re-granting each Course inside it one at a time.

### The data model — `NodeGovernor`, a polymorphic grant

```python
# moderation/models.py
class NodeGovernor(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, related_name='governed_nodes', ...)
    content_type = models.ForeignKey(ContentType, ...)
    object_id = models.PositiveIntegerField()
    node = GenericForeignKey('content_type', 'object_id')       # a Field OR a Course
    granted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, related_name='+', ...)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'content_type', 'object_id')]
        ordering = ['-created_at']   # newest grant first — this project's own live-browser
                                       # verification of the admin UI caught a real test-script bug
                                       # (not an app bug) that assumed the opposite ordering, see below

GOVERNABLE_NODE_MODELS = {'field': Field, 'course': Course}
```

A `GenericForeignKey`, the same polymorphic pattern this project already uses for `Comment`/`Report`
(one grant row, either kind of node), rather than two separate `FieldGovernor`/`CourseGovernor`
tables — a Field-vs-Course grant differs only in WHAT it points at, not in any other field, so a
second model would just be the same five columns duplicated.

### The scoping engine — `is_governor_of_course` / `governed_course_ids`

```python
# moderation/services.py
def is_governor_of_course(user, course) -> bool:
    """Object-level check: can this user act on THIS specific course's moderation items?"""
    if user is None or not user.is_authenticated: return False
    if user.is_staff: return True                      # global staff is unaffected by this feature
    if course is None: return False
    return NodeGovernor.objects.filter(user=user).filter(
        Q(content_type=course_ct, object_id=course.pk) |          # direct Course grant
        Q(content_type=field_ct, object_id=course.field_id)        # OR the owning Field's grant
    ).exists()

def governed_course_ids(user) -> set[int] | None:
    """Queryset-level filter: which course ids can this user's moderation QUEUE even show?
    `None` means "don't filter — global staff sees everything," a REAL set (possibly empty)
    means genuine scoping, including the honest 'governs nothing at all' case."""
    if user is None or not user.is_authenticated or user.is_staff: return None
    # ... resolves direct Course grants + every Course under a granted Field, unions them
```

**The `None`-vs-`set()` distinction is load-bearing, not incidental.** `build_moderation_queue_payload`
and `build_report_queue` both take this same `course_ids: set[int] | None` and only filter when it's
not `None` — collapsing "unfiltered" into an empty-set convention instead would have made a genuine
zero-grants governor indistinguishable from global staff at the query layer, a real correctness trap
this design avoids by keeping the two states as different Python values, not the same value read two
different ways.

**Both an object-level AND a queryset-level check exist, and both matter — a queryset filter alone
isn't enough.** `ModerationActionView`/`ReportActionView` each act on ONE specific row by id, arriving
via a URL path parameter a scoped queryset filter never gets a chance to narrow — a governor could
otherwise POST directly to a moderation action for a row outside their own scope and it would still
process, since the view never runs the LIST query at all for a single-object action. Both views now
call `is_governor_of_course`/`_course_for_moderation_target`/`_course_for_report_target` (new small
helpers resolving "which course does this specific target ultimately belong to") and return `403`
before any mutation if the acting user doesn't govern that course — checked BEFORE the claim/update,
not after, so a disallowed request can't even partially apply.

**A real, found-before-shipping bug: `ReportActionView.post()`'s own final response used to return
the UNSCOPED report queue.** `build_report_queue()` with no arguments returns every pending report
platform-wide — correct for global staff, a real scope leak for anyone else, since the response body
would show a scoped governor reports from courses they have no business seeing, purely as a side
effect of the endpoint's own "return the freshly-resolved queue" convenience. Fixed to
`build_report_queue(course_ids=governed_course_ids(request.user))`, and caught by a dedicated
regression test (`ReportActionScopingTests`) specifically written to catch this exact shape of bug,
not just to exercise the happy path.

### The grant/revoke API — `NodeGovernorViewSet`

`IsModerator.has_permission` was widened to admit anyone holding ANY `NodeGovernor` row (not just
`is_staff`) — a scoped governor needs to reach `/moderation/queue/` at all, even though what they see
there is then further narrowed by `governed_course_ids`. Granting/revoking the role itself, though,
stays **staff-only in this v1** — `NodeGovernorViewSet.get_permissions()` requires `IsAdminUser` for
`create`/`destroy` specifically, a deliberate, narrower decision than "anyone who can moderate can
also delegate moderation," see "Left open" below. `get_queryset()` scopes a NON-staff caller's own
`GET /moderation/governors/` to just their own grant(s) — real, if modest, self-service visibility
("what do I govern?") without needing staff status just to see your own scope.

`NodeGovernorSerializer` accepts `{ user, kind: 'field'|'course', node_slug }` on write (resolving
`node_slug` against whichever model `kind` names, `400`ing with a real, specific error if it doesn't
resolve or the grant already exists — `NodeGovernor.objects.filter(...).exists()` checked in
`validate()`, not left to the DB's own `unique_together` to surface as an opaque `IntegrityError`),
and returns a fully resolved, human-readable shape on read (`node_type`, `node_id` — the slug, not the
raw numeric PK, matching this API's own established id-format convention — `node_label`, resolved
through the SAME `resolve_translation`/`request_locale` machinery every other node-name lookup in this
API already uses, so a governor's own scope banner reads "Algebra (verify)," not a bare slug).

### The frontend — `/moderation`'s new "Governors" tab, and a widened gate everywhere else

`authStore.canModerate` (`isModerator || isNodeGovernor`) is the new, single gate the whole frontend
reads instead of `isModerator` alone — the Header's nav link, and the moderation page's own top-level
`{#if}`, both switched to it. `ProfileSerializer.get_is_node_governor` is a small, cheap `.exists()`
query added to the `/me` payload precisely so this flag is available on login without a second
round-trip.

The moderation page gained a fifth tab, **Governors**, visible ONLY to real global staff
(`authStore.isModerator`, deliberately NOT `canModerate` — a scoped governor can't grant/revoke this
role at all in v1, so the tab isn't offered to them rather than being reachable and then 403ing on
every action inside it). A non-staff governor instead sees a small scope banner above the ordinary
queue tabs ("You govern: {node}. This is your own scoped queue, not the whole platform's.") — the
queue itself (Reports/New exercises/Edit suggestions/Translations) is the SAME `ModerationQueueView`
every staff member already sees, just server-side narrowed to their own course(s), so no separate
scoped-queue UI was needed, only the banner disclosing that the narrowing exists.

The Governors tab itself: a grant form (a numeric User ID field — see "Left open" on why there's no
user search — a Scope `<select>` toggling between Field/Course, and a node `<select>` populated from
whichever list `getFields()`/`getAllCourses()` already loaded) and a list of current grants, each
rendered as a plain, readable sentence ("verify_nogrant governs the whole field: Math (verify)") with
a Revoke button.

### Verified end-to-end, live — a real bug found and fixed along the way, not assumed correct

Driven with a real headless-Chromium session (Playwright) against the actual running dev servers
(backend on :8000, frontend Vite dev on :5173), not just `svelte-check`/`manage.py test` passing in
isolation — the same "reproduce/verify before trusting it" discipline Sections 17I/17K/17L already
established for this project. Confirmed, against real seeded data (a `math-verify` Field, an
`algebra-verify` Course inside it, and three real logged-in accounts — a staff user, a course-scoped
governor, and a user with zero grants at all):

- The scoped, non-staff governor sees the Moderation nav link, the scope banner reading their exact
  course, and correctly does NOT see the Governors tab.
- Global staff sees the Governors tab, the existing grant listed with its correctly-resolved course
  label, can grant a brand-new FIELD-level governor through the real form (not just via the API
  directly), sees it appear immediately with the correct "governs the whole field" label, and can
  revoke it — leaving the other, unrelated grant untouched.
- A user with zero grants and no staff status sees no Moderation nav link at all, and a direct
  navigation to `/moderation` shows the access-denied message, not the queue.
- Backend-only checks (bypassing the UI, hitting the API directly): `/api/auth/me/` correctly reports
  `is_node_governor`; the scoped governor gets a real `200` from the moderation queue (server-side
  narrowed) while a zero-grant user gets `403`; a scoped governor attempting to grant/revoke via the
  API themselves correctly gets `403` (staff-only in v1).

**Two real, found-and-fixed bugs surfaced by this live verification, neither caught by
`svelte-check`/`manage.py test` alone:**

1. **A genuine runtime type bug in the grant form.** The User ID field was originally
   `<input type="number">` bound via Svelte 5's `bind:value` — which binds a real JavaScript
   `number` (or `undefined`) for a number input, NOT the `string` the surrounding code (`.trim()`,
   `grantNodeGovernor(userId: string, ...)`) assumed throughout. `svelte-check` never flagged the
   mismatch (the binding's own inferred type doesn't get checked against the DOM input's `type`
   attribute), but the very first live grant attempt through the actual form threw a real
   `$.get(...).trim is not a function` in the browser console. Fixed by switching to
   `type="text" inputmode="numeric" pattern="[0-9]*"` — keeps the numeric mobile keyboard, keeps
   Svelte's binding a genuine string end to end, matching what the rest of the code already assumed.
2. **A test-script bug this session's own verification pass caught mid-way, not an app bug** — worth
   recording anyway since it's exactly the kind of "ordering assumption silently wrong" mistake this
   project's discipline is meant to surface. `NodeGovernor.Meta.ordering = ['-created_at']` means the
   list is newest-grant-first; a first draft of the verification script picked the row to revoke via
   `.last()` (oldest, not newest), which silently revoked the WRONG grant. Confirmed by checking the
   real API state directly after the run (`GET /moderation/governors/` unexpectedly returned `[]`,
   both grants gone, not just the intentionally-created one) — fixed by re-targeting the revoke by
   its actual row text (`.governor-row:has-text("verify_nogrant")`) instead of position, and
   re-verified clean.

Both fixes were re-verified against a fresh live run before being treated as done — not assumed
correct from the diff alone.

**Backend: 26 new tests** (`NodeGovernorHelperTests`, `ModerationActionScopingTests`,
`ModerationQueueScopingTests`, `IsModeratorGateTests`, `NodeGovernorGrantApiTests`,
`ReportActionScopingTests` — the last including a direct regression test for the queue-leak bug
above — plus 2 in `accounts/tests.py` for the `/me` flag), bringing the full suite to **92 tests,
all passing**. `manage.py check` and `makemigrations --check --dry-run` both stay clean.
`npm run check` (0 errors/0 warnings across 1224 files), `npm run lint` (prettier + eslint, both
clean — the only warnings anywhere are in `project.inlang`'s own pre-existing, untouched generated
files), and `npm run build` (production build succeeds) all confirmed clean on the frontend.

### Left open, not built

- **No user-search endpoint.** Granting a governor role means already knowing the target account's
  real numeric User ID (visible via Django admin's own user list) — a real, honest UX limitation for
  a v1 admin tool, not a hidden gap. A real `/api/accounts/search/?q=` (or similar) would be the
  natural next step once this needs to scale past "an admin who already knows the id."
- **Only global staff can grant/revoke the role, even at Field scope, in this v1.** A Field-level
  governor can't delegate a narrower Course-level grant to someone else within their own field —
  every grant/revoke, at any scope, requires real `is_staff`. Explicitly a v1 scope decision
  (`IsAdminUser` on `create`/`destroy`), not an oversight; delegated sub-granting is a real, deferred
  follow-up if this role hierarchy ever needs to go more than one level deep.
- **No audit trail beyond `granted_by`/`created_at`.** A revoke doesn't leave any record of who
  revoked it or when — the row is simply deleted. Fine for a small admin tool today; a real audit log
  (who granted/revoked what, and when) would be the natural next step if this needs to be
  accountable at a larger scale.
- **No UI or backend concept of a governor's own activity being distinguishable from staff's** in the
  moderation action's own `reviewed_by`/`resolved_by` fields — a decision made by a scoped governor
  looks identical to one made by a full staff member in the data, which is arguably correct (the
  decision itself IS equally authoritative within their scope) but worth naming as a deliberate
  non-distinction, not an unconsidered gap.

## 17N. Feature: real material uploads — PDF/PNG/LaTeX/Word, content-sniffed and (optionally) scanned (✅ built)

"Exams, tests, etc. — usually a PDF/PNG, but a whole LaTeX/Word document should be accepted too, and
it should be scanned and kept safe." Before this, `Material` (2.11) had zero create/upload path at
all — `MaterialViewSet` was, and remains, a plain `ReadOnlyModelViewSet`; every one of the 7 real
materials in this corpus exists only via `import_legacy_corpus` or the Django admin. This feature
adds the missing piece: a real, moderated user-submission flow for course materials, mirroring
`ExerciseSubmission`'s own shape (2.9's own model), with two things `ExerciseSubmission` never
needed at all — real file-content validation, and an optional malware scan.

### Two separate safety layers, both real, neither faked

`materials/validators.py` is genuinely new ground for this project — every prior "moderation" feature
gated on trusting a Django model field (text, a JSON payload); this is the first time this app has had
to reason about untrusted BINARY content at all.

1. **Content-type verification, always on.** `python-magic` (a thin binding over the system
   `libmagic` library, confirmed already present on this machine — no new system package needed) reads
   the first few KB of an upload and checks the SNIFFED mime type against a whitelist keyed by
   extension (`ALLOWED_MATERIAL_TYPES`) — never trusting the extension or the browser-supplied
   `Content-Type` header, both of which the uploader fully controls. Verified directly before being
   trusted, not assumed from the library's own docs: a real PDF/PNG/`.tex` file is accepted; a real
   Windows PE executable (a genuine `MZ...` header) renamed to `.pdf` is rejected, because its sniffed
   type (an executable signature, or `application/octet-stream` for a very short/ambiguous buffer)
   simply isn't in the `.pdf` extension's own allowed set either way. `.docx`/`.doc` both accept a
   genuinely broad container type (`application/zip` / OLE2's own `application/x-ole-storage`)
   alongside the more specific Office MIME strings some `libmagic` database versions report — a real
   `.docx` IS a zip archive, a real legacy `.doc` IS an OLE2 compound file; this validator answers "is
   this really a document/image, not something pretending to be one," not full format forensics. A
   25MB size cap (`MAX_MATERIAL_SUBMISSION_SIZE_BYTES`) rounds out the same function
   (`validate_material_submission_file`) — a real Django field validator, wired onto BOTH
   `MaterialSubmission.file` and `Material.file` itself (the latter for defense-in-depth consistency,
   even though the corpus importer's own raw `.create()` calls bypass field validators by design,
   same as every other Django validator in this app).
2. **Malware scanning, genuinely pluggable, honestly optional here.** `scan_for_malware` tries a real
   ClamAV daemon — first a Unix socket (`CLAMD_UNIX_SOCKET`), then TCP (`CLAMD_HOST`/`CLAMD_PORT`),
   both new `config/settings.py` values — via the `clamd` PyPI client, which only ever talks to an
   ALREADY-RUNNING clamd. This project's own sandboxed dev environment has neither: confirmed no
   `clamscan`/`clamdscan`/`freshclam` binary anywhere, and no root access to install one (the same
   constraint CLAUDE.md's own venv note already records for a different tool). The honest, common
   outcome here is `scanned=False` — returned as a real dataclass (`ScanOutcome`), never silently
   upgraded to "clean" by a caller that only checks a bare bool. `MATERIAL_SCAN_REQUIRED` (`False` in
   this environment) is what a real deployment that actually runs ClamAV would flip to `True`, turning
   "couldn't scan it" into a hard rejection instead of this environment's own honest, recorded skip —
   the same "flag it, don't fake it" discipline this doc already applies to the email-backend stub
   (Section 18 item 9) and the avatar-upload URL stand-in (Section 4W).

### `MaterialSubmission` — the file-centric counterpart to `ExerciseSubmission`

Lives in `moderation/models.py`, same app as every other pending-review model, importing
`Material`/`MATERIAL_TYPE_CHOICES` from `materials.models` the same way `ExerciseSubmission` imports
`Exercise`. Deliberately real, typed fields (`title`, `description`, `locale`, `type`, `file`) rather
than `ExerciseSubmission`'s own flat `JSONField` payload — a Material has no rich statement/hint/
solution text to draft, just a file plus a handful of plain metadata fields, so a JSON payload would
just be extra indirection around fields this model can hold directly. `scan_status`/`scan_detail` are
surfaced to the moderator reviewing the queue, not silently discarded — "was this file ever actually
scanned" is exactly the kind of thing a real moderator deciding whether to trust an upload should see.

**"Kept safe" storage, not just safe content.** `material_submission_upload_path` deliberately
discards the uploader's own original filename, keeping only its (already-validated) extension — a
random UUID hex is the real stored filename. A real original filename is untrusted input too (path
traversal characters, a double-extension trick like `invoice.pdf.exe`, an unpredictable collision) —
Django's own default `FileSystemStorage.get_valid_name` sanitization is a lower bar than not trusting
the name at all.

`_apply_material_submission` (moderation/views.py) mirrors `_apply_submission`'s own shape: builds a
real, published `Material` + `MaterialTranslation` from an approved submission, assigning
`Material.file` the SAME already-uploaded, already-validated, already-scanned file the submission
itself holds (a plain FileField reference copy, no re-upload). `Material` has no `number` field to
allocate the way `Exercise` does, but it does have the same real `unique_together = [('course',
'slug')]` constraint `Exercise`'s `(course, number)` has — so this function generates a slug from the
submitted title via `slugify`, retrying with a numeric suffix on collision, the exact same "retry until
it doesn't collide" shape `_apply_submission`'s own number-allocation loop (Section 17I) already
established for a different field.

### Wired into every existing moderation surface, not a parallel system

`_KIND_MODELS`/`_course_for_moderation_target` (views.py) both gained a `'material'` entry —
`ModerationActionView`'s existing approve/reject/idempotency-claim/node-governor-scoping machinery
(Sections 17I/17M) covers a material submission with zero new logic of its own, the same free ride
every prior kind already got from that shared view. `build_moderation_queue_payload`
(moderation/services.py) gained a `material_submissions` key, scoped by `governed_course_ids` exactly
like `submissions`/`edits`/`translations` already are — a node governor sees only their own course's
pending material uploads, same as everything else in their scoped queue.
`notifications/services.py`'s `_PREFERENCE_FIELD_FOR_TYPE` gained
`material_submission_approved`/`material_submission_rejected`, both mapped to the existing
`notify_on_moderation_decision` category — `label_for_material` (already built, unused until now) is
what resolves a real, per-locale title for the notification.

### Frontend — a real multipart upload, not JSON

`apiClient` gained a genuinely new capability: `postForm<T>(path, formData)`, and `request()`'s own
Content-Type logic was widened to never set `application/json` when the body is a `FormData` instance
— the browser generates the correct `multipart/form-data; boundary=...` header itself, with a boundary
value this function could never construct by hand. `submitMaterial` (`lib/services/materials.ts`)
builds the `FormData` and sends the real `File` object alongside the plain metadata fields.

A new route, `/submit-material`, mirrors `/submit`'s own layout (course/type/language pickers, a
title/description, and — the one new field kind for this app — a real `<input type="file">` with an
`accept` attribute matching the validator's own whitelist, a real, honest UX convenience, not the
security boundary itself). The moderation page gained a sixth tab, "Materials," listing pending
uploads with the resolved type label, a scan-status badge (`Not scanned` / `Scanned — clean` /
`Scanned — flagged`, reading directly off `scan_status`), a real working file link (`download`,
`target="_blank"`, with an `eslint-disable` for `svelte/no-navigation-without-resolve` — an external
Django-media-server URL, not an app route `resolve()` can express, the same precedent
`MaterialCard.svelte`'s own download link already established), and the same Approve/Reject actions
every other queue tab already has.

### Verified end-to-end, live — not just unit-tested

**Backend: 18 new tests** (`MaterialSubmissionValidatorTests`, `MaterialSubmissionApiTests`,
`MaterialSubmissionApprovalTests`), bringing the full suite to **110 tests, all passing**. Real content
fixtures throughout, not synthetic placeholders — a genuine minimal PDF/PNG/`.tex` byte sequence for
the accept cases, a genuine Windows PE header for the disguised-executable reject case, and a real
`@override_settings(MATERIAL_SCAN_REQUIRED=True)` test confirming an upload IS rejected when no
scanner is reachable, the counterpart to this environment's own honest default. `manage.py check`/
`makemigrations --check --dry-run` both stay clean.

**Frontend, driven live against the real running dev servers with headless Chromium** (the same
"reproduce/verify before trusting it" discipline every Phase 4 feature in this doc already holds
itself to) — not `npm run check`/`build` alone, though both stayed clean throughout (`0 errors, 0
warnings`, and `npm run lint`'s prettier+eslint pass clean too, once two real issues below were found
and fixed):

- A registered student uploaded a REAL PDF through the actual `/submit-material` form; the success
  message rendered correctly.
- A staff moderator's Materials tab showed the real submission with the correct type label, course
  name, submitter name, and an honest "Not scanned" badge (confirming this environment's own
  `scanned=False` path is surfaced all the way to the UI, not silently hidden) — a real, working file
  link that resolves to the Django media server.
- Approving it removed it from the queue; the resulting `Material` genuinely appeared, published, on
  its real course page — confirmed by navigating there and reading the live-rendered DOM, not assumed
  from the API response alone.
- A second upload, a real disguised executable, was REJECTED by the actual running form — a real error
  message rendered, no false "awaiting review" success shown.

**Two real bugs found and fixed by this live pass, neither caught by `svelte-check` alone:**

1. **A stale `svelte/no-navigation-without-resolve` eslint violation that only reproduced once the
   `<a>` tag was reformatted onto multiple lines** — `eslint-disable-next-line` only suppresses a
   violation reported on the literal next line, and the rule reports the violation at the `href`
   attribute's own line specifically, not the tag's opening line; a multi-line, Prettier-reformatted
   tag put the two line numbers out of sync. Fixed with a block-scoped `eslint-disable`/`eslint-enable`
   pair around the whole element instead of a single-line disable comment — immune to reformatting
   moving attributes across lines, unlike the fragile single-line form.
2. **The verification script's own `<select>` locators, not an app bug** — `page.locator('select').first()`
   matched the Header's own always-present "Interface language" selector before ever reaching the
   actual submit form's course picker, on both the node-governor (Section 17M) and this feature's own
   verification passes. Fixed by scoping every form-field locator to `form.submit-form` specifically —
   recorded here since it's the same class of "positional locator vs. a page with more than one
   matching element" mistake Section 17M's own writeup already caught once, now caught a second time
   in a genuinely different feature's verification script.

### Left open, not built

- **No real ClamAV daemon exists in this sandboxed dev environment** — `scan_for_malware`'s own
  network-scanning code path (both the Unix-socket and TCP branches) is real and correctly falls back
  when unreachable, but was never exercised against an ACTUAL positive detection (a real virus
  signature triggering `status: 'FOUND'`) — only the "no daemon reachable" branch was ever live-tested,
  since this environment genuinely has no daemon to test the other branch against. A real deployment
  that installs ClamAV would be the first to exercise that code path for real.
- **`MaterialSubmission.type` is a bare `CharField`, not `choices=MATERIAL_TYPE_CHOICES`** — the
  serializer never validates it against the real enum, so a malformed `type` value would only ever
  surface as `Material.type` failing ITS OWN `choices` validation the moment `_apply_material_submission`
  tries to build the real `Material` row from it (a 500, not a clean 400 at submission time). Not hit
  by any current fixture or the live verification pass (the frontend's own `FRONTEND_TO_BACKEND_MATERIAL_TYPE`
  map only ever sends real values), but a real, if narrow, gap worth tightening.
- **No UI for a student to see the outcome of their own material submission** (approved/rejected,
  with the moderator's own review note) — `ExerciseSubmission` has the identical gap already
  (unaddressed by any prior session), so this isn't a new hole this feature introduced, just one it
  didn't take the opportunity to close either.
- **`getMaterialSubmissionsForCourse` (materials.ts) is built but has no real UI consumer yet** — added
  for symmetry with `getExerciseSubmissionsForCourse`, but nothing in this pass needed a course-scoped
  submissions view outside the moderation queue itself.

## 17O. Feature: material requirements, threaded/reportable coverage discussion (confirmed), and price/time-estimate fields (✅ built)

Four related additions to Materials, requested together: (1) a loose, free-text requirement list
per Material, with a submission-time field and a governor-only edit path for an already-published
one; (2) real, multi-level threaded discussion per `MaterialCoverage` claim — largely already
supported by the data model, confirmed rather than assumed, with one real gap closed; (3) comments
already reportable, generically, confirmed rather than rebuilt; (4) an optional price and a
time-estimate on `Material`/`MaterialSubmission`. Backend suite grew from 123 to **144 tests, all
passing**.

### `MaterialRequirement` — the same loose, free-text style this codebase already uses elsewhere

```python
# materials/models.py
class MaterialRequirement(models.Model):
    material = models.ForeignKey(Material, related_name='requirements', on_delete=models.CASCADE)
    label = models.CharField(max_length=200)
    order = models.PositiveIntegerField(default=0)
    class Meta: ordering = ['order', 'id']
```

Deliberately not a fixed vocabulary — `label` is whatever the uploader/governor typed ("English
B2+", "basic algebra," "a graphing calculator"), the same free-form-per-row convention
`ExerciseSource.collection`/`.name` already establish for a similarly loose field, not a
`choices=`-constrained enum the way `Material.type`/`difficulty` are. `order` is a plain,
governor-controlled display order (not creation-order, not alphabetical), the same shape
`Material.order`/`Course.order`/`Topic.order` already use elsewhere in this schema.

**Read side:** `MaterialRequirementSerializer` (id/label/order), embedded read-only on
`MaterialSerializer` as `requirements` — the same "no create/update endpoint on `Material` itself"
posture `coverage`/`tags` already have (`MaterialViewSet` stays a `ReadOnlyModelViewSet` for its
ordinary CRUD surface).

**Write side #1 — at submission time.** `MaterialSubmission` (moderation/models.py) gained
`requirements = models.JSONField(default=list, blank=True)` — a plain `list[str]` draft, not a real
`MaterialRequirement` FK, since there's no real `Material` row yet for one to point at (mirroring
`ExerciseSubmission.payload`'s own "draft now, real structural rows only once approved" split, just
narrower — three plain fields here, not a whole JSON blob, since a Material submission is otherwise
already real, typed fields). `MaterialSubmissionSerializer.requirements` is declared explicitly as
`serializers.JSONField(required=False, default=list)` with a real `validate_requirements` — this
endpoint is multipart, not JSON, and a multipart form field always arrives as a bare STRING, not a
native array; the validator accepts either shape (parses a JSON-encoded string itself when that's
what arrived, passes a real list straight through when the caller sent one directly, e.g. this
app's own `format='json'` test requests). `_apply_material_submission` (moderation/views.py) turns
the submission's own `requirements` list into real, ordered `MaterialRequirement` rows the instant a
moderator approves it — the exact moment a real `Material` row first exists to attach them to.

**Write side #2 — a governor-only bulk replace for an already-published Material.** A new
`PUT /api/materials/{id}/requirements/` action on `MaterialViewSet`:

```python
@action(detail=True, methods=['put'])
def requirements(self, request, pk=None):
    material = self.get_object()
    if not request.user.is_authenticated:
        return Response(status=status.HTTP_401_UNAUTHORIZED)
    if not (request.user.is_staff or is_governor_of_course(request.user, material.course)):
        return Response(status=status.HTTP_403_FORBIDDEN)
    ...  # full, ordered replace: delete every existing row, bulk_create the new list
```

**The trust-boundary decision, made explicitly, not defaulted to.** Gated by the exact same
`is_governor_of_course` scoping engine Section 17M's node-governor feature already built (global
staff, or a governor of the material's own course) — deliberately **not** open to any authenticated
user the way `MaterialCoverage` proposals are. `MaterialCoverage`'s own doc comment already draws
this line explicitly: a coverage claim is "additive, reversible, low-stakes organizational
metadata," verified/corrected by community voting rather than gatekept up front. A requirement list
reads differently — closer to structural metadata about the material itself (what you need to
actually use it) than to a community discussion point — so it gets the same moderator-adjacent trust
boundary every other structural mutation in this app already uses, not the open, community-vote
posture. Body: `{"requirements": ["English B2+", "basic algebra", ...]}` — a full, ordered replace,
not a single add/remove, matching how a real list-editor UI naturally works (submits its current
full state) and avoiding a second endpoint shape just for reordering.

### Frontend — chips on the card, a governor-facing editor, wired into the submission form

`lib/types/material.ts`'s `Material` gained `requirements: MaterialRequirement[]`; `MaterialCard.svelte`
renders each as a plain, non-interactive `.requirement-chip` pill — deliberately not a `TagChip`
(that component's hover-menu/follow/apply machinery is for the free-form Tag vocabulary, a genuinely
different axis from a material's own prerequisites). A "Edit requirements" trigger renders only for
`authStore.canModerate` (the same coarse frontend gate the moderation nav link/page already use,
Section 17M) — the real, narrower per-course check happens server-side, the same "coarse frontend
gate, authoritative backend check" split this app's Governors tab already established; a governor
attempting to edit a material outside their own scope gets a real 403 from the PUT, surfaced as
`material_requirementsSaveError`.

`RequirementsEditor.svelte` (`lib/components/material/`) — a plain add/remove list (type a label,
Enter or the Add button appends it; each row gets a remove ×), matching `AddCoverageForm`'s own
"controlled, dumb, parent owns the async save" shape: it never calls the service function itself,
only hands the caller a full `string[]` on submit. `apiClient` gained a genuinely new verb,
`put<T>(path, data?)` — a real full-replace call reads more honestly as PUT than PATCH, and every
prior HTTP-verb helper on this object already follows the identical thin one-liner shape.

`/submit-material` gained three new, genuinely optional fields — an inline requirements
add/remove list (Enter to add, mirroring the governor editor's own interaction), and a price/
estimated-time row. **A real bug found and fixed by this feature's own live-browser verification,
the identical class Section 17M's node-governor grant form already hit once:** the price/estimated-
minutes inputs were originally `<input type="number">`, which binds a genuine JS `number` (or
`undefined`) via Svelte 5's `bind:value` — not the `string` `handleSubmit`'s own `.trim()` calls
assumed. `svelte-check` never flagged it; the first live submit attempt threw a real
`$.get(...).trim is not a function` in the browser console, caught only because this was actually
driven through headless Chromium, not just typechecked. Fixed the same way Section 17M's form was —
`type="text" inputmode="decimal"`/`inputmode="numeric"` — keeping the state a genuine string end to
end, matching every other text field on the same form.

### Threaded, reportable coverage discussion — confirmed real, not rebuilt, plus one real gap closed

**Confirmed live, not assumed from reading the code:** `Comment.parent` (self-FK,
`related_name='replies'`) and `CommentSerializer`'s own writable `parent` field already threaded a
reply correctly end-to-end through `MaterialCoverageViewSet.comments`'s existing POST branch — a
root comment, a reply, and a second-level reply-to-a-reply all threaded correctly on the first live
`curl` attempt, with zero code changes needed for the threading itself. The frontend side was
**already built too**, further along than a from-scratch read of this feature's own brief would
suggest: `CoveragePopover.svelte` already called `submitComment(..., parentId)`,
`DiscussionThread.svelte` already ran `buildCommentTree`/`CommentNode.svelte` (the exact same
recursive tree-building and rendering the exercise detail page's own discussion already uses — one
shared component, not two parallel ones), and `CommentNode.svelte` already had a visible **Reply**
button, correct nested-reply indentation, and a `ReportButton` per comment. All three of these were
verified live via headless Chromium against real coverage-claim data, not inferred from the
component reading correctly: a root comment, a reply, and a reply-to-a-reply all rendered nested
correctly in the actual DOM.

**The one real gap: no validation that a submitted `parent` actually belongs to the SAME target's
own comment set.** Before this fix, a client could pass an arbitrary comment id belonging to an
entirely different coverage row's — or a different content type's — own thread, and it would
silently "reply" there instead. Fixed in `MaterialCoverageViewSet.comments` (materials/views.py):

```python
parent = serializer.validated_data.get('parent')
if parent is not None and (
    parent.content_type_id != content_type.id or parent.object_id != coverage.pk
):
    return Response({'parent': [...]}, status=status.HTTP_400_BAD_REQUEST)
```

Checked in the view, not the serializer's own `validate()` — `content_type`/`object_id` are never
part of the client-submitted data at all (the view sets them itself right after), so the serializer
has no way to know what target it's about to be saved against until this point. **The identical
gap existed in `ExerciseViewSet.comments` (exercises/views.py) too**, confirmed by re-reading that
action's own code — the same fix was applied there as a bonus, since it's the same bug class in the
sibling comment endpoint, not a new one this feature introduced. Verified live both directions: a
`parent` naming a comment on a *different* `MaterialCoverage` row is rejected with 400; a `parent`
naming a real Comment attached to an *Exercise* instead is also rejected; a `parent` from the *same*
coverage's own thread still threads correctly, confirmed via the real listing endpoint afterward.

**Comment reportability — confirmed real and fully generic, not rebuilt.** `moderation/services.py`'s
`REPORT_KIND_MODELS = {'exercise': Exercise, 'comment': Comment, 'review': Review}` means ANY
`Comment` row is already reportable via the existing `POST /api/reports/`, `kind='comment'`,
regardless of what that comment's own `content_type`/`object_id` points at — verified live with a
real `POST` against a comment attached to a `MaterialCoverage` specifically (not just an Exercise,
which every prior report-system test already covered), confirmed as a real `Report` row afterward.
`check_auto_hide` was also confirmed to gracefully no-op for this case (no crash, no division by
zero) — `resolve_view_scope_exercise` has no viewer-pool concept for a `MaterialCoverage` at all, so
three real reports against a coverage-attached comment correctly never auto-hide it, matching this
service's own documented honesty about that gap rather than a real bug. The frontend's own
`ReportButton.svelte` was likewise already wired into `CommentNode.svelte` generically, so a coverage
reply gets the identical Report affordance an exercise-page comment already has — the same shared
component, not a second one built for this feature.

### `Material.price_amount`/`price_currency`/`estimated_minutes`

```python
price_amount = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
price_currency = models.CharField(max_length=3, default='PLN', blank=True)
estimated_minutes = models.PositiveIntegerField(null=True, blank=True)
```

Both genuinely optional — a material that sets neither behaves exactly as before this feature
existed; `price_currency` only means anything once `price_amount` is actually set. **`estimated_minutes`
was chosen over a page-count "length" field, the other real option on the table, because it's the
more directly useful signal across every material type this app actually has** — a script, an exam
collection, a slide deck — and doesn't require a page count nobody has ever recorded for this corpus
(`material.yaml` never carried one). The identical pair of fields was added to `MaterialSubmission`
(so a new upload can optionally declare both at submission time) and carried over onto the real
`Material` row by `_apply_material_submission` the moment it's approved.

`MaterialSerializer`/`MaterialSubmissionSerializer` both expose these as plain passthrough fields —
no custom serializer logic needed, since neither is translatable text. `MaterialCard.svelte` renders
"29.99 PLN"/"~45 min" pills only when the respective field is actually set — deliberately **no**
"Free"/"No estimate" placeholder text for the unset case, since most materials in this corpus stay
free/no-estimate and a placeholder on every single card would be far noisier than simply rendering
nothing, the same restraint this app's own Section 17C already applied to `Material.type` before
that badge existed at all.

### Verified end-to-end against the real running dev servers, not assumed from the code alone

**Backend, live via `curl`:** the full requirements PUT lifecycle (401 anonymous, 403 a plain
authenticated user with no governor grant, 200 for global staff, 200 for a real course-scoped
`NodeGovernor`, 403 for a governor of a *different* course); a real multipart submission carrying
`requirements`/`price_amount`/`price_currency`/`estimated_minutes` together, confirmed round-tripping
correctly through approval into a real `Material` + its own ordered `MaterialRequirement` rows; the
full threading/cross-target-rejection/reporting sequence above.

**Frontend, headless Chromium (`playwright-core`), against the real running dev servers:** a real
material's requirement chips and price/time pills render correctly; the governor-only edit trigger
is present for a staff account and absent for a plain authenticated one, with the chips themselves
still visible read-only to both; opening the editor, adding a requirement, removing one, and saving
correctly updates the rendered chips end-to-end (confirmed via the real PUT, not just local state);
the `/submit-material` form's own requirements list, price, and estimated-time fields all round-trip
into a real, correctly-shaped `MaterialSubmission` (confirmed via a direct API read afterward); the
coverage-discussion root/reply/nested-reply/report flow, all live, zero console/page errors across
every run. All scratch data created for verification (test users, submissions, materials, coverage
comments, reports, requirement rows) was cleaned up afterward, confirmed removed via direct queries
— not just hidden client-side. `npm run check`/`lint`/`build` and `manage.py check`/
`makemigrations --check --dry-run` all clean throughout.

### Round 2 — closing out the five items the first pass left open

**Status: ✅ all five closed.** Backend suite grew from 144 to **147 tests, all passing**. Same
rigor as the first pass: real tests, real end-to-end verification against the running dev servers
(not just `svelte-check`/`manage.py test` in isolation), every new string in both `en.json`/
`pl.json`, everything left uncommitted.

**1 — the moderation queue's Materials tab now surfaces a pending submission's requirements/price/
time.** `routes/moderation/+page.svelte`'s Materials tab renders a new `.submission-declared` block
per pending row — a `Requirements:` label plus one chip per declared requirement (reusing the same
`.requirement-chip` visual language `MaterialCard.svelte` already established, so a moderator sees
the identical presentation a reader eventually will), and the existing `material_price`/
`material_estimatedMinutes` message keys for price/time, all three rendered only when actually
present on the submission — no "Free"/"No estimate" placeholder noise for the common case where
none of the three were declared. Verified live: a real pending submission carrying
`requirements: ['Requirement One', 'Requirement Two']`, `price_amount: '12.50'`,
`price_currency: 'EUR'`, `estimated_minutes: 25` rendered all three correctly in the moderator's own
queue view before any approve/reject decision was made.

**2 — a real currency `<select>`, everywhere `price_currency` is edited, plus a `choices=` decision
made and documented.** `Material.price_currency`/`MaterialSubmission.price_currency` both gained
`choices=CURRENCY_CHOICES` (materials/models.py — `MaterialSubmission` imports it from
`materials.models`, no circular-import risk, confirmed: `materials/models.py` has no import of
`moderation` anywhere) — four real, curated values (`PLN`/`EUR`/`USD`/`GBP`), the same "mirror a
small backend enum, flag the drift risk" convention `DONATION_PLATFORMS`/`SOURCE_TYPES` already
establish elsewhere in this app's own sibling project, applied here for the first time to this
project. **The `choices=` decision, made explicitly, not defaulted to:** yes, constrain the model
field — this app has no multi-currency payment processing anywhere, `price_amount`/`price_currency`
are purely display-only fields, so `choices=` follows the exact same precedent
`Material.type`/`Exercise.difficulty` already establish for a small, real enum rather than a bare,
unvalidated `CharField`. **The real tradeoff, named plainly rather than silently accepted:** a
governor wanting to price a material in an exotic currency this 4-value list doesn't cover can't do
it through the UI without a backend change — four currencies deliberately covers this platform's
own real, likely case (a Polish university, PLN by default, with EUR/USD/GBP realistic for an
international audience), not an attempt to be a general-purpose currency picker. The frontend's own
`MATERIAL_CURRENCIES` (`lib/utils/labels.ts`) is a hand-maintained mirror of the same 4-value list,
flagged in both files' own comments as the one place drift could creep in — the same honesty this
codebase's own `NOTIFICATION_TYPE_CATEGORY`/`DONATION_PLATFORMS` mirrors already carry. Wired into
the one real place `price_currency` is ever edited (`/submit-material` — confirmed via grep there is
no separate "governor edits an existing material's price" surface anywhere in this app; only
`requirements` got a governor-facing edit surface in round 1, not price/time, so this is the whole
scope). Verified live: the select renders exactly `PLN`/`EUR`/`USD`/`GBP`, and picking `USD` sticks
and round-trips through a real submission.

**3 — real drag-and-drop reordering for `RequirementsEditor.svelte`, plus keyboard Up/Down buttons,
not one without the other.** Native HTML5 `dragstart`/`dragover`/`drop`/`dragend` — no drag library,
matching this app's own "no existing DnD precedent to match, keep it simple" scope call; `draggedIndex`
tracks the row being moved, dropping onto another row splices it out and back in at the target index
via a shared `moveLabel(from, to)` helper. **The explicit "don't ship mouse-only reordering when
keyboard support is cheap" instruction was followed literally, not treated as optional:** every row
also gets a pair of Up/Down icon buttons (`aria-label`s reading `Move {label} up`/`Move {label} down`,
two new message keys in both locales), correctly `disabled` at each boundary (the first row's Up, the
last row's Down) — genuinely reachable and operable via keyboard alone, not a decorative pair sitting
beside a mouse-only drag handle. Verified live with a real headless-Chromium session: the keyboard
buttons correctly reorder a 3-item list both directions and correctly disable at both boundaries; a
synthesized native `DragEvent` sequence (`dragstart`→`dragover`→`drop`→`dragend`, dispatched directly
against the DOM nodes with a real `DataTransfer` object, since Playwright's own mouse-simulation API
can't drive genuine HTML5 DnD) correctly moved the last item to the front; saving persisted the
final, drag-and-keyboard-reordered sequence through the real `PUT` endpoint, confirmed via a direct
API read afterward. **A deliberate scope decision, stated plainly rather than left unstated:**
`/submit-material`'s own separate, simpler requirements list (a plain `<ul>` with just remove
buttons, not `RequirementsEditor`) did **not** get the same drag/keyboard reordering — the
coordinator's own instruction named `RequirementsEditor.svelte` specifically, and a brand-new
submission's own draft order is materially lower-stakes than reordering an already-published
Material's real, live-facing requirement list; adding it there too would be a reasonable follow-up,
not something this round treated as in scope.

**4 — a real, case-insensitive duplicate-label guard, on both write paths, rejecting rather than
silently deduping.** `materials/services.py` gained two small, shared functions —
`clean_requirement_labels` (the trim+drop-blank step both paths already needed) and
`find_duplicate_requirement_label` (a plain case-insensitive-after-trim scan, returning the first
duplicate's own original-cased label for a readable error message, or `None`) — imported by both
`materials/views.py`'s governor-only bulk-replace action and `moderation/serializers.py`'s
`MaterialSubmissionSerializer.validate_requirements`, so the two write paths share one definition of
"is this a duplicate" rather than two independently-drifting copies, the same "one definition, not
two" discipline this project's own `_vote_weight`/`_net_vote_weight` split already established for a
different pair of call sites. Both reject with a real 400 (`ValidationError` on the submission path,
a structured `{'requirements': [...]}` 400 on the governor-PUT path) naming the specific duplicate —
never a silent dedupe. Two new tests on the governor-PUT side (an exact duplicate, and a
case-insensitive-after-trim one — `'English B2+'` vs. `'  english b2+  '`), one new test on the
submission side (the identical case-insensitive scenario at `POST /api/material-submissions/`),
confirming both a rejected PUT and a rejected submission leave zero requirement rows behind, not a
partial write.

**5 — the delete+recreate wrapped in `transaction.atomic()`, and the lost-update race genuinely
reproduced, not left purely theoretical.** `materials/views.py`'s `requirements` action now wraps
`material.requirements.all().delete()` + `MaterialRequirement.objects.bulk_create(...)` in a plain
`with transaction.atomic():` block — no `select_for_update()` (this app's own SQLite dev database has
no row-level locking at all; Django silently no-ops that call rather than raising, the exact lesson
Section 17I's own "select_for_update()/atomic() detour" note already learned the hard way for a
*different*, much slower, multi-statement apply sequence). **The distinction that makes this
`atomic()` safe where that earlier one wasn't, stated explicitly rather than assumed:** Django's
SQLite backend holds an exclusive write lock for the *full duration* of an `atomic()` block, not per
statement — Section 17I's own trap came from wrapping several real, cross-table queries (target
resolution, number allocation, translation creation) in one such block under real concurrent write
pressure, turning a moderate wait into `database is locked` failures. This block is two fast,
adjacent statements against one table — the same low-risk shape `ExerciseSetSerializer.update()`'s
own transaction already uses elsewhere in this codebase — so the fix here is real ("if `bulk_create`
ever fails partway, the preceding `delete()` rolls back with it, never leaving zero requirements on
a Material that started with some") without reintroducing that earlier trap. **Full optimistic
concurrency (a version check) was judged genuine overkill for this specific action** — a governor-
only, low-frequency, low-stakes admin edit, not a page under real concurrent write pressure — so per
the explicit instruction, the lost-update scenario was **reproduced once, for real, rather than left
theoretical:** 30 genuinely simultaneous `curl` PUT requests (15 backgrounded processes submitting a
3-item list, 15 submitting a different 2-item list, `wait`'d together) against a real running dev
server and a real seeded Material — all 30 returned `200`, zero crashes, zero `500`s, and the final
DB state was confirmed to be **exactly one of the two submitted lists in full**, never empty, never
a mix of both — the honest "safe, last-write-wins, not perfectly linearizable" outcome this endpoint's
own docstring already promises, the same class of residual-but-safe outcome Section 17K's own
`ExerciseTranslation` race investigation already reasoned through and declined to chase further for
a comparably rare, low-stakes case. Documented plainly in the action's own docstring, not just here.

### Left open, not built

- **No reordering UI for `/submit-material`'s own, separate requirements list** — deliberate, see
  item 3's own scope note above; `RequirementsEditor.svelte` (the governor-facing editor) is the one
  place drag/keyboard reordering was built.
- **The 4-currency `choices=` list can't express an exotic currency a governor might genuinely want**
  — the real, named tradeoff of item 2 above; widening the list (or exposing a `choices=`-bypassing
  "other" free-text escape hatch) would be a small, real follow-up if this ever becomes a genuine
  ask, not something this round built preemptively.
- **The reproduced concurrent-PUT race (item 5) confirms "safe, not perfectly linearizable," the same
  residual outcome Section 17K already accepted for a different endpoint** — fully eliminating it
  would need real cross-request mutual exclusion keyed on the Material id itself, which this
  codebase has already learned (the hard way, Section 17I) can make things measurably *worse* under
  SQLite's own real concurrent-write behavior rather than better. Not chased further, by the same
  judgment call Section 17K already made explicit for its own sibling race.
- **No duplicate-label check across a re-submission's own history** — the guard is per-request only
  (two labels in the SAME body); nothing stops two separate, sequential saves from each individually
  containing no duplicates while still layering the same label in twice across two different
  governors' own edits at different times (the second save's own full-replace semantics mean this
  can't actually happen in practice, since a full replace always starts from the submitted list
  fresh — flagged for completeness, not because it's a real gap this endpoint's own full-replace
  shape leaves open).

## 17P. Feature: Tutoring/services listings, and real user-to-user messaging (✅ built, full stack)

Two new apps, built together since the second is what makes the first actually useful beyond a bare
listing page: a real, course-scoped "Services" listing (a tutor advertising themselves against one
or more real Courses from the existing taxonomy) and real user-to-user messaging, so a visitor can
actually reach out to a listing's own provider rather than the listing being a dead end.

### Backend — `services` and `messaging`, both already built and wired in before this pass began

`services.Service` (`provider`, `title`, `description`, `courses` M2M to `taxonomy.Course`,
`hourly_rate`/`currency` — display-only, this app has no real payment processing anywhere —
`is_active`) is deliberately the fuller, structured sibling of `accounts.Profile.offers_tutoring`
(2.12/Section 9's own note): the bare flag is "I'm open to being asked," a `Service` is a real,
course-scoped marketplace-style presence a visitor can browse and filter by course. `ServiceViewSet`
matches this app's own established "public GET, owner-scoped writes" split (`ExerciseSetViewSet`)
exactly — `?course=<slug>` for course-scoped discovery, `?mine=true` for a registered user's own
listings (including paused ones the public browse never shows), and a non-owner's write attempt
correctly 404s (queryset-scoping, not permission-checking, the same pattern `NodeGovernorViewSet`
already establishes).

`messaging/` has no models of its own — it's a thin DRF wrapper over **django-postman**'s own
`Message` model and `pm_write()` API (verified against PyPI directly before choosing it over the
older, unmaintained `django-messages` alternative). django-postman ships no equivalent for a REPLY
within an existing thread (only its own Django form classes handle that) — `reply_to_message()`
(`messaging/services.py`) replicates that exact thread-linking sequence, read directly from the
installed package's own `BaseWriteForm._save()` source, not guessed: the first-ever reply promotes
the original message into being its own thread root (`parent.thread = parent`), and every reply
after that inherits the same `thread_id`. The reply's own recipient is "whoever isn't the current
replier" on the parent message, not unconditionally `parent.sender` — a real back-and-forth
conversation, not a one-way restriction. `django.contrib.sites` is a genuine, confirmed-necessary
dependency of django-postman itself (its own `api.py` unconditionally imports the `Site` model at
load time), not an optional extra. Auto-moderation is off (no `POSTMAN_AUTO_MODERATE_AS` configured)
— every message is immediately accepted, and `skip_notification=True` throughout since this project
has no real email backend configured (the same honest gap `PasswordResetView`'s own stub already
flags) — messages are surfaced via this app's own REST endpoints, not email.

`MessageViewSet` (a plain `GenericViewSet`, not a `ModelViewSet` — django-postman's own manager
methods already do the real folder-scoping work) exposes `GET /messages/?folder=inbox|sent|
archives|trash` (default `inbox`), `GET/POST /messages/{id}/` (retrieve marks read as a side effect
if the caller is the recipient and it isn't already — the natural "opening a message marks it read"
behavior), `POST /messages/{id}/reply/`, `GET /messages/{id}/thread/` (every message in the
conversation, oldest first), and `GET /messages/unread-count/` (a bell-badge count, matching this
project's own pre-existing Notification-bell precedent). Authenticated-only throughout — there's no
anonymous/visitor messaging path in this app.

### This session's own work: real automated tests, and the frontend (previously entirely unbuilt)

**Backend test coverage — both apps had only empty `tests.py` stubs before this pass, despite real,
non-trivial business logic (course-scoped filtering, message threading, unread counts, ownership
permissions) already sitting untested.** `services/tests.py` (12 tests) covers course-scoped
creation/discovery, the `?mine=`/`is_active` visibility split, unknown-course-slug rejection, and
the full owner-vs-non-owner update/delete boundary. `messaging/tests.py` (16 tests) covers sending,
replying (including the "recipient is whoever isn't the current replier" case specifically, not just
the trivial always-reply-to-sender case), thread ordering and `replies_count`, retrieve-marks-read
(and that retrieving as the *sender* does **not** mark it read or affect the recipient's count), folder
listing, invalid-folder rejection, and — the access-boundary case — a third party who's neither
sender nor recipient correctly gets a `404` from reply/thread/retrieve alike, not a `403` (matching
this app's own queryset-scoping convention). Full backend suite: **138 tests, all passing** (up from
110 before this pass); `manage.py check`/`makemigrations --check --dry-run` both stay clean.

**Frontend — built from scratch, this app's first real UI for either feature.** New types
(`service.ts`/`message.ts`, plus `User` widened with `offersTutoring`/`tutoringNote`, both already
real backend fields with zero frontend wiring before this pass), mappers (`RawService`/`mapService`,
`RawMessage`/`mapMessage`), and two new service-layer files:

- **`lib/services/tutoring.ts`** — deliberately NOT named `services/services.ts` (this app's own
  "one `lib/services/*.ts` file per backend app" convention would otherwise produce exactly that
  self-referential path), matching `ServiceViewSet` 1:1 regardless of the file's own name.
- **`lib/services/messaging.ts`** — `getMessages`/`getMessage`/`getThread`/`sendMessage`/
  `replyToMessage`/`getUnreadMessageCount`, plus `lib/state/messages.svelte.ts` (a lightweight
  unread-count rune store, mirroring `notifications.svelte.ts`'s own shape but deliberately without
  a live SSE connection — this feature has no real-time-push requirement the way the Notification
  bell's own stream does, so a plain refetch-on-the-obvious-moments discipline is honest and
  sufficient rather than duplicating that infrastructure).

**Routes**: `/services` (browse + course filter +, for an authenticated visitor, a "My listings"
tab with inline edit/pause/reactivate/delete, reusing the same `ServiceForm` the create page uses —
off one `initial?` prop, two modes, this app's own established shape), `/services/new`,
`/messages` (folder tabs, one row per individual message — matching django-postman's own
`inbox()`/`sent()` manager methods, which return one row per message, not one row per conversation),
`/messages/new` (reads `?to=`/`?subject=` from the URL — a Service listing's own "Contact" link is
the real, primary entry point, pre-filling both from the listing's provider/title), and
`/messages/[id]` (the full thread, oldest first, with a reply composer — opening it also marks
every OTHER still-unread message in the same thread addressed to the current user read, not just the
one that was clicked, the natural "viewing this conversation clears it" webmail expectation).
`Header.svelte` gained "Tutoring listings"/"Messages" nav links, the latter with an unread badge
matching the pre-existing "My Set" guest-count badge's own visual convention. The settings page
gained a real "Tutoring" section (the opt-in checkbox + note, previously a backend-only field with
no UI anywhere) and the public profile page (`/users/[id]`) gained a tutoring badge, the note, and a
"Send message" link for any other logged-in visitor. **Full i18n parity maintained** — every new
string added to both `en.json`/`pl.json` in this same pass (461 keys total in each, verified
key-set-identical programmatically before treating the pass as done), never English-only.

### Two real bugs found and fixed during live verification, not shipped broken

Both found via a real headless-Chromium session (`playwright-core`, the same cached-binary
methodology `check_accessibility.ts`/`check_katex_compatibility.ts` already establish for this
project) driving the actual running dev servers with two real logged-in accounts (Kasia/Ola) end to
end — not assumed correct from the code reading right.

1. **A genuine runtime type bug, the exact same class Section 17M's own node-governor grant form
   already hit once:** `ServiceForm.svelte`'s hourly-rate field was `<input type="number"
   bind:value={hourlyRate}>` — Svelte's `bind:value` on a `type="number"` input coerces to a real
   JavaScript `number` (or `undefined`), not the `string` `draftToBody` (`tutoring.ts`) assumed
   throughout. `svelte-check` never flagged the mismatch; the first live submission threw a real
   `TypeError: draft.hourlyRate.trim is not a function` in the browser console, caught specifically
   because verification drove the actual form rather than stopping at `npm run check`/`build`
   passing. Fixed the same way Section 17M's own identical bug was fixed:
   `type="text" inputmode="decimal"` — keeps the numeric mobile keyboard, keeps the binding a
   genuine string end to end.
2. **A real, more serious one: an uncaught 401 during server-side rendering crashed the ENTIRE Vite
   dev server process, not just the one page.** `routes/messages/+page.svelte`'s initial
   `getMessages('inbox')` call — authenticated-only (`messaging/views.py`'s `MessageViewSet`) — was
   fired eagerly at the component's own top level. Unlike this app's own pre-existing eager-fetch
   precedent (`submit-material`'s `getAllCourses()`, a PUBLIC endpoint that returns `200` with no
   token), a bare top-level call also runs during SSR, where the server-rendering process has no
   browser-stored token at all — the resulting `401 ApiError` was never caught anywhere, and Node's
   own unhandled-rejection handling took the whole dev server process down. A first fix (gating the
   initial call inside `onMount`, matching `notifications/+page.svelte`'s own precedent) closed the
   SSR-crash risk but reintroduced a *second*, more subtle race: `onMount` checks
   `authStore.isAuthenticated` exactly once, synchronously, at mount time — but a genuine hard
   reload/direct visit re-runs the root layout's own async `authStore.init()` from scratch, which
   hasn't necessarily resolved by the instant this page's own `onMount` fires, so a direct hard
   visit to `/messages` could still show an empty inbox despite a valid, persisted session. Fixed
   properly by switching to a real `$effect` — re-running whenever `authStore.isAuthenticated`
   itself changes, exactly matching `routes/moderation/+page.svelte`'s own pre-existing, correct
   solution to the identical problem (`$effect(() => { if (authStore.canModerate) load(); })`) — with
   a `loadedOnce` guard so the effect doesn't re-fire and silently reset the folder tab back to
   "Inbox" on some later, unrelated reactive change once the real fetch has already happened.

### Verified end-to-end, live, not assumed from the code alone

A full real-account, two-browser-context run (Kasia and Ola, both real seeded demo users): Kasia
creates a course-scoped listing through the real form; it appears in the public browse tab with the
course correctly resolved to its real name (not a bare slug) and in her own "My listings" tab; pausing
it flips the status pill correctly. Ola, browsing, sees a real "Contact" link (correctly absent on
Kasia's own listings when Kasia views them) that opens the compose form with the recipient and
subject correctly pre-filled from the listing; sending lands on a real, new thread page showing her
own message bubble, with **no** false unread badge for her own outgoing message. Kasia sees a real
unread badge, the inbox correctly marks the row unread, opening the thread clears the badge and shows
exactly the one message; replying correctly grows the thread to two messages. Ola then sees a real
unread badge for the reply and the full two-message thread. Separately: enabling the tutoring opt-in
and note in Settings correctly shows both on Kasia's public profile, alongside a working "Send
Message" link. **Zero console/page errors across the entire run** once both bugs above were fixed.
`npm run check` (0 errors/0 warnings), `eslint` (clean), `npm run build` (succeeds), and the full
backend suite (138/138) all confirmed clean after every fix, not just at the start.

### Left open, not built

- **No user-search endpoint** — composing a new message means already knowing the recipient's real
  user id (via a Service listing's own "Contact" link, or a profile's own "Send Message" link);
  there's no way to start a conversation with an arbitrary user you don't already have a link to.
  Same honest v1 limitation Section 17M's own node-governor grant form already documents for the
  identical reason.
- **No message edit/delete/report, no attachments** — this app's messaging surface covers exactly
  what a listing inquiry needs (send, reply, thread, unread count); nothing beyond that was built.
- **No archiving/trash UI** — `MessageViewSet`'s own `folder=archives|trash` query values are real
  and already wired (django-postman's own manager methods back them), but the Inbox page only ever
  offers Inbox/Sent tabs; a visitor can't archive or delete a conversation from the UI today.
- **No donation-link-style reordering for a provider's multiple Service listings** — a "My listings"
  row order is whatever the backend's own `-created_at` ordering returns, no manual reordering.
- **No moderation/reporting surface for either a Service listing or a message** — unlike
  Exercise/Material/Comment, neither of these new content types is wired into the existing
  `Report`/auto-hide system. A real, if narrow, gap worth naming rather than silently leaving
  unstated, since both are genuinely public-facing, user-generated content.

## 17Q. Security scan follow-through: avatar uploads, auth rate limiting, and material provenance (✅ built)

A whole-project scan for sanitization/validation gaps (file-upload paths, XSS, SQL injection, CORS,
rate limiting) found four real items. Two were closed in the preceding pass — server-side `bleach`
sanitization (`config/sanitize.py`, the "sanitize on save too" layer Section 11 always specified but
never built) and the `renderContent.ts` SSR bypass that returned raw, unsanitized HTML whenever
`window` was undefined. This section covers the remaining two, plus a related provenance gap.

### 1. `Profile.avatar` had zero file validation — and no way to write to it at all

The field has existed since Phase 2 as a bare `ImageField(upload_to='avatars/')` with **none** of the
three layers `materials/validators.py` applies to a Material upload. It was never exploitable, for
the accidental reason Section 17B already recorded as a missing feature: there was no avatar upload
UI anywhere, and `avatar` is deliberately absent from `ProfileUpdateSerializer`'s writable fields.
Building the upload is precisely the moment that stops being theoretical, so the validation landed in
the same change as the feature.

**The core decision: never store the bytes the uploader sent.** `accounts/avatar.py`'s
`process_avatar` decodes every accepted image and **re-encodes** it from scratch. This is strictly
stronger than the content-type sniffing a Material upload gets, for a reason worth stating: sniffing
answers "does this look like a real image?", which a **polyglot** (a valid image whose trailing bytes
are also a valid archive/script) answers "yes" to as honestly as a genuine photo does. Re-encoding
does not ask the question — it discards every byte that is not pixel data. A Material upload cannot
do this (a PDF must stay the submitter's PDF); an avatar can, because nothing about the original file
is worth keeping once the pixels are extracted. Verified directly: a real image with a PHP payload
appended survives content sniffing and does **not** survive the re-encode.

Four checks, in the order they must happen:

1. **Byte cap** (5 MB) — cheap, first, before anything decodes.
2. **Content sniffing** via the same `python-magic`/libmagic binding `materials/validators.py` uses.
   Kept even though step 4 makes it non-load-bearing for safety, purely for a better error message
   than Pillow's generic decode failure.
3. **A decoded-pixel cap** (40 MP), checked against the header's declared dimensions BEFORE any pixel
   data is read. **This is the check that is easy to miss and the reason a byte limit alone is not
   enough:** compression ratios are unbounded, so a perfectly valid ~140 KB PNG can declare
   12000x12000 and decode to gigabytes of resident memory — a real decompression-bomb DoS from a file
   that passes both checks above. Confirmed with a real such file, not reasoned about. Pillow's own
   `MAX_IMAGE_PIXELS` defaults to ~89 MP and only *warns* below 2x that, so this module sets its own
   much lower explicit bound rather than relying on that default.
4. **Full re-encode** — decode, honor EXIF orientation, centre-crop square, resize, write fresh WebP.

**EXIF is stripped, which is a privacy fix, not only a security one.** A phone photo routinely carries
GPS coordinates; publishing them alongside a public profile picture leaks where the account holder
physically was. Re-encoding drops the block by construction (Pillow only writes EXIF when handed it).
The one tag that must be *honored* before being discarded is `Orientation` — phone photos are often
stored sideways with a tag saying to rotate, so stripping without applying would silently turn every
such upload 90°. `ImageOps.exif_transpose` bakes it into the pixels first. Both properties are pinned
by tests, the orientation one by difference (tagged and untagged input must not produce identical
output).

**Sizing and format, as real decisions rather than defaults.** 512x512, not the 256 an avatar's
largest on-screen appearance suggests: 2x/3x device pixel ratios are the norm, so a 128 CSS-pixel
avatar genuinely needs 384 real pixels, and a 512 WebP is ~13 KB — the headroom costs nothing.
**Alpha is preserved rather than flattened onto white**, because this app ships a real light/dark
theme (Section 13) and a flattened logo-style avatar would be a bright rectangle in one of them.

`POST`/`DELETE /api/auth/me/avatar/` (`AvatarView`) is its own endpoint rather than a writable field
on `ProfileUpdateSerializer` (where `avatar` correctly stays absent): the request is multipart not
JSON, the upload needs its own tighter throttle scope, and removing an avatar is a genuine file
delete, not a field set to null. `process_avatar` raises Django's `ValidationError`, which DRF does
**not** translate into a 400 on its own — an uncaught one is a 500 — so the view translates it
explicitly into this API's usual `{field: [messages]}` shape, pinned by its own test. The previous
file is deleted before a replacement is saved: Django's `FileField` does not clean up a replaced
file, and the random UUID names mean nothing would ever overwrite one, so without this every
re-upload would orphan its predecessor forever (verified by counting files, not assumed).

**Frontend — a real crop step, so the user picks which square is used.** `svelte-easy-crop` (v5.0.1,
`svelte: ^5.0.0` peer dependency — a genuine Svelte 5 component, not a Svelte 3/4 package on the
compatibility layer; chosen over the more widely-used `cropperjs` v2, which is a web-component API
that would need wiring by hand). It returns the selected region in natural image pixels, which is
exactly what a single `drawImage` with an explicit source rectangle needs — no manual zoom/pan
arithmetic. **The client-side crop is a UX affordance, never a security boundary:** the backend
re-decodes and re-encodes whatever actually arrives, so a caller POSTing straight to the endpoint
gains nothing by skipping it.

**A real bug found by driving the actual browser, not by review.** The component's first version
gated on `file.type` — which the browser derives almost entirely from the FILENAME, so a Windows
executable renamed to `.png` is reported as `image/png` and sailed straight past into an **empty
cropper**, where the user would drag an invisible selection and only learn anything was wrong when
Save failed. Caught because the verification script tested the rejection path through the real form
rather than only via `curl`. Fixed by actually attempting to decode the file: the browser's own image
decoder answers the question from the bytes, which is the same question libmagic asks server-side and
the one `file.type` cannot.

### 2. No rate limiting anywhere in the API

Zero DRF throttle classes were configured, so `POST /api/auth/login/` accepted unlimited password
guesses against any account.

**Two throttles on login, not one, because they stop different attacks.** DRF's `AnonRateThrottle`
keys on client IP — right for one host hammering the endpoint, and useless against credential
stuffing, where a leaked list is replayed against one account from a distributed pool and never trips
any single IP's counter. `LoginUsernameRateThrottle` (`accounts/throttles.py`) keys on the submitted
identifier instead. Neither subsumes the other, so `LoginView` applies both (set via
`throttle_classes`, not `throttle_scope`, since `ScopedRateThrottle` supports only one scope per
view). The identifier is normalized (trimmed, lowercased) so capitalization cannot mint a fresh
budget, then SHA-256'd so what lands in the cache is a digest rather than a plaintext list of every
email anyone has tried to log in as.

**The limitation is stated rather than papered over:** an identifier-keyed throttle is itself a DoS
lever — someone who knows a victim's email can burn that account's budget. Hence the per-username
rate is deliberately much looser than the per-IP one, sized to stop a systematic search rather than
to make typos expensive. The real fix is a lockout counting only FAILED attempts and clearing on
success, which DRF's framework has no notion of — it counts requests, not outcomes. A test pins that
actual behavior (a correct password still counts toward the limit) rather than leaving a future
reader to assume otherwise.

Scoped rates elsewhere: `register`, `password_reset`, and `avatar` (the most expensive authenticated
write in the app — it decodes and re-encodes a real image, so an unbounded rate is a CPU-exhaustion
lever). `password_reset` has nothing to brute-force *today* — it is still the honest always-200 stub
Phase 2 shipped — but the moment a real email backend lands it becomes an unauthenticated endpoint
that sends mail to a caller-chosen address, and the limit is far easier to add now than to remember
then. The two global backstops (`anon`/`user`) are deliberately loose: this is a browse-heavy app
where one exercise page fires several requests and the moderation page more than a dozen, so a tight
global limit would break ordinary reading long before inconveniencing anyone abusive.

**A real deployment caveat, flagged in both `config/settings.py` and `accounts/throttles.py`:** DRF
throttling counts through Django's cache, and this project configures no `CACHES` at all — so the
default per-process `LocMemCache` applies and every worker in a multi-process deployment keeps its
own counter, multiplying every rate by the worker count. Correct for this prototype's single-process
dev server; a real deployment needs a shared cache before these numbers mean what they say.

**Testing these required finding a real trap.** `SimpleRateThrottle` binds
`THROTTLE_RATES = api_settings.DEFAULT_THROTTLE_RATES` as a CLASS attribute, evaluated once at import
time — so `override_settings(REST_FRAMEWORK=...)` genuinely does not reach it, and a test written
that way runs against production rates while appearing to declare its own. Found the hard way: the
first version failed because 4 requests understandably did not trip a 10/min limit. `patch.dict` on
the shared dict every subclass inherits is what actually works. The cache must also be cleared
between tests, or one test's requests spend the next one's budget and results depend on execution
order.

### 3. Material submissions had no author or source

Related, and surfaced by the same "what do we actually know about an uploaded file?" question.
`Material.author` existed (free text — the real corpus's `material.yaml` values are human names like
a course TA, almost never a platform account); **neither** `Material` nor `MaterialSubmission` had
any record of where a file came from, and `MaterialSubmission` had no author field at all.

`source_url` (a `URLField`, not free text — provenance nobody can follow is worse than none) is now on
both models, and `author` on both. Genuinely distinct fields: `author` is WHO wrote it, `source_url`
is WHERE it came from, and neither answers the other — a TA's own handout has an author and no
traceable source; an anonymous departmental script has the reverse. Both are optional by design: a
scan of a paper handout has no URL, and forcing one would produce fabricated provenance, which is the
exact opposite of the point. All 7 legacy corpus materials are correctly blank (`material.yaml` never
carried a source), rather than backfilled with invented values.

**Why this matters beyond bookkeeping:** Section 18 item 2 is a still-open ⚠️ on the copyright status
of transcribed course material — a question that cannot even be investigated for a given file without
a record of its origin. And the uploader is the *only* person who ever knows: a moderator looking at a
pending PDF cannot recover its author or source from the bytes, so if the form never asks, the
information is not merely missing from the record, it is unrecoverable. Hence both are surfaced in the
moderation queue's Materials tab alongside the file link — the approve/reject click is exactly where
that judgment gets made, so the evidence belongs in front of the person making it, not only in the
database. `_apply_material_submission` carries both onto the real `Material` row on approval.

`MaterialCard` now shows both. A real, pre-existing bug fixed in passing: `author` hung off an
`{:else if}` on `submittedBy`, so a material with both silently showed only the submitter — fine when
nothing collected an author, wrong now that submissions routinely carry both. The source renders as a
plain underlined link, deliberately not styled as a button like the download beside it: following a
provenance link is a secondary, informational action, and equal visual weight would misrepresent what
the reader is there for. `rel="nofollow"` throughout, since the URL is user-submitted.

The submit form's source field is `type="text" inputmode="url"`, **not** `type="url"` — its native
validation would reject a perfectly reasonable `example.edu/handout.pdf` typed without a scheme, so
the form normalizes a missing scheme to `https://` instead of bouncing the whole submission. (This
also sidesteps the Svelte 5 `bind:value` coercion bug this project has now hit twice, Sections
17M/17O.)

### Verified end-to-end, live, not assumed from the code

**Backend, direct against the running dev server:** a real 900x600 JPEG carrying genuine GPS
coordinates, a camera make, and `Orientation=6` uploaded to a 512x512 WebP with zero EXIF, no GPS, no
ICC profile (13.4 KB); a real Windows PE renamed `.png` rejected with `detected: application/x-dosexec`;
a real 140 KB / 144-megapixel decompression bomb rejected before decode; anonymous upload 401; a
re-upload leaving exactly one file on disk; DELETE removing both field and file. Login throttling
confirmed returning a real 429 with `Retry-After` guidance after the limit. The full material
provenance round trip — submit with author + source, both visible in the moderator's queue, both
carried onto the published `Material`, an invalid URL rejected with a real 400.

**Frontend, headless Chromium against the real running app** — 17 checks on the avatar flow (the crop
panel opening, the cropper rendering the picked image, the zoom slider and a real drag both operable,
Save firing a real 200, the resulting image genuinely LOADING at `naturalWidth=512` rather than merely
having an `src`, persistence across a hard reload, the avatar appearing on the public profile,
removal, and the disguised-executable rejection through the actual form) and 8 on the material form,
zero console/page errors on both. All scratch data created for verification (test materials,
submissions, uploaded files) was cleaned up afterward and confirmed removed by direct query — the
corpus is back to its real 7-material baseline.

**24 new backend tests** (`accounts/test_avatar.py` 17, `accounts/test_throttling.py` 7) plus 5 for
material provenance in `moderation/tests.py`. `npm run check` (0 errors/0 warnings, 872 files),
`eslint`, and `npm run build` all clean; `manage.py check` and `makemigrations --check --dry-run`
clean.

### Left open, not built

- **A failed-attempt lockout** (counting failures, clearing on success) is the real answer to the
  brute-force problem; DRF's throttling counts requests, not outcomes, so this needs something outside
  that framework. The current throttles are a genuine, working mitigation, not a complete solution.
- **No shared cache configured**, so the rates are per-worker in any multi-process deployment — see
  the caveat above. A real deployment concern, not a code gap.
- **No identicon/generated placeholder** for an account with no avatar — a plain neutral placeholder
  renders instead. Inventing a second visual identity for an account is a larger decision than this
  feature's scope.
- **No avatar moderation or reporting.** An uploaded profile picture is public, user-generated content
  and is not wired into the `Report`/auto-hide system the way Exercise/Material/Comment are — the same
  gap Section 17P already names for Service listings and messages.
- **`source_url` is not verified to resolve.** Nothing checks that the link is reachable, or that it
  actually points at the material it claims to; it is a declaration by the uploader, surfaced for a
  human to weigh, not a validated fact.
- **No backfill path for the 7 legacy materials**, deliberately — see above; inventing provenance
  would defeat the purpose of recording it.
## 17R. Feature: online/in-person tutor offers, with real OpenStreetMap locations (✅ built, full stack)

"Users need to be able to post tutor offers and specify if stationary or virtually (if stationary
location, so we need to have openmaps connected)." `services.Service` (Section 17P) already had
everything about a tutoring offer EXCEPT how you attend it — a student could not tell whether a
listing meant video calls or a room in Warsaw, which is the first thing they need to know.

### `delivery_mode` — one choice field, not two booleans

`online` / `in_person` / `hybrid`. Deliberately a single choice rather than an `is_online` +
`is_in_person` pair: two booleans make an illegal fourth state representable — neither set, a listing
nobody can attend — that every read site would then have to defend against. A choice field cannot
express it at all.

`hybrid` is a real third answer, not a convenience. "Online, or in person if you come to Warsaw" is a
common offer, and collapsing it into either neighbour loses information a student filters on. It
therefore matches **both** filters rather than neither — a hybrid tutor genuinely satisfies someone
who wants to meet in person, and excluding them from both would hide the most flexible listings from
everyone, which is precisely backwards.

`default='online'` is what makes the migration safe for the listings that already existed: every one
of them predates the field and made no claim about location, so the only honest default is the mode
that requires none. Backfilling them as in-person would invent a location none of them declared.

**The mode and the location are kept consistent in both directions**, by
`ServiceWriteSerializer.validate`: an in-person or hybrid listing without coordinates is rejected, and
switching a listing back to online-only actively CLEARS its location rather than merely ignoring it.
The second half matters as much as the first — a stale pin left behind would keep rendering a map for
a place the tutoring no longer happens, which is worse than showing nothing, because it is wrong
rather than absent. The validation reads the mode from the *instance* when a PATCH does not supply
one, so a partial update that touches only the coordinates is still checked against the mode the
listing already has.

### OpenStreetMap, in two halves: Nominatim (geocoding) and Leaflet (the map)

**Geocoding is proxied through the backend** (`services/geocoding.py`,
`GET /api/geocode/`), not called from the browser. Calling Nominatim directly from the frontend is
less code and what most tutorials show; it is also a real violation of its usage policy, which drove
the whole design:

1. **The policy requires a `User-Agent` identifying the application.** A browser `fetch()` cannot set
   `User-Agent` at all — it is a forbidden header, silently ignored — so every request would arrive
   labelled as an ordinary browser. That is exactly the anonymous traffic Nominatim blocks, and being
   blocked takes the feature down for every user at once.
2. **The policy caps the whole application at 1 request/second.** A per-browser pattern cannot
   enforce a global limit: 50 users typing at once is 50 concurrent requests and no client can see
   the others. A single server-side gate can — `cache.add`, which is atomic, as a 1.1-second mutex.
3. **The policy asks that results be cached.** Only a shared server-side cache helps; a per-browser
   cache never benefits the second user searching the same street. Cached for 24h, including empty
   results — a misspelled address would otherwise cost a real upstream request on every retry.

The endpoint is authenticated-only. Not because addresses are sensitive (they end up on a public
listing) but because it spends a shared, rate-limited third-party budget on the caller's behalf; an
anonymous one would let anyone exhaust it for every real user. It has its own `geocode` throttle
scope for the same reason. **No new dependency** — `urllib.request` from the stdlib rather than
`requests`, which is not installed and would be a new runtime dependency for two HTTP GETs, the same
restraint this project already applies to `testing/factories.py` over `factory_boy`.

**Attribution is not optional.** OSM data is ODbL-licensed; the credit string is returned *with* the
data rather than hardcoded in the UI, so the two cannot drift, and Leaflet renders its own attribution
into the corner of every map.

**Leaflet over MapLibre GL**, with OSM raster tiles. Leaflet is ~42 KB and raster OSM tiles need no
API key; MapLibre is WebGL-heavy and expects a vector tile provider, which in practice means signing
up for one. Nothing here needs vector rendering — this is a pin on a street map.

`LocationMap.svelte` is the single wrapper, with the read-only view and the picker as one component
(`interactive` toggles whether the pin can move). Three details that are load-bearing rather than
incidental:

- **Leaflet is imported dynamically inside `onMount`.** It touches `window`/`document` at module
  scope, so a top-level import executes during SSR and crashes the render — and this project has
  already taken a Vite dev server down exactly once that way (Section 17P's `/messages` 401).
  `onMount` never runs on the server, so this is the pattern that actually holds rather than one that
  merely looks careful.
- **A `divIcon` instead of Leaflet's default marker.** The default icon loads image files by relative
  URL, which every bundler rewrites — the single most common Leaflet-with-a-bundler breakage, showing
  up as a broken-image pin. A CSS-only pin sidesteps the asset question entirely and picks up this
  app's own theme tokens instead of shipping a foreign blue.
- **Scroll-zoom and dragging are off for the read-only map.** A reader scrolling past a listing should
  not have their page scroll swallowed by a map they never asked to interact with.

**The map is on the detail page only, never the browse card.** A Leaflet instance per card means a
dozen map widgets and a tile-request storm on one page, for information the card's own location line
already conveys as text.

### `?near=` — what makes a stored location useful rather than decorative

`?near=<lat>,<lon>&radius_km=<n>` filters to tutors within N km. Two stages: a bounding box in SQL
that discards almost everything cheaply, then an exact haversine pass in Python over what survives.
This project runs on SQLite with no GIS extension (Section 13), so there is no `ST_Distance` to call
and a box is genuinely all SQL can express — but the second stage is not merely an optimization: a
lat/lon box is not a circle, and box-only filtering returns corner results up to ~41% further away
than asked for. A dedicated test pins exactly that, using a query where a 300 km-distant listing falls
inside the box but outside the circle. Longitude degrees shrink toward the poles, so the box widens by
1/cos(latitude), clamped so it cannot become infinite near a pole. A malformed `near=` degrades to
unfiltered rather than erroring — this is a browse filter, and silently showing everything beats
failing the whole page.

### Four real bugs, all found by running the thing rather than reading it

1. **Nominatim returns 7+ decimal places; the model stores 6 — and DRF's `DecimalField` REJECTS
   excess precision rather than rounding it.** So the frontend faithfully echoed a search result back
   and got a 400 telling it the value it had just been handed was invalid. Fixed in two layers:
   rounding at the geocoding boundary, and a `CoordinateField` that rounds instead of rejecting, which
   covers coordinates that did not come from a search (a dragged pin, any other client). The 7th
   decimal place is ~1 cm.
2. **The 1-request/second gate fired on a single user doing nothing wrong.** "Search an address, then
   nudge the pin" is two lookups well under a second apart, and a non-waiting gate turned that into a
   user-facing "temporarily unavailable". Now waits briefly (bounded, 1.5s) and retries — what a
   well-behaved Nominatim client does, and what geopy's own RateLimiter does for the same reason. The
   tradeoff is stated in the code rather than hidden: it holds a worker thread for that bounded window.
3. **Pausing an in-person listing would have silently deleted its location.** `handleTogglePause`
   rebuilds the entire draft from the existing listing just to flip one boolean, so anything omitted
   is actively erased — the listing would have lost its pin and then failed validation for being
   in-person without one. Caught by the type checker when `ServiceDraft` grew the new fields, which is
   exactly why that type is exhaustive rather than partial.
4. **Cache keys containing spaces.** Django's `CacheKeyWarning` flagged that the raw address was going
   straight into the key. It works on the `LocMemCache` used in development and breaks on memcached —
   i.e. it would have started failing on the very backend this module's own docstring recommends
   moving to. Hashed instead, which also bounds the key length.

Two smaller ones worth recording because they cost real time: an `@use` rule inserted below other
rules (Sass requires it first), and — the genuinely baffling one — **a code comment containing a
literal HTML style tag.** The Svelte preprocessor scans for that tag textually, matched it inside the
comment, and truncated the script element there, producing a "script was left open" error pointing at
a line 25 below. Leaflet's stylesheet is now a side-effect `import` in the script rather than an
`@use` in the style block, which is what a third-party widget stylesheet actually wants anyway:
Svelte scopes styles to the component's own markup, and Leaflet's classes live on DOM it generates at
runtime, so scoping stripped all of them and produced ~170 "unused CSS selector" warnings.

### Verified end-to-end, live

**Backend, against the running dev server:** 22 checks — real Nominatim search and reverse lookups,
cache hits served in ~9 ms, anonymous access rejected, missing params 400, in-person-without-location
rejected, coordinates stored and round-tripped, switching to online clearing the pin, hybrid appearing
under both filters, `near=` including a listing 1 km away and excluding one in Rome, malformed input
degrading rather than 500ing.

**Frontend, headless Chromium against the real app:** 22 checks — the three mode radios, the picker
appearing only for in-person/hybrid, **Leaflet genuinely initialising with real OSM tiles loaded**
(6 tiles, not merely a container present), the attribution rendered on the map, submit correctly
disabled until a location exists, a real address search returning real results through the proxy,
choosing one placing the pin and enabling submit, the listing saving with mode + coordinates + label,
the detail page rendering its own map, and the browse filter including the listing under "in person"
and excluding it under "online". Zero console/page errors.

**26 new backend tests** (`services/test_location.py`). Nominatim is never actually called in the
suite — every geocoding test patches `_fetch`, because a suite that hit a public rate-limited service
would be slow, fail offline, and be exactly the abusive traffic pattern this code exists to avoid.
All scratch listings created during verification were deleted afterward, confirmed by direct query.
`npm run check`/`eslint`/`build` clean; `manage.py check` and `makemigrations --check` clean.

### Left open, not built

- **No "near me" UI.** The `?near=` filter is real, tested, and exposed through the service layer, but
  the browse page currently offers only the format filter — wiring a radius control needs a
  geolocation prompt or a "search this area" map interaction, which is its own design question rather
  than a line of markup.
- **No service-area radius on a listing.** A tutor has one exact point, not "I travel up to 10 km" —
  so a student searching a small radius may miss a tutor who would happily have come to them.
- **Only one location per listing.** A tutor teaching at two campuses must create two listings.
- **The location is not verified.** Nothing checks that a tutor can actually be found where they
  dropped their pin; it is a claim, shown for a human to weigh, exactly like `Material.source_url`.
- **Nominatim's public instance has no SLA.** The feature degrades honestly when it is unreachable
  (the map and any already-saved location still work; only new address *searches* fail, with a
  distinct "try again" message rather than a misleading "not found") but a real deployment expecting
  volume should self-host or use a commercial geocoder.
- **The 1/second gate is per-process** until a shared cache is configured — the same caveat, and the
  same one-line fix, as the auth throttles in Section 17Q.
## 17S. Feature: sign-in provider drafts, and the USOS ground (✅ built — drafts on the front, real ground behind them)

Two halves of one feature, and they are at deliberately different stages: **four sign-in providers
(School, Google, Apple, GitHub) as honest drafts**, and **the ground for USOS connections** — real
models, a real seam, real consent, real tests — which is what turns a sign-in into a verified
student, a transferred diploma and a transferred transcript, each only if the person wants it.

Everything lives in one new Django app, `backend/identity/`, plus `frontend/src/lib/components/auth/`
and `frontend/src/lib/components/settings/EducationPanel.svelte`.

### Why the buttons are drafts, and what "draft" means here concretely

The instruction was explicit: clicking a provider button should open a modal describing the current
state of that connection and linking to the repository. So there is **no mock handshake anywhere** —
a draft that quietly signed somebody in would be considerably worse than an honest button, and the
Django suite pins that (`test_no_provider_endpoint_can_authenticate_anybody`).

**The configuration, though, is real.** Every endpoint is the provider's own published URL, every
scope is one EdMat would genuinely request, and each carries the quirk that actually breaks a first
integration:

- **Apple** POSTs its response (`response_mode=form_post`) the moment any scope is requested, so a
  callback route that only accepts GET never runs at all; it sends the user's name **exactly once**,
  on the first authorization only; and its client secret is a short-lived ES256 JWT that must be
  regenerated, not a fixed string.
- **GitHub** is plain OAuth 2.0, so the token carries no identity: `/user` for the profile, and a
  second call to `/user/emails` because the email there is frequently `null` — and only the entry
  flagged verified may ever be trusted.
- **Google** is OIDC, so the `id_token` already carries identity and the userinfo call is a wasted
  round trip; what the callback owes instead is real token verification.
- **School** is SAML 2.0 federation in practice, not OAuth — which is why it shares no code with the
  three above, and is the only one that could ever return `eduPersonAffiliation`, the attribute that
  actually distinguishes a student from an alumnus from staff.

**What is missing is one thing per provider — a client id and secret** — and the modal computes that
rather than asserting it. `providers.blockers_for()` reads `settings.EDMAT_OAUTH_CLIENTS`, so
configuring a real client is what makes the UI stop calling that provider a draft, with **no copy to
remember to edit anywhere**. That is the whole reason the modal is a fetch rather than a paragraph in
a Svelte file, and it is tested directly
(`test_the_state_is_computed_from_settings_not_hardcoded`).

The modal also lists **what a real callback must check** — `state`, single-use code, server-side
exchange, full `id_token` verification on the OIDC two, and the never-adopt-an-account-on-an-
unverified-email rule for GitHub. Written down because these are the parts that are easy to skip and
expensive to skip: none of them is visible in a flow that otherwise appears to work.

### The school picker is load-bearing, not decorative

`identity.School` — 23 institutions seeded by data migration (PL, plus UA/CZ/DE), each with
`email_domains`, a grade scale, and `usos_base_url`. Matching on a domain is strict — exact domain or
a subdomain of one — so `@wne.uw.edu.pl` counts and `uw.edu.pl.example.com` does not, since a looser
rule would let anybody mint a verification badge by registering a hostname.

A blank `usos_base_url` is a **statement, not missing data**: that institution runs no USOS
installation, so the UI says so instead of offering a button whose only possible outcome is failure.
Secondary schools are deliberately not enumerated (tens of thousands in this market), so "my school
is not listed" is a real first-class answer carrying no verification — the honest outcome rather than
a gap.

### USOS: what specifically blocks a real connection, and it is not code

`identity/usos.py`. USOS API issues credentials **per institution, by that institution, to a named
application, after a request a human there approves.** There is no global key — twelve universities
is twelve registrations — and that is encoded in the design (`UsosCredentials` keyed by school slug,
capabilities probed per installation) rather than discovered later by a client that assumed one.

Three things recorded because a first implementation usually gets them wrong: **it is OAuth 1.0a**
(HMAC-SHA1, three legs — an OAuth 2 library does not apply, which is exactly why this shares nothing
with the three consumer providers); **scopes are granular and asked for up front**, so `studies` does
not include `grades`; and **installations genuinely differ**, so capabilities are probed.

`active_connector()` is the **one line** a real client replaces. The default,
`UnconfiguredUsosConnector`, verifies nobody — so a half-finished deployment cannot accidentally
appear to. `MockUsosConnector` (behind `EDMAT_USOS_MOCK`, never on by default) exists so the ground
is genuinely exercised by the test suite against the same interface a real client will implement,
rather than being plausible-looking code nobody has run; it respects granted scopes and per-
installation capabilities, so a UI bug that forgets to request a scope fails there rather than in
production. There is **no `if mock` branch in any UI**.

**There is deliberately no access-token column.** A real token carrying `offline_access` is a
long-lived credential to somebody's academic record, and this project ships an unencrypted SQLite
file. It belongs in an encrypted store keyed by the link row, and adding a plaintext column now would
be laying exactly the wrong ground.

### Grades: reconciling §3a with what was actually asked for

LAUNCHCHECKLIST §3a says grades "are not [needed], and must never be requested" — because asking for
more than is used is both a privacy failure and a reason for a university to refuse the registration.
The requested feature is that a person *may* transfer their diploma and transcript if they want to.

**Both hold, because they are two different authorizations.** `BASE_SCOPES` is what an ordinary
connection asks for (`studies`); grades are added only by an explicit, separate act by the account
holder. The registration request to each university should say exactly that — an optional,
user-initiated scope, not part of the default grant. Attempting an import without it is refused with
the real reason and the scope name, not a generic failure
(`test_grades_need_their_own_authorization`).

### Transfer and consent are never the same click

`EducationSharing` is three independent flags that all start `False`, and **a student who connects
USOS to prove they are a student and never shows a single mark is the case this is shaped around**,
not an edge case it tolerates. Importing touches no consent flag at all
(`test_importing_publishes_nothing`), and the public profile renders one field at a time as each is
allowed (`test_consent_is_granted_one_field_at_a_time`). The gating lives server-side in
`standing.public_view`, so the frontend cannot leak something by forgetting a condition.

`weighted_average` is ECTS-weighted, because that is how every institution here computes it — an
unweighted mean across a 30-credit thesis and a 2-credit elective is not an average of anything — and
it **refuses to mix scales**, returning `None` for a transcript containing ECTS letters rather than
inventing a mapping onto the Polish 2–5 scale that no registrar would sign.

Changing your declared institution drops every claim it backed; disconnecting USOS falls back to the
school-email verification rather than to nothing, since that one was never USOS's to grant.

### The "boost" is §3's verification ceiling, implemented rather than reinvented

`identity/standing.py`. LAUNCHCHECKLIST §3 already defines
`effective_tier = max(usos_tier, min(rep_tier, verification_ceiling))`. Reputation does not exist
yet, so this module owns **exactly one term** — the ceiling — computed from §3's own ladder. When REP
lands it supplies the others and this needs no revision.

Four rules it follows:

1. **It is a ceiling on capability, never authority.** §2b is explicit: mod level is never granted by
   identity. A verified first-year may upload, link, review and comment freely, and may do nothing
   whatsoever to anybody else's work — asserted directly (`test_connecting_grants_no_authority`).
2. **It is fully itemised.** `reasons` is the entire computation and the UI renders every line.
3. **It cannot be earned by typing.** Self-declaring a school is worth one step and no more. An
   institutional address is **not** counted as verification at all, because EdMat has no
   email-confirmation flow — a verification obtainable by typing would be worth exactly as much to
   somebody lying. The UI explains that rather than silently granting nothing
   (`school_email_eligible`), which is also the sharpest argument yet for building confirmation.
4. **Capability never depends on publishing.** Skill seeded from a transcript comes from the import,
   not the consent to display it, so nothing pressures anybody into publishing marks to keep up
   (`test_publishing_does_not_change_what_you_may_do`).

`CourseGrade.matched_course` is why a transcript is worth more here than a badge: §3a's "seeded SKILL
from real enrolment". A result in a course the registry names maps onto `taxonomy.Course` directly —
someone who passed Analiza Matematyczna II has an institutionally-attested claim no amount of
upvoting establishes as cheaply. Matching is deliberately conservative; an unmatched result is kept
but never placed, since a wrong match would attach competence to the wrong corner of the site.

### Verified

`backend/identity/tests.py` — **36 tests**. Full backend suite afterwards: **391 tests, OK, zero
regressions**. `frontend/e2e/education-auth.mjs` — **42 checks in a real browser against both
servers, zero console/page errors**, covering the part only a browser can confirm: all four drafts
offered and labelled as drafts on the button itself, each modal describing its own provider's real
quirk and blockers, the repository link, Escape closing it, the school picker distinguishing a
university that runs USOS from one that does not, **no session created by any of it**, then the whole
connect → transfer → consent → un-publish → delete loop. `npm run check`: 0 errors, 0 warnings.
`npm run build`: clean. Both locales carry all 70 new keys.

### Left open, not built

- **No real redirect for any provider**, and no callback route — the checks it owes are written down
  rather than implemented.
- **No account-linking UI**, and no way to unlink.
- **The `school` provider is SAML in the design and an email-domain check in reality**, which is a
  genuinely weaker claim and is labelled as one everywhere it appears.
- **USOS installation URLs are the conventional `usosapi.<host>` form and unverified** — several
  institutions deviate, so each must be confirmed against the consortium's registry.
- **Course matching is name-based**, best-effort; a real mapping is per-university course codes.
- **Transcripts are re-imported wholesale, never diffed** — no history, no "this changed", no
  re-sync prompt when a link goes stale.
- **Education data sits in the same SQLite file as everything else.** For a transcript that is a
  materially worse thing to be casual about than a cart; real storage, a consent audit trail and a
  GDPR answer belong with the deployment question, not this round.

## 17T. Feature: courses run by users, and taking part in them (✅ built, full stack)

People can now run a course here, and other people can join it. A new Django app, `classroom/`, plus
`/classroom` on the frontend.

### The name, first, because it is the one decision everything else inherits

`taxonomy.Course` already exists and means a *przedmiot* — a university subject like Analiza
Matematyczna II, which nobody runs and nobody enrols in. What this adds is the other Polish word, a
*kurs*: something a person teaches over time to a group who sign up. English collapses the two onto
one word; the code must not.

`/api/courses/` and the frontend's `/courses/[course]` are both already the taxonomy's, so this is
not merely a readability preference — the namespace is genuinely occupied. Renaming
`taxonomy.Course` to `Subject` would be the tidier long-term fix and was rejected as far too much
collateral for a naming preference: it reaches into migrations, the corpus importer, the API and the
frontend's routes. So the new thing takes the new name — **model `TaughtCourse`, app `classroom`,
API `/api/taught-courses/`, route `/classroom`** — and **users never see any of it**: in both
locales it is simply "Courses" / "Kursy", because a visitor should not pay for an internal
disambiguation.

### What a course is, and the states that are deliberately not booleans

`status` is one field (`draft → open → running → finished`) rather than `is_published` +
`is_finished`, for the same reason `Service.delivery_mode` already gives: two booleans make an
illegal state representable — finished but never published — that every read site would then have to
defend against.

**A course starts as a draft and is invisible to everyone but its instructor.** Creating something is
not announcing it. That is enforced by queryset filtering rather than a permission check, so a draft
is absent from every listing for free instead of being hidden by a rule each new endpoint has to
remember, and a stranger poking at one gets a 404 — which is also the honest answer, since for them
it does not exist.

`enrollment_policy` is `open` (anyone, immediately) or `approval` (the instructor decides). Not a
boolean, so a third policy — an invite code, say — is a value rather than a schema change.
`capacity = 0` means uncapped, which is genuinely different from a large limit and is the right
default for a reading group nobody intends to cap.

`Enrollment.status` has five values, and the three endings are separate on purpose: someone who
**left** may re-join, someone **removed** may not, and a **declined** request is a decision rather
than an absence. One `inactive` flag would throw away exactly what both parties need to see later.
One row per person per course, reused across leaving and re-joining, so "am I in this?" stays a
single lookup with a single answer.

### Why the refusal reason travels to the client

`TaughtCourse.enrollment_block_reason()` returns *why* somebody cannot join — not a boolean — and the
API passes it through. "This course is full" and "the instructor removed you" are the same refusal to
a boolean and completely different to a person: one is a matter of waiting, the other is not. The
frontend has a line for each of the six.

The cap is enforced on **both** paths — joining and the instructor approving — because a limit that
only holds on one of them is not a limit. Lowering a cap below the people already admitted is refused
rather than silently leaving the course over capacity or, far worse, dropping somebody already let
in.

### Lessons: public blurb, participant-only notes

A lesson's title and description are public so somebody can judge whether to join; `participant_notes`
is the part worth joining for and is blanked for anybody who is not in the course. Blanked rather than
omitted, so the response shape never changes with the caller and no client has to branch on whether a
key exists. A **pending** request does not unlock it — asking is not joining.

Lesson content *references* existing exercises and materials rather than copying them, so a corrected
exercise stays corrected everywhere and nothing here becomes a second, silently diverging copy of the
corpus.

### The roster is not public

A course roster is a list of real people. Participants see each other; the instructor additionally
sees pending requests, since acting on them is their job; a stranger browsing the catalogue gets a
403. The course page still shows a participant *count*, which is what somebody deciding whether to
join actually needs.

### A kill switch, like every other feature surface here

`FeatureFlag('classroom')`, seeded on, gating every action including reads — the same `feature_gate`
contract `tutoring` and `messaging` already use, with the same `is_staff` bypass so a moderator can
still manage what exists while the feature is off.

### Verified

`backend/classroom/tests.py` — **28 tests**, weighted towards the boundaries that fail silently: a
draft is invisible, a roster is not public, a full course refuses on both paths, a removed person
cannot walk back in, participant notes stay out of an outsider's response, and the creator becomes
the instructor regardless of what was posted. Full backend suite afterwards: **419 tests, OK**.

`frontend/e2e/classroom.mjs` — **29 checks in a real browser, three separate accounts in three
separate contexts, zero console/page errors**: the same page rendering three different things to a
stranger, a participant and the instructor; the approval flow from both ends including the note the
applicant wrote; leaving giving the seat back and re-locking the notes; a full course refusing in its
own words. `npm run check`: 0 errors, 0 warnings. `npm run build`: clean. Both locales carry all 68
new keys.

One pre-existing test needed updating rather than working around: `moderation`'s own
`test_list_is_public_and_returns_all_seeded_flags` asserts the exact set of seeded flags, and there is
now a sixth. That is the intended effect of adding a kill switch, so the expectation was what was
stale.


### Follow-up: discussion, notifications, and a setting for each of them (✅ built)

Three layers of switch, and the reason there are three is that they answer three different
questions — which is also why none of them could sensibly have been folded into the others.

**Discussion** reuses `community.Comment` through its existing GenericForeignKey, so the thread, the
tree builder, the report flow and the frontend's `DiscussionThread` all come for free; nothing about
it is bespoke. `discussion_mode` (`off` / `participants` / `public`) is three values rather than a
boolean pair for the same reason `status` is one field. **Reading and posting are separate
questions**: the mode decides who may READ, while posting is always restricted to the people in the
course. "Anyone may read my course discussion" is a reasonable thing to want; "anyone may post into
it" is not, and collapsing the two would have made the public mode unusable. Participants-only is the
default, because the roster is private and lesson notes are participant-only — a discussion that was
public by default would be the one place a course quietly leaked.

**Notifications** add six types rather than one `course_activity`, because the recipient and the next
action genuinely differ per event: an instructor gets the request, the applicant gets the answer, and
a single type would leave the UI unable to say which happened without parsing a label. They carry a
nullable `Notification.taught_course` FK for the same reason `material` was added earlier — a
notification you cannot click is markedly less useful than one you can.

Two deliberate silences. **Joining an open course notifies nobody**, since that would be noise
proportional to the course's popularity and nothing the instructor can act on. And **a pending
request is never told what is happening inside** — telling somebody not yet admitted about new
lessons would undo the participants-only rule from the other direction.

**The three switches**, checked at three levels by `notify_course_participants`:

1. the **course's own setting** (`announce_new_lessons` / `announce_new_posts`) — a ten-week seminar
   posting one lesson a week should announce each; a reading group posting daily should not, and only
   the instructor knows which they are running;
2. the **participant's per-course mute** (`Enrollment.notify`), mirroring `TagFollow.notify` exactly —
   muting one busy course must not cost somebody every other course's notifications, and leaving is
   far too blunt an instrument for "this thread is noisy";
3. the **account-wide category** (`Profile.notify_on_course_activity`), which `notify()` applies on
   its own, plus the existing per-type mute list layered on top of it.

**23 more tests** (51 in `classroom`, 442 across the backend) and **15 more browser checks** (44 in
`e2e/classroom.mjs`). See `test.md` for what each suite covers and how to run them.

A real bug this round, found by the browser suite rather than by reading: the new copy "The
discussion is for people taking part in this course" contains the exact phrase an earlier check used
to detect membership, so a whole-page match began reporting a member as a non-member. The app was
right and the assertion was ambiguous — now scoped to the section. Recorded because it is the
failure mode of text assertions generally, and `test.md` says so where somebody writing the next one
will read it.

### Left open, not built

- ~~**No discussion inside a course.**~~ — built, see above. `community.Comment` already does threaded, reportable
  discussion for exercises and materials and is the obvious thing to reuse, but it was not wired up
  here.
- ~~**No notifications.**~~ — built, see above: six types, three levels of setting.
- **Subject/field tagging exists in the model and the API but has no picker** — the form preserves
  whatever is already set rather than offering to change it, so discovery by subject is reachable
  only through the API today.
- **Lessons cannot be reordered or edited in place from the UI** (the API supports PATCH); adding and
  deleting is all the page offers.
- **Attaching exercises and materials to a lesson is API-only** for the same reason — the picker is
  its own piece of work, and `My Set` already has one worth borrowing from.
- **No calendar or reminder anywhere**, despite `scheduled_at` existing.
- **A price is display-only**, exactly like a tutoring listing's rate: nothing here takes money, and
  the form says so.
- **No cap on how many courses one person may run**, and no moderation queue for course content —
  only the platform-wide kill switch and ordinary reporting elsewhere.


### Follow-up: a one-command install, and demo content to install (✅ built)

`setup.sh`, `run.sh` — for handing the project to somebody on Ubuntu with nothing installed.

> **`MARYSIA.md` was deleted (Aug 2026) and is no longer part of this repo.** It was a Polish-language
> walkthrough of these two scripts, written that way because the person it was for reads Polish and a
> setup guide is exactly the wrong place to make somebody translate as they go. **The scripts
> themselves are untouched and still work** — only the prose wrapper is gone, and README.md now
> describes the two commands directly instead of linking to it. Recover it from history
> (`git show c3e852f^:MARYSIA.md`) if that audience comes back.

**The two files are split on purpose**: `setup.sh` builds, `run.sh` starts. Re-running the build
should never kill a running site, and starting should never rebuild.

**The `.venv`/`node_modules`/database are all created by the script**, so the thing you send is just
the repository — which is what "ready to send without node/venv" required. Everything a person might
reasonably want to change is four lines at the top of `setup.sh`; the rest is machinery.

#### Two real bugs, found only by running it on a genuinely clean copy

Both would have hit the recipient and nobody else, which is exactly why testing on a working machine
would not have caught them:

- **`python3 -c 'import venv'` is not a test for `python3-venv`.** The `venv` module ships with
  Python itself, so it imports fine on a machine where `python3 -m venv` cannot build a working
  environment. Ubuntu splits out `ensurepip`, which is what the check now looks for. The first clean
  run failed exactly the way a new user's would.
- **Changing the port broke the site silently.** `run.sh` invites you to change the ports, but the
  API only accepts browser requests from origins it knows, and its built-in allowlist covers the
  default port only — so a changed port produced "Something went wrong" and no clue. `run.sh` now
  passes the chosen origin through, and keeps `frontend/.env` in step with the backend port.

#### The demo content, and why profiles needed new models to hold it

`manage.py seed_demo_content` (idempotent, `--reset` to redo) creates four people with real
histories, reviews with text, threaded comments, three courses with participants, one pending
request and one draft. It exists because an empty app is genuinely hard to judge: every list says
"nothing here yet", so a feature that works is indistinguishable from one that does not.

Placing that content required two new models:

- **`ExperienceEntry`** — self-declared, and labelled as such on screen. That is the whole reason it
  sits next to the education card rather than inside it: one is a claim a person typed, the other is
  a claim an institution made, and a reader should be able to tell without being told.
- **`SkillEntry`** — with `evidence` (`self_declared` / `coursework` / `registry`), which is the
  interesting field. `registry` is **not self-assignable**: the serializer downgrades it, because a
  value anybody can type is worth what typing costs. It is what `identity.standing.skill_seeds`
  already computes, so imported USOS grades have somewhere to land.

The **activity feed** (`GET /users/{id}/activity/`) is derived on read rather than stored. A real
event log would mean touching every mutation and would still miss everything that happened before
the feature existed — the corpus alone is 742 exercises with a history this app never recorded.
Tags come from real data (an exercise's own tags, a course's subjects), so filtering by one means
something, and **undated items sort last rather than being given a fake date**.

**A real API defect the tests caught**: DRF derives uniqueness validators from `unique_together` but
not from `Meta.constraints`, which is what `SkillEntry` uses — so a duplicate skill label surfaced as
a 500 rather than a 400. Fixed in the serializer.

**Verified on a genuinely clean copy** (`git write-tree` → `git archive` → no `.venv`, no
`node_modules`, no database): `setup.sh` ran end to end, `run.sh` started both halves, and a
17-check browser pass confirmed every promise `MARYSIA.md` made (that file has since been deleted —
see the note above; the scripts it described are unchanged) — courses listed, the draft hidden,
the demo login working, Piotr's pending request waiting with its note, a profile showing experience,
skills with their evidence, and an activity feed that filters by tag and re-sorts. 458 backend tests
(16 new), zero console errors.

## 17U. Feature: booking sessions with a tutor (✅ built, full stack)

A tutor can publish when they teach, and a student can ask for an hour of it. A new Django app,
`booking/`, plus `/bookings` on the frontend and a booking panel on every tutoring listing.

It attaches to `services.Service` — a tutoring **offering** — rather than inventing a second,
parallel notion of "a thing you can book". A Service already carried the provider, the courses, the
rate and the delivery mode; what it had no answer to was *when*.

### The one decision everything else follows from

A tutor chooses, **per offering**, how the availability a student sees is computed. It is a real
stored field (`Service.availability_mode`) rather than behaviour inferred from anything, because the
two answers are two different promises to the student and the student is entitled to know which one
they are looking at:

| Mode | What a slot on screen means |
|---|---|
| `derived` | Declared hours **minus** everything already taken — bookings made here, plus any other appointment the tutor recorded as a block. Booking an hour removes it from what the next person sees. |
| `declared` | A published window that keeps showing **whole** even once part of it is spoken for. Several people can legitimately ask for the same hour. |

`declared` is not `derived` done badly. Plenty of tutors advertise "2–4pm, ask me" and triage the
clashes themselves, and a system that could only express the tidy version would be telling those
people they are holding it wrong. What it must not do is let a student *mistake* one for the other,
so the mode is stated in words above the grid in both cases — including the good one, since a notice
that only ever appears when something is qualified teaches people to distrust its absence.

**The default is `derived`**, and that is the mode that cannot mislead: it shows less than it might,
where `declared` can show an hour that is gone. Advertising over-subscribed hours stays available as
something you turn on having read what it means. Every listing that predates the field gets
`derived`, which for a tutor who has declared no hours at all shows nothing either way — so the
default cannot retroactively publish availability nobody claimed.

### What a request means in each mode, decided rather than left to fall out

**Every booking starts as a request, and needs the tutor's confirmation, in BOTH modes.** Nothing in
this app ever writes a confirmed booking directly. A stranger should not be able to put an
appointment in somebody's calendar, and a tutor should be free to refuse a particular student without
having to undo something they never agreed to. **The mode changes what is shown and what is refused,
never who decides** — which is exactly what stops `declared` from being a hole.

The two modes then meet in **one** function. `is_offered_slot()` asks whether a requested time is
genuinely one of the slots the listing is publishing *right now*, using the same computation the
browse endpoint uses, and both modes' entire booking semantics fall out of that one subtraction:

- in `derived`, a slot somebody has already asked for is not in the published list, so the second
  request is **refused** ("that slot is no longer available");
- in `declared`, the same slot **is** still in the list, so the second request is **accepted**, and
  the tutor sorts it out.

Deliberately the same function rather than a separate "does this look reasonable" check, so a student
also cannot request 03:00 on a Sunday just because they can craft the POST.

**A `requested` booking holds a `derived` slot, not just a `confirmed` one** (`BLOCKING_STATUSES`).
That is a real choice with a real cost — the first person to ask holds the hour until the tutor
answers — but the alternative is a slot shown as free, requested by four people, disappointing three.
That would defeat the entire promise of the mode. The cost is named in "Left open": there is no
expiry on an unanswered request.

**Confirming two overlapping bookings is refused in both modes.** `declared` is a statement about
what is *published*, not a claim to be in two places at once; a Booking has exactly one student, so
allowing it would be silently pretending group sessions exist. It matters in `derived` too, despite
the request path already refusing overlaps there, because a tutor can switch an offering from
`declared` to `derived` after the requests have landed.

**Confirming one request does not auto-decline the others.** The tutor may want to counter-offer, or
may know the other two are the same study group. What they must not have to do is decide blind, so a
contested request carries a count of what it clashes with — **tutor-only**, since that count is a
window onto their whole calendar across every listing they run, which is precisely what `declared`
mode exists to keep private. For a student it is always 0.

For the same reason, a `declared` calendar does **not** return taken slots flagged as taken. Doing so
would leak the tutor's real load to anybody who opened the page and half-defeat the mode. What the
student gets instead is the mode said plainly.

### Whose calendar is it — the model shape

**Availability rules belong to the tutor, with an optional narrowing to one offering.** A person has
one calendar; a tutor with three listings who had to re-declare Tuesday afternoon three times would
be maintaining three copies of one fact, and the copies would drift, so "when is this person free"
would depend on which listing you asked. `AvailabilityRule.service` being nullable keeps the narrower
case anyway ("I only teach Analiza on Thursday evenings").

**Busy time is always computed tutor-wide, across every listing.** An hour booked through the physics
listing is not available through the maths one. Scoping it per listing would produce exactly that
double-booking while each listing looked internally consistent.

**`AvailabilityException` has two kinds, not an `is_blocked` boolean.** `block` is "not that Tuesday"
— a conference, a dentist, an exam they are sitting themselves, i.e. the "any other appointments they
have recorded" half of the brief — while `open` is "and also this one Saturday", which no amount of
blocking can express. Openings are added *before* blocks are subtracted, so "I'm away that day" wins
over "and also this Saturday" rather than the two quietly disagreeing. All-day means the whole day and
is only meaningful for a block; an all-day *opening* would be a claim to be free from midnight to
midnight, so it is refused.

**`Booking.ends_at` is stored, not derived** from `Service.session_minutes` on read: a tutor who later
changes their session length from 60 to 90 minutes has not thereby lengthened every appointment
already in their calendar. `Booking.tutor` is denormalized from `service.provider` and load-bearing
rather than convenient — every busy-time query is tutor-wide, and routing it through
`service__provider` would make the one query the whole feature depends on a join a new call site can
forget.

**Five statuses, not three** (`requested → confirmed/declined → cancelled/completed`). `declined` is
the tutor's answer to a request; `cancelled` is either party walking away from something already
agreed, with `cancelled_by` recording which — the distinction each party actually wants when they look
back at it. `complete` is refused before the session has ended (a completed booking for an hour still
in the future is a claim about something that has not happened) and is never automatic on the clock
passing, because plenty of confirmed sessions do not happen and marking them complete would turn a
record of what took place into a record of what was scheduled.

### The API, and where the seams are

`BookingViewSet` is a `ReadOnlyModelViewSet` plus four explicit actions rather than a `ModelViewSet`:
a booking is never edited as a bag of fields, every change to one is a specific act by a specific
party with its own rules, and a generic PATCH would be a way to write `status='confirmed'` straight
past all of them. A third party gets a **404** (queryset scoping, matching this app's convention for a
private conversation); the wrong one of the two parties gets a **403**, because pretending it does not
exist is a lie they can disprove by reading it; a wrong-status transition gets a **409**, because
nothing about the request was malformed — the world moved.

`GET /api/services/{id}/availability/` lives in the booking app despite its `services/` URL: the URL
says what the availability is *of*, the code belongs with what computes it. An `@action` on
`ServiceViewSet` would have made services import booking, which already imports it back. It is public,
like the listing itself, and returns `availability_mode`, `session_minutes` and — its own flag rather
than inferred — `has_schedule`, because a fully-booked fortnight and a schedule nobody ever wrote look
identical from an empty day list and want completely different words on screen.

**Booking hides behind the existing `tutoring` kill switch**, not a flag of its own. Turning tutoring
off already takes the listings away; leaving their booking endpoints live would let a stale tab write
appointments against a feature that is supposed to be gone.

**Deleting a listing that still has an upcoming booking is refused (409).** `Booking.service` cascades,
so the delete would take real, agreed appointments with it, silently, from the student's side as well.
A listing is an offer; a booking is an agreement; withdrawing the first is not the same act as standing
somebody up. Pausing is offered instead and already existed (`is_active`) — it removes the listing from
every browse and refuses new bookings while leaving the agreed ones intact. This is the one place the
services→booking dependency runs backwards, so the import is local and commented as such.

### Notifications

Four types (`booking_requested/confirmed/declined/cancelled`), split by recipient the same way the
course ones are: the tutor gets the request, the student gets the answer, either can be the one told
about a cancellation. One `cancelled` type for both directions, because `cancelled_by` already records
which side it was. All four sit under one new coarse preference (`Profile.notify_on_booking`) — and the
settings copy names the consequence out loud, because a tutor who mutes this stops hearing that anybody
has asked for an hour of their time.

**No `Notification` FK to `Booking`, deliberately.** The existing `exercise`/`material`/`taught_course`
columns exist because each has a real page to open. A booking does not: there is no per-booking route,
and both parties' destination is the same schedule page, which is also where the request is acted on.
`NotificationCard.svelte` routes the four types there by type, which is simpler than a fifth nullable
column that would always point at one URL.

### Frontend

- **`/bookings`** — one page, three tabs, because they are three views of one calendar rather than
  three features: splitting them across routes would mean a tutor answering a request has to leave the
  page to check whether they had already blocked that afternoon. Requests for me / My bookings / My
  availability. Neither side is gated behind a role, since most accounts here are both a tutor and a
  student — the same reasoning messaging's single inbox already follows.
- **`BookingPanel.svelte`** on `/services/[id]`, above reviews and discussion: somebody who has read
  the card and the map is deciding whether they can get an hour, and that comes before what other
  people thought.
- The success message says **"Request sent — the tutor still has to confirm it"**, never "booked".
  Telling somebody they have an appointment when what they have is a question would be the single most
  misleading sentence this feature could say.
- `ServiceForm` gained the mode as two radios with a sentence each rather than a select: the difference
  between them is a paragraph, not a word, and a tutor picking `declared` should be reading what it
  means at the moment they pick it.
- Full i18n parity — every new string in both `en.json` and `pl.json` (1018 keys each, verified
  key-set-identical programmatically).

### Two real bugs, both found by driving a browser rather than by reading the code

1. **A refusal explained itself and then wiped the explanation.** `/bookings`'s `load()` cleared
   `actionError` on entry, and the 409 path set the message *then* reloaded to show the world as it now
   was — so the tutor saw the list rearrange itself with no word about why their click had not worked.
   `load()` no longer clears it; callers clear it before acting, which is when it stops being true.
2. **A repeatable script needed a reset the API could actually perform.** The e2e script signs in as
   the seeded demo users rather than registering (registration is rate-limited per IP, and a script
   that registers three people exhausts it on repeated runs — at which point the whole run fails in a
   way that looks exactly like a regression). That made the accounts stateful, so the script now starts
   by clearing the tutor's rules and exceptions and cancelling their live bookings *through the real
   endpoints*. A script that had to reach into the database to set itself up would not be exercising
   the same system a person uses.

### Verified

**Backend: 550 tests, all passing** (57 new in `booking/tests.py`, up from 493). The slot arithmetic is
pinned directly — back-to-back sessions, a window too short to fit one, a block cutting a hole in the
middle rather than trimming an edge, an all-day block, an opening the weekly pattern never had, a block
beating an opening on the same day, overlapping rules not offering one hour twice, and the past never
offered. Then the modes against each other, on the same calendar: `derived` removes a taken hour,
`declared` does not, a *requested* booking already holds a derived slot, a declined one gives it back,
and an hour taken through one listing is taken on all of them.

**Browser: `e2e/booking.mjs`, 28 checks, zero console/page errors**, three people in three contexts
against the real servers. The same published window is captioned differently in the two modes; three
one-hour slots come out of one 14:00–17:00 rule; the student is told it is a request; the hour then
vanishes from the derived listing and stays on the declared one; a second person asks for it anyway and
is accepted; the tutor is warned the hour is contested, confirms one, is **refused** on the clashing one
in its own words, declines it; each student sees their own answer and neither is shown the tutor's
calendar; a whole-day block empties a Tuesday the weekly rule would otherwise fill, read back from the
public endpoint with no account; and deleting a listing with a live booking is refused, naming pausing
as the alternative.

**Regression:** `classroom.mjs` (44), `classroom-overhaul.mjs` (29), `material-claims.mjs` (14) and
`profile-editing.mjs` (8) all re-run clean, zero console/page errors. `npm run check`: 0 errors, 0
warnings. `npm run build`: clean. `manage.py check` and `makemigrations --check --dry-run` both clean.

### Week and month views (✅ built, a follow-up pass)

The first build showed availability as a list of days with a row of time chips. That reads well for
"what's free this week" and answers nothing else. Two more views were added, both the shapes people
already know from every calendar they use, and both driven from the same data as the list.

**Three shared, domain-free pieces** (`lib/components/booking/`): `calendar.ts` (the geometry and the
`CalendarEntry`/`CalendarMonthDay` shapes), `CalendarWeek.svelte` and `CalendarMonth.svelte`, plus a
small `ViewSwitcher`. None of them imports `Booking`, `Service` or anything else from this domain —
each caller resolves its own objects into entries first, which is what lets one grid serve a student
choosing an hour and a tutor looking at their week. Same "dumb component, pure props in" contract the
project's other shared pieces already follow.

- **Week** is a real time axis: block height is duration, so a 30-minute session and a two-hour one
  are visibly different, and **overlapping entries are laid out side by side in lanes** rather than
  stacked. That is not a nicety — overlaps are `declared` mode working as designed, and stacking them
  would hide exactly the clash the tutor opened the calendar to see. Lanes are computed per *cluster*,
  so two overlapping entries in the morning do not make an unrelated afternoon one half-width.
- **Month** is deliberately a **summary, not a miniature week**: a cell carries a count and a tone,
  and clicking it opens that day's week. A month grid trying to show every session's time would be
  illegible at that size, and the question it exists to answer — "which day should I look at?" — is a
  different one. Every cell is a button, including the empty ones, because "is anything happening on
  the 14th?" is a real question and a grid that only let you click the busy days would refuse it.
- **The hour range is fitted to the content**, padded an hour each side and floored to whole hours,
  with a minimum span — a day drawn from midnight would make a two-hour afternoon window an unreadable
  sliver.
- Monday-first throughout, matching both locales and the backend's own `date.weekday()` numbering, so
  nothing converts between two week shapes. Weekday names come from `Intl` off a real week rather than
  seven message keys, so they arrive translated and abbreviated the way each locale abbreviates.

**One new endpoint, `GET /api/my-schedule/`**, because the tutor's calendar and a student's slot list
are genuinely different questions. The student-facing one is scoped to a listing, sliced into that
listing's session length, and has the taken hours removed. This one spans **every** listing, has no
single session length to slice by, does not hide the past, and — the point — **returns the bookings
alongside the windows instead of subtracting them**, so each session is drawn sitting inside the hours
it occupies. A calendar with the appointments cut out of it is the one thing a calendar must not be.
It returns both sides of the caller's account, since somebody who teaches on Tuesday and takes a
lesson on Thursday has one week, not two.

The tutor's calendar is **read from that endpoint rather than assembled in the browser** from the
rules and exceptions already on the page. Expanding a weekly rule over real dates, adding openings and
then subtracting blocks is exactly the arithmetic `booking/availability.py` exists to own, and a
second implementation of it client-side is how the calendar and the slots a student is offered start
disagreeing. `_rule_windows`/`_apply_exceptions` were widened to take a tutor plus an optional service
scope so both callers share one implementation.

Two smaller decisions worth naming: **declined and cancelled sessions are not drawn** (they are not
appointments, and drawing them would fill the week with blocks nobody will attend) while completed
ones are, because looking back at what you actually taught is half of why anybody opens a calendar;
and the month view **dots** days that have published hours but no sessions, rather than folding them
into the count — a number that sometimes means sessions and sometimes means hours is a number nobody
can read.

**A real rendering bug, found by looking at a screenshot rather than at the assertions**, which all
passed: the hour labels were positioned by an `nth-child` rule in the stylesheet that had to be kept
in step with the row height by hand, and centred on their own line — so the first label was pulled
half-way out of the top of the grid and clipped, and the last sat on the bottom edge. Both the labels
and the lines now come from one `linePosition()` function, and the label sits just under its line, the
way a paper timetable reads.

**Verified**: `e2e/booking.mjs` grew to **42 checks** (from 28), still zero console/page errors —
the week grid renders an hour axis and seven columns with exactly the slots the list showed, as real
pressable buttons; the month grid is whole weeks and marks the days with free times; clicking a day
opens its week; the tutor's own calendar draws published hours as bands with the confirmed session on
top of them and the declined one absent; and its month view counts sessions while dotting the days
that only have hours. **559 backend tests** (9 new for `my-schedule`, up from 550). Both views were
also inspected as real screenshots, which is what caught the axis bug. `classroom.mjs` (44),
`classroom-overhaul.mjs` (29), `material-claims.mjs` (14) and `profile-editing.mjs` (8) all re-run
clean. `npm run check`: 0 errors, 0 warnings. `npm run build`: clean.

**Left open here too**: the week grid scrolls sideways on a narrow screen rather than reflowing —
seven columns against a time axis genuinely need the width, and collapsing them would just reproduce
the list view, which is already offered beside it. There is no drag-to-create or drag-to-move:
availability is still edited through the forms below the calendar, and the calendar only shows. And
the month view cannot show a day's times at all by design, so a day with six sessions and a day with
one differ by a number rather than by shape.

### 24-hour and Monday by default; 12-hour and Sunday in Settings (✅ built)

The calendars were formatting times through `Intl` with nothing but the interface locale, which for
`en` means a 12-hour clock and — had anything asked — a Sunday-first week. Nobody chose that. It was
`Intl`'s default leaking through as if it were a decision, and it was wrong for most of the people
this app is built for.

**Two real stored preferences on `Profile`**, `time_format` (`24h`/`12h`) and `week_starts_on`
(`monday`/`sunday`), **defaulting to 24-hour and Monday**, with both offered in Settings under their
own "Dates and times" section.

- **They are separate from the interface language, deliberately.** Reading the English interface is
  not a statement about wanting a 12-hour clock, and letting the locale decide is exactly how somebody
  ends up looking at the wrong one with no way to say so. The Settings copy says this out loud rather
  than leaving it to be discovered.
- **The defaults cost nothing to hold**: they are what this app's own markets (PL, UA, the EU) use,
  and what the rest of the stack already speaks — `AvailabilityRule` stores a 24-hour `TimeField` and
  numbers weekdays from Monday, matching Python's `date.weekday()`. So the default needs no conversion
  anywhere, and the other two are a real choice rather than an inference.
- **Stored as names, not numbers** (`'monday'`, not `1`): the row stays readable, and the frontend's
  own `Date.getDay()` numbering stays the frontend's business rather than being baked into a column.
  `displayPrefs.weekStartsOn` converts once.
- **Not on the public profile.** Not because a clock preference is sensitive, but because a stranger's
  settings are not a public endpoint's business — the same line `PublicProfileSerializer` already draws
  around the notification preferences.
- **A signed-out visitor gets the same defaults**, which matters because most people looking at a
  public tutoring listing are signed out — they see the app's 24-hour Monday-first calendar rather
  than whatever their browser's language implies.

**Where the preference is read.** `state/displayPrefs.svelte.ts` holds it and is read directly by the
components that draw a clock, the way `themeStore` already is, rather than threaded through props from
every page. The distinction worth keeping: the calendar components stay free of any **domain** import
(they still know nothing about bookings or services), while chrome this global is fetched where it is
needed. The geometry in `calendar.ts` takes `weekStartsOn` as a **parameter** instead, defaulting to
Monday, so that module stays pure and importless.

`lib/utils/datetime.ts` holds the formatters — `formatTimeOfDay`, `formatClock` (for a rule's bare
`'HH:MM'`), `formatHourMark`, `formatDateTime`, `weekdayNames`. They live outside the rune module
because they build throwaway `Date`s and `svelte/prefer-svelte-reactivity` refuses a mutable Date in a
`.svelte.ts` file. That rule is right, and the split it forced is the better shape: the setting in one
file, the rendering in another. Two smaller details inside them: 24-hour uses `hourCycle: 'h23'` rather
than `hour12: false`, which in some locales produces the h24 cycle and prints midnight as "24:00"; and
an hour axis drops the minutes in 12-hour mode ("4 PM", not "4:00 PM"), since an axis label is a marker
and the minutes are always zero.

**The weekday `<select>` on the availability form re-orders but does not re-number.** The stored value
stays Monday-based 0–6, because that is what the backend compares a rule against; only the order the
options are offered in follows the preference. A Sunday-first reader picking "Sunday" must still store
6, or the rule would quietly land on Monday.

**A real bug this surfaced, found in a browser rather than by reading the code.** Both calendars stored
the first day of the visible range in `$state`, computed once at mount from `startOfWeek(today,
displayPrefs.weekStartsOn)`. `authStore` loads asynchronously, so at mount the preference had not
resolved and the default Monday was baked in — while the month grid, which was `$derived`, re-ordered
correctly. The header and the grid beside it therefore disagreed for anybody whose saved setting was
Sunday. Fixed at the root by storing the **focused day** and deriving the range from it, which also
deleted the re-anchoring arithmetic that switching views used to need: "the week of the 12th" and "the
month containing the 12th" are the same focus read two ways. (A second, duller bug went with it: a
`formatClock` edit to the published-rule row had silently not applied, so that one line stayed 24-hour
while everything around it switched. The browser check caught it; `svelte-check` could not have.)

**Verified**: `e2e/booking.mjs` grew to **51 checks**, zero console/page errors. In English, with
nothing set, the axis is 24-hour and the week starts Monday — the point, since `Intl` would have picked
neither. Settings offers both as real choices; switching flips the axis to AM/PM, moves the week to
Sunday-first, re-orders the month grid to match, carries the published rule's own times with it, and
**survives a hard reload**. The script resets the account to the defaults at the start of a run and
again afterwards, or a previous run's setting would quietly become the "default" the first check
asserts against. **564 backend tests** (5 new, up from 559), including that the default does not follow
the interface language, that an out-of-range value is refused, and that neither field appears on
somebody else's public profile. Both states were also inspected as real screenshots.
`classroom.mjs` (44), `classroom-overhaul.mjs` (29), `material-claims.mjs` (14) and
`profile-editing.mjs` (8) all re-run clean. `npm run check`: 0 errors, 0 warnings.

**Left open**: no per-account timezone still (see above) — these two say how a time is *drawn*, not
which clock it is drawn from. And the preference is account-wide only: a signed-out visitor cannot
choose, since there is nowhere to keep the answer.

### Left open, not built

- **No expiry on an unanswered request.** A `derived` slot is held by whoever asked first until the
  tutor answers, so an unattended tutor's calendar can be squatted. A real version wants a lease, or a
  tutor-configurable auto-decline.
- **No timezone per tutor.** Rules are interpreted in the project timezone (`settings.TIME_ZONE`, UTC).
  A tutor abroad would be publishing hours in the wrong one. Nothing in this app has ever had a
  timezone field, and guessing one from the browser would be worse than not having it.
- **No auto-confirm option**, even for `derived` where the slot was provably free. Defensible either
  way; deciding it belongs with a real tutor asking for it.
- **No rescheduling.** A booking is cancelled and a new one requested; there is no "move this to
  Thursday" that keeps the thread.
- **No calendar export or import** — no `.ics` feed, and no way to have an external calendar's busy
  time subtracted. The `block` exception is the manual stand-in for exactly that, which is honest but
  is data entry.
- **Slots step by the session length**, so a 90-minute session inside a 14:00–17:00 window offers
  14:00 and 15:30 and drops the tail. A sliding grid would offer four times as many slots for the same
  hours and booking any one would silently invalidate its neighbours, which is worse for a student to
  run into; a real answer is per-listing granularity, which nobody has asked for yet.
- **No cancellation window or no-show handling.** Either party can cancel a confirmed session one
  minute before it starts, with no consequence recorded anywhere.
- **A booking has no discussion of its own.** The student's note and the tutor's reply are one field
  each; anything further goes through the existing messaging.
- **Nothing connects a completed session to money.** This app has no payment processing anywhere
  (`Service.hourly_rate` has always been display-only), and a booking does not change that.
- **No moderation or reporting surface for a booking**, matching the gap Section 17P already names for
  Service listings and messages.

---

## 17V. Feature: one-off events, a rebuilt navbar, and homepage tabs (✅ built, full stack)

Three pieces of work that shipped together because two of them exist to make the third reachable: a
new `events` Django app, a navbar reorganised from a flat row of ten links into three groups, and a
homepage that finally acknowledges the four kinds of content this site holds besides exercises.

### 17V.1 Events — what an event is, and what it deliberately is not

An **event** is a one-off happening somebody organises and other people turn up to: a guest lecture, a
workshop, a study session, an exam-prep meetup.

EdMat already had two models that put a person in a room with other people at a time, and an event is
neither of them. Getting this wrong in either direction would have been the expensive mistake, so it
is written out in `events/models.py`'s own module docstring as well:

- **`classroom.TaughtCourse`** is something taught *over time* to a group who sign up for it. It has a
  roster, chapters, lessons, contributions, staff, and an enrolment lifecycle in which a request can be
  pending, approved, declined or revoked. A guest lecture on Thursday has none of that. Modelling one
  as a course with a single lesson would mean every one of those fields exists and means nothing, and
  every read site would then have to defend against a "course" that is really an evening.
- **`booking.Booking`** is one person's hour with one tutor, negotiated: requested, then confirmed or
  declined. An event is the opposite shape — it is published first and *many* people answer it, and
  nobody approves anybody. There is no counterparty to negotiate with.

So it is its own small app, and deliberately smaller than either. Everything it needs that already
exists is reused rather than rebuilt: the taxonomy for discovery (the same `subjects`/`field` pair
`TaughtCourse` and `Service` both use), `notifications.notify()` for telling people, and the
`FeatureFlag` kill switch.

**The model, and the choices inside it**

- **`status`: draft / published / cancelled.** Three values rather than two booleans, for the reason
  `TaughtCourse.status` already records: two booleans make an illegal state representable. `cancelled`
  is a *state*, not a deletion, and that is load-bearing — people arranged their week around this, so
  the row has to survive long enough to tell them, and the event has to stay readable afterwards so
  somebody who missed the notification does not turn up to an empty room.
- **A start instant plus a duration**, not a start and an end. Two datetimes make an event that ends
  before it begins representable and would need validating at every write; a duration cannot be
  negative in the first place, and "90 minutes" is also what a host actually knows while writing the
  announcement. `ends_at` is derived.
- **`location_kind`: onsite / online / hybrid**, rather than a nullable URL. A hybrid event with only a
  link set reads as online-only to somebody who would have come in person, and `clean()` requires the
  place and/or the link that the chosen kind actually implies — in the model, so the admin and any seed
  command are held to it too, not only the API.
- **`capacity = 0` means no limit**, which is genuinely different from a limit that happens to be
  large. The same convention and default as `TaughtCourse.capacity`.
- **`EventAttendance` stores "no" as a real row**, not as the absence of one, for two reasons that are
  not the same. First, capacity: somebody who said they were coming and changed their mind must give
  the seat back, and with one row per person (enforced by a unique constraint, not by whichever view
  happens to write it) that is a status change on a row that already exists — so nobody can hold two
  seats and no counting code has to reconcile a delete against a create. Second, "I answered no" and
  "I never answered" are different states, and a host's view of the event is more honest when it can
  tell them apart.
- **The host does not attend their own event.** They are running it, and counting them would make an
  empty event report one attendee.

**The API** (`/api/events/`) follows the split this codebase already uses everywhere: anyone may read
what is published, only the host may change it, and the scoping happens in the queryset rather than in
after-the-fact checks — so somebody poking at another person's draft gets a 404, which is also the
honest answer, since for them it does not exist.

Two things about `get_queryset` worth recording, because the first was a real bug found by a test:

- **Visibility and browse filters are separate layers.** DRF's `get_object` reads the same queryset, so
  a filter meant for the list also narrows what is reachable by id. That is right for visibility and
  wrong for browsing: with `when=upcoming` applied unconditionally, `GET /api/events/{id}/` for a talk
  that happened last week answered **404**, and so did any attempt to answer one. Caught by
  `AttendanceTests.test_a_past_event_cannot_be_answered`, which expected the honest refusal ("this
  already happened") and got "no such event". Visibility now always applies; browse filters only on
  `list`.
- **A cancelled event leaves the browse list but stays readable.** Found by *looking at the rendered
  page*, not by an assertion: three cancelled events sat at the top of "Coming up", each one an
  invitation to click through to something that is not happening. It is now excluded from the browse
  listing only — it still resolves at its own URL (so the link in the cancellation notification works)
  and still appears under "I am going to these" and "I am running these".

**Attendance is one endpoint, not two.** `POST /events/{id}/attend/` takes `{status}`, because there is
one row and it has a value; an `attend`/`unattend` pair would leave a client having to know which one
applies from state it might be holding stale. The capacity check is re-run against the database on
every call rather than trusted from the `can_respond` the client was last shown — two people answering
a one-seat event at the same moment both saw a free seat. Somebody who already holds a seat is
deliberately exempt from the cap, or a full event would refuse to let one of its own attendees decline,
which is the one answer a full event most wants to hear.

**The roster is private, but not as private as a course's.** A course roster is staff-and-participants
only. For an event, "is anybody else going" is half of why somebody opens the page at all, so people
who *are* going see each other; strangers get a 403. The host additionally sees the declines, which
nobody else does — a decline is between the person who made it and the person running the event.

**Notifications: three types, and a deliberate silence.** The host is told when somebody says they are
coming; everybody holding a seat is told when the event moves or is called off. A **decline is not a
notification** — it is information the host can see on the event itself, and a bell for every "no"
would make hosting a well-attended event unpleasant. A change of mind does not re-notify either. Only
the time and the place count as "changed": a corrected typo in a description does not put a badge on
forty people's bell, which is how a bell gets ignored. `Notification` gained a nullable `event` FK on
the same shape and reasoning as `taught_course` before it, and `Profile.notify_on_event` is its own
coarse category rather than a share of `notify_on_course_activity` — a switch labelled "courses" that
silently also governed events would be a setting whose label lies.

### 17V.2 Events and the tutor's calendar — two questions, two different answers

This had to be decided explicitly, so both halves are recorded, along with the asymmetry inside the
second one.

**Question one: do events appear on `/api/my-schedule/`? Yes.** That endpoint answers "what does my week
look like", and it already carries *both* sides of the caller's bookings because somebody who teaches on
Tuesday and takes a lesson on Thursday has one week, not two. An evening spent running a workshop is
gone in exactly the same way, so a calendar omitting it would be answering its own question wrongly.
Hosting and going both appear. Drafts do not (nothing was announced, so the evening is not spoken for)
and neither do cancellations (it *was* a commitment and is not one any more — leaving it there would go
on saying the Thursday is taken after the very notification saying it is not). This endpoint still never
*subtracts*: `windows_for_tutor` is untouched, the published bands are drawn whole, and the event is
drawn on top of them, because a calendar with the appointments cut out of it is the one thing a calendar
must not be. Events get **their own tone** there — dashed, in the accent colour — rather than reusing
the confirmed-booking green.

**Question two: does an event also remove the hour from what students are OFFERED? Hosting does;
attending does not.** This lives in `availability._event_intervals`, feeding the same `_busy_intervals`
that confirmed and requested bookings already feed, so `derived` mode subtracts it, `declared` mode
ignores it, and the two modes still meet in exactly one subtraction rather than growing a second code
path. Because `is_offered_slot` is deliberately the *same* function the browse endpoint uses, a student
also cannot request the hour, not merely fail to see it.

The asymmetry is the whole decision:

- **Hosting is a commitment to other people who will physically turn up expecting you.** It is exactly
  as binding as a confirmed booking, and a tutor who could still be booked during a workshop they are
  running would have been double-booked *by the app* rather than by their own mistake.
- **Attending is a statement this app lets you take back with one click, telling nobody when you do.**
  Treating it as a withdrawal of bookable hours would mean an RSVP silently costing somebody income they
  never agreed to give up — and on a 200-person lecture that would happen to every tutor in the room.
  The clash is still *shown*, since both kinds are drawn on the tutor's own calendar, so somebody who
  does want the evening free can block it with the one-off exception mechanism that exists for exactly
  this. The difference is between the app deciding and the app informing.

Two consequences worth stating plainly. **A cancelled or draft event blocks nothing**, on the same
reasoning as above. And **the `events` kill switch is honoured here too**, which is the harder half: with
events off, a live event stops protecting its host's evening. That is still the right way round, because
with the feature down the tutor cannot see the event *anywhere* — not on their calendar, not on the
event page — so an hour missing from their published availability would be unexplainable from inside the
app, and a kill switch whose side effects outlive it is not a kill switch. The hour goes again the
moment the flag returns.

It also means `/api/my-schedule/` and `/services/{id}/availability/` will disagree about a hosted
event's hour, deliberately: the first shows a tutor their real Tuesday, the second shows a student what
can be booked.

### 17V.3 The kill switch, including every link that points at the feature

`events` is a new `FeatureFlag`, seeded on by a data migration alongside the existing five, and gating
the whole `/api/events/` surface through the standard `feature_gate('events')` — every action, not
just writes, with real staff bypassing it as they do everywhere else.

The explicit requirement here was that pulling the switch removes the **links** too, not only the pages
behind them, since a killed feature that still shows its buttons has not been hidden, only made to fail
somewhere less useful. So, with the flag off, for a non-staff visitor:

- the **Events nav link** is gone;
- the **homepage Events tab** is not rendered at all (a tab that opens onto "this feature is
  unavailable" is a link to a dead end);
- **"Host an event" disappears from the "Add…" menu** — and the menu's own trigger disappears entirely
  if every item under it is gone, because an empty menu invites a click and then explains nothing;
- `/events` and `/events/[id]` render the shared `FeatureGate` notice rather than the real page;
- and **`/api/my-schedule/` returns an empty `events` list while continuing to work**, since it is a
  *tutoring* endpoint and must not break — a killed feature leaking through a neighbouring endpoint is
  exactly the hole a kill switch is meant not to have.

All eight of those are pinned by the browser script, and the flag is turned back on at the end of it.

### 17V.4 The navbar, rebuilt

The bar had grown one link per feature — browse, materials, my set, submit exercise, submit material,
courses, tutoring, watchlist, schedule, messages, moderation — every one competing for the same
attention and wrapping onto a second line before a laptop was even narrow. The rebuild removes nothing;
it sorts what was there by what each link is **for**:

- **Browsing stays in the nav**, because that is what a nav is: places to go and look at things.
- **Making collapses into one "Add…" popover.** Five of the old links were create flows sharing a
  single question ("I want to make something") that the bar was asking five times: submit an exercise,
  submit a material, create a course, offer tutoring, and now host an event.
- **You collapses into the account button**, which was already there carrying the person's name and did
  nothing except link to Settings, while Log out sat beside it as a separate control and My Set sat
  over in the nav. It now holds **Profile** (new — `/users/<own id>`, which the app had no navigation to
  at all), My Set, My schedule, Settings and Log out.
- **Messages moved into the action area as an icon-only SVG button** with a real `aria-label` and its
  unread badge intact. It and the notification bell are siblings — both inboxes, both with an unread
  count — and one being a word in the nav while the other was an icon on the right was an accident of
  the order they were built in rather than a distinction.

**One shared popover primitive, not three ad-hoc dropdowns.** `MeatballsMenu` already owned exactly the
behaviour that is easy to get subtly wrong (open, Escape, click-outside, return focus to the trigger) —
but it owned it *for a "⋯" button holding a list of callbacks*. The navbar needs two panels that are
neither: one holds links, the other is triggered by a person's name. Widening `MeatballsMenu` to take
either items or children and either a label or a trigger snippet would have produced a component that
is really two components sharing a file. So the behaviour moved into `shared/Popover.svelte` and
`MeatballsMenu` keeps its own implementation deliberately — it is used in a dozen places, it works, and
rewriting a tested component onto a new primitive is real risk for no user-visible payoff. The
duplication is about twenty lines and is named in both files so nobody has to rediscover that it was a
choice.

Two details worth keeping: the panel's `children` snippet receives a `close` callback, because a link
that navigates and leaves the popover hanging over the new page is a real bug under client-side routing
(the component is not torn down by the navigation); and focus returns to the trigger on **Escape only**,
never on a click-away, since somebody who clicked elsewhere has already said where they want to be.

**On a phone the same content becomes one row and a drawer.** Three rules drove that, and each shows up
in the markup rather than only in the styles:

1. **One row.** The bar is the brand and nothing else; everything that lives across the top on a desktop
   lives in the drawer instead. Before this, the nav collapsed behind a toggle while the action row
   stayed and wrapped — so the "one row" was frequently three.
2. **It gets out of the way.** Scrolling down tucks the bar away; scrolling up brings it back at once. A
   sticky bar on a 390px-tall reading surface is a real cost, and the gesture people make to get it back
   is exactly the one that returns it. The measurement runs once per animation frame (`scroll` fires far
   more often than the screen redraws, and reading `scrollY` in the handler is a layout read on every
   one), with a 6px deadband — without it, the sub-pixel jitter a phone produces while a finger rests on
   the screen flickers the bar in and out — and the bar is always out within 72px of the top, so a page
   restored mid-article never opens with no bar and no obvious reason.
3. **The menu button never goes anywhere.** It is rendered **outside `<header>`**, which is the
   requirement rather than a layout preference: the header is the thing that slides away, so a button
   inside it would slide away too, and this is the one control that has to survive the bar hiding,
   because it is what brings the bar's contents back. It sits level with the bar while the bar is there
   and stays exactly where it is once the bar has gone, so it never appears to move.

**The item lists are snippets rendered by both surfaces.** The browse links, the create actions and the
account items each exist once and are rendered into both the desktop popovers and the drawer, so a
feature flag can never hide an entry in one place and leave it in the other — which is precisely the bug
a second hand-maintained mobile menu would eventually grow.

**The drawer is not a popover-in-a-popover.** Inside it, the create and account groups are flat sections
under headings rather than nested menus, and Messages and Notifications are plain links carrying their
unread counts as text rather than the desktop bell and envelope, both of which open popovers of their
own. A popover inside a drawer is a worse interaction than simply going to the inbox, and the counts —
the only reason those two are worth surfacing at all — come along either way. Targets are 44px, which is
the size a thumb actually hits.

Drawer mechanics: Escape closes it and returns focus to the toggle, the scrim closes it, background
scroll is locked (on a phone the drawer is most of the screen, and a page scrolling behind it is how
somebody loses their place in an article by opening a menu), every link inside closes it, and a route
change from *anywhere* — including the browser's own back button, which no click handler sees — closes
it too. It is moved off-canvas rather than unmounted so it slides, and `visibility: hidden` is what keeps
it out of the tab order while it is off-screen: a translated element is still focusable, and a hidden
drawer full of reachable links is a real keyboard trap. The scrim is a real `<button>` rather than a
`<div>` with a click handler, so it is interactive by construction rather than by assertion — kept out
of the tab order and hidden from the accessibility tree, since a keyboard user already has Escape and
the ✕ and a third unlabelled route would be noise. Anybody who has asked for less motion gets the same
behaviour with none of it.

**A real bug, caught by looking at a screenshot rather than by any assertion:** the drawer opened and shut
again in the same frame, so the page looked exactly as though the menu button did nothing. The
route-change effect read `drawerOpen` to decide whether to close, which made the effect *depend* on it —
so setting it to `true` re-ran the very effect whose job was to close it. `untrack` around that read is
load-bearing; the dependency the effect is supposed to have is the pathname and nothing else.

**My Set is the one entry that lives in two places, conditionally.** It is in the account menu for
anybody signed in, and stays in the nav for a guest — who has no account menu, and whose set is the
more fragile of the two, since it exists only in that browser until they make an account.

**Found by looking at a screenshot rather than by an assertion:** the account trigger was a person's own
name sitting in a row of icons, which reads as a label rather than as something to press. It gained a
chevron that rotates on open.

### 17V.5 Homepage tabs

The homepage was exercises and nothing else — top-rated and recent — with no acknowledgement on the
front page that this site also holds materials, courses somebody runs, people offering tutoring, or
events. It is now five tabs: **Exercises, Materials, Courses, Tutoring, Events.**

- **Each tab renders that feature's own card component** (`ExerciseCard`, `MaterialCard`, `CourseCard`,
  `ServiceCard`, `EventCard`) rather than a homepage-specific summary card. A course on the homepage
  should look like a course, and a second card component per kind is a second place to fix every time
  one of them changes.
- **The selected tab is in the URL** (`?tab=`), not in component state. Three things follow and all
  three were the point: a reload keeps you where you were, the back button steps between tabs the way a
  person expects, and somebody can send a link to the Events tab. A query parameter rather than five
  routes, because these are five views of one page; and a real `goto` rather than `replaceState`, which
  would have taken the back button away again.
- **Data is fetched per tab, once, and kept.** Loading all five on first paint would make the homepage
  five round trips slow for a visitor who only ever looks at one; re-fetching on every switch would make
  going back and forth flicker.
- **Real ARIA tab semantics**, including the part usually skipped: a roving `tabindex`, `aria-selected`,
  `aria-controls`/`aria-labelledby` wiring the panel to its tab, and Left/Right/Home/End moving between
  tabs with focus following selection. A `role="tablist"` that does not answer arrow keys is a promise
  to a screen-reader user that the page then breaks.
- **Tabs are gated by the same flags their features are.** A killed feature's tab is not rendered, and
  an unknown or now-hidden `?tab=` falls back to Exercises rather than rendering nothing, so a stale
  link still lands somewhere real.

### 17V.6 Verified

**Backend — `events/tests.py` (60 tests) plus seven new ones in `booking/tests.py`, and the whole suite
re-run.** The suite pins refusals rather
than happy paths, on `classroom/tests.py`'s own reasoning: a draft invisible to strangers and 404 on its
own URL; a cancelled event readable but out of the browse list while staying in the lists of the people
it concerns; `mine=hosting` vs `mine=attending`; every location-kind validation, including a **partial
edit validated against the fields it is not changing** (switching an onsite event to online while
sending no URL must fail on the URL it does not have); cancelling refused as a PATCH and offered only as
its own action; un-cancelling refused; deleting refused once people are coming, naming cancelling as the
alternative; the seat given back on a change of mind; a full event still accepting a decline; the block
reason told to the person it applies to; the private roster in all four of its cases; every notification
including the two deliberate silences; the kill switch across anonymous / signed-in / host / write /
staff; and the schedule integration. The availability half is pinned in `booking/tests.py`, next to the mode
arithmetic it belongs to: a hosted event removes the hour from a `derived` listing and an attended one
does not; a `declared` listing keeps publishing through both; a draft and a cancellation block nothing;
a 150-minute workshop swallows every slot it covers (the subtraction is interval arithmetic, not slot
matching); the kill switch gives the hours back; and a student is refused at request time, not merely
shown a shorter list — asserted separately so a future refactor that split the browse check from the
request-time gate would be caught here rather than in production.

**Browser — `frontend/e2e/events-and-nav.mjs`, 92 checks, zero console/page errors**, five browser
contexts against the real servers. It drives the whole loop: the Add menu opening, offering all five
create actions, closing on Escape and returning focus; the account menu holding all five entries with
Profile resolving to the signed-in person's own id; Messages rendering as an SVG with no text and a real
accessible name; five tabs with the panel correctly wired, the tab surviving a reload, the back button
stepping between tabs and arrow keys moving between them; creating an event through the real form and
landing on its own page; a second person answering, the count moving, and *answering* being what unlocks
the roster they could not see a moment earlier; the host's notification linking to the event; capacity
refusing a third person, the seat-holder still able to decline, and the freed seat being offered on;
the event appearing on the events page, the homepage tab via a shared link, and the host's own calendar
labelled "Running"; cancelling telling the person who was coming while the event stays readable; the
kill switch removing the nav link, the tab, the menu item, the page and the API while leaving
`/my-schedule/` working and empty, with a moderator keeping access throughout; both locales; and the
phone navbar in a 390×844 context — the bar down to a single row with neither the desktop nav nor the
action row on it, the drawer holding the browse links, the create actions, the account items and
Messages, Escape closing it and returning focus, **the bar tucking away on scroll down while the menu
button stays within a pixel of where it was**, the bar returning on scroll up, and a drawer link both
navigating and closing the drawer behind it.

One real application bug came out of this that no assertion would have found — the drawer opening and
closing in the same frame, see 17V.4 — and three bugs in the script itself are worth recording because
each cost a real run: fields addressed by
position rather than by label (filling "One-line summary" where "Place" was meant, leaving a required
field empty so the browser silently refused to submit — which reads exactly like a broken create flow);
`kasia` being the one seeded staff account rather than `julia`, so the flag PATCH 403'd; and Paraglide
here having **no URL strategy configured**, so `/pl/events` is not a locale URL at all and the language
is chosen through the picker. A fourth was the test being right and the assertion wrong: the "does the
kill switch leak" check was being asked of the moderator, who bypasses every flag by design.

**Regression — all six pre-existing scripts re-run, 188 checks, zero regressions:** booking 51,
classroom 44, classroom-overhaul 29, education-auth 42, material-claims 14, profile-editing 8. Two runs
hit the documented Vite/Chromium resource-exhaustion artifact (a navigation timing out after a long
chain of full page loads) and passed on a re-run against a fresh dev server; `education-auth.mjs`
carries a **pre-existing hardcoded `127.0.0.1:8011`** and must be run against the port `test.md`
documents, which is unrelated to this work.

`npm run check`: 0 errors, 0 warnings. `npm run build`: clean. `makemigrations --check`: no pending
changes.

### 17V.7 Left open, not built

**Six of the entries below were closed in a follow-up pass — see 17W.** What remains here needs a
product decision or infrastructure this project does not have, rather than an afternoon.

- ~~**No editing an event after it exists.**~~ **Built — 17W.1.**
- ~~**No subject picker on the event form.**~~ **Built — 17W.2.** `CourseForm` still has the gap.
- **No recurrence.** Every event is a single occurrence; a weekly reading group is five events. Adding a
  rule would mean deciding whether attendance is per-occurrence, which is a real design question rather
  than a field.
- **No reminder before it starts.** Somebody who said they are coming is told if it moves or is called
  off, and never told "this is tomorrow" — that needs scheduled work (cron or a task queue), which this
  project has nowhere to run yet.
- **No comments on an event.** The generic `Comment` is right there and `classroom` shows how to wire
  it; it was left out to keep this pass honest rather than broad.
- **No moderation or reporting surface for an event**, matching the gap Section 17P names for Service
  listings and 17U for bookings.
- **No waiting list.** A full event simply refuses, and the seat freed by a change of mind goes to
  whoever asks next rather than to whoever asked first.
- **Attendance has no check-in**, so nothing records who actually turned up as opposed to who said they
  would.
- **The homepage tabs show six items each with no pagination**, and "See all" is the only route to the
  rest.
- **`MeatballsMenu` still duplicates `Popover`'s open/close behaviour**, deliberately — see 17V.4.
- ~~**The drawer does not trap focus.**~~ **Built — 17W.3.**
- **Attending an event still does not block bookable time**, by decision rather than omission (17V.2).
  The missing escape hatch beside it is now built — 17W.4.
- ~~**Nothing warns a host that they are publishing an event over their own bookable hours**~~ —
  **Built — 17W.5.**

---

## 17W. Closing the real defects on that list (✅ built)

Six entries from 17V.7. The other seven stay open on purpose: recurrence and a waiting list are design
questions (is attendance per-occurrence? is a freed seat first-come or first-asked?), reminders need
scheduled work this project has nowhere to run, and comments/moderation/check-in are scope rather than
defects.

### 17W.1 Editing an event

`/events/[id]/edit`, the same shape as `classroom/[id]/edit`: load, refuse in a sentence, otherwise hand
the record to the shared `EventForm` — which was already written for both jobs and needed no change.
The API, the serializer and the "this has moved" notification all existed and were tested; only the page
was missing.

**A cancelled event is refused here rather than allowed to fail on save.** The form always sends a
status and `validate_status` refuses to reopen a cancelled event, so that form could only ever be
rejected. Same reasoning the classroom page states for a course that is not yours.

### 17W.2 Subjects on the event form

A checkbox group, not `<select multiple>`: multi-select needs a modifier key most people do not know
they are holding, and at this catalogue's size the whole list fits on screen.

**Narrowed to the chosen field**, because a subject belongs to one, and **changing the field drops
subjects that no longer belong to it** — the same reasoning that already blanks `locationText` when the
location kind changes: a value the form no longer offers is one nobody can see and every later edit
silently preserves. Done in the change handler rather than an `$effect`, because an effect that both
reads and writes `subjectSlugs` re-runs itself — the exact shape of the drawer bug in 17V.4, and
reaching for `untrack` to fix a loop that need not exist is the wrong trade.

### 17W.3 The drawer traps focus

A keydown cycle rather than `inert`. `inert` is the tidier idea and would also take the background out
of the accessibility tree, but from inside `Header.svelte` "the rest of the document" means iterating
the body's children and skipping our own three elements — a DOM-wide side effect to undo on every exit
path including teardown. This stays inside the component and needs no cleanup.

**The toggle button leads the cycle deliberately.** It is the drawer's ✕ while the drawer is open and it
lives outside `<header>` (17V.4), so a trap scoped to the drawer alone would put the close button out of
a keyboard's reach — a worse bug than the leak being fixed.

### 17W.4 One click to keep the hours

Attending still does not withdraw bookable time; that decision stands and 17V.2 explains it. What was
missing was the way out for somebody who *does* want the evening held, which was "go and write an
availability exception by hand". Now a button on the event, writing a real `AvailabilityException`
whose note names the event — because an unexplained hole in a schedule six weeks later is one somebody
deletes.

### 17W.5 The clash warning

Hosting removes the hours from anything still bookable, but it never moves a session somebody has
already booked — so a host could be double-booked and find out only by looking at their own calendar.
Two different warnings, because they are different problems: a **live booking** over those hours (shown
to host and attendee alike, since either can be the one who has to sort it out) and **hours still
published as bookable** (host only — for anybody else the subtraction never happens). Styled as a
warning, not an error: nothing has gone wrong and nothing is refused.

`my-schedule` never subtracts, by design, so its windows are the raw published bands and this overlap
check sees what the tutor sees.

### 17W.6 The hardcoded port in `education-auth.mjs`

It reached the API through a literal `127.0.0.1:8011`, making it the only script here that could not be
pointed at another backend. Now `E2E_API` like every sibling, and the call moved to Node so it does not
depend on CORS — the reasoning `classroom-overhaul.mjs` already records.

**Worth knowing: the sibling scripts default to `:8000` while `test.md` documents `:8011`,** so most of
them need `E2E_API` set explicitly. That mismatch is pre-existing and untouched here.

### 17W.7 Verified

`e2e/known-issues.mjs` — **23 checks, zero console/page errors**, plus screenshots actually looked at.
Real runs: the subjects group renders four subjects and the one ticked at creation is still ticked when
the edit form reloads; a non-host is refused in words with no form rendered; the "keep these hours free"
button writes a real `AvailabilityException` **read back from the API**, so a button that only flipped a
flag on the page would fail; focus survives 40 Tabs and 20 Shift-Tabs inside the drawer, Escape closes
it and focus returns to the button that opened it.

All seven pre-existing scripts re-run: **280 checks, zero regressions** (events-and-nav 92, booking 51,
classroom 44, classroom-overhaul 29, education-auth 42, material-claims 14, profile-editing 8).
**303 browser checks in total.** `npm run check` 0 errors 0 warnings; `npm run build` clean. No backend
file was touched.

**One trap worth recording, hit three times in this pass**: `register` is throttled at **10/hour in a
per-process `LocMemCache`**, so a long e2e session exhausts it and every later script fails in ways that
look exactly like a code regression (a page with no menus, a form that will not submit). Restarting the
backend process clears it. `pkill -f "manage.py runserver …"` also matches the shell issuing it and
kills the replacement — kill by the PID holding the port instead.

---

## 17X. `/levels` — the trust system, described where readers are (✅ built)

The REP/SKILL/ENERGY design has lived in LAUNCHCHECKLIST.md since it was written, which is the right
home for a design brief and the wrong one for the people the rules would apply to. `/levels` is that
document written for a reader: two ladders, seven capability tiers, five mod levels, vote weight,
energy costs, REP events, the promotion/demotion rules, and appeals.

**The page's real job is the distinction between designed and live**, so it is a badge on every heading
rather than a caveat somebody skims. Eight sections carry *Designed, not built*; exactly one carries
*Live today*, and it is checked against the code rather than the brief — the single staff flag, the one
contributor flag, `NodeGovernor`, and the real throttle rates out of `DEFAULT_THROTTLE_RATES`, including
the honest note that they are per-process counters. A page that let somebody believe they had a tier
would be worse than no page.

**Text lives in `lib/content/levels.ts`, per locale — deliberately widening the exception
`content/privacy.ts` opened** rather than letting it drift. That file's argument was that a document has
to be readable and reviewable AS A DOCUMENT, not as ~50 keys interleaved with button labels in
`en.json`; nine tables and forty paragraphs are the same shape of content, and the rule's actual
purpose — no string is ever English-only — still holds exactly, since both locales live in the one file
and a third cannot be added without adding all of it. If the file and LAUNCHCHECKLIST.md ever disagree,
**the checklist is the source and the page is the stale copy**; the module says so at the top.

**Reachable from three places, and two of them are attached to a badge rather than sitting in a menu.**
The footer, beside the privacy policy — both are standing explanations of how the site treats you,
wanted occasionally and never mid-task. `/settings`, directly under the role badges in the Profile card,
worded about your own standing: "these badges are all the standing EdMat has today; what they are meant
to become —". And `/users/[id]`, inside the badge row itself as a caption reading "What these badges
mean", worded for somebody looking at SOMEBODY ELSE'S profile — the common case there, and the one where
"what does Verified contributor actually mean?" is a real question. Not in the navbar in any case: this
is something you want at the moment a badge raises the question, not something you go looking for.

The public-profile link is suppressed when the badge row renders nothing at all (a private profile with
no roles), since a caption explaining badges that are not there explains nothing.

**Verified in a browser**: both locales render fully translated with 8 tables and exactly one live
badge, the footer link navigates, zero console/page errors. `npm run check` 0 errors 0 warnings; build
clean. One ordering bug found by looking at the screenshot rather than by any assertion: bullets
rendered *after* the table in the only section that has both, so the line introducing the rate-limit
table sat underneath it. Bullets now precede tables everywhere.

**Left open**: nothing on the page is personalised — it cannot say what tier *you* hold, because no
tier exists to hold. `/settings` links to it but shows no standing of its own beyond the two existing
flags; turning that link into a real panel — your REP, your SKILL per field, your energy, read against
these tables — is what there is to build once the system behind it exists.

---

## 17Y. Feature: updates on an event — a picture, some links, some words (✅ built, full stack)

An event could say what it *was* and never what had *happened since*. The room moves, the slides go
up, the recording appears, the start slips twenty minutes — and the only places to put any of that
were the `description` (read by somebody deciding whether to come, edited in place, undated) or
nowhere. `EventPost` is that missing thing: a dated broadcast from the host, appended and read in
order.

### What it is not

Two models already in this app look close enough to be worth ruling out in writing, since picking
either would have been the expensive mistake:

- **Not the event's `description`.** A description answers "what is this?"; an update answers "what
  has changed?". Folding updates into the description means either losing every earlier one or
  growing one text field into an undated changelog nobody can skim.
- **Not a `community.Comment`.** That thread is a conversation — anybody may write, and the reader's
  question is "what do people think?". This is a broadcast from the one person running the thing, and
  the reader's question is "what do I need to know?". Same shape, opposite direction. Mixing them
  would bury "moved to room 5" under a discussion, which is precisely the message that must not be
  buried.

**Only the host may post**, because every post goes out as a notification to everybody holding a seat,
and the right to interrupt forty people's evening belongs to the person who organised it. Attendees
are not silenced by this — the event has its own thread — they simply do not get the megaphone.

**Reads are public** (anybody who can see the event), which is deliberately wider than the roster.
"The room has moved" is most useful to somebody still deciding whether to come, and gating it behind
an RSVP would hide it from exactly those people. A draft's updates are invisible for free, because the
draft is — the visibility rule lives in `EventViewSet.get_queryset` and nothing here restates it.

### The picture is never the bytes that were uploaded

`events/postimage.py` decodes and **re-encodes** every accepted image, which is what discards appended
payloads, embedded metadata, and format-parser trickery. That pipeline already existed for avatars, so
the parts of it that are *security bounds* rather than presentation moved to a new top-level
`imaging` module — a second copy of a decompression-bomb budget is how one path gets a fix after an
incident and the other silently does not. `accounts/avatar.py` keeps every public name it exported;
`validate_avatar_file` in particular cannot move, because `accounts/migrations/0006` refers to it by
path.

What did **not** move is the shape. An avatar is centre-cropped square for the round frame that
renders it; a post picture keeps its aspect ratio and bounds its longest edge instead, because it is
routinely a whiteboard, a slide or a poster — the three things a centre-crop damages most, since on
all of them the content runs to the edges. `thumbnail` is shrink-only, so a small picture is not
stretched up to the bound.

**EXIF is stripped for a sharper reason here than on an avatar.** A phone photo of the room an event
is in carries the GPS coordinates of that room. An event already publishes where it is, deliberately
and in words the host chose; what it must not also publish is a precise fix taken from a photo the
host thought they were merely illustrating the page with.

### Links are rows, and arrive in whichever shape the request can carry

`EventPostLink` rather than a JSON list: a `URLField` validates each one on the way in for free, and a
list inside a text column gets none of that. Capped at ten — a shape bound, not a storage one, since
past a handful a post has stopped being an announcement and become a link dump.

Deliberately a URL and nothing else. A label sounds useful until you ask who writes it: the host, in a
second field, for every link, most of which are self-describing. The frontend shows host and path,
which is what somebody reads before deciding whether to click.

`PostLinksField` accepts three shapes and normalizes all three, because a post is submitted two
different ways: with a picture it must be `multipart/form-data`, which has no arrays, and without one
it is ordinary JSON, where a list is obvious. So it reads a JSON list, repeated form keys, or one
string holding several. **The repeated-key case needed a `get_value` override** — DRF's default reads
only the *last* value for a repeated key off a QueryDict, so three links would silently have become
one.

### Notifications

A new `event_posted` type, to everybody holding a seat, carrying the post's opening words rather than
only its existence — a notification that makes you open a page to discover it was "the slides are up"
spent your attention to tell you nothing.

**Kept apart from `event_updated`** even though both mean "something about this event changed",
because the two ask different things of the reader: that one fires when the time or place moved and
the reader must rearrange their evening; this one means the host wrote something and the reader should
go and read it. Collapsing them makes the urgent one indistinguishable from "the slides are up", which
is how people learn to ignore both. An edit never re-notifies, and a draft notifies nobody.

### The count on the card

`EventSerializer.post_count`, so a listing can say an event has news without fetching every feed —
otherwise the whole feature is invisible until somebody opens each event in turn. Shown only when
non-zero: "Updates: 0" spends a line to say nothing, on every event on the page, since most never get
one.

Its prefetch needs `to_attr`, and that is load-bearing rather than stylistic. Without it the deferred
queryset lands in the related manager's own prefetch cache and the manager chains further calls onto
it — so `event.posts.select_related('author')` in the `posts` action inherited the `.only()` and
raised `FieldError: Field EventPost.author cannot be both deferred and traversed using
select_related`. Found by the reading tests, not by inspection.

### Verified

**`events/tests.py` grew from 60 to 95 tests**, full backend suite **728, all passing**. Weighted
towards refusals and the cases that fail silently: a post with neither words nor a picture; links
alone; a stranger posting (404, not 403); a draft's feed invisible to everybody but its host; the
newest first; every link shape including the repeated-key one DRF loses by default; a disguised
executable; the stored picture re-encoded, bounded, and NOT centre-cropped; a small picture not
upscaled; a body-only PATCH leaving links *and* picture alone while an explicitly empty list clears
them; an empty multipart `image` field meaning "remove"; removing the only picture from a wordless
post refused; who is told and who is not; and the update count adding no queries per event.

**Driven in a real browser and against a real server**, since type-checks and unit tests both pass on
an API whose field names the frontend does not agree with — this project's own recorded lesson.
Anonymous read (3 posts, one picture, shortened link labels, no composer), host compose through the
actual form, the live notification arriving with the post's text, the picture served as genuine WebP
resized 2400×1200 → 1600×800, and the count rendering on the browse card.

### Left open, not built

- **A post cannot be reported.** Consistent rather than an omission: `Event` itself is not in
  `REPORT_KIND_MODELS` either, so an event's description is equally unreportable. Both belong in the
  same change if either does.
- **No comments on a post.** The generic `Comment` is right there and `courses` shows how to wire it;
  left out to keep the broadcast/conversation split clean until somebody asks for the other half.
- **One picture per post**, no galleries, and no alt text — the host is never asked for a description,
  so the image renders with an empty `alt`, marking it decorative, rather than an invented one being
  read aloud on every post.
- **No "N new since you last looked".** The count is a total, so an attendee cannot tell at a glance
  which updates they have already read.
- **No draft or scheduled post** — publishing is the act of writing one.

---

## 17AA. Feature: the navbar collapses in stages, and search reaches everything (✅ built)

(§17AA rather than §17Z, which the unmerged `worktree-booking-week-schedules` branch already claims.)
Built from `NAVBAR-BRIEF.md`, whose stage order is the specification. Between "everything fits" and
"phone drawer" the bar used to have nothing: one breakpoint at 720px. Now it degrades one stage at a
time, each at a narrower width than the last, giving up the cheapest thing first — and its height,
padding, gaps and border thickness shrink as a **linear function of window width** (`clamp()` with a
`vw` middle term, endpoints defined once as `--hdr-*` custom properties on `.site-header`, so nothing
can end up with a linear height and stepped padding). Media queries, not container queries: the bar
spans the full viewport, so the two are equivalent here, and media queries are what this app already
uses.

**The stages** (Header.svelte, each a labelled media query): 1180px Events → calendar icon; 1120px the
account trigger → their avatar, or a plain person icon (no identicon, §17Q); 1060px Materials → book
icon; 1000px Tutoring → money icon; 950px Add… → its plus alone; 900px Disciplines → a **search icon
immediately left of Add**; 850px the logo disappears (721–850px band only — the phone bar at ≤720px is
the brand again, and a Home entry appears in the account menu for the band; guests keep breadcrumbs);
800px a signed-in person's language picker moves into the account menu (**a guest's stays in the
row** — the one control someone may need before they can read anything must not sit behind a menu
labelled in a language they cannot read); 760px Courses disappears (reachable via the homepage tabs,
the drawer one stage below, and search); 720px the existing drawer (§17V.4, unchanged). Collapsed
icons join the action row **just right of the dice, in nav order** (book, calendar, money), each an
inline SVG — decided with the owner over their earlier "emoji" — with a real `aria-label`. The text
links and icon twins are the same single-sourced snippet lists §17V.4 demands, so the feature-flag
gates (`can('events')` etc.) hold on both forms. Four owner decisions recorded: **stage 3 (Watchlists
→ eye icon) is deliberately absent** — it was already removed from the bar and the owner confirmed
the spec line was an older memory, not a re-add; Tutoring (which the refined spec had dropped)
collapses between Materials and Add; search widened to *everything*; SVG over emoji.

**Search now reaches what the removed links opened.** `?q=` (plain icontains on title/description,
MaterialViewSet's own convention) added to `EventViewSet`, `ServiceViewSet` and the taught-course
`CourseViewSet` — each inside the existing visibility layer, pinned by a test per app that a draft/
only-you/paused row is not widened into view by a matching query. `/search` gained sections for
disciplines + branches (client-side filter over the small, bounded, already-served lists — not a
second search implementation), taught courses, events and tutoring, each rendered with that feature's
own card and gated by the same flags as everywhere else, requested only when the flag allows.

**Verified**: `e2e/navbar-stages.mjs` (42 checks, see test.md) plus screenshots actually looked at —
which is how the one real issue of this build was found: the first run's search checks passed
**vacuously** against a backend process that predated the `?q=` filters (an unfiltered list also
contains the stamped test rows); the screenshot showed non-matching courses under a `matematyka`
query, and the script now asserts the exact result count so that cannot pass again.
`e2e/events-and-nav.mjs` re-run: 89 passing checks stay passing (its 3 failures — an account-menu
My Set entry and two schedule-page labels — pre-date this work on `main`). Backend suites for the
three touched apps pass; `npm run check`/`lint`/`build` clean.

**Left open, not built**: the 3 pre-existing `events-and-nav.mjs` failures above; no `?q=` for
messages or bookings (private, not browse surfaces); ~~the empty `.site-nav` at ≤760px still renders
its divider (a hairline artifact, visible only in the 721–760px band)~~ — moot since the update
below removed the divider outright.

### Update (2026-08-10): the collapse stays IN PLACE — the rearranging rules are dropped

An owner-requested simplification of the scheme above. Three changes, one decision behind them:

- **A collapsing browse link now swaps its text for its own icon IN PLACE**, keeping its nav
  position and order (Materials stays between Disciplines and Courses) at the SAME widths as
  before — Events 1180, Materials 1060, Tutoring 1000, Disciplines 900, Courses 760. The whole
  "collapsed icons migrate to the action row beside the dice / Disciplines merges into a search
  icon left of Add / Courses vanishes outright" arrangement is gone. Two new icons existed nowhere
  before and were needed for the two links that previously had no icon form: a compass
  (Disciplines — replaced on 2026-08-25 by a worksheet-with-a-tick once that link was renamed
  Exercises/Zadania, since a compass stood for nothing a reader could name any more) and a
  mortarboard (Courses). Each link carries a permanent `aria-label`, so the
  accessible name survives the text hiding. The drawer renders the same `browseLinks` snippet and
  stays text-only at every width (the icon spans' base rule hides them; every stage rule is scoped
  under `.site-nav`). **Consequence, flagged rather than hidden: the header no longer links to
  `/search` at any width** — the search icon existed only as Disciplines' stage-6 merged form, and
  went with the scheme. The search page stays reachable through the homepage hero search.
- **The `.row-divider` is removed** (markup + styles) — with the actions block right-aligned by
  its single `margin-left: auto`, the distance is the separation; a line in the middle of empty
  space was furniture. This also erases the ≤760px hairline artifact the Left-open list above had
  recorded.
- **Exactly one auto margin does the pushing**: `.site-header__actions` keeps `margin-left: auto`;
  the second, inert `margin-left: auto` on `.site-header__you` (a leftover from the divider-era
  layout, dead since the actions block became `flex: 0 0 auto`) is removed.

**Verified**: `e2e/navbar-stages.mjs` rewritten to pin the new behavior (51 checks, all passing,
zero console/page errors — including per-stage "the nav keeps its order" position assertions and
"the old search icon is gone for good"), plus screenshots at 1280/980/840/740/390 actually looked
at. Two script-infrastructure fixes were needed, both worth remembering: its `goto` used
`waitUntil: 'networkidle'`, which **never fires on an authenticated page against a healthy
backend** — the signed-in header holds the notification SSE stream open, a permanently in-flight
request — so it only ever passed when the stream failed fast; now `'load'` plus explicit
`waitFor()`s on the elements the checks read (the account trigger, the search results). And a
local-only 500 on `DELETE /api/services/` during cleanup turned out to be the canonical dev
checkout's own `db.sqlite3` never having been migrated past the week-schedules feature (`no such
table: booking_weektemplatewindow`) — a stale-dev-DB problem, not a code bug; webek4 is fully
migrated. `npm run check` (0 errors/0 warnings), `lint`, `build` all clean.
## 17Z. Feature: laying out a schedule week by week — drag and drop, saved weeks, bulk apply (✅ built, full stack)

A tutor could say "Tuesdays, 14:00–16:00, forever" and nothing else. `AvailabilityRule` is unbounded
by construction, so there was no version of "and the third week of term is different" that the data
model could express at all — and the only way to write any of it was a form with four selects.

Three things changed, and the first is the one the other two rest on.

### A week either follows the pattern, or replaces it

`WeekSchedule` (tutor + a Monday, unique) with `WeekScheduleWindow` children is the concrete
timetable for **one** week. Its existence *is* the statement: `availability._base_windows` reads the
repeating rules for that week not at all.

- **The replacement is total, not a layer.** A detached week with no windows publishes nothing, which
  is what somebody who cleared it meant. Letting the pattern show through the gaps would re-publish
  the hours they had just removed, and would leave "I am not working that week" unsayable.
- **Bounding the rules with dates instead was the obvious alternative and is worse.** Every per-week
  edit would split a rule into three — before, the changed week, after — growing the table without
  limit and destroying the one thing the pattern is for: an answer to "what does my ordinary week
  look like".
- **Exceptions still apply on top, to both sources.** "I am at a conference on the 14th" is a fact
  about the 14th and stays true however that week's hours were arrived at. That is why the branch
  lives in one function and everything downstream — exceptions, busy time, slicing, the past — is
  blind to which arm it took. Two sources of hours must never mean two paths through the arithmetic.
- **The stored week is always Monday-based**, whatever week order the viewer reads in. It is a lookup
  key, so it has to mean the same thing for everybody; if it followed each viewer's `week_starts_on`,
  one calendar week would key to two different dates depending on who opened it, and switching that
  preference would silently re-partition every saved week into halves of two others. The editor
  therefore draws Monday–Sunday while editing, and says so to the minority who read Sunday-first.
- **`WeekTemplate` is deliberately a third thing**, not a fourth use of the other two: a named shape
  on a shelf that does nothing at all until applied. Collapsing it into the repeating pattern would
  mean either that saving a template changed your live availability, or that your live availability
  was one template among several with nothing marking which was in force.
- The two window tables share an abstract base rather than one table with an XOR constraint — each
  table means exactly one thing, and this codebase has consistently taken that side of the trade.

### Dragging on the calendar

`CalendarWeek` gained an editing layer, still domain-free: a window is a date and two minute offsets,
and the grid neither knows nor cares whose hours they are. Drag on a day to draw, drag a block to
move it, drag its edges to resize, × to remove. 15-minute snapping — half-hours cannot express a
45-minute session, and free-form dragging produces 14:07 starts that look like mistakes because they
are.

- **Keyboard support is not a bolt-on.** Enter on a day adds an hour at the first free time, arrows
  move a block, Shift+↑↓ resize it, ←→ move it a day, Delete removes it. A schedule editor operable
  only by pointer would be unusable for exactly the people who most need their hours written down
  correctly. It is also why the day column is a real `<button>` rather than a div with a handler:
  saying so in the markup is honest, and it is what makes drawing hours reachable at all.
- **Overlaps are merged on write**, unlike the repeating rules. `_merge` already unions them on read,
  so two dragged blocks at 10–12 and 11–13 are drawn as one band — storing two rows would redraw them
  stacked on the next load, i.e. the editor disagreeing with the calendar it is drawing on.
- **The published-hours background band is suppressed while editing.** It is the same afternoon as the
  editable layer arrived at from the other side (the band has exceptions folded in; the editor's layer
  is the hours before them), and drawing both shows one afternoon twice in two slightly different
  shapes with no way to tell which a drag was about to change.
- **Every gesture saves immediately.** A schedule editor with unsaved state is one crash away from
  publishing hours somebody thought they had withdrawn — the same reasoning that already refuses to
  cache this tab.
- **Which of the two things a change reaches is a choice, not an inference.** Two radio buttons with a
  sentence each: "only this week" or "every week". Guessing from whether the week happened to be
  detached already would pick wrong about half the time, and the state line says which case you are
  in *before* an edit rather than after.

### Repeating a week, and then changing one

`POST /week-schedules/apply/` takes a source (a template, or a week to copy), a first week and a
count. A count rather than an end date, because that is how the decision is made and it cannot
express an empty or backwards range.

- **The copy is of the hours somebody works, not of the dentist appointment they had that Thursday.**
  `base_windows_for_week` reads *before* exceptions; replicating one forward would invent five
  appointments nobody made.
- **Every target week is detached by this**, which is the point — a week left following the pattern
  would drift the moment the pattern changed, and somebody who has just laid out their term means the
  term.
- `overwrite=false` skips weeks that already have their own schedule, and the response says how many
  were written and how many were skipped, because "5 weeks updated" and "3 updated, 2 left alone" are
  different outcomes and the second is the surprising one.

### Verified

**`booking/test_week_schedules.py` — 64 tests**, weighted at precedence, because that is the half that
fails silently: a detached week replacing the pattern rather than layering on it, an empty one
publishing nothing, the weeks either side untouched, a Sunday belonging to the week that started the
previous Monday, exceptions still cutting through, a midweek date normalising to its Monday, and the
whole lay-out-then-change-the-third-week flow end to end.

**`e2e/schedule-editing.mjs` — 36 checks in a real browser, zero console/page errors**: a drag
becoming stored hours, the same window answering both the mouse and the arrow keys, both resize
edges, five weeks written and the sixth still on the pattern, the third of them changed while the
others stayed, a week saved as a template, and a week put back.

**Three real bugs, all found by driving a browser rather than by reading the code**, and none of them
catchable by `svelte-check`:

1. **`formatTimeOfDay` where `formatClock` was meant.** Both take a `string`; the first parses an ISO
   instant, so `new Date('09:00')` is an Invalid Date and `Intl` throws on it. The entire editable
   layer silently failed to render — the canvas was there, so dragging still created hours, but
   nothing was ever drawn.
2. **Window listeners attached conditionally on the gesture.** Binding `onpointermove` to `gesture`
   makes attaching it a reactive effect that runs *after* the pointerdown that set it, so every move
   dispatched before Svelte's next flush is lost and a drag arriving in one tick registers as a click.
   A human mouse spreads its moves over frames and hides this completely. Now attached for as long as
   editing is on, with a null check in the handler.
3. **`id` added to the week payload and to the type, but never to the mapper**, so reattaching a week
   silently no-opped — the button did nothing at all, with no error anywhere.

Two more were visual, found by looking at a screenshot rather than at the assertions, which all
passed: the switcher's `text-transform: capitalize` (right for locale month names) turned "Week of
August 3" into Title Case, so the week identity moved into the editor panel where it belongs; and the
remove × sat on top of the time it was next to ("14:15–16:15×"), so it now appears on hover or focus.
The upper resize grabber was also invisible, drawn one pixel under the label — both grabbers are now
pinned to their own edge of the block.

### Left open, not built

- **No undo.** Every gesture saves immediately, and there is no way back except making the opposite
  gesture. Reattaching a week discards its hours with no confirmation.
- **A Sunday-first reader's grid shifts by a day when they start editing.** Stated on screen rather
  than solved; the alternative — a displayed week straddling two stored ones — would mean a drag on
  the leading day quietly changing the week before.
- **No drag across the month view**, which has no time axis, so the editor is offered only in the week
  view.
- **Applying a template cannot preview what it will overwrite** — the count of skipped weeks is
  reported after the fact, not before.
- **A template cannot be edited on the calendar**, only saved from a week and applied to weeks. The
  API supports a full replace; there is no UI for it.
- **Nothing warns that a week being changed already has bookings in the hours being removed.** The
  bookings are drawn on the calendar underneath, so the clash is visible, but the app does not say it.
- **`getWeekSchedules` is built but has no UI consumer** — the month view does not yet mark which
  weeks have their own schedule.

---

## 17AB. Feature: Redis — shared counters, earn-your-slot response caching, pub/sub push (✅ built)

(§17AB because §17AA is the navbar branch's, unmerged when this was written. The Rust/Go/C port
direction this superseded is archived on `outdated/port-rust`, files and session log preserved —
the owner decided to stay with Django and spend the effort here instead; `PORTS-BRIEF.md` and
`ENERGY-BRIEF.md` on the navbar branch carry the analysis that led to this feature.)

**One env var, three behaviors, zero new requirements for a bare clone.** `EDMAT_REDIS_URL`
(config/settings.py) is the whole switch: set, it moves Django's cache to the built-in Redis
backend (auth throttle counters — per-worker-correct at any process count, closing the caveat
§17Q left open), makes the new anonymous-read response cache genuinely shared, and turns
notification SSE delivery into real pub/sub push. Unset — a fresh clone, `setup.sh`, the test
suite — everything keeps the file-cache / DB-polling behavior, so Redis is an upgrade a deployment
opts into, never a daemon a student must install (`MATERIAL_SCAN_REQUIRED`'s own posture).

**The SSE rewrite (notifications/views.py + the new notifications/redisbus.py).** The stream used
to poll the database every 3 s PER CONNECTION for up to 600 s — the app's only busy loop, and
against the real vhost's 8 WSGI slots (2 processes × 4 threads) an availability problem: eight
idle tabs occupied every slot (ENERGY-BRIEF §1). Now `notify()` publishes each serialized row once
(fire-and-forget — the DB row is already the durable truth, so a lost publish costs only
immediacy) and an idle stream blocks on the subscribe socket: zero queries, zero wakeups between
events, keep-alives riding the 15 s subscribe timeout. Subscribe-first-then-drain ordering plus an
`id <= last_id` guard closes the race between the snapshot and the subscription. **And the cap**:
two concurrent streams per account (`redisbus.STREAM_SLOT_LIMIT`, Redis-counted with a TTL leak
guard, fail-open if Redis dies mid-request) — a third tab gets a plain 429, which EventSource
treats as terminal, so one person can no longer absorb the slot pool. The polling implementation
survives verbatim as the no-Redis fallback.

**The response cache (config/cachemw.py) — the owner's admission policy, verbatim**: "only after
2nd refresh, or even later depending on the current traffic (after like 6-7)". An anonymous GET on
the positive-list prefixes is only STORED once its exact URL has missed twice
(`EDMAT_CACHE_ADMISSION_MIN=2`); when the current minute's anonymous traffic passes
`EDMAT_CACHE_BUSY_RPM=120` the bar rises to `EDMAT_CACHE_ADMISSION_BUSY=7` — under pressure an URL
must prove itself harder before spending shared memory. Entries are TTL-bounded (60 s), writes
never invalidate (sub-minute staleness beats an invalidation protocol at this write volume — a
stated trade). **The security gates are about who asks, not what the endpoint looks like**: any
`Authorization` header or session cookie disqualifies the request in both directions (
SessionAuthentication on the browsable API means a session-bearing GET can genuinely see different
data), a `Set-Cookie` response is never stored, and exercise DETAIL is carved out because
`retrieve()` records the `ContentView` viewer-pool rows the auto-hide arithmetic divides by — a
cache hit would silently stop counting anonymous readers. `X-EdMat-Cache: miss/stored/hit/skip`
makes every decision observable. Speaks Django's cache API only, so the identical logic runs on
the file cache too — Redis makes it shared, not different.

**The preloader (`manage.py preload_cache`, telemetry app)** — "preload in redis as much as
possible", bounded by evidence: the taxonomy base set (discipline lists + every published
discipline's branches payload, both locales) plus the top `--top` anonymous GET paths from the
telemetry log's own anonymous shard (`logs_anon`), fetched through the full middleware stack and
seated via cachemw's own `store()` with admission deliberately bypassed. Query strings are never
replayed (telemetry redacts `?q=` by design — a search term is the visitor's content). Same TTL as
organic entries, so preloading is a head start, never a staleness extension; cron it at the TTL
cadence for standing warmth.

**Verified.** 7 new tests (`telemetry.tests.AnonymousReadCacheTests`): the 2-miss admission ladder
(miss → stored → hit, bytes identical), the busy-traffic bar refusing to store before the 7th
request, an Authorization header and a session cookie each disqualifying in both directions, the
exercise-detail carve-out, and the preloader seating hits ahead of any admission — plus the full
telemetry + throttle suites re-run OK, `manage.py check` clean. **Live, against a real compiled
Redis 8.10** (user-local build, no sudo): the admission ladder over HTTP; a `notify()` fired from
a separate process arriving on an open stream immediately; the third stream for one account
refused 429 with the slot counter readable in redis-cli at exactly 2; `preload_cache` seating 13
responses and a never-requested URL serving `X-EdMat-Cache: hit` cold; and the fallback server
(no env var) still admitting via the file cache and streaming via the polling path. **Three real
bugs found by the live pass, none by the unit tests**: the preloader died on a missing/unmigrated
`logs_anon` shard (now degrades to the base set, loudly); it silently preloaded ZERO because the
test client's `Host: testserver` 400s under non-test `ALLOWED_HOSTS` (the suite whitelists it —
now picks a real allowed host, and the output separates "off-list" from "failed fetches" so an
all-failures run can't read as success); and redis-server's `--daemonize` startup race initially
looked like a failed install.

**Left open, not built**: no cache invalidation on write (TTL-only, by decision); the stream cap
is only enforced when Redis is up (an in-process count under mod_wsgi's multiple processes would
be a fiction — stated in redisbus.py rather than pretended); `django-redis` is deliberately NOT a
dependency (Django 5's built-in backend suffices); the SSE token-in-query tradeoff (§17H) is
unchanged by this; and the frontend needed zero changes — EventSource semantics are identical on
both transports.

---

## 17AC. Feature: a course links real content, not a link in a paragraph (✅ built, full stack)

A chapter or a lesson could reference something in exactly one way that a curator could reach: paste
its address into the description and let the Markdown render it. That works once and then stops
being useful — the course cannot show the material's live title, cannot drop an exercise a moderator
has pulled, cannot order it against the rest of the week, and cannot find it in the course's own
search. None of that is available to a string in a paragraph.

Most of the machinery already existed. `CourseItem` has been the intermediary all along (material /
exercise / attachment / event, filed into a chapter or a lesson, with order, note and a review
status), and `LessonExerciseSet` already pinned a whole set into a lesson. Four things were missing,
and they are what this section is.

### A discussion is now a thing a course can point at

A fifth `CourseItem` kind, `discussion`, pointing at a `community.Comment`. This is the one kind that
needed rules the other four did not:

- **A root comment only.** A thread is a conversation; a link into the middle of one is a link to an
  answer with the question missing.
- **Not a thread private to another course.** A course's own discussion, and a week's or a session's
  inside it, are readable by that course's participants (`discussion_mode` defaults to
  `participants` because the roster is private). Linking one into a *different* course would publish
  it to a roster it was never shared with — exactly what the attachment check already refuses, so it
  is refused the same way. This course's own thread is fine, and is the case the feature was asked
  for: filing this week's question into this week.
- **A taken-down thread stops being shown** to participants and stays visible to curators, who are
  the people who can replace it — the same rule an unpublished exercise already gets.
- The label is the comment's opening words, because a comment has no title and never will. The
  response also carries `discussion_target_type`/`_id`: a comment has no page of its own, it hangs
  off whatever its own target hangs off, and only the server can say which. That is what
  `community/targets.py` exists for.

### A set can hang off a week, not only a session

`LessonExerciseSet` gained a nullable `chapter` beside its (now nullable) `lesson`, with an
exactly-one check constraint — the same shape `CourseItem` already had, for the same reason: the
reading everybody does before week 3 belongs to the week, not to whichever session is first in it.
One pair of endpoints serves both levels (`/{lessons|chapters}/{id}/exercise-sets/`) rather than a
second pair under `chapters/`, since the two differ only in which column the row stores. Its reorder
group ids are therefore prefixed (`chapter:7` / `lesson:7`); a **bare id still means a lesson**, so
every payload written before chapters were possible keeps meaning what it did. The model keeps its
`Lesson`-shaped name deliberately — renaming it would rewrite six files' worth of imports and a
drag-and-drop registry to say what its docstring says better.

### The linking form is where you already are

`LinkedContentEditor.svelte`, rendered inside both the chapter and the lesson edit dialogs: the list
of what is linked, and one row to add another. It takes **the thing people actually have** — the
address of the page they are looking at — and turns it into a real row. `lib/utils/contentLinks.ts`
does the reading, and is deliberately tolerant about shape and strict about meaning: a full URL from
any origin, a path, a locale prefix, a trailing slash, a query string and a bare id all resolve, and
anything else returns null and is refused in words rather than guessed at.

Two things about the surface are load-bearing rather than tidy. It brings **no `<form>` of its own**,
because it renders inside dialogs that are already forms — nesting is invalid HTML, browsers resolve
it by dropping the inner one, and the "Add link" button would have submitted the dialog and saved the
chapter instead. And Enter in its text field is `preventDefault`ed for the same reason. The dialogs'
description fields also came down from 30vh to 14vh: "as tall as the dialog can reasonably give it"
was true when the description was the only thing worth space, and at that height the new section and
the Save button both opened below the fold.

### A comment's "⋯" grew three entries

**Save this** (a private bookmark, `community.SavedComment`, listed on `/settings`), **Link to a
course** (pick one you can curate, optionally a chapter or lesson), and **Copy link**. The last is
not a nicety: a comment had no address at all, so `CommentNode` now renders an `#comment-<id>`
anchor and `contentLinks.ts` parses that exact fragment back — one anchor, produced in one place and
read in one place, which is what makes a discussion linkable from the course form too.

Filing from the thread matters because a thread is something you come across while reading; going
away to find the course, open the right week and paste a link is how a good answer ends up not filed
at all.

### Verified

**19 new tests in `courses/test_content_links.py`** (its own module — `tests.py` is already 4000
lines) and **8 in `community/tests.py`**, weighted at refusals: a reply, a removed comment, the same
thread twice, another course's private thread, and the participant/curator split on a taken-down
one; then the chapter-level set link, its locked-chapter visibility, the prefixed reorder, the bare
id still meaning a lesson, and a drag from a lesson onto a chapter clearing the lesson.

**`e2e/course-content-links.mjs`, 23 checks in a real browser, zero console/page errors.**

**One real bug the tests could not have caught, found by the browser run:** DRF derives an action's
`url_name` with hyphens but leaves `url_path` as the method name **verbatim**, so
`reverse('comment-save-for-me')` resolved happily in the tests while the real route was
`/comments/{id}/save_for_me/` — green against a URL no client could build. `url_path` is now spelled
out.

### A pre-existing failure that had to be fixed to verify any of this

`manage.py test courses` failed ~74 tests on a clean checkout, with `'HttpResponse' object has no
attribute 'data'`. The anonymous-read response cache (§17AB) stores a response as bytes and replays
it as a plain `HttpResponse`; its default backend is a FILE cache under `backend/cachedata/` that
outlives the process, so an anonymous GET made by one test earned admission (two misses is the whole
bar) and was then served to a different test, to the next run, or to a run after the dev server had
browsed the same URL. Confirmed identical on unmodified `main` before touching anything. The
middleware is now stripped from `MIDDLEWARE` under the test runner, and
`telemetry.tests.AnonymousReadCacheTests` puts it back for itself with `@override_settings`.

**Not fixed, and confirmed pre-existing on `main`:** 26 tests in `courses.tests.CourseSearchTests`
fail with `KeyError: 'reason'`. Reproduced on an untouched checkout of the same commit; that area
has other work in flight, so it is reported rather than edited.

### Left open, not built

- **The page-level "Add something" panel and this dialog section overlap.** That panel searches by
  title and is the better affordance for a material or an exercise; this one takes an address and is
  the only way to link a discussion. Folding the search picker into the dialog would be the right
  next step.
- **No search picker for a discussion**, in either place — the route to one is the thread's own menu
  or a copied link, by design, but a curator who knows the thread exists and not where it is has no
  way to find it.
- **"Saved" is per-session on a comment.** The thread endpoint does not say whether each comment is
  saved, so a reload shows "Save this" on something already saved; pressing it changes nothing.
  Fetching it would be a request per row to draw a menu item nobody has opened.
- **The saved list has no folders, tags or ordering**, deliberately — it is a bookmark list, not a
  filing system.
- **Nothing notifies the author** when their comment is filed into a course.

---

## 17AD. Material claims: one question per row, ranked by the community, comments votable (✅ built)

Reported: "assessing what a material covers" opened a popover that printed the **same number under
both "As a requirement" and "As content covered"**. That was designed in — one `MaterialCoverage.level`
deliberately read two ways — and the design was the bug: a single figure cannot honestly answer
two different questions, and a reader was shown it answering both.

- **`MaterialCoverage.kind`** (`covers` / `requires`, migration `materials.0015`). A row answers one
  question; a material may carry both kinds on the same topic (unique per `(material, kind, topic,
  subtopic)`). Existing rows are all `covers`. The popover shows **only** the line its kind means,
  and says in a sentence which kind it is. Requirements are therefore **structured claims** — topic,
  optional subtopic, a 1–100 level typed exactly or slid, a thread, votes — exactly like coverage,
  replacing the free-text `MaterialRequirement` list in the UI (the model, governor PUT and reports
  stay; zero rows existed, and the page still renders any that appear). Browse filters, `sort=level`
  and the recommender read `covers` only.
- **An importance vote, separate from the accuracy vote** (`MaterialCoverageImportanceVote`,
  `/material-coverage/{id}/importance/`): "should this be shown near the top?" is not "is the level
  right?", and folding them into one agree/disagree would make the ordering argue with the accuracy.
  Every list of claims — card, detail page, "+N more" modal — is ordered by importance net weight,
  then accuracy (`sortClaims`, `lib/utils/coverage.ts`); an upvote visibly moves a claim to the
  front and the order survives a reload.
- **Comment up/down votes** (`community.CommentVote`, `/comments/{id}/vote/`), rendered as a ▲ score
  ▼ column in the shared `CommentNode`, so every thread in the app gets them, not only claim
  threads. Unweighted (see community/CLAUDE.md for why); disabled with a tooltip when signed out.
- A `requires` claim is drawn in the **warning hue** on badges and card chips so it can never be
  read as "taught here"; the card's Requires chips are now clickable like the Covers ones.

**Verified**: 325 backend tests across materials/community/moderation/exercises/taxonomy (18 new),
`makemigrations --check` clean; `e2e/material-claims-rework.mjs` 28/28 and the pre-existing
`material-claims.mjs` 14/14, zero console errors; screenshots looked at (which is how the header
card missing a just-added claim was found and fixed). `npm run check` 0/0, eslint clean, both
catalogues key-identical.

**Courses got the same claims** (a follow-up in the same session): `courses.CourseClaim` inherits a new
abstract `materials.ClaimBase`, its votes/importance/thread go through the shared `materials/claims.py`
handlers, and the course page renders `CourseClaims.svelte` above the enrol block using the material
badge/popover/form unchanged — a claim's `ownerKind` (`material` | `course`) picks the endpoint. Topics
come from the course's subject branches. 8 tests in `courses/test_claims.py`; `e2e/course-claims.mjs`
13/13. **Also**: signing in or registering now returns you to the page where you clicked "Log in"
(`lib/utils/returnTo.ts` — remembered in sessionStorage across the login↔register hop, `?next=`
honoured, same-origin paths only; `e2e/login-return.mjs` 5/5).

**Exercises got the same claims too** (`exercises.ExerciseClaim` on `ClaimBase`, `/exercises/{id}/claims/`
+ `/exercise-claims/{id}/…`, topics from the exercise's branch; the exercise page's free-text
requirement list — never used, zero rows — was replaced by the shared `ClaimGroups.svelte`, which
`CourseClaims` now also wraps; 5 tests in `exercises/test_claims.py`, `e2e/exercise-claims.mjs` 12/12).
**The navbar's "Disciplines" link now reads "Exercises" / "Zadania"** (`nav_browse`; the route is still
`/disciplines`). **"Other…" in the discipline and branch pickers** of `/submit` and `/submit-material`
reveals a text box; submitting proposes the named node through the existing `/taxonomy/propose/`
(pending unless a moderator) and files the submission under it — one act rather than a detour through
the propose dialog, which those two pickers no longer show (topics and material types keep it).
`TaxonomyOptions` exports `OTHER_VALUE`; `e2e/taxonomy-other.mjs` 8/8.

**Left open**: `CommentSerializer` fetches votes per comment when a caller forgets
`prefetch_related('votes')` (every thread GET passes it today); no per-claim "sort by accuracy"
toggle — importance is the one order; legacy `MaterialRequirement` proposing has no UI any more and
could be retired from the API once nothing else reads it.

## 17AE. First Contentful Paint: prerendered hubs and a boot shell for the SPA fallback (✅ built)

Measured on the production build (`e2e/fcp.mjs`, real Chromium, CDP-throttled to 150 ms / 1.6 Mbit/s):
the prerendered home painted at ~90 ms, but **every route served from the SPA fallback `200.html`
painted nothing until the whole module graph had booted** — 5.3 s on the throttled link, and "FCP"
was simply the hydration time. Two cheap changes, no infrastructure:

- **Seven more hub routes are prerendered** (`/disciplines`, `/materials`, `/courses`, `/events`,
  `/services`, `/submit`, `/submit-material` — a one-line `+page.ts` each): their chrome, heading,
  filters and loading states are static text; the lists are still fetched client-side after
  hydration, so nothing stale is baked in. `/search` cannot be (it reads the URL query at load).
  Apache's existing `$1.html` rewrite serves the new pages with no config change.
- **A boot shell in `app.html`** — a real brand-bar link and a loading line, painted from the HTML
  alone on any fallback route, hidden by one CSS rule the instant the SvelteKit body div has content
  (build time on a prerendered page, hydration on a fallback one). **The rule must exclude
  `script`**: SvelteKit puts its bootstrap `<script>` INSIDE that div, so a bare `> *` matched it and
  the shell never showed — found by a JS-disabled screenshot that came back blank, not by the
  numbers. After the fix a fallback route's throttled FCP is ~1.45 s (HTML + CSS arrival) against
  an app header at ~5.5 s; localhost 60–90 ms.

One trap the packaging step found and the dev build hides: a prerendered page that calls a service
at component top level makes the build itself perform `fetch('/api/…')`, which under the
production `PUBLIC_API_BASE_URL=/api` has no origin and crashes the prerender (`/submit`,
`/submit-material`; both loads moved into `onMount`). `pack.sh` now refuses a build missing any of
the prerendered pages, so this cannot ship silently again.

**PageSpeed follow-up (same day):** its mobile run reported the prerendered `<h1>` waiting 2.3 s on
nineteen ~1 KB render-blocking component stylesheets, KaTeX's fonts (`font-display: block`) at the end
of a 7.3 s critical chain, and a CLS of 0.21 that was entirely the footer leaping down when the home
tab's cards replaced a one-line "Loading…". Three changes: `kit.inlineStyleThreshold` (5 KB) inlines
the small sheets so only the shared 12 KB layout sheet is linked; a five-line Vite transform rewrites
KaTeX's `font-display: block` to `swap` at build time (no fork of the vendor file); and the home tab
renders the card skeleton inside a panel with `min-height: 70vh`, so the footer sits below a phone's
fold while loading — measured CLS 0 at 412 px and 1280 px. The 3 s of "script evaluation" PageSpeed
attributed to the Svelte runtime chunk could not be reproduced: a CPU profile of the same build under
4× throttling shows ~250 ms of script work; re-measure after deploying before chasing it.

**KaTeX lazy-loaded (same day, `mathRender.ts`):** the 381 KB KaTeX + markdown-it + DOMPurify chunk
was imported by the app entry, so every page parsed it. `MathTitle`/`MathContent` now reach it
through a dynamic import (a page without math never fetches it; the home page's entry preloads fell
from 704 KB to 327 KB), the root `+layout.ts` awaits it server-side so prerendering still typesets,
and the client shows the escaped source for the instant before the chunk lands.

What it does not fix, stated plainly: the bundle itself (43 preloaded modules, 1.4 MB of chunks,
323 KB of CSS across 78 files) still takes ~5 s to boot on that link; the shell makes the wait
honest, it does not shorten it. The real lever there is SSR (`adapter-node`), which is a deployment
change webek4's Apache/mod_wsgi setup was not built for. The dev server's own first paint (Vite's
unbundled module graph, ~2.7 s cold, 250 requests, component styles injected by JS so collapsed
nav icons can flash unstyled) is not what users get and was not chased.

## 17AF. Profile exercise counts are stored integers, and the owner sees the unpublished ones (✅ built)

Reported: a profile with more than fifty exercises said fifty. `UserActivityView` computed the
tile's `counts` from its own `items`, and every source in that feed is sliced `[:50]` — so the
number on the tile was the size of a page, not a total.

- **Two integers on `Profile`** — `exercises_published_count` / `exercises_private_count`
  (migration `accounts.0018`, with a backfill). "Private" is `published=False` for any reason: a
  moderator unpublished it, an auto-hide, a removal. **Recounted, never incremented**
  (`accounts/counters.py`): two `COUNT`s over an indexed FK are cheap, and a recount cannot drift —
  an increment that misses one code path is wrong forever, a recount is right the next time
  anything changes. `exercises/signals.py` calls it on every Exercise save and delete, and a
  `pre_save` remembers the previous submitter so a reassignment recounts both people. The honest
  limit is pinned by a test: a `QuerySet.update()` fires no signal, and is corrected by the next
  save rather than never.
- **The feed's `counts.exercise` is the stored number**; the feed still lists its 50 newest.
- **`PublicProfileSerializer` carries `exercises_published_count` for anyone** (it counts exercises
  that are themselves public, so `show_profile_publicly` guards nothing here) and
  `exercises_private_count` **only for the owner — `null` to everybody else**, so a client can tell
  "none" from "not yours to know".
- **`GET /api/exercises/?unpublished=1`** lists the caller's own unpublished exercises (owner or
  staff; anybody else gets an empty list, never the published list under a heading that says
  otherwise). `_annotated_exercises` took a `published=` argument for it.
- **Frontend**: the Exercises tile shows the published total, and on your own profile a
  "+ N unpublished" link beneath it — a sibling of the tile button, not a child, because an anchor
  inside a button is invalid HTML — opening `/users/[id]/unpublished`, which renders
  `ExerciseCard`s and tells a non-owner in words that it is not theirs. The tile also appears when
  everything you contributed is hidden (published 0, private > 0), or those exercises would be
  unfindable.

**One trap, worth the line**: `Count('pk', filter=Q(published=False))` in an annotation named
`published` reads the *annotation*, not the column (`COUNT(...) FILTER (WHERE COUNT(...) = 0)`,
which SQLite rejects as "misuse of aggregate function"). The annotations are `n_published` /
`n_private` for that reason.

**Verified**: 14 new tests (`accounts/test_exercise_counts.py`) — including 60 exercises reading
as 60 with 50 items — alongside the accounts/exercises/community/moderation/study/taxonomy suites;
`e2e/profile-exercise-counts.mjs` 10/10, zero console errors, screenshots looked at (which is how
the list page's missing container was found). `npm run check` 0/0.

**Left open**: ~~no such counter for materials~~ — closed in 17AG (`materials/signals.py`, migration
`accounts.0019`), the same shape; no "+ N unpublished" link for materials yet.

## 17AG. "Report issue / Zgłoś błąd": site issue reports, filed from where you stand (✅ built, full stack)

A new `issues` app. Distinct from `moderation.Report`, which flags one piece of content: an
`Issue` is about the SITE — something broken, wrong content the reporter cannot point a report at,
an idea, anything else — and it travels with where the person was when it occurred to them.

- **Three entry points, one dialog.** A small link under the ∫ EdMat wordmark, **drawn over the bar
  rather than in its flow** (absolutely positioned; the header does not grow — measured at the same
  60px with and without it), with padding around the 11px label so the target is ~19px tall and
  12px wider than the text; the same action in the account menu, the phone drawer and the footer.
  All open `ReportIssueModal`, mounted once in the root layout and driven by `issueReportStore`.
- **Context by default, editable.** `open()` captures the path and page title at the moment of the
  click; the modal adds locale, viewport and browser, shows all of it, and lets the person change
  the address and title. The type is pre-picked — `content` on an exercise/material/course page,
  `bug` elsewhere — and shown as a select, because a guess shown as a fact is how wrong reports
  get filed. Four kinds: bug / content / idea / other.
- **Anonymity is real.** The owner chose "truly anonymous — not stored at all": an anonymous report
  has `reporter=NULL` and a blank `contact_email`, and the hint says the cost out loud (nobody can
  reply). Guests may file; they are anonymous unless they leave an email, which only staff ever see.
- **Publication is the reporter's call.** Unpublished reports are staff-only — a 404 to everybody
  else, the reporter included (chosen: "private to staff only; the reporter gets notifications").
  Staff may un-publish, never publish (`IssueStaffUpdateSerializer.validate_is_public`), and cannot
  edit the reporter's words. A published report has a page, `/issues/[id]`, with the shared
  `DiscussionThread` under it (a fifteenth `Comment` target: `('issues', 'issue') → 'issue'`).
- **Status is one field** (`open → in_progress → resolved / closed`), moved by staff from a panel on
  the page, with a note. A status change notifies the reporter (`issue_status_changed`, under the
  moderation-decision preference, with a nullable `Notification.issue` FK like `event` before it);
  a note alone does not, and an anonymous report notifies nobody.
- **`issues` is a kill switch** like every other feature: off, filing 403s, `/issues` shows the
  disabled notice, and every link — under the logo, in both menus, in the footer — goes.
  `featureFlagsStore` gained `isLoaded`, because a gated page firing its list request before the
  flags arrive fails open into a 403 in the console.
- Filing has its own throttle scope (`issue_report`, 10/hour per IP): the form is open to guests.

**Verified**: 20 tests in `issues/tests.py`; `e2e/issue-reports.mjs` 34 checks, zero console/page
errors — the link's position and hit area measured, a guest's anonymous public report, a named
private one, its 404 to the reporter, staff resolving it with a note and the reporter's notification
linking back, the phone drawer, and the kill switch removing all four links; screenshots looked at.

### Addendum (same day): the phone bar — ☰ inside the bar, borderless; the drawer gets its own ✕

Owner's decisions, superseding two rules 17V.4 wrote down: the drawer toggle now lives **inside**
`.site-header__row` (in flow, `margin-left: auto`, **30×30, no border** — "people know what these
three lines mean") and therefore **tucks away with the bar** on scroll down; scrolling up brings
both back, which is the gesture 17V.4 already relied on. Because the header sits below the scrim's
z-index, the toggle can no longer double as the ✕ while the drawer is open — the drawer carries
its own `.drawer__close` in `.drawer__top`, styled exactly like the old floating toggle (bordered
40×40, surface background, modal shadow) at the owner's request. The focus trap is now scoped to
the drawer alone (its ✕ is inside it); Escape still returns focus to the ☰. On phones the "Report
issue" link sits beside the brand in the flow, since a 43px bar has no room for it underneath.
`e2e/phone-navbar.mjs` (12 checks) pins all of it; the older `events-and-nav.mjs` assertion that
the toggle "stays exactly where it was" was inverted to match. Both `events-and-nav.mjs` (92/92)
and `known-issues.mjs` (23/23) were then repaired from four drifts none of which was an app bug:
`fd70011` made an event's date optional and private by default (the scripts now pick the exact-
date mode and public visibility), `goto` waited for `networkidle` (never fires on a signed-in page,
e2e/CLAUDE.md trap 2), "My Set"/"Disciplines" wording, and a `hasText: /^Events$/` that never
matched once the in-place icon span left the anchor's textContent as `" Events"` — found by
dumping the anchors, not by reading the assertion.

**Left open**: no screenshot/attachment on a report; no editing or deleting your own report; no
"my reports" list (private ones are deliberately staff-only); comments on an issue are not yet
in `PRIVATE_TARGET_TYPES`, so linking a private issue's thread into a course would be refused only
by the 404 on the issue itself; the profile's material tile now uses the stored counter (17AF's own
left-open item, closed here) but there is no "+ N unpublished" link for materials.

## 17AH. The solution/hint pool: peer solutions and hints per exercise, voted, reviewed (✅ built, full stack)

An exercise used to have at most ONE hint and ONE solution — two text fields on its translation,
editable only through the moderation queue. Now it has a POOL (`exercises.SolutionEntry`): any
number of peer hints and solutions, each written by a named person in one language, voted on,
individually review-gated, discussable and reportable. Every shape decision below was put to the
owner as an explicit question first (2026-08-27), not defaulted to.

### The model, and the migration that emptied two columns

`SolutionEntry(exercise, kind: hint|solution, locale, body, author, status, pinned, is_removed,
auto_hidden_at, reviewed_by, review_note)` + `SolutionEntryVote` (▲/▼, one per user, weighted 2×
for a verified contributor by the same shared `materials/services.py` math every claim vote uses).
Ordering everywhere is pinned-first, then net weighted score (`exercises/entries.py`'s
`sort_entries` — that module also owns visibility and every trust rule, one place, not scattered).

**Migrate & retire, the owner's call over keeping the fields as "the original":**
`ExerciseTranslation.hint`/`.solution` were copied out (migrations `exercises.0009–0011`) — every
published translation's text became a **pinned, published** entry ("the currently attached ones
should be pinned"), a pending translation's became pending entries, and the columns were DROPPED.
Translations are title/statement/answer only now; a solution in another language is just another
entry in that language, never a translation row (`TranslateForm` says so in words). Readers see
entries matching their content locale, with "Show N more in other languages" as the explicit
escape ("we don't want to overwhelm users with the main interface"). 1485 entries migrated;
`import_legacy_corpus` upserts corpus originals into the pool by `(exercise, kind, locale,
pinned=True)` and stays idempotent.

**`Exercise.verified` is DERIVED now** (owner's call): ≥1 published, visible solution that passed
review — pinned, reviewed, or by a verified contributor — recomputed by `exercises/signals.py`'s
`recount_verified` (recount-not-increment; the review action's queryset-`update()` claim fires no
signal, so it calls it explicitly). **A real, counted consequence, accepted with the decision:**
389 corpus exercises carried a full solution while hand-flagged `verified=False`; the badge now
asserts "a reviewed/original solution exists," so they flipped to True (verified went 353 → 742
of 746). The migration writes this; the old hand-toggle is gone as a concept.

### Who publishes, who reviews, who decides an edit

- **Publishing**: a verified contributor / staff / branch governor's entry goes live immediately
  (the §18.4 fast path's reasoning, extended); anybody else's starts `pending` — visible inline to
  its author and to reviewers, nowhere else (a rejected one stays visible to its author alone,
  with the note).
- **Review**: ONE accept (any verified contributor, staff, or governor of the branch —
  `can_review_entry`, the single seam where the future field/branch-expert SKILL tier lands)
  publishes; one deny **with a required note** ("a comment with what went wrong") rejects and
  notifies the author (`solution_entry_approved/rejected`, moderation-decision category). The ONE
  endpoint (`POST /api/solution-entries/{id}/review/`, idempotent WHERE-anchored claim → 409) is
  called by BOTH the exercise page's inline accept/deny AND the moderation queue's new "Solutions
  & hints" tab — deliberately not a second `_KIND_MODELS` kind, so there is one review path.
- **Edit suggestions target the row** (`EditSuggestion.entry`, migration `moderation.0023`;
  `exercise/locale/field` derive from the entry server-side): decided by the entry's own AUTHOR +
  staff/governors (`POST /api/edit-suggestions/{id}/decide/`) — deliberately NOT every verified
  contributor: folding words into somebody else's solution is a different act than reviewing a
  new standalone entry. A non-verified author's own edit re-queues their entry. The old
  'hint'/'solution' translation-field suggestions are refused at validation; pending ones were
  retargeted (or honestly closed) by `moderation.0024`.
- Entries are reportable (`REPORT_KIND_MODELS['solution_entry']`, auto-hide measured against the
  exercise's own viewer pool) and each has its own generic-Comment thread
  (`targets.py: 'solutionEntry'`) — "different solutions may have their own comments".

### Frontend, and the Activity tab

`SolutionEntrySection.svelte` (per-kind reveal — progressive-reveal pedagogy unchanged — plus the
composer with live KaTeX preview and the other-languages toggle) and `SolutionEntryCard.svelte`
(votes, badges, accept/deny, author edit/delete, suggest-an-edit, the author's own suggestion
inbox, lazy per-entry discussion, report) replaced the two static reveal blocks on
`exercises/[id]`. My Set and shared-set printouts render the pool's published entries
(locale-matching first). The moderation page gained the tab; `EditSuggestionForm`/`TranslateForm`
narrowed to title/statement/answer. And — the owner's add-on — the homepage gained a deliberately
near-placeholder **Activity** tab (last tab, `GET /api/activity/`, community/views.py's
`SiteActivityView`): newest public exercises/materials/authored entries, derived on read, "we
will improve it later." Corpus-migrated entries are excluded there (no author, migration
timestamp — "somebody added a solution" is only true of authored rows).

### Verified

**40 new backend tests** (`exercises/test_solution_entries.py`) — publish/review circles, pending
leaks (exactly the author + reviewers), derived-verified transitions, weighted votes, pin, the
suggestion deciding circle (a verified contributor correctly NOT in it), cross-thread comment
parents refused, report → auto-hide → gone from the reader list, submission-created founding
entries (pinned only when a moderator approved), the activity feed. Full suite re-run after.
**Browser: `e2e/solution-entries.mjs`, 27 checks, zero console/page errors, rerunnable** (resets
its scratch through the real API first — a positional `.first()` reject once hit the WRONG queue
row, e2e/CLAUDE.md trap 6 relearned). Screenshots actually looked at. `npm run check` 0/0,
eslint clean, both catalogs +54 keys, key-set identical.

**Two real pre-existing problems found and fixed on the way, neither caused by this feature:**
(1) `accounts.0018/0019` depended on `('exercises'|'materials', '__latest__')` — a dynamic
dependency that breaks the migration graph the instant that app gains a migration after it was
applied ("applied before its dependency"); pinned to the concrete migrations they actually meant.
(2) `check:katex` had been silently broken since the isomorphic-dompurify fix (§17Q): DOMPurify in
Node strips the `<annotation>` TAG but keeps its raw-TeX text inside `<math>`, so the checker's
annotation-only strip flagged 103 perfectly fine fields (`\\[2mm]` line breaks — 57 of them plain
statements this feature never touched) as leftover delimiters, and it now needs an 8GB heap
(wired into the npm script). The checker strips the whole MathML block now: **0 issues across
2241 rows**, the corpus + pool genuinely clean.

### Left open, not built

- **The expert tier is a seam, not a feature**: `can_review_entry`/`can_decide_entry_suggestion`
  (exercises/entries.py) are where the SKILL-based field-expert circle lands — one clause each.
- **A rejected entry is visible to its author only** — staff can't enumerate somebody else's
  rejected entries outside the Django admin. Honest, but it means no oversight surface for
  reject decisions (and e2e cleanup needed the author's own token).
- **The Activity tab is the placeholder it was asked to be** — 3 sources, 20 rows, no pagination,
  no filters, no per-user tailoring.
- **No cap on entries per exercise**, and no collapse of near-duplicate solutions — votes are the
  only ranking pressure.
- **Old message keys** (`exercise_showHint`, `editSuggestion_field_hint`, …) are unused but left
  in both catalogs — harmless, removable in a sweep.
- **Revoking a contributor's verified tier does not sweep `verified` recounts** over exercises
  whose entries qualified through their authorship — only the next entry change recounts
  (flagged in `recount_verified`'s own docstring).

## 18. Open questions

1. ✅ **Auth mechanism — resolved (Phase 2).** DRF `TokenAuthentication` (the "simple" option this
   item itself named), `SessionAuthentication` kept alongside it for the Django admin / browsable
   API. No university SSO (Section 4, unchanged). Not `django-allauth`/JWT — appropriate for a
   prototype with no SSO requirement, not necessarily the final answer for a real deployment.
2. ⚠️ **Copyright/provenance of the existing corpus.** The exercises are transcribed from real
   university course material (exam/midterm/exercise-sheet problems) — worth a real answer on
   whether redistributing them (even reworded/re-solved) needs instructor permission, before this
   goes beyond a personal/prototype deployment. Distinct from `personalizacja_edukacji`'s old
   `License`/`TraceabilityBadge` problem (that was about *linking to* others' material; this is about
   *hosting content transcribed from* course material) — flagged here rather than assumed clear.
3. ✅ **Does `Database-of-Student-Exercise`'s static site keep running post-launch — resolved
   (Phase 4), see Section 12.** No: retire it now, EdMat is the sole source of truth immediately.
   `import_legacy_corpus` (built, Phase 2) needed no change either way, since it was already
   idempotent regardless of how this was answered — the migration is now correctly understood as a
   one-shot historical import rather than an ongoing sync. A real retirement banner was added to the
   static site's own `README.md` and generated page shell (Section 12).
4. ✅ **Verified-contributor fast path — resolved and built (Phase 4).** Decided: **auto-publish, but
   narrowly.** A brand-new exercise submitted by a verified contributor
   (`Profile.is_verified_contributor` — already a real tier this app grants and reads elsewhere, for
   material-coverage vote weighting, `materials/serializers.py`) goes live immediately, no moderator
   review at all. An edit suggestion or a translation from that same person still queues regardless —
   deliberately, per the policy's own actual scope: trusting someone's brand-new work being
   mathematically sound is a different claim from trusting an unreviewed CHANGE to something already
   published and already checked once. `ExerciseSubmissionViewSet.perform_create`
   (`moderation/views.py`) is the one place this lives; `EditSuggestionViewSet.perform_create` and
   `ExerciseViewSet.translations` (`exercises/views.py`) are both explicitly, deliberately unchanged,
   with a comment at each pointing back here so a future reader doesn't wonder why they weren't
   touched too.

   Reuses `_apply_submission` completely unchanged — the exact function a moderator's own approve
   action already calls, retry-safe number allocation (Section 17I) included, so an auto-published
   submission racing a real concurrent moderator approval for the same course is already covered by
   that same fix, not a new race this path could reintroduce. `reviewed_by` is deliberately left
   unset (no one actually reviewed it — pretending the submitter reviewed their own work would be
   dishonest exactly where a moderator might later want to tell "a person checked this" apart from
   "the system published it on trust"); `review_note` says so in plain language instead
   (`'Auto-published — submitted by a verified contributor.'`). The resulting `Exercise.verified`
   flag (a moderator's own "checked the math" attestation, a genuinely separate claim from the
   Profile-level trust tier) correctly stays `False` — confirmed directly, not assumed, by inspecting
   a real auto-published row.

   Frontend: `/submit`'s own subtitle and success message both now read `authStore.user
   ?.isVerifiedContributor` (the same field `CoverageVoteWidget.svelte` already reads for its own
   2x-vote-weight note) to show the right outcome honestly — "published immediately" with a real
   working link to the new exercise for a verified contributor, the original "awaiting review"
   message for everyone else — rather than always implying a queue regardless of what actually
   happened. Verified end-to-end with real logged-in requests (not just typechecked): a verified
   contributor's submission came back `status: 'approved'` with a real, published `Exercise` row and
   correctly did NOT appear in the moderation queue; the identical request from a non-verified user
   came back `status: 'pending'`, completely unaffected. A real headless-browser run confirmed the
   `/submit` page itself renders the right subtitle/success copy and a working link to the newly
   published exercise's own detail page, zero console errors. Phase 2's `is_staff` "moderator" gate
   remains a coarser, adjacent concept, untouched — this tier is genuinely separate, as this item's
   own original wording already anticipated.

   **Left open, not built:** no moderator-facing UI exists to grant/revoke
   `is_verified_contributor` beyond Django admin (already fully functional there — `ProfileAdmin`'s
   change form has no `readonly_fields` blocking it, confirmed by inspection) — building a dedicated
   in-app granting flow wasn't part of this policy decision's own scope and wasn't attempted.
5. ✅ **`venv` vs `.venv` duplication — resolved (Phase 2), recurred and resolved again (Notifications
   feature session).** Both turned out to be stale/mismatched the first time (built against a Python
   version not present on this machine); deleted and rebuilt as a single working `.venv` via
   `python3 -m venv --without-pip` + a manual `get-pip.py` bootstrap, since this sandbox has neither
   `sudo`/root access nor an interactive TTY for `apt install python3-venv`. **Recurred**: a later
   session's own `.venv/pyvenv.cfg` was found pointing at `/home/piotrek/Wymiana_VW/edmat` (Python
   3.14, `python -m venv`), an entirely different machine/user/path than this sandbox's own
   `/home/alojzy/Zrzut_Na_Hosta/edmat` (Python 3.12) — the directory had evidently been copied
   wholesale from elsewhere at some point, and `.venv/` (correctly gitignored, so never a git-history
   question) carried that foreign machine's own baked-in absolute paths along with it; only `pip`
   itself was actually importable, Django/DRF/etc. were never really there. Rebuilt cleanly with the
   same no-sudo/no-TTY method against this sandbox's real `python3` (3.12.3). **Also fixed the same
   session:** `backend/requirements.txt` had never actually been committed at all, despite the
   README's own setup instructions (`pip install -r requirements.txt`) and project-layout listing
   both referencing it — a real, broken-fresh-clone gap, now fixed with a real, committed file
   (`Django<5.3,>=5.2`, `djangorestframework<3.17,>=3.16`, `django-cors-headers<5.0,>=4.4`,
   `django-filter<25.0,>=24.3`, `Pillow<11.0,>=10.4`, `PyYAML<7.0,>=6.0`).

   **Recurred a third time, and resolved differently on 2026-08-07 — by removing the duplication
   itself rather than rebuilding it again.** Three venv directories were present: the root `.venv`
   (working), `venv/` (Python 3.14, `bin/python` a dangling symlink to an interpreter not on this
   machine — the same copied-from-another-machine artifact this item describes above), and
   `backend/.venv` (a second working one). The last two were deleted, leaving one. `backend/.venv`
   was safe to remove because its only unique packages were *older* versions of ones the root venv
   already had newer (`django-filter` 24.3, DRF 3.16.1, Pillow 10.4); verified before deleting by
   diffing both package sets, confirming `run.sh` already used the root venv, and running
   `manage.py check` plus `manage.py test taxonomy accounts` under it.

   **The two `requirements.txt` files were the real reason this kept recurring, and they are now one
   list.** They had drifted materially: the root file (the one `README.md` step 1 and `setup.sh`
   install from) was missing `django-postman`, `python-magic`, `clamd` and `bleach` entirely, so a
   genuinely clean clone could not boot the backend — `ModuleNotFoundError: No module named
   'postman'` — while the existing `.venv` worked only because those packages had been hand-installed
   into it. `backend/requirements.txt` is now the single source, and the root file is a one-line `-r
   backend/requirements.txt` include. **Deliberately an include rather than a single file**, because
   neither location can serve both consumers: `deploy/DEPLOYMENT.md`'s own step 1 rsyncs only
   `backend/`, `frontend/` and `deploy/`, so the root file never reaches the server, while local dev
   must install from the root because that is where a fresh clone's `.venv` lives. Three stale upper
   bounds in `backend/requirements.txt` were also raised to admit the versions actually installed and
   passing tests (DRF `<3.17`→`<3.18`, `django-filter` `<25.0`→`<27.0`, `Pillow` `<11.0`→`<13.0`) —
   the pins had gone stale, not the packages.

   **Still open, and it is what would stop a fourth recurrence:** nothing *exercises* the
   requirements file on a clean machine, so the same drift can recur silently — exactly as it did
   here, where a hand-patched venv masked a broken file for an unknown length of time. Only a
   clean-clone install catches that, and no CI runs one (QA.md's own "§3 What I'd do next" carries
   this).
6. ⚠️ **Hosting/deployment target** — not decided; affects the `adapter-node` choice's own specifics
   once Phase 3 starts, but doesn't block Phase 1 or 2 (both now built).
7. ⚠️ **Locales beyond en/pl** — the data model (`ExerciseTranslation.locale` is a free string, not
   an enum tied to Paraglide's own locale list, Section 10) already supports adding a third language
   without a schema change; the *interface* would need a Paraglide config change and a new message
   catalog. Not planned for v1, just confirmed not to be a structural blocker later.
8. ⚠️ **KaTeX command-subset compatibility** with the existing corpus's actual LaTeX usage — needs a
   real, mechanical check early in Phase 1 (Section 11), not assumed.
9. ✅ **Real-time delivery resolved (Section 17H) — email delivery still ⚠️ open.** The `Notification`
   model/API/UI (17B) were already real; the FRONTEND used to only ever learn about a new one on the
   next explicit fetch, never live/pushed — now genuinely pushed, via SSE, within a few seconds of
   creation, see Section 17H's own full writeup (the design this item originally sketched, built as
   sketched: SSE over Channels, a DB-polling loop, `notify()` itself unchanged). Email delivery
   remains unbuilt — kept below as the original design starting point for that still-open half:
   - **Delivery transport — ✅ resolved, SSE chosen and built (Section 17H).** The two real options
     for a Django backend were: (a) **Django Channels + an ASGI server + a channel layer** (Redis in
     production, the in-memory layer for dev) for genuine WebSocket push straight to a connected
     browser tab; or (b) **Server-Sent Events**, a much lighter lift (no new infra dependency, a
     single long-lived HTTP response DRF can serve directly) but one-way only and without the
     reconnect/backpressure handling a real WebSocket client library gives for free. SSE was the
     right first step for a project this size, as predicted — Channels remains a real architectural
     addition (a second server process, a message broker) this app has never needed to reach for.
   - **Browser/OS-level push** (a notification even when the tab isn't open) needs the **Web Push
     API** — a service worker registered client-side, a subscription endpoint storing each browser's
     push subscription server-side, and a backend library (e.g. `pywebpush`) signing/sending through
     the browser vendor's own push service. Meaningfully more infrastructure than in-app delivery;
     only worth it once in-app delivery is real and there's a concrete reason a visitor needs to know
     without the tab open.
   - **Email delivery** — the *other* piece of infrastructure this project has flagged as missing
     since Phase 2 (`PasswordResetView`'s own "mock-era stub... no real email backend exists yet,"
     accounts/views.py) is the exact same missing piece a "notify me by email" preference would need:
     a real `EMAIL_BACKEND` (Django's own SMTP backend, or a transactional-email API like
     Postmark/SendGrid) configured in `config/settings.py`. Wiring one up unblocks BOTH gaps at once,
     not two separate pieces of work.
   - **What doesn't need to change:** `notify()` itself, the `Notification` model, and every existing
     call site (moderation decisions, auto-hide, comment replies) — a real transport would hook in
     as an ADDITIONAL side effect of the same `notify()` call (e.g. also publishing to a channel
     group, or also queuing an email), not a redesign of how/when a notification gets created.

---

## 19. Glossary (Polish domain terms ↔ EdMat's English model)

| Polish (source data) | English (this project) |
|---|---|
| kierunek | field |
| przedmiot | course (`taxonomy.Course`) — a university subject |
| kurs (prowadzony przez użytkownika) | taught course (`classroom.TaughtCourse`) — something a person runs and others join |
| wydarzenie | event (`events.Event`) — a one-off happening people turn up to, distinct from both a taught course and a booking |
| aktualność | update (`events.EventPost`) — a dated note the host appends to an event after announcing it; not its description, and not a comment |
| dział / temat | topic |
| zadanie | exercise |
| materiał (dydaktyczny) | material |
| zestaw | set (as in "my set" / study sheet) |
| treść | statement |
| wskazówka | hint |
| odpowiedź | answer |
| rozwiązanie | solution |
| trudność: łatwe / średnie / trudne | difficulty: easy / medium / hard |
| źródło: Ćwiczenia / Kolokwium / Egzamin | source type: exercises / midterm / exam |
| zweryfikowane (verified) | verified — a full, correct solution/answer exists (unchanged meaning) |
