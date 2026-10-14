# Courses and materials — what to build next (research, 2026-10-14)

Written on `ux/colour-pass` as a research pass. No code was changed. The owner asked on 2026-10-14
to *"bring back materials to navbar and adding … bring back courses. here we will be having people
creating communities around both general topics, and specific courses on universities for all the
materials to be in one place"*, and then to *"research how to improve courses and materials
modules"*.

**Baseline assumed.** Another branch is putting Materials and Courses back in the navbar and the
Add… menu right now. It is also adding a course `kind` (a general-topic community, or a specific
university course with university, course code, semester and an optional `taxonomy.Branch`) and a
"materials in one place" section on the course page. When this was written, nothing from that
branch had reached its worktree yet. Every recommendation below starts from that baseline and goes
past it. Where a field name is needed I use a working one, such as `Course.kind`, `university` or
`course_code`; the real names are whatever that branch lands.

**About the sources.** The web research was done by three sub-agents and checked in places by
hand. Most of it rests on search-result summaries rather than full page reads. Claims marked
**[unverified]** had no primary source this session. The legal points are a reading and not legal
advice. `LEGAL.md` §3 is still the authority on the corpus question.

---

## 1. Short answer — the five highest-leverage improvements

1. **One standing community per university course, with semesters inside it (M).** Today each
   semester's group would be a new `Course` row that starts empty. Polish student groups already
   behave this way: every *rocznik* rebuilds its Drive and its Messenger chat from nothing. The
   fix is a long-lived course identified by (university, code), with every filed item carrying the
   term it belongs to. Earlier terms stay visible and are demoted on the page rather than deleted.
   This follows MIT OpenCourseWare's "number + term" shape. It is also the one thing a private
   Facebook group structurally cannot do.
2. **A duplicate guard and a single way in (S).** When somebody creates a university course and
   a course with the same (university, code) already exists, the form should say "join this one
   instead". Course pages should also be listed on the matching `Branch` page. The research is
   clear that shared repositories fail on findability more often than on supply. Two communities
   for the same course halve both of them.
3. **A "past exams and tests" section that the corpus can fill on day one (M).** The corpus
   already holds 175 exam and midterm problems (`ExerciseSource.type` exam=110, midterm=65), but
   nothing records which year they come from. Add a term to the source and an "Egzaminy i
   kolokwia" section on the course page, grouped by year and with solutions linked. Old exams are
   what Polish students actually trade (§4). EdMat can offer them *with verified solutions*, which
   nobody else does.
4. **"Link, don't re-host" for other people's work, and asking who made it at upload (S).** Most
   of what a course page needs (lecturer slides on Moodle, USOS pages, recordings) belongs to the
   University. `LEGAL.md` §3 already found that the University holds those rights under art. 12.
   Course Hero's $75.3M verdict in 2026 was for *stripping attribution* from uploaded course
   documents. The cheap and safe pattern is a quick "add a link" on the course page, plus one
   question at upload ("I wrote this / the lecturer or University / someone else"). The answer
   steers the uploader to a link or to `unknown`, and never to a public re-host.
5. **Seed two flagship courses before announcing anything (S).** Most online communities fail,
   and the median wiki has 7 contributors. Seeding is the documented counter-measure, with one
   twist: seeded content teaches users *what kind* of thing to contribute (Solomon & Wash). Build
   UW *Analiza Matematyczna II* and *Rachunek Prawdopodobieństwa I* as real university-kind
   courses from the corpus, each with a named course representative. Launch them before the
   January 2027 session.

After these five come errata on materials, a course "key dates" strip with an `.ics` feed,
accepted answers in course Q&A, and a "useful for this course and term" signal. Sizes and order
are in §5–§6.

---

## 2. What we have today

### 2.1 Courses (`backend/courses/`, the largest app)

