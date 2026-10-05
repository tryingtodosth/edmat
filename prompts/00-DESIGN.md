# The learning graph — how exercises, flashcards, concepts, courses, grades, the school demo and conferences link

Written 2026-10-05 from the code as it is, not from the history. Every claim about an existing
model names the file. This is the design every brief in this directory builds a piece of; read it
before any of them. Where it and the code disagree, the code wins and you say so on the board.

---

## 0. Where we stand — three kinds of node already exist

**Content nodes** — the things a learner reads. Referenced everywhere, copied nowhere.

| Node | Model | What links to it today |
|---|---|---|
| exercise | `exercises.Exercise` (+ `ExerciseTranslation` per locale, `SolutionEntry` hint/solution pool) | `study.ExerciseSetItem`, `courses.CourseItem`, `events.SessionLink`, `concepts.ConceptLink`, `exercises.ExerciseMaterialLink` |
| material | `materials.Material` | same set, plus `coauthoring` versions |
| concept | `concepts.Concept` → `ConceptArticle` (audience, locale) → `ConceptRevision` | `ConceptLink` (`related` / `prerequisite`, body-derived or manual) |

**Context nodes** — the places where content is used by a group. `config/nodes.py` already names
four of them for the management layer and answers "may this person see / is on the roster / may
run it" for each: `course`, `event`, `material`, `organization`.

| Node | What it holds about content |
|---|---|
| course (`courses.Course`) | `Chapter` → `Lesson` → `CourseItem` (material / exercise / attachment / link / discussion, exactly one per row, `models.py:775`), `LessonExerciseSet` (a **snapshot** of a `study.ExerciseSet`'s membership, live exercise references, `frontend/src/lib/types/course.ts:173`), `LessonProgress` (a participant's **statement**, never a measurement, `models.py:1560`) |
| event (`events.Event`) | programme `Track` → `Session` → `SessionLink` (material / exercise / exercise_set / url, `events/models.py:714`); the six conference apps hang off the event by a row of their own |
| organization (`organizations.Organization`, kind university / faculty / **school** / student_circle / ngo / company) | runs courses and events (`runs` / `supports` links) — the "who" hub |

**Person layer** — what one account carries about itself.

| Thing | Model | Visibility rule |
|---|---|---|
| my set | `study.ExerciseSet` (random slug, `is_public` opt-in) | `study/views.py` retrieve; **no minors check — a minor's public set exposes their display name** (gap, step B fixes) |
| institutional grades | `identity.CourseGrade` (`matched_course` → `taxonomy.Branch`), `Diploma`, `EducationProfile` with `share_school` / `share_diploma` / `share_grades` | `identity/standing.py: public_view` — three consents, checked one at a time |
| standing | `identity/standing.py` — the verification **ceiling** on capability (LAUNCHCHECKLIST §3) | never authority |
| progress on a course | `courses.LessonProgress` | `Course.progress_visibility`, one decision per course |
| volunteer hours | `shifts` — confirmed by an organiser, printable certificate | the one "certificate" precedent |

**The school demo** (`school-management-demo/`, published as `/dziennik`, HISTORY §17BO) is a
recorded snapshot with **no server behind it**, by owner decision: one outbound call (filing an
issue), writes refused with `demo_read_only`, roles chosen not authenticated. It cannot be linked
at the data level and must not be. Its link to EdMat is by *example*: what a school is, and that
`Organization.kind='school'` already exists.

---

## 1. Four rules that make the graph hold

1. **Three hubs, each answering one question.** `taxonomy.Branch` answers *where in the
   curriculum* (every exercise, every imported grade, every concept hangs off one).
   `concepts.Concept` answers *what this is about* (the prerequisite graph is the only "learn this
   first" the site has). `organizations.Organization` answers *who runs this* (a school, a faculty,
   a circle). A new link between two surfaces goes **through a hub** before it goes directly.
2. **Content is referenced, never copied; membership may be snapshotted.** `LessonExerciseSet`
   has the exact shape: the list is a copy taken at link time, every item a live reference. A deck
   made from a set, a lesson or a session follows it to the letter.
3. **Everything a person does is per person and consent-gated; a statement is not a
   measurement.** `LessonProgress` is a button somebody pressed. A flashcard review log is the first
   *measurement* this site will hold about a learner, so it is private by construction, aggregated
   before it is ever shown, and shown only behind a consent flag of the same three-flag shape
   `EducationProfile` already uses. An EdMat activity count is **never** presented next to an
   institutional grade as if it were one.
4. **No field on a shared model.** Linking a deck to a course is a row in `flashcards` pointing
   at a node through `config/nodes.py`, not a sixth `CourseItem` kind and not a fourth FK on
   `SessionLink`. This is the rule that let seven and then six branches merge; it stays.

---

## 2. The links, pair by pair

