# EdMat — Project Blueprint

**Status:** ✅ Phase 1 (frontend, fully mocked), Phase 2 (Django REST Framework backend, real
migrated corpus), and Phase 3 (frontend wired to the real backend, mocks deleted) all built — see
`frontend/` and `backend/`. Phase 4 (hardening) in progress — the LaTeX/KaTeX compatibility sweep
(Section 11's own ⚠️), a real accessibility audit, the moderation-queue synthetic load test, and a
real multi-moderator concurrent-access test are done, see Sections 17D/17E/17F/17I; only the
corpus-retirement decision is not yet done, see Section 16. The material detail page (Section 17G)
and real-time notification delivery via SSE (Section 17H, Section 18 item 9) are also now built,
closing two gaps this document had explicitly flagged as open. This document is the living spec for
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

⚠️ **Open question:** does `Database-of-Student-Exercise`'s static site keep running in parallel as a
mirror/fallback after EdMat launches, or does EdMat become the sole source of truth immediately and
the static generator gets retired? Affects whether the migration needs to be one-shot or ongoing.

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
- **Phase 4 — Hardening.** In progress. LaTeX-compatibility sweep across the full migrated corpus
  (Section 11's own ⚠️) ✅ **done, see Section 17D.** A real accessibility audit ✅ **done, see
  Section 17E.** A moderation-queue synthetic load test ✅ **done, see Section 17F** (found and fixed
  a real N+1 on both the backend and the frontend). A real multi-moderator concurrent-access test
  ✅ **done, see Section 17I** (found and fixed a real race condition in submission approval — a
  genuine `IntegrityError`/500 under simultaneous requests, not a theoretical concern). Still open:
  deciding the `Database-of-Student-Exercise` retirement question (Section 12's ⚠️).

**Left for a later phase, not v1, flagged so they aren't silently forgotten (both are real, working
features in the current static site — Section 3):**
- Server-side "my set" sharing (a link to someone else's set, not just your own saved one).
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

### Left open, not built

- **Real-time/push delivery and email** — see Section 18 item 9's own detailed writeup (Django
  Channels vs. SSE, Web Push, and the shared missing piece with `PasswordResetView`'s own stub: a
  real email backend). Deliberately documented, not built, per the explicit "to do info" request.
- **No `NotificationGroup`-style clustering** — a plain list, deliberately, see the note above.
- **No donation-link reordering UI** — `order` exists and is honored by the public display, but
  there's no drag-and-drop; a newly-added link just appends after whatever's already there.
- **No avatar upload UI anywhere** — `Profile.avatar` predates this feature and stays untouched;
  only its URL-resolution correctness (the missing `context={'request': ...}` fix above) changed.

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
- **The `_publish_translation`/`ExerciseTranslation` path has its own separate, unfixed race**,
  noted but deliberately not chased as part of this item: two *different* translations for the same
  `(exercise, locale)` approved concurrently could both pass its own delete-then-set sequence and
  both momentarily claim `status='published'`, which the `unique_together` that function's own
  docstring describes exists specifically to prevent. Out of scope here — this item's own concrete,
  reproduced bug was the submission-approval number collision; flagged honestly rather than silently
  left undocumented.
- **The retry loop's 5-attempt bound is untested against genuinely higher contention** (more than 6
  simultaneous writers) — reasonable given this app's real moderator count, not validated at a scale
  this environment has no way to produce.

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
3. ⚠️ **Does `Database-of-Student-Exercise`'s static site keep running post-launch** (Section 12) —
   affects whether migration is one-shot or needs to stay idempotent/repeatable indefinitely.
   `import_legacy_corpus` (built, Phase 2) is already idempotent regardless of how this is answered.
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
| przedmiot | course |
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