| Piece | What it is |
|---|---|
| `Course` | `title/summary/description`, `subjects` M2M → `taxonomy.Branch`, `field` → `Discipline`, `visibility` (`only_you`/unlisted `private`/`public`), `status` (open → running → finished), `enrollment_policy` (open/approval), `capacity`, `upload_quota_bytes`, `language`, `audience`, `starts_on/ends_on`, display-only `price`, `discussion_mode` (off/participants/public), `announce_*`, `progress_visibility`, `contribution_policy` (staff/**approval** default/open). No university, code or term field until the baseline lands. |
| `CourseStaff` | owner / admin / assistant. The owner row is created in `save()`. |
| `Enrollment` | five statuses (`left` may rejoin, `removed` may not, `declined` is a decision). Per-enrolment `notify`. |
| `Chapter` → `Lesson` | ordered, time-gated by `unlocks_at`, `LessonProgress` (in_progress/stuck/done), reviews per lesson and per chapter. |
| `CourseItem` | **the "file into the course" row**: exactly one of `material`, `exercise`, `attachment`, `event`, `discussion`, filed into a chapter or lesson or left unfiled, with `status` pending/approved/rejected and `submitted_by`/`decided_by`. Content is *referenced, never copied*. |
| `LessonExerciseSet` | an exercise set filed into a lesson or chapter. |
| `CourseInvite`, `CourseNote`, `CourseCompletion` (certificate), `CourseClaim` (covers/requires, the material claims' shape), school mode (`rules.py`, via `organizations`), `search.py` (in-course search). |
| Attached through `config/nodes.py` | a course is a **node**: tasks, plans, needs, goals, polls, `attachments.Attachment` (tiered public ⊂ members ⊂ staff ⊂ managers), flashcard deck placements and discussions all hang off it without touching its schema. |

The course page (`frontend/src/routes/courses/[id]/+page.svelte`, 1,247 lines) has tabs for content,
attachments, notes, discussion and people. It also mounts `CourseClaims`, `CourseContribute`,
`CourseSearch`, `ManagementPanels`, `DeckPlacementsPanel` and `CourseCompletions`.

### 2.2 Materials (`materials/`, `coauthoring/`, `materials_coop/`, `licensing/`)

- A `Material` is **exactly one** `branch` FK (required, CASCADE). It is one of three shapes, file,
  `url` or `body`. Its `type` is a data-driven `MaterialType` (script, exam_collection,
  midterm_collection, exercise_collection, formula_sheet, lecture_slides, solution_guide,
  syllabus, practice_test, recording, textbook_excerpt, code_dataset, other). It also has `author`
  as free text, `source_url`, `tags`, `audience`, `licence` (seven keys, default `edmat-only`,
  corpus `unknown`), translations, `MaterialReview` stars, coverage claims with two votes each,
  `MaterialView` (per user), and `ExerciseMaterialLink` (an exercise to the material it came from).
- **A material can only be created through a co-authoring project.** The path is
  `POST /api/material-projects/` with `publish: true`, and the `Material` row is the projection of
  the published `MaterialVersion`. Projects carry a team, invites, join requests and a
  `CoopSettings` policy.
- Upload safety is strong: libmagic sniffing, a 25 MB cap, random names, a ClamAV hook, and
  `MATERIAL_SCAN_REQUIRED`.
- There is **no term or year anywhere**: not on `Material`, not on `CourseItem`, not on
  `ExerciseSource`. The year of an exam lives, if at all, in the free-text
  `ExerciseSource.collection`.

### 2.3 The dev-database numbers (read-only, `backend/db.sqlite3`, 2026-10-14)

This is a development database, mostly e2e residue. These numbers describe the build and not real
use. The real signal will come from production through `analytics` (§5).

| | |
|---|---|
| users | 91 |
| courses | 19 (18 open, 1 running; 12 `only_you`, 6 public, 1 unlisted). All 19 have `audience=university` and `contribution_policy=approval`. 4 have a `subjects` branch. Several are e2e leftovers ("Linking check …"). |
| enrolments | 6 active, 1 pending. The largest course ("Analiza od zera") has 4. |
| course structure | 12 chapters, 16 lessons, 20 staff rows, 1 note, 1 invite, 2 claims, 2 progress rows, 0 certificates |
| `CourseItem` | 3 rows (2 approved, 1 pending). **All three are exercises; 0 materials**, 0 attachments, 0 events, 0 discussions. |
| materials | 22, all published. 18 `script`, 2 exercise_collection, 1 exam_collection, 1 midterm_collection. Licence: 15 `edmat-only`, 7 `unknown`. 19 file, 3 body, **0 link-only**. Only **2 branches** have any. |
| material signals | **0 reviews**, 30 views, 115 coverage claims, 2 claim votes, 1 tagged material |
| corpus | 749 exercises in 2 real branches (analiza-matematyczna 391, rachunek-prawdopodobienstwa 357). Sources: 566 exercise-sheet, 110 exam, 65 midterm, 8 other. |

What this shows: **the course ↔ material join has never been exercised with real content**, and
nobody uses the quality signals yet. There are 0 reviews, and 115 claims against 2 votes, which
means the corpus importer wrote the claims and no community has checked them. The links-only shape
has never been used, even though links are how Polish students actually share (§4).

### 2.4 Known gaps already written down

- `QA.md` row *materials*: there is no quality signal on a **version**, so a material that got
  worse cannot say so. The detail page runs 5 queries per coverage claim. Self-declared
  requirements, price and time are never verified. Since §17BC a team publishes with no moderator
  in between.
- `QA.md`: course-level contributor recognition is not built. University information was free text
  and is used for no filtering.
- `HISTORY.md` §"The navbar carries the mission" (2026-10-01): Materials and Courses were taken out
  of the bar *as a claim*, not killed. That decision is now reversed.
- Board (`edmat-boards/todo.md`): `AttachmentsPanel` is still kept off a course until
  `absorb_legacy_attachments --apply` runs. Old `courses.Attachment` rows (0 on dev) and the new
  `attachments` app coexist on the course page until then. That is a prerequisite for "files in one
  place".

---

## 3. What others do

### 3.1 Comparison

| Platform | Unit of community | How materials are found | Quality signal | Incentive | Copyright posture / failure mode |
|---|---|---|---|---|---|
| **Studocu** | university + course. Users follow a course and are notified of new uploads; it has "course groups" for Q&A ([app listing](https://apps.appfollow.io/ios/studocu/1460235511?country=cr)) | upload metadata: university, course, category, academic year ([third-party guide](https://www.swifdoo.com/convert-pdfs/studocu-download-pdf-free)) **[unverified on studocu.com]** | community ratings and upvotes on documents | **upload to unlock**: Premium time per upload, varying by region **[unverified]** | Sued by Erasmus University Rotterdam (2024) over staff syllabi and past exams; the question is whether it must screen uploads proactively ([Silicon Canals](https://siliconcanals.com/studocu-erasmus-university-rotterdam-lawsuit/)). Academics found their slides there ([THE, 2021](https://www.timeshighereducation.com/node/718458)). |
| **Course Hero** | university course pages | search and paywall ("Unlocks") | — | upload to unlock | **Post University v. Course Hero, March 2026: $75.3M jury verdict.** Nearly all of it was for removing copyright-management information and re-branding documents; the infringement damages were $114.85 ([Thompson Coburn](https://www.thompsoncoburn.com/insights/unlocking-infringement-post-university-lawsuit-targets-course-heros-business-pr-102l71u/), [CLM](https://www.clm.com/client-advisory-update-75-3-million-jury-verdict-reinforces-urgency-of-protecting-teaching-materials-against-online-theft/)). A professor subpoenaed uploader identities over posted exams ([Legal Insurrection](https://legalinsurrection.com/2022/03/chapman-university-prof-files-lawsuit-after-midterm-and-final-exams-are-posted-online)). |
| **Quizlet** | a teacher-created *class*. Students may not create classes and use folders instead. Members are emailed when sets are added ([Quizlet help](https://help.quizlet.com/hc/articles/360030513392)) | sets, folders, search | — | study modes | Core modes moved behind a paywall in 2022 and drew student backlash ([school paper](https://ehseagleseye.com/6095/features/quizlet-from-free-to-paid)). Takedowns of study sets copied from a textbook ([Thompson Coburn](https://www.thompsoncoburn.com/insights/education-platform-liability-in-the-ai-era-divergent-outcomes-for-quizlet-and-course-hero/)). |
| **Brainly** | none (a global Q&A) | — | moderators, "best answer" | points: 20 at signup, half a question's points for a great answer, 5 per moderation action ([Comparably FAQ](https://www.comparably.com/companies/brainly/faqs)) | No independent evidence found on moderation at scale. |
| **Piazza / Ed Discussion** | the official course instance | categories, filters (unanswered/endorsed) | **instructor-endorsed** threads and **accepted answers** ([Wharton, Ed](https://support.wharton.upenn.edu/help/ed-discussion-for-faculty); [PSU, Piazza](https://weblearning.psu.edu/files/2017/07/piazza_handout_short-2-21egrck.pdf)) | participation correlates with exam results, causation unknown ([Yale](https://poorvucenter.yale.edu/print/399)) | Posts are anonymous to peers but **not to staff**. Students value it, especially quiet ones ([Waterloo CTE](https://uwaterloo.ca/centre-for-teaching-excellence/teaching-resources/teaching-tips/piazza), [LSE](https://info.lse.ac.uk/current-students/skills-and-opportunities/assets/documents/Change-makers/research-archive/2023-24/47-Piazza-discussion-forum-SUMMARY.pdf)). Students disliked delayed notifications and having one more tool ([UW survey](https://it.uw.edu/wp-content/uploads/2022/05/Summer_Autumn-2021-Ed-Discussion-survey-report.pdf)). |
| **Discord study servers** | a server per programme; a **channel per course, re-created each semester**; roles by year plus alumni, grad and professor ([ASEE 2024 WIP](https://peer.asee.org/board-54-work-in-progress-exploring-how-an-unofficial-discord-server-supports-undergraduate-learning-in-computer-science)) | pinned messages; little search | none | social | Ephemeral, unsearchable from outside, and dependent on one admin. |
| **Reddit uni subs** | a sub per university, unofficial ([r/UIUC](https://thehiveindex.com/communities/r-uiuc/)) | pinned **megathreads** that absorb recurring questions ([example](https://reddit.birdcat.cafe/r/dunedin/comments/1kymvwd/going_to_uni_megathread)) | votes | karma | Thin evidence on wikis. |
| **Student-society exam banks** | the official course code | by department and course number (U Alberta SU registry, Waterloo EngSoc, Toronto Skule; [UofT library FAQ](https://library.utoronto.ca/faq/where-can-i-find-old-exams), [Waterloo EngSoc](https://www.engsoc.uwaterloo.ca/?p=116)) | — | students submit | **RWTH Aachen's Fachschaft lets about 3,000 old exams be viewed only on site, because some lecturers object to online copies** ([FSMPI](https://www.fsmpi.rwth-aachen.de/en/studium/altklausuren)). |
| **OpenStax** | the book | subject | **errata reviewed by subject experts and released in twice-yearly batches** with a visible revision number; a new edition every 3–5 years; only the current and previous edition hosted ([errata process](https://help.openstax.org/s/article/Errata-correction-process), [retirement policy](https://openstax.org/openstax-edition-retirement-policy)) | — | CC BY |
| **MERLOT** | discipline | catalogue | **two separate signals**: peer review by editorial boards, and member ratings ([Memphis guide](https://libguides.memphis.edu/open_education/evaluatingOER/reviews)). They can disagree ([Bentley 2026](https://scholars.bentley.edu/library_oerpubs/17)). | — | — |
| **LibreTexts** | an instructor's remix of pages | remix maps; flat structures recommended ([guide](https://chem.libretexts.org/Courses/Remixer_University/A_Quick_Guide_to_LibreTexts_for_New_Instructors/02%3A_Building_Remixing_Maps)) | — | — | Per-page licences drift, and some pages declare none ([example](https://chem.libretexts.org/Courses/Remixer_University/The_ADAPT_WeBWorK_Handbook/00%3A_Front_Matter/05%3A_Licensing)). EdMat's `unknown` is the same state. |
| **MIT OCW** | **course number + term** ("6.857 Fall 2003"); older terms archived in DSpace with a "newer version exists" notice ([DSpace](https://dspace.mit.edu/handle/1721.1/33971)) | department → course → term | editorial | — | CC BY-NC-SA |
| **Canvas Commons** | the instructor's course | tags and search ([WWU](https://atus.wwu.edu/kb/using-canvas-commons-share-course-materials)) | — | — | The sharer picks a licence, including "Copyrighted" ([UW](https://ciso.uw.edu/tools-services-support/teaching-learning/canvas/canvas-help-for-instructors/canvas-commons/copyright-licensing)). Not pre-screened. |
| **Moodle / LMS logs** | the official course | files, modules | — | — | **Usage spikes before exams** ([arXiv 1601.02975](https://arxiv.org/pdf/1601.02975), [EDM 2010](https://educationaldatamining.org/EDM2010/uploads/proc/edm2010_submission_10.pdf), [Melbourne](https://www.unimelb.edu.au/tli/news/articles/online-learning-the-story-in-numbers), [Warwick](https://warwick.ac.uk/archive/iatl/websitearchived2024/sharing-practice/staff/all-projects/barile)). Steady activity predicts grades and a late surge does not ([Tübingen 2025](https://uni-tuebingen.de/en/research/core-research/lead-graduate-school-research-network/newsfullview/article/unsuccessful-in-exams-studying-regularly-helps/)). |

Not researched or not found: Wikiversity, Khan Academy, OER Commons, Notion and Obsidian shared
vaults, and any ranking of which LMS features students use.

### 3.2 Lessons, with how strong each one is

1. **Findability fails before supply does.** In faculty surveys, 38% found searching hard and the
   top complaint was the lack of a comprehensive catalogue ([Higher Ed Dive / Babson](https://www.highereddive.com/news/why-open-educational-resources-arent-catching-on-with-some-faculty/405162/)).
   Difficulty locating material was cited by 48% ([eCampus News, 2016](https://www.ecampusnews.com/2016/09/07/faculty-oer/)).
   *Moderate evidence: dated and self-reported, but consistent.* For EdMat this means **one page per
   real course**, reachable from the code, the name and the branch.
2. **Repositories that last have quality assurance and an owner.** Interviews with managers of 27
   repositories linked success to peer and expert quality assurance. Many repositories fail to
   attract users and funding ([Clements et al.](https://library.iated.org/view/CLEMENTS2015HOW)).
   *Moderate evidence.* For EdMat: a course needs a named person (a course rep), and quality signals
   must be cheap enough to actually be given.
3. **Keep different signals separate.** MERLOT keeps peer review and member ratings apart, and they
   disagree. EdMat already separates "is the level right" from "is this important" on claims, and
   the same discipline should apply to "useful for this exam".
4. **Seeding works, and it shapes what follows.** Most communities fail, and the median across
   about 9,000 wikis is 7 contributors ([CMU on Kraut & Resnick](https://www.cmu.edu/news/stories/archives/2012/may/may3_guidingonlinecommunities.html)).
   Seeded content teaches newcomers what *kind* of contribution is wanted, though it can reduce how
   much they add ([Solomon & Wash, CSCW 2012](https://rickwash.com/papers/bootstrapping-cscw.pdf)).
   *Moderate evidence.* For EdMat: seed the content type we want most (worked solutions, structured
   exam collections), not filler.
5. **Paywalls and upload-to-unlock create hostility and lawsuits, not quality.** Quizlet drew
   backlash, Studocu and Course Hero drew lawsuits, and notatek.pl dropped "upload or pay by SMS"
   because too few people uploaded ([Antyweb 2013](https://antyweb.pl/notatek-pl-chce-byc-spotify-edukacji)).
   EdMat already takes no money (`FINANCES.md`).
6. **Attribution is the legal fault line.** Course Hero's exposure came from *removing* copyright
   management information. Keeping author, source and licence attached is therefore not only
   courtesy. EdMat already stores `author`, `source_url` and `licence`, so they should be shown on
   every course-page row.
7. **Course Q&A works when it has endorsed answers and low-risk asking.** Endorsement and
   anonymity to peers recur in every Piazza and Ed report. *Weak to moderate evidence: surveys and
   teaching-centre pages, no controlled studies.*
8. **Versioning must be visible and cheap.** That means OpenStax-style batched errata with a
   revision stamp, and MIT-style term archives that are demoted on the page rather than deleted.
9. **Usage is seasonal.** In Poland that means late January–February, June and September (§4).
   Retention features should fire *before* those windows, and success should be judged on steady
   weekly use rather than on peaks.

---

## 4. The Polish student reality

- **Where it actually lives.** The incumbent is a Facebook group or Messenger or Discord chat per
  *kierunek* and *rocznik*, with a Google Drive folder linked from a pinned post. Lecturers
  sometimes try to watch those groups ([Spidersweb, 2021](https://spidersweb.pl/2021/01/studenci-sciaganie-nauka-zdalna.html)).
  Drive links are passed around on forums ([e-prawnik thread](https://e-prawnik.pl/forum/notatki-studenckie.html)).
  Individual MIMUW students publish solutions on GitHub ([ecosyste.ms topic "mimuw"](https://repos.ecosyste.ms/topics/mimuw)).
  The specific pipeline is **[unverified as a whole]**, since no survey was found. It matches
  common knowledge and the sources above. Its weaknesses are exactly EdMat's openings: it is
  **private, tied to one year, dependent on one admin, unsearchable and unreviewed**, and the
  material dies with the year group.
- **What they trade.** Old exams and tests ("stare kolokwia", "baza egzaminów"), worked answers,
  "ściągi", lecture notes, "opracowania" (worked-out exam-question lists). EdMat's corpus is
  already 175 exam and midterm problems, many with solutions.
- **Commercial precedent.** notatek.pl (2013): free notes paid for by ads, about 102k files and
  ~120k monthly users. Each upload was moderated and checked for duplicates. A file was **blocked
  immediately on a rights-holder report** and removed once proof was given. The site said it had
  never been sued ([Antyweb](https://antyweb.pl/notatek-pl-chce-byc-spotify-edukacji)). Nothing
  reliable was found about docer.pl or sciaga.pl.
- **Law (a reading, not advice).** `LEGAL.md` §3 already records that UW teaching materials are
  employee works owned by the University (art. 12, Senate resolution 68 §13). It also records that
  art. 27 covers a closed institutional setting and not a public site
  ([MEN explanation](https://www.portaloswiatowy.pl/komunikaty-men-i-cke/zmiany-w-prawie-autorskim-wyjasnienia-men-dotyczace-szkol-i-przedszkoli-12085.html)).
  Notes **in the student's own words** are the low-risk category. Copying the lecturer's slides or
  delivery verbatim is where trouble starts, usually academic rather than civil
  ([Bezprawnik](https://bezprawnik.pl/sprzedaz-notatek-na-vinted/)). Whether an exam paper is a
  protected work is undecided: routine computational problems probably are not, and an exam as an
  original compilation plausibly is. DSA art. 6 and art. 16 make a precise notice the trigger for
  liability, and EdMat's notice-and-action exists (`LEGAL.md` §4).
- **USOS.** Each university runs its own USOS API. On UW, `services/courses/search` and `course`
  are **anonymous**, and `course_edition` takes `course_id` + `term_id`
  ([UW USOS API](https://usosapps.uw.edu.pl/developers/api/services/courses/);
  [vocabulary: prz_kod → course_id, cdyd_kod → term_id](https://usosapps.uw.edu.pl/developers/api/definitions/vocabulary/)).
  There is no single terms-of-use document. PWr limits keys to its own staff and students and
  requires security and GDPR documentation
  ([PWr procedure](https://di.pwr.edu.pl/fcp/FGBUKOQtTKlQhbx08SlkTUgNBUWRuHQwFDBoIVURNWHxQBFhnRlUuWTISTnoYDxMe/173/public/2025_prodecura_api_usos.pdf)).
  UW term codes look like `2025Z` and `2026L` **[unverified format, check `services/terms`]**, and
  other universities differ. The public UW catalogue shows only current cycles, which is a gap
  EdMat's term archive would fill.
- **Moodle at UW** is per unit (e.g. [ILS](https://ils.uw.edu.pl/?p=1952)), behind login and often
  behind an enrolment key **[unverified detail]**. This is why students mirror its contents into
  private groups, and it is why EdMat should **link** to it rather than copy it.
- **Calendar.** UW 2025/26 had its winter session 26 Jan–8 Feb 2026 and resits 20 Feb–1 Mar
  ([aggregator](https://opinieouczelniach.pl/uczelnia/uniwersytet-warszawski/kalendarz-akademicki/)).
  The 2026/27 summer session is about 7–27 June 2027 and the resits about 30 Aug–12 Sep 2027 (same
  source). The science faculties, MIMUW included, follow a different timetable, so check
  uw.edu.pl. **The first realistic test of anything built here is the January 2027 session**,
  roughly 13 weeks from today.

---

## 5. Recommendations

Each item maps onto existing apps. The analytics notes use only what `backend/analytics/` already
records: `DailyContentView` (kind=`course`/`material`, per object), `DailyRouteStat` (route
template), `live.FEATURE_REGISTRY` (`materials`, `material_versions`, `courses` and `enrollments`
per week), with k=10 suppression on people counts. **No per-user tracking is proposed anywhere.**
Where a new figure is needed, it is one more line in `FEATURE_REGISTRY`, a live count over
existing rows.

### R1. Terms inside one standing course (cross-year continuity) — **M**

- **Problem.** The baseline puts one `semester` on `Course`. A course that runs every year then
  needs either a new row each term, which starts empty and splits the community, or one row whose
  materials get mixed with no year attached. Discord re-creates channels each semester, and Polish
  year-group Drives die with the year.
- **Evidence.** MIT OCW's number + term with archived terms; OpenStax's visible revision number;
  §3.2 lessons 1 and 8.
- **Change.**
  - Treat `Course(kind='university')` as the **standing** course for (university, course_code), and
    make `semester` mean the *current* term.
  - Add `CourseItem.term` (CharField, blank, free text checked against a per-university pattern,
    `2025Z` on UW), stamped with the course's current term when an item is filed. Staff can edit it.
  - The course page groups the materials section by term, newest first, and folds older terms
    under "Z poprzednich lat". A carried-over item shows "last confirmed: 2025Z".
  - Add a staff action `POST /api/courses/{id}/new-term/` that advances `semester`, posts an
    announcement, and optionally re-confirms chosen items into the new term (a re-stamp, not a copy).
  - Enrolments are untouched. People from earlier terms stay, and their role is R8's concern.
- **Dependencies.** The baseline `kind`/`semester` fields.
- **Risks.** Low. The one trap is the term format: keep it free text with a per-university regex
  hint rather than an enum (`locale` is the precedent).
- **Measure.** The share of `DailyContentView(kind=course)` landing on courses with items in two or
  more terms. A live count of items whose term is older than the current one but were re-confirmed
  (re-use).

### R2. One page per real course: duplicate guard and discovery — **S**

- **Problem.** Nothing stops two "AM2 at UW" communities, and the `Branch` page shows exercises
  and materials but no courses.
- **Evidence.** §3.2 lesson 1. Studocu and student-society exam banks are organised by course code.
- **Change.**
  - `GET /api/courses/?university=&code=` (exact match), plus a check in course creation that
    answers **409 `course_exists`** with the id for `kind='university'` when (university, code) is
    taken by a public or unlisted course. The frontend offers "join it". Following house rule 6, it
    says *why*.
  - Do not make it a database unique constraint: a private study group may legitimately mirror the
    course, so the guard applies only to `public` courses.
  - Add a "Kursy" tab on `routes/branches/[branch]/` (the `subject` filter already exists).
  - Make the course code searchable in `/search`.
  - **Prefer an `organizations.Organization` of kind `university` as `university`** over free text.
    `ORGANIZATION_KIND_CHOICES` already has `university` and `faculty`, so "everything at MIMUW" is
    one page. Fall back to free text when no organisation exists.
- **Risks.** Squatting: an inactive owner holds the canonical page. Mitigate with R8 (a
  hand-over request through moderation) rather than with automatic expiry.
- **Measure.** Count of public university courses with duplicate (university, code), aiming for 0.
  The `course_exists` refusal count from `DailyRouteStat` 4xx on the create route (a rough proxy).
  Branch-page → course traffic cannot be measured without referrer paths; do not add them.

### R3. Past exams and tests as a first-class section — **M**

- **Problem.** There are 175 exam and midterm problems with no year. `exam_collection` and
  `midterm_collection` materials exist but are not tied to a sitting. Students want exams *by year*,
  *with solutions*.
- **Evidence.** §4 (what Polish students trade); student-society exam banks are organised by course
  and year; OpenStax and MIT on visible dating.
- **Change.**
  - `ExerciseSource.term` (or `year` plus `sitting`: first or resit), as a backfill done by hand from
    the collection names, and a field in the `/submit` and import formats
    (`.claude/skills/import-exercises/reference/format.md`).
  - On the course page, add an **"Egzaminy i kolokwia"** section. It derives from exercises whose
    source type is exam or midterm in the course's `subjects`/`branch`, plus filed exam and midterm
    materials, grouped by term. Each row shows "solution verified" (`verified` is already derived)
    and links "practise as flashcards" (`flashcards` decks from an exercise set already exist:
    `Deck.source_set`).
  - Let a course rep file a whole sitting as a `LessonExerciseSet` labelled "Egzamin 2025Z".
- **Dependencies.** R1 for the term vocabulary.
- **Risks.**
  - Copyright, as in §4: exams are the University's. Ship this for **re-typed problems with
    original solutions** (the corpus's shape, `LEGAL.md` §3 point 3), never for scans of the
    exam sheet.
  - Academic integrity: an exam must never be posted *during* its sitting. Add a rule in
    `exercises/entries.py` or the submission validator refusing a term equal to the current,
    still-open sitting **[owner decision]**.
- **Measure.** `DailyContentView(kind=exercise)` restricted to exam and midterm sources, compared
  across the session windows (Jan–Feb, June, September) and quiet weeks. Solutions added to exam
  problems per week (a live count).

### R4. "Link, don't re-host", and who made it — **S**

- **Problem.** Most of what belongs on a course page is somebody else's: Moodle files, slides,
  USOS, recordings. Today the only way to add a material is a co-authoring project that asks for a
  licence. A link-only material has never been made on dev (0 of 22), and an uploader holding the
  lecturer's PDF has no honest licence to pick.
- **Evidence.** Course Hero's verdict was about attribution. The Studocu and Erasmus question is
  about proactive screening. RWTH keeps exams on site only. notatek.pl blocked on notice. `LEGAL.md`
  §3 says UW owns its staff's teaching materials.
- **Change.**
  - On the course page, **"Dodaj link"** creates a `CourseItem` pointing at a link-only `Material`
    through the existing `create_material` path, with `publish: true` and the branch prefilled from
    the course. Title, URL, type and term; no licence question, because nothing is re-hosted.
    *If* creating a project per link is too heavy, the alternative is a sixth `CourseItem` kind
    `link` (url + title). That is cheaper but makes a link invisible to `/materials`. **[owner
    decision]**
  - For uploads (`/submit-material` and course "contribute"), ask **"Kto jest autorem?"** with
    three answers. "Ja / my" offers the licence picker as today. "Prowadzący / uczelnia" steers to
    *add a link instead*, and if they still upload, sets `licence='unknown'` and forces the
    `attachments` tier `members` or `staff`, never `public`. "Ktoś inny" requires `author` +
    `source_url` and sets `unknown`. `licensing.rules` already keeps `unknown` non-selectable, so
    this needs one new reason code in that module, not a new rule.
  - Show `author · source · licence` on every material row on the course page (lesson 6).
- **Risks.** A members-only tier is **not** a legal shelter (§4: art. 27 is institutional). It
  limits spread and makes takedown simpler, and that is all. Say so in the UI copy and in
  `LEGAL.md`.
- **Measure.** The ratio of link-only to file materials created per week (a `FEATURE_REGISTRY`
  line), and the share of new uploads landing as `unknown`. DSA notices per material per month,
  from moderation's existing queue figures.

### R5. Seed two flagship courses and appoint course reps — **S**

- **Problem.** All 19 dev courses are empty or test residue, and a community that opens empty
  usually stays empty.
- **Evidence.** §3.2 lesson 4.
- **Change.**
  - A management command `seed_flagship_courses`, idempotent and using real rows, *not*
    `FAKE_PREFIX`. Two public `kind='university'` courses, UW *Analiza Matematyczna II* and UW
    *Rachunek Prawdopodobieństwa I*. Each gets:
    - chapters following the corpus topics;
    - the exam and midterm sections from R3;
    - links to the official USOS course page (a link, R4);
    - the 7 corpus scripts filed as `CourseItem`;
    - a goal ("every 2025 exam problem has a verified solution", `goals` with criteria);
    - `needs` rows ("missing: solutions for RP1 exam 2024").
  - Recruit one **course rep (starosta kursu)** per course as `CourseStaff` admin before launch.
- **Dependencies.** R1 and R3 for full value. It can ship with the baseline alone.
- **Risks.** Seeding content we may not have rights to: the corpus's own open question. The
  flagship pages *increase* its visibility, so `LEGAL.md` §3 should be resolved, or at least the UW
  sign-off requested, before this goes public **[owner decision]**.
- **Measure.** Weekly active enrolments on the two courses (k=10 applies), contributions per week
  (`CourseItem` approvals, `material_versions`), and `DailyContentView(kind=course)` for the two ids
  through the January 2027 session.

### R6. Errata and freshness for materials — **S–M**

- **Problem.** `QA.md`: there is no quality signal on a version, and a wrong script can only be
  reported. MaterialReview has 0 rows, so stars are not being given.
- **Evidence.** OpenStax's reviewed and batched errata with a revision number; §3.2 lesson 8.
- **Change.**
  - On `/materials/[id]`, add **"Zgłoś błąd"**. It creates a `tasks.Task` hung off the material node
    (`config/nodes.py` already admits `material`) with a fixed label `erratum`, with **no new
    model**, visible to the project team. Fixing it means proposing a `MaterialVersion` (the
    existing coauthoring path) that closes the task.
  - Show "wersja N · poprawiona <date> · 2 otwarte zgłoszenia błędów" on the card.
  - Prefer this one-click errata path over asking for stars. Stars produce no signal at this scale
    (0 reviews).
- **Risks.** Spam errata. Use the existing throttles and reports.
- **Measure.** Errata opened and closed per month, and median time to close, both live over
  `tasks`.

### R7. Key dates on the course page, with a calendar feed — **S–M**

- **Problem.** Exam dates, resits and deadlines are the most-asked question in year-group chats
  **[unverified, plausible]**. `CourseItem(event)` exists but an `events.Event` is heavyweight:
  programme, registration, conference layer.
- **Evidence.** LMS calendars and announcements; exam-driven usage spikes.
- **Change.** Either:
  - **(a)** a lightweight `CourseDate` model in `courses` (title, kind exam/resit/midterm/deadline,
    `starts_at`, term), with an `.ics` feed at `/api/courses/{id}/dates.ics`. The `events`
    `my-agenda.ics` is the precedent. Or
  - **(b)** reuse `events.Event` with a minimal "date only" form.

  (a) is recommended: it is small, honest and avoids pulling the conference layer into a course.
  Notifications go through the existing `notify_course_participants` and `announce_*`, plus a
  reminder 7 days before.
- **Risks.** Wrong dates published by a non-staff member. Make it curator-only (`can_curate`).
- **Measure.** `.ics` route requests in `DailyRouteStat`. This is a pull by calendars, and it counts
  requests, not people.

### R8. Community roles that match a student course — **S**

- **Problem.** owner/admin/assistant says what a person may *do*, not who they *are* (course rep,
  TA, lecturer, alumnus). Communities need visible stewards, and a canonical page needs a hand-over
  path (R2).
- **Evidence.** Discord's year, alumni and professor roles; Piazza and Ed instructor endorsement.
- **Change.**
  - `CourseStaff.title`, a choice of course rep / TA / lecturer / alumnus, display-only. Permission
    stays on `role`.
  - Show an "alumni" chip on enrolments from earlier terms (derived from R1's term on the
    enrolment date; no new state).
  - Add a moderation-mediated request, "Request to take over this course", for an abandoned
    canonical course. It reuses `moderation.Report`-style queue handling, and the owner stays
    hostage-proof unless a moderator decides.
  - **Never** let "lecturer" be self-declared as a badge without verification. Leave lecturer as
    an invitation sent by the owner (`CourseInvite` role).
- **Risks.** Impersonating a lecturer. Keep the title free of any authority, so it grants nothing.
- **Measure.** The share of public university courses with at least one course rep (live).

### R9. Q&A with accepted answers in the course discussion — **M**

- **Problem.** The discussion is a flat `community.Comment` thread. For a course, the valuable
  artefact is the *answered question*.
- **Evidence.** §3.1, Piazza and Ed. Weak to moderate evidence.
- **Change.**
  - On root comments under a course, add `is_question` and an `accepted_reply` FK, set by the asker
    or a curator. A curator can also mark a reply "endorsed" (house rule: one status field, e.g.
    `answer_state` none/accepted/endorsed).
  - Filter "unanswered".
  - **Anonymous-to-peers is not recommended now.** Minors can be participants (`accounts/minors.py`),
    and moderation and DSA handling need an attributable author. Revisit with the owner.
- **Dependencies.** Changes `community`, which every thread uses, so put it behind the course's
  discussion feature.
- **Measure.** Questions per week, the share answered within 48 h (live counts over comments).

### R10. Follow without joining, and the pre-session nudge — **S**

- **Problem.** Joining is the only way to hear about a course, and a public community should be
  followable. The mail digest exists (opt-in, hourly).
- **Evidence.** Studocu's follow-a-course; Ed users disliked delayed notifications; exam spikes.
- **Change.**
  - For public courses with `enrollment_policy='open'`, joining *is* following, so the label should
    say "Obserwuj / Dołącz".
  - Add a **"Przed sesją"** notification two weeks before a `CourseDate(kind=exam)`, naming what is
    new since the last term: new solutions, errata closed. It rides the existing
    `Notification` → digest path, so the three mute layers still govern it.
- **Risks.** Notification fatigue. One per exam, and it respects `Enrollment.notify`.
- **Measure.** Weekly returning activity on course pages around session windows (aggregate
  `DailyContentView`), and digest sends from `mail`'s own log counts.

### R11. Let a material belong to a general-topic course, and to several subjects — **decision, then S–M**

- **Problem.** `Material.branch` is a **required single FK**. A general-topic community such as
  "Analiza od zera" or a programming circle may have no branch, and a material may serve two
  branches. The baseline makes `Branch` optional on a course, so the "materials in one place"
  section will hit this the first time a general-topic course adds a material.
- **Change.** Choose one:
  - **(a)** keep it required, and have the course form fall back to the course's first subject or a
    catch-all branch per discipline;
  - **(b)** make it nullable. That touches `/materials` browsing, the recommender, content-locale
    filters and `MaterialViewSet` scoping;
  - **(c)** add `Material.branches` M2M.

  (a) is the cheapest and keeps every read site honest. (c) is the right model if materials are
  meant to be cross-subject.
- **[owner decision]**

### R12. Small fixes the course page will expose — **S each**

- Run `absorb_legacy_attachments --apply` and drop the `ManagementPanels` condition (board
  `todo.md`), so a course shows one attachments surface, not two.
- The material detail page's 5-queries-per-claim (`QA.md`) gets worse once course pages list
  materials with claims. Prefetch before R3 and R5 put 30+ claims on a page.
- `contribution_policy='approval'` with **every** staff member notified is right for a class. For
  a 300-student public course with one rep, the queue stalls. Document the expectation, and
  consider `open` plus reports for courses with three or more curators.

### What I would *not* build

- **Upload-to-unlock, points-for-uploads, or paywalls** (lesson 5).
- **Scraping or bulk-importing USOS or Moodle content.** Only *metadata lookup* by course code
  through the anonymous UW `courses/search` and `course` endpoints, and only after asking the UW
  USOS team, since terms differ per installation. That is an optional M later, not a dependency.
- **A new "studygroups" app.** A study group is a private `Course(kind='general')` with
  `visibility='private'` and an invite link, all of which exists.

---

## 6. Suggested sequence

| Release | When | Contents | Why this order |
|---|---|---|---|
| **1 — "One place, safely"** | before December 2026 | R2 (duplicate guard, Branch tab, code search), R4 (add a link; who made it), R11 decision + the chosen fix, R12 (attachments absorb, claim prefetch), R8 `title` only | Makes the baseline usable without creating duplicate courses or copyright debt. Everything is S. |
| **2 — "Ready for the January session"** | mid-December 2026 | R1 (terms), R3 (exam section + `ExerciseSource.term` backfill), R5 (two flagship courses + reps), R7 (key dates + `.ics`) | The winter session (about mid-January to February 2027) is the first real test. Seed before it, not during it. |
| **3 — "Keep them coming back"** | February–May 2027, before the June session | R6 (errata), R9 (accepted answers), R10 (follow + pre-session nudge), the rest of R8 (alumni chip, take-over request), optional USOS metadata lookup | Retention after a first cohort exists. Judge it on the June 2027 session against January's numbers. |

---

## 7. Open questions for the owner

1. **The corpus licence question (`LEGAL.md` §3) and flagship visibility.** Do we ask UW for
   institutional sign-off before R5 puts AM2 and RP1 exam problems on two prominent public pages,
   or launch and rely on notice-and-action?
2. **Old exams policy.** Re-typed problems with original solutions only, never scans? An embargo on
   the current sitting? Should a lecturer be able to ask for a course's exams to be members-only?
3. **Link materials: full `Material` or a lightweight `CourseItem(link)`?** The first makes links
   findable on `/materials` and costs a project per link. The second is cheap and course-local.
4. **`Material.branch`**: keep required with a fallback (a), nullable (b), or many-to-many (c)?
5. **One canonical public course per (university, code)?** Enforced, or only suggested? And who
   arbitrates a take-over of an abandoned one?
6. **University as an `Organization`** (kind `university`/`faculty`, one page per MIMUW) or free
   text? The first ties into school mode and `/organizations`, and needs somebody to create those
   rows.
7. **Anonymous-to-peers questions** in course Q&A: wanted at all, given minors and DSA
   attribution?
8. **USOS**: may we ask UW's USOS team for an API key for metadata lookup, and is the operator (the
   student team, `LEGAL.md` §1) the right applicant?
9. **Course reps**: will you recruit the first two by hand? The seeding evidence says the person
   matters more than the feature.