| Pair | Mechanism | Step |
|---|---|---|
| exercise → flashcard | `flashcards.Card.exercise` nullable FK; front = statement, back = published `answer`, hint and pinned solution as optional reveals; `GET /api/exercises/bulk/?ids=` loads a deck in one request | A |
| my set → deck | `POST /api/decks/` with `source_set`: membership snapshot, live references (rule 2) | A |
| concept → flashcard | `Card.concept` nullable FK; front = the reader's resolved revision title, back = its summary (`concepts/resolve.py`) | A (model), D (the "deck from this concept" button) |
| concept → "learn first" | `ConceptLink.relation='prerequisite'` walked to a bounded closure; shown on the exercise page as *before this, know…* | D |
| deck → course / event | `flashcards.DeckPlacement(node kind+pk, deck, order, added_by)` through `config/nodes.py`; mounted on the course and event pages at a marker; the placement is public iff the node is visible and the deck is public | A (model + panel), C and E (the buttons that create one) |
| lesson → deck | "make a deck from this week": every exercise in the lesson's items and sets, snapshot | C |
| session → deck | "take home": the session's `SessionLink` exercises and sets, snapshot, placed on the event | E |
| course ↔ organization | exists (`runs`); a **school** is an organisation of kind `school` whose courses are classes, participants under `Guardianship`, `progress_visibility` set for staff | C |
| course → certificate | `courses.CourseCompletion`: issued by staff to a participant who **said** they finished (`LessonProgress` all `done`), printable like the shifts certificate; never a grade | C |
| event ↔ course | through the organisation only ("this conference's workshops became these courses"): no direct FK | E (the cross-link panel on both pages) |
| grades → profile | exists (`public_view`); the profile gets one **learning record** section: shared grades (institutional, per Branch) in one block, EdMat activity (sets, progress statements, cards reviewed, per Branch, counts only) in a second block under its own `share_activity` consent | B |
| exercise / card / lesson → branch | every count in the learning record is grouped by `taxonomy.Branch`, which is what makes "4.5 in Analysis I" and "300 cards reviewed in Analysis I" sit in the same table without pretending to be the same thing | B |
| school demo → EdMat | **no data link.** `/about` and the organisations page say: a school on EdMat is an organisation of kind `school`; the full register is the demo. `seed_school_demo` builds one lived-in school (the `seed_conference_demo` precedent) | C, G |
| creation → verification | until the USOS connection exists, **creating** a course, an event, a tutoring listing or an organisation is refused for ordinary accounts with a reason naming it; reads, joins and everything already created are untouched; staff and verified contributors pass. One rule module, `config/creation.py`, asked by four create paths and by the Add… menu | F |
| everything → /about | every design here gets a page under `/about/` built from **sample data in `lib/content/`**, rendering the real components read-only — the `/dziennik` posture, no demo rows in production tables. The manual's screenshots come from the same pages and from a seeded dev database | G, H |

---

## 3. The steps

| Step | Branch | App(s) owned | One sentence |
|---|---|---|---|
| prep | integrator | `moderation` migration 0047, markers, empty app, `config/creation.py` stub | the seams, before anyone starts |
| A | `learn/a-flashcards` | `flashcards` (new) | decks, cards, SM-2, review UI, placements, the panel |
| B | `learn/b-record` | `identity`, `accounts` profile page | the learning record on the profile, consent-gated; minors fix in `study` |
| C | `learn/c-courses` | `courses` | lesson → deck, school mode, completion certificate, `seed_school_demo` |
| D | `learn/d-concepts` | `concepts` | prerequisite closure, "learn first" on exercise pages, deck from concept |
| E | `learn/e-events` | `events`, `organizations` cross-link panel | take-home decks, event ↔ course through the organisation |
| F | `learn/f-gate` | `config/creation.py`, Header Add… menu | the creation gate until USOS |
| G | `learn/g-about` | `/about/**`, `lib/content/showcase/` | the designs on /about with sample data |
| H | `learn/h-manual` | `/about/guide/**`, `frontend/static/guide/` | the manual with real screenshots; exercises first, flashcards after A merges |
| integration | integrator | everything shared | merge, wire providers, matrix rows, docs, the whole suite |

Dependencies that are real: C's and E's "make a deck" buttons call A's API, so they are built
against A's **documented** endpoint shapes (in `02-flashcards.md` §API, fixed in the prep) and
verified at integration. H's flashcards chapter waits for A. Everything else is independent.

---

## 4. Defaults in force unless the owner says otherwise

1. Decks are **private only** in this cycle; `is_public` exists on the model, defaults off, and a
   minor cannot set it. Sharing a deck is a later step.
2. SM-2 with four grades. FSRS is left open.
3. "Cards due" is counted on the server's day (no per-account timezone, `CLAUDE.md` known gaps).
4. The learning record's activity block is **counts per Branch**, never per card, never per
   exercise, and off by default.
5. A completion certificate is issued by course staff, by hand, only to a participant whose own
   progress statements say done. It carries the course title, the organisation if any, dates and
   the issuer. No grade, no mark, no rank.
6. The creation gate is **on** at seed time, refuses non-staff, non-verified accounts, and is
   turned off by flipping `creation_requires_verification` the day USOS lands.
7. Showcase pages use sample data from `lib/content/showcase/*.ts`; nothing is seeded into
   production tables for /about.
8. Minor line under 16 (`accounts/minors.py`), unchanged.

## 5. Left open, by design

- Shared and copied decks; a public deck library per Branch.
- Course-issued *grades* (a gradebook). The demo has one; EdMat deliberately does not.
- Notifications for cards due (a three-file change; name it, do not build it in a parallel step).
- Offline grading with queued reviews (the ticket scanner's batch-sync shape would fit).
- Concept cards from a revision that is later superseded: the card keeps the live reference, so it
  updates; a "frozen" card is not offered.
