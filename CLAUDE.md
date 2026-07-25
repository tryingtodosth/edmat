# EdMat — Project Blueprint

**Status:** ✅ Phase 1 (frontend, fully mocked), Phase 2 (Django REST Framework backend, real
migrated corpus), and Phase 3 (frontend wired to the real backend, mocks deleted) all built — see
`frontend/` and `backend/`. Phase 4 (hardening) not started. This document is the living spec for
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
| **Verified contributor** *(a lightweight reputation tier, not a separate account type — a flag a moderator grants)* | Submissions and translations from this tier still queue for moderation in v1 (trust doesn't bypass review of *math correctness*, only maybe the response-time priority) — see Section 18 for whether this tier should ever get an auto-publish fast path. |
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
   CDN script tag per page. ⚠️ Confirm every existing exercise's LaTeX is actually KaTeX-compatible
   (KaTeX supports a smaller command subset than full MathJax/LaTeX) before committing to this — a
   real, mechanical check to run early in Phase 1 (batch-render all 740 exercises, log any
   unsupported command), not assumed clean.

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
  "Moderator" is, for this prototype, Django's own `is_staff` flag — the simplest real gate
  available today, not a final answer to Section 18 item 4's still-open verified-contributor
  question.

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
- **Phase 4 — Hardening.** Real accessibility pass, LaTeX-compatibility sweep across the full
  migrated corpus (Section 11's ⚠️), moderation-queue load testing with real volunteer moderators,
  decide the `Database-of-Student-Exercise` retirement question (Section 12's ⚠️).

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
4. ⚠️ **Verified-contributor fast path.** Should a trusted tier (e.g. an actual TA) ever get
   auto-publish for their own submissions, or does *everything* always queue for moderation
   regardless of who submitted it? Section 5 leaves this open rather than deciding it. Phase 2's own
   "moderator" gate (`is_staff`) is a coarser, adjacent concept — not the same tier this item asks
   about, and doesn't resolve it.
5. ✅ **`venv` vs `.venv` duplication — resolved (Phase 2).** Both turned out to be stale/mismatched
   (built against a Python version not present on this machine); deleted and rebuilt as a single
   working `.venv` via `python3 -m venv --without-pip` + a manual `get-pip.py` bootstrap, since this
   sandbox has neither `sudo`/root access nor an interactive TTY for `apt install python3-venv`.
6. ⚠️ **Hosting/deployment target** — not decided; affects the `adapter-node` choice's own specifics
   once Phase 3 starts, but doesn't block Phase 1 or 2 (both now built).
7. ⚠️ **Locales beyond en/pl** — the data model (`ExerciseTranslation.locale` is a free string, not
   an enum tied to Paraglide's own locale list, Section 10) already supports adding a third language
   without a schema change; the *interface* would need a Paraglide config change and a new message
   catalog. Not planned for v1, just confirmed not to be a structural blocker later.
8. ⚠️ **KaTeX command-subset compatibility** with the existing corpus's actual LaTeX usage — needs a
   real, mechanical check early in Phase 1 (Section 11), not assumed.

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
