# EdMat — project reference

A community-driven database of university exercises (mathematics / CS / physics), with a full platform grown around it: LaTeX-rendered
statement / hint / answer / solution, browsable **discipline → branch → topic → exercise**, plus reviews, threaded discussion,
moderated submissions, per-exercise translation, teaching materials with coverage claims, user-run courses, tutoring listings with
real booking and availability, one-off events, user-to-user messaging, and a scoped moderation system.

Seeded from a real 740-exercise legacy corpus (`Database-of-Student-Exercise/`, a static-site generator now retired — kept in-tree
only as migration provenance). A SvelteKit SPA against a Django REST Framework API.

**This file is an orientation map — read this first.** The full chronological build history — every
feature, every design decision with its reasoning, every bug found and how — lives in **`CLAUDE.md`
(~435 KB)**, which remains the source of truth. When the two disagree, `CLAUDE.md` wins.

---

# 1. Repo layout at a glance

```
edmat/
├── backend/           Django 5.2 + DRF. 15 apps + config/ + testing/ + imaging.py. SQLite.
├── frontend/          SvelteKit 2 + Svelte 5 runes + TS. adapter-static (SPA). Paraglide i18n.
├── deploy/            Apache vhosts + the webek4/edmat.net runbooks.
├── scripts/           One legacy helper (mock-fixture extraction from the corpus).
├── Database-of-Student-Exercise/   The retired static site + vendored 740-exercise corpus.
├── FUW/               UNTRACKED. Server-rescue snapshots — CONTAINS LIVE SECRETS.
├── .claude/           settings.local.json + settings.json (bgIsolation: none — work in this checkout directly).
├── setup.sh run.sh    One-command install; separate one-command run.
├── CLAUDE.md          The 435 KB living blueprint / build log (§17A–§17AB, §18 open questions, §19 glossary).
├── LAUNCHCHECKLIST.md QA.md test.md README.md
├── NAVBAR-BRIEF.md PORTS-BRIEF.md ENERGY-BRIEF.md   Owner-facing design briefs.
└── requirements.txt   One-line include of backend/requirements.txt.
```

Two vocabularies coexist and this trips people up constantly:

| Concept | Model | Note |
|---|---|---|
| A university subject (*przedmiot*) | `taxonomy.Branch` | Formerly `Course`. Renamed. |
| A field of study (*kierunek*) | `taxonomy.Discipline` | Formerly `Field`. Renamed. |
| Something a **user runs** and others join (*kurs*) | `courses.Course` | App formerly `classroom`. |

So `/api/courses/` is now the *user-run* course API, and `/api/branches/` is the taxonomy. A stale `backend/classroom/` directory
still exists on disk; the live app is `courses`. Docs, tests and several e2e scripts still say "classroom" in places.

---

# 2. Backend — Django + DRF (`backend/`)

## 2.1 Stack and settings
- **Django 5.2**, **DRF 3.16–3.17**, **SQLite** (`backend/db.sqlite3`, with dated `.bak-premigrate-*`/`.bak-premerge-*` snapshots
  beside it — deliberate, don't clean them up blindly).
- **Auth:** DRF `TokenAuthentication` (the SPA) + `SessionAuthentication` (admin, browsable API). No SSO. Login accepts an
  **email**, resolved to the underlying username server-side.
- **Runtime deps** (`backend/requirements.txt` is canonical): `django-cors-headers` (the SPA is a separate origin, so CORS is
  load-bearing), `django-filter`, `Pillow` + `python-magic` (libmagic sniffing) + `clamd` (optional ClamAV), `bleach` (the
  write-side sanitizer, `config/sanitize.py`), `django-postman` (the messaging substrate — drags in `django.contrib.sites` as a
  hard import-time dependency), `PyYAML` (corpus importer), `redis` (optional, only via `EDMAT_REDIS_URL`).
- **`config/settings.py` highlights:** `SECRET_KEY`/`DEBUG`/`ALLOWED_HOSTS`/`CSRF_TRUSTED_ORIGINS` env-driven; `EMAIL_BACKEND` is
  the **console** backend (no real mail, §7); `TIME_ZONE = 'UTC'` and **no per-user timezone anywhere**;
  `DATABASE_ROUTERS = ['telemetry.routers.LogShardRouter']`; `MATERIAL_SCAN_REQUIRED = False` + `CLAMD_*` (§2.5);
  `EDMAT_OAUTH_CLIENTS`/`EDMAT_USOS_CREDENTIALS` empty dicts, which is what makes the identity providers report themselves as
  drafts; `EDMAT_REDIS_URL` (§2.6); `EDMAT_LOG_SHARD_*`; `EDMAT_USOS_MOCK`; `EDMAT_REPOSITORY_URL`.
- **Pagination is globally OFF**, deliberately: every list the frontend calls is bounded by construction, and leaving it on would
  have put a `{count,next,previous,results}` envelope on some endpoints while the many custom `@action`s returned bare arrays.
- Other config modules: `cachemw.py` (anonymous-read response cache), `sanitize.py`, `dbsearch.py`, `i18n_utils.py` (locale
  resolution/fallback, used by every translated serializer).
- **Tests:** `manage.py test` — **~1145** across per-app `tests.py`/`test_*.py`. `backend/testing/factories.py` holds shared
  plain-function fixtures (deliberately not `factory_boy`); `make_viewer` skips password hashing on purpose, which cut the
  moderation suite from 52 s to 12 s.

## 2.2 The apps, one by one

### `taxonomy` — the controlled vocabulary everything hangs off
Models: `Discipline`, `Branch`, `Topic`, `Subtopic`, `Chapter`, each with its own `*Translation` sibling, plus an abstract
`ProposableNode` base. Structural fields live on the node, all human-language text lives in the translation table — the same split
`ExerciseTranslation` uses, applied consistently. `Topic` is **branch-scoped** (matching the source corpus exactly, where a topic id
only means anything inside its own `course.yaml`); `Subtopic` nests under it. `Chapter` carries the textbook page map imported from
`mapa_rozdzialow.yaml`.

`ProposableNode` is the community half: users propose new taxonomy nodes (`POST /api/taxonomy/propose/`), which land in the
moderation queue. Views: `DisciplineViewSet` (+ `branches`), `BranchViewSet` (+ exercises/materials), `ProposeNodeView`.
Unpublished nodes 404 rather than leaking.

### `exercises` — the core content model
Models: `Exercise` (structural only: branch, number, topics, difficulty, tags, `published`, `verified`, `original_locale`,
`submitted_by`), `ExerciseSource` + `ExerciseSourceTranslation` (the corpus `source:` block), `ExerciseTranslation` (**the** text
table — title / statement / hint / answer / solution, `status`, `translated_by`, `reviewed_by`, `review_note`, one row per
(exercise, locale, status) *including the original*), `Tag` + `TagFollow`, and `ExerciseRequirement` + `ExerciseRequirementVote`.

The uniqueness rule has real history: it started as `unique_together('exercise','locale','status')`, which was *broader* than the
Meta comment claimed and produced three deterministic 500s. It is now a **partial unique constraint** — at most one *published* row
per (exercise, locale) — with multiple pending/rejected rows explicitly legal.

`ExerciseViewSet` carries filtering (`?topic=&difficulty=&source_type=&q=&tag=&sort=`), `?lang=` resolution with fallback to
`original_locale`, `random/` (a list-level action registered *before* the `{pk}` route; prefer-unseen then weighted-roulette by
topic affinity), `bulk/?ids=` (built to kill a 115-request frontend N+1), plus `translations/`, `reviews/`, `comments/`,
`requirements/`. `TagViewSet.apply/` attaches or (DELETE with a body) removes a tag on an exercise or material.

Two bugs worth remembering, both data-correctness rather than cosmetic: `ExerciseDetailSerializer` cached its resolved translation
on `self`, which DRF's `ListSerializer` shares across every row under `many=True`; and `markdown-it` silently ate `\[`/`\]` as
CommonMark escapes (see §3.5).

### `materials` — files, coverage claims, weighted votes
Models: `Material` (+ `MaterialTranslation`), `MaterialType` (+ translation — the type list became **data**, not a hardcoded enum),
`MaterialReview`, `MaterialRequirement` (+ vote), `MaterialView`, `MaterialCoverage` (+ vote). `Material` carries `author`,
`source_url` (§2.5), optional `price_amount`/`price_currency` (a curated 4-value list, display-only — no payment processing exists
anywhere) and `estimated_minutes`.

`MaterialCoverage` is the interesting one: any authenticated user may *claim* "this material covers topic X at level Y", and the
community votes it up or down, with a `is_verified_contributor` vote counting **double**. Deliberately not moderation-gated —
additive, reversible, low-stakes organizational metadata, corrected by voting rather than gatekept up front. Requirements by
contrast are governor-only to edit (`PUT /materials/{id}/requirements/`, a full ordered replace inside `transaction.atomic()`),
because they read as structural claims about the material rather than community opinion.

`materials/validators.py` + `materialfile.py` hold upload validation and the ClamAV seam (§2.5); `services.py` holds the
recommendation helpers and the duplicate-label guard shared by both requirement write paths.

### `community` — reviews and threaded comments
`Review` (1–5 stars + optional body, unique per (exercise, author), resubmitting **updates** rather than duplicating) and `Comment`
(a `GenericForeignKey` target + self-FK `parent`, so one model threads discussion under exercises, materials, coverage claims,
courses, lessons and chapters). Deletion is a **tombstone** (`is_removed`), never a hard delete, so thread structure survives; the
serializer blanks `body`/`author_display_name` on a removed row.

One real gap closed late: nothing validated that a submitted `parent` belonged to the *same* target, so a client could reply into a
different object's thread. Now checked in the view (not the serializer — `content_type`/`object_id` aren't in client data yet at
validation time), in both the exercise and coverage endpoints.

### `moderation` — the queue, the scoped role, and the kill switches
Models: `ExerciseSubmission` (a JSON `payload` draft), `EditSuggestion`, `MaterialSubmission` (real typed fields + a file),
`Report`, `ContentView` (the viewer pool auto-hide divides by), `NodeGovernor`, `FeatureFlag`.

- **Moderator** = `is_staff`. **Node governor** = a `NodeGovernor` grant (a `GenericForeignKey` to a Discipline *or* a Branch);
  a Discipline grant cascades to every Branch under it. `governed_branch_ids()` returns `None` for global staff (meaning "don't
  filter") versus a real, possibly-empty `set` for a governor — collapsing that distinction would make a zero-grant governor
  indistinguishable from staff at the query layer. Both a queryset filter *and* an object-level check exist, because single-object
  actions arrive by URL pk and never run the list query.
- **Auto-hide** fires at ≥3 distinct reports **and** ≥20 % of the viewer pool. Both, not either.
- **Idempotency:** every decision claims its row with one `filter(pk=…, status='pending').update(...)`; a simultaneous second
  decision affects 0 rows and gets a clean **409**. This replaced a `select_for_update()`/`atomic()` attempt that made things
  *worse* on SQLite (no row locking; whole-block write lock → `database is locked`). Submission approval additionally retries
  number allocation on a `(branch, number)` collision.
- **`FeatureFlag`** is the kill-switch table (tutoring, messaging, courses, events, …), seeded on, gating reads as well as writes,
  `is_staff`-bypassed. Killing a feature must also remove every **link** to it, not just the pages.
- `build_report_queue` was rewritten from O(4·N) per-report queries to a fixed handful of bulk ones (820 queries / 1452 ms → 13 /
  ~69 ms at ~200 groups), verified by diffing against the pre-edit implementation on live data rather than by re-measuring alone.
  It and `build_moderation_queue_payload` are shared by the real view and the measurement command — one code path only.

### `study` — "My Set"
`ExerciseSet` + `ExerciseSetItem` (a `through` model carrying `order`, which needed an explicit serializer `update()` since DRF's
default M2M handling would reset it). Guests keep their set in `localStorage`; registered users persist named sets server-side.
`retrieve` is the one `AllowAny` action on an otherwise fully owner-scoped viewset — that is the sharing feature: the set's numeric
id *is* the share link. Every write stays `owner=request.user`-scoped, so a non-owner gets a 404.

### `accounts` — identity, profile, avatars, throttles
`Profile` (display name, avatar, locale, `is_verified_contributor`, privacy flag, `notify_on_*` categories, a
`muted_notification_types` list, `time_format`, `week_starts_on`, tutoring opt-in), `DonationLink`, and the profile extras
`ExperienceEntry`, `SkillEntry` (whose `evidence: registry` is **not** self-assignable — the serializer downgrades it),
`Certificate`.

`accounts/avatar.py` + shared `backend/imaging.py`: an uploaded avatar's bytes are **never stored**. Four checks in order — byte cap
(5 MB), libmagic sniff, a *declared-dimensions* pixel cap checked before any decode (a 140 KB PNG declaring 12000×12000 is a real
decompression-bomb DoS that passes a byte cap), then decode / EXIF-transpose / centre-crop / re-encode to WebP. Re-encoding beats
sniffing because it defeats polyglots, and it strips EXIF — a *privacy* fix as much as a security one (phone photos carry GPS).

`accounts/throttles.py`: login is throttled **twice** — per-IP, and per-submitted-identifier (normalized then SHA-256'd, so the
cache holds digests rather than everyone's email). Neither subsumes the other: IP throttling is useless against distributed
credential stuffing, identifier throttling is itself a DoS lever, so the per-identifier rate is deliberately looser. Scoped rates
also on register, password-reset, avatar, geocode. DRF counts *requests*, not failures, so a real lockout doesn't exist.

### `notifications` — one creation path, three gates, SSE delivery
`Notification` is deliberately **denormalized**: `target_label` is captured at creation time rather than resolved through a
`GenericForeignKey`, plus nullable FKs to the things with a real page to open (`exercise`, `material`, `taught_course`, `event`).
No clustering — a plain reverse-chronological list, flagged as considered rather than forgotten.

`services.notify()` is the **only** place a row is created, so three guards can't be bypassed: `recipient=None` no-ops (the 742
migrated exercises have no submitter), `actor == recipient` no-ops, and the preference gate means a muted category means the row is
**never created**, not hidden client-side. On top sit `muted_notification_types` (per-type) and per-tag / per-course mutes.
`NOTIFICATION_TYPES` is derived *from* the gating dict so a type can't be registered in one place only.

Delivery is **SSE**, not Channels — `GET /api/notifications/stream/?token=…`, a raw `StreamingHttpResponse` from a plain `APIView`.
The token is in the query string because `EventSource` **cannot set headers at all**; mitigated by wiring
`QueryParamTokenAuthentication` onto this one view only, with the better fix (a short-lived ticket) named in the code.
`EventStreamRenderer` exists purely to satisfy DRF content negotiation — without it, `Accept: text/event-stream` got a **406**
before `get()` ever ran (invisible to `curl`, which sends `*/*`). `redisbus.py` swaps polling for real pub/sub when Redis is on.

### `services` — tutoring listings and OSM locations
`Service` (provider, title, description, branches, rate + currency — display-only, `is_active`, `delivery_mode`, coordinates +
label, `availability_mode`, `session_minutes`), `ServiceReview`, `ServiceWatch`.

`delivery_mode` is one choice field (`online`/`in_person`/`hybrid`), not two booleans — two booleans make "attendable by nobody"
representable. **Hybrid matches both filters**, not neither. Mode and location are kept consistent in *both* directions: an
in-person listing without coordinates is rejected, and switching back to online **clears** the pin rather than ignoring it (a stale
pin renders a map for somewhere the tutoring no longer happens, which is worse than nothing).

`geocoding.py` proxies **Nominatim** server-side rather than from the browser, for three concrete reasons: the policy requires an
identifying `User-Agent` (a browser `fetch()` cannot set one); it caps the *whole application* at 1 req/s (unenforceable
per-browser — `cache.add` is the atomic mutex, with a bounded wait-and-retry, because "search then nudge the pin" is two lookups
under a second apart); and it asks for caching, which only helps if shared. Uses `urllib.request`, not `requests`. Attribution
travels *with* the data so the two can't drift. `?near=` filters in two stages — a bounding box in SQL (no GIS extension on
SQLite), then an exact haversine pass, because a box is not a circle and returns corner results up to ~41 % too far.

### `messaging` — a thin wrapper over django-postman
**No models of its own.** `MessageViewSet` is a plain `GenericViewSet` over postman's `Message` and `pm_write()`, with
`?folder=inbox|sent|archives|trash`, retrieve-marks-read, `reply/`, `thread/`, `unread-count/`. django-postman ships no *reply*
API (only Django form classes), so `services.reply_to_message()` replicates its thread-linking sequence read from the installed
package's own source: the first reply promotes the parent into being its own thread root, later ones inherit the `thread_id`.
Recipient is "whoever isn't the current replier", not unconditionally the original sender. Auto-moderation off, notifications
skipped (no mail backend). A third party gets **404**, matching the queryset-scoping convention.

### `identity` — sign-in provider drafts and the USOS ground
Models: `School` (23 seeded institutions with `email_domains`, a grade scale, a `usos_base_url` where one exists — a *blank* URL is
a statement, not missing data), `GradeScale`, `Verification`, `StudentStatus`, `EducationProfile`, `Diploma`, `CourseGrade`.

`providers.py` defines four sign-in providers (School/SAML, Google/OIDC, Apple, GitHub) as **honest drafts**: the endpoints and
scopes are real, there is **no mock handshake anywhere**, and a test pins that no provider endpoint can authenticate anybody.
`blockers_for()` computes "what's missing" from `settings.EDMAT_OAUTH_CLIENTS`, so configuring a real client is what stops the UI
calling it a draft — no copy to remember to edit.

`usos.py` encodes what actually blocks a real USOS connection, which is not code: credentials are issued **per institution**, by
that institution, after a human approves — twelve universities is twelve registrations. It is OAuth **1.0a** (three legs), scopes
are granular, and installations differ so capabilities are probed. `active_connector()` is the one line a real client replaces; the
default verifies nobody, and `MockUsosConnector` (behind `EDMAT_USOS_MOCK`) exists so the seam is exercised by tests. **There is
deliberately no access-token column** — a token to somebody's academic record does not belong in an unencrypted SQLite file.

`standing.py` implements one term of the LAUNCHCHECKLIST §3 formula — the verification **ceiling**: a ceiling on *capability*,
never authority; fully itemised (`reasons` is the whole computation); unearnable by typing (an institutional email counts for
nothing, because there is no confirmation flow); and never dependent on publishing. Education sharing is three flags, all starting
`False` — importing publishes nothing, and `weighted_average` refuses to mix grade scales rather than inventing a mapping.

### `courses` — user-run courses (the largest app)
Models: `Course`, `Lesson`, `Enrollment`, `CourseStaff`, `Chapter`, `CourseItem`, `CourseInvite`, `CourseNote`, `Attachment`,
`AttachmentReview`, `LessonReview`, `ChapterReview`, `LessonExerciseSet`, `LessonSetExercise`, `LessonProgress`.

- `status` is one field (`draft → open → running → finished`), not booleans. **A draft is invisible to everyone but its
  instructor**, by queryset filtering, so it's absent from every listing for free and a stranger gets a 404.
- `enrollment_policy` is `open`/`approval`; `capacity = 0` is uncapped. `enrollment_block_reason()` returns *why* someone can't
  join — "full" and "you were removed" are the same boolean and completely different sentences. The cap is enforced on **both** the
  join path and the approve path. `Enrollment.status` has five values, and the three endings are separate on purpose: **left** may
  re-join, **removed** may not, **declined** is a decision rather than an absence.
- `CourseStaff` gives three roles (`assistant` curates, `admin` also changes the course and its staff, `owner` can delete). The
  owner row is **real data**, created in `Course.save()` — putting it in `perform_create` broke 16 tests, the honest signal that
  it's a model invariant (seed commands, fixtures and the admin create courses too). The owner can never be demoted through the
  API; promoting a participant retires their enrolment so nobody occupies two seats.
- `CourseItem` is one model for two jobs — staff filing content and a participant offering it for review — differing only in the
  starting `status`. `contribution_policy` defaults to `approval`, the only value safe to pick on somebody's behalf. Content is
  **referenced, never copied**. A pending item is visible to staff *and its own submitter*; every staff member is notified.
- `Chapter` carries the time gate (`unlocks_at`) — one decision about a group of things. A locked chapter **still renders** while
  its contents don't; deleting one keeps its content, unfiled.
- `CourseInvite` is addressed by token, bypasses the approval queue but **never** the capacity (incremented under
  `select_for_update`), is readable logged-out and `noindex`, and revocation is a timestamp rather than a delete. `owner` is
  deliberately not an invite role — transferring a course is a decision about a named person, not something left in a URL.
- Lessons: title/description public, `participant_notes` blanked (not omitted) for non-participants, and a *pending* request does
  not unlock them. `search.py` does in-course search with snippets; `reports.py` scopes reporting to a course.

### `booking` — availability arithmetic and sessions
Models: `AvailabilityRule` (the repeating weekly pattern), `AvailabilityException` (`block` and `open` — two kinds, not an
`is_blocked` boolean, because "and also this Saturday" is unsayable with blocks alone), `ScheduleWindow`, `WeekTemplate`,
`WeekSchedule` (+ their window children), `Booking`.

- **The decision everything follows from:** `Service.availability_mode` is `derived` (published hours *minus* what's taken) or
  `declared` (a fixed window that keeps showing whole). Two different promises, both stated in words on screen — including the good
  one, because a notice that only appears when something is qualified teaches people to distrust its absence. Default `derived`.
- **Both modes require the tutor's confirmation.** The mode changes what is *shown* and *refused*, never *who decides* — which is
  what stops `declared` being a hole. Both semantics fall out of one function, `is_offered_slot()`, deliberately the same one the
  browse endpoint uses, so a student can't craft a POST for 03:00 either.
- A **requested** booking already holds a derived slot — first-asker holds it until answered (no expiry; the cost is named). Rules
  belong to the **tutor**, optionally narrowed to one listing, and busy time is always computed **tutor-wide**, or an hour booked
  through the physics listing would still be offered through the maths one.
- `Booking.ends_at` is stored, not derived from the current `session_minutes` — changing your session length must not retroactively
  lengthen appointments already agreed. Five statuses: `declined` (the tutor's answer) is distinct from `cancelled` (either party
  walking away, with `cancelled_by`). `complete` is refused before the session ends and is never automatic.
- **`WeekSchedule` replaces the pattern for one week, totally** — a detached week with no windows publishes nothing, because that's
  what clearing it meant. Exceptions still apply on top of *both* sources, which is why the branch lives in one function and
  everything downstream is blind to which arm it took. The stored week key is always Monday-based whatever the viewer prefers.
- Also serves `GET /api/services/{id}/availability/` (public, the student's view) and `GET /api/my-schedule/` (the tutor's own week
  across every listing). The two deliberately **disagree** about a hosted event's hour: my-schedule never subtracts.

### `events` — one-off happenings
Models: `Event`, `EventAttendance`, `EventPost`, `EventPostLink`. Deliberately neither a course (no roster lifecycle, chapters,
staff) nor a booking (published first, answered by *many*, nobody approves anybody) — written out in the module docstring.

- `status`: draft / published / **cancelled** — a state, not a deletion, because people arranged their week around it. A cancelled
  event leaves the *browse* list but stays reachable at its own URL and in the lists of the people it concerns.
- A start instant **plus a duration**, not two datetimes (an end before a start is then unrepresentable); `location_kind` is
  validated in `clean()` so the admin and seed commands are held to it too. `EventAttendance` stores "no" as a real row — it
  returns the seat correctly, and "answered no" ≠ "never answered". The host does not attend their own event.
- **Hosting** removes the hour from a `derived` listing's bookable time; **attending** does not — attending is a statement you can
  take back with one click, and treating it as a withdrawal would silently cost tutors income on every 200-person lecture. The
  clash is *shown* instead, with a one-click "keep these hours free" that writes a real `AvailabilityException`.
- `EventPost` is a dated broadcast from the host, explicitly not the description (undated, read by someone deciding whether to come)
  and not a `Comment` (a conversation, opposite direction). Pictures are re-encoded but bounded by longest edge rather than
  centre-cropped — a whiteboard/slide/poster is exactly what a centre-crop destroys. `PostLinksField` accepts three shapes, because
  a post is multipart with a picture and JSON without; the repeated-form-key case needed a `get_value` override, since DRF reads
  only the last value of a repeated QueryDict key.

### `telemetry` — request logging and audit
`RequestLog`, `AuditEvent`, `middleware.py`, `routers.py` (`LogShardRouter`), `checks.py`. Logs are written to **separate SQLite
databases** (`logs_*` shards under `backend/logdata/`, sized by `EDMAT_LOG_SHARD_SIZE`/`COUNT`), with an anonymous shard
(`logs_anon`) kept apart — query strings are redacted, because a search term is the visitor's content. That anonymous shard is what
`manage.py preload_cache` reads to decide which URLs to warm.

## 2.3 API surface (shape, not exhaustive)

Everything is mounted under `/api/`. Standalone paths cover auth (`register/login/logout/me/me-avatar/password-reset/providers`),
`users/{id}/` + `activity|extras|reviews`, `moderation/queue/`, `taxonomy/propose/`, `notifications/stream/`, `geocode/`,
`services/{id}/availability/`, `my-schedule/`, `schools/`, `education/*`, and `course-invites/<token>/` + `/accept/`.
Routers register: `disciplines`, `branches`, `exercises`, `exercise-requirements`,
`exercise-submissions`, `edit-suggestions`, `tags`, `comments`, `reviews`, `materials`, `material-types`, `material-reviews`,
`material-coverage`, `material-requirements`, `material-submissions`, `exercise-sets`, `notifications`, `donation-links`,
`me/experience`, `me/skills`, `me/certificates`, `services`, `service-reviews`, `service-watches`, `messages`, `courses`,
`bookings`, `availability-rules`, `week-templates`, `week-schedules`, `events`, `reports`, `feature-flags`,
`moderation/governors`.

**Conventions throughout:** public GET / owner-scoped writes; a non-owner gets **404** (queryset scoping), a wrong-party-but-real
participant **403**, a wrong-status transition **409**; Discipline/Branch ids are **slugs** and everything else the numeric pk as a
string; `?lang=` resolves a translation and falls back to `original_locale`.

## 2.4 Cross-cutting: content rendering, sanitization, translation

- Content is **Markdown with literal LaTeX delimiters and raw HTML passthrough**, chosen precisely so the 740-exercise corpus
  migrated byte-for-byte with **zero content rewriting** — the existing `<p>…</p>` + `\(…\)` bodies are already valid CommonMark
  input. New submissions can just write plain paragraphs.
- Write side: `config/sanitize.py` (bleach, allowlist matching what the frontend parser needs). Read side: DOMPurify. Both, always —
  the API is a second, independent entry point.
- Translation resolution lives in `config/i18n_utils.py` and is used by every translated serializer, so the fallback behaviour is
  defined once.

## 2.5 Cross-cutting: uploads
Two safety layers, kept honest about which is which:
1. **Content-type verification, always on.** `python-magic` sniffs the leading bytes against a per-extension whitelist — never the
   filename or the browser-supplied `Content-Type`, both of which the uploader controls (`.docx`/`.doc` legitimately sniff as zip /
   OLE2; a real Windows PE renamed `.pdf` is rejected). Plus a 25 MB cap.
2. **Malware scanning, pluggable and honestly optional.** `scan_for_malware` tries a ClamAV daemon (unix socket, then TCP) and
   returns a `ScanOutcome` dataclass, never a bare bool — this environment has no daemon, so `scanned=False` is the honest common
   outcome. `MATERIAL_SCAN_REQUIRED=True` is what a real deployment flips to make "couldn't scan" a hard rejection.

Stored filenames are a random UUID hex plus the validated extension — the original filename is untrusted input (traversal
characters, `invoice.pdf.exe`, collisions). Avatars and event-post images go further and are fully re-encoded (§2.2).

**Provenance:** `Material` and `MaterialSubmission` carry `author` (who wrote it) and `source_url` (where it came from) — genuinely
distinct, both optional, both surfaced to the moderator *at the approve/reject click*, because that is where the judgment happens
and the uploader is the only person who ever knows. Nothing verifies the URL resolves; it's a declaration for a human to weigh. The
7 legacy materials are correctly blank rather than backfilled with invented provenance.

## 2.6 Cross-cutting: Redis (optional), caching, throttling
One env var, three behaviours. **`EDMAT_REDIS_URL` unset** — a bare clone, `setup.sh`, the test suite — keeps the file/LocMem cache
and the DB-polling SSE path. **Set**, it:

- moves Django's cache to the built-in Redis backend, making the auth throttle counters correct across workers (the per-process
  caveat that had stood since the throttles were added);
- makes `config/cachemw.py`'s **anonymous-read response cache** genuinely shared. The admission policy is the owner's, verbatim: an
  anonymous GET on a positive-list prefix is only *stored* after its exact URL has missed twice, and the bar rises to 7 once the
  current minute's anonymous traffic passes 120 rpm. TTL 60 s; writes never invalidate (a stated trade). The gates are about **who
  asks** — any `Authorization` header or session cookie disqualifies in both directions, a `Set-Cookie` response is never stored,
  and **exercise detail is carved out** because `retrieve()` records the `ContentView` rows auto-hide divides by, so a cache hit
  would silently stop counting anonymous readers. `X-EdMat-Cache: miss/stored/hit/skip` makes every decision observable.
- turns notification delivery into **pub/sub push** (`notifications/redisbus.py`): an idle stream blocks on the subscribe socket
  with zero queries instead of polling every 3 s per connection — against the real vhost's 8 WSGI slots, eight idle tabs used to
  occupy every one. Subscribe-first-then-drain plus an `id <= last_id` guard closes the snapshot/subscription race. Two streams per
  account, Redis-counted with a TTL leak guard, fail-open if Redis dies; a third tab gets a 429, which `EventSource` treats as
  terminal.

`manage.py preload_cache` warms the taxonomy base set plus the top-N anonymous GET paths from the telemetry anon shard, through the
full middleware stack, seated bypassing admission. Query strings are never replayed.

## 2.7 Management commands worth knowing

`import_legacy_corpus` (the one-shot corpus migration — idempotent by natural key; keyed on the material's *directory name* after
two real materials were found sharing a copy-pasted `id:`), `seed_demo_users`, `seed_demo_content` (four people with real
histories, reviews with text, threaded comments, three courses, one pending request, one draft — because an empty app is genuinely
hard to judge), `dump_text_fields` (feeds the KaTeX checker), `seed_moderation_load_test` + `measure_moderation_queue`
(manifest-tracked seeding and `CaptureQueriesContext` measurement, kept as permanent re-runnable tools), `preload_cache`.

---

# 3. Frontend — SvelteKit + Svelte 5 (`frontend/`)

## 3.1 Stack

**SvelteKit 2.63**, **Svelte 5.56 in runes mode** (forced in `svelte.config.js`), **TypeScript 6**, **Vite 8**, **SCSS** (`sass`).
Runtime deps are deliberately few: `katex`, `markdown-it`, `dompurify` + `isomorphic-dompurify`, `leaflet`, `svelte-easy-crop`.
Dev/tooling: `@inlang/paraglide-js`, `adapter-static`, `eslint` + `eslint-plugin-svelte` + `prettier`, `svelte-check`, `tsx`,
`playwright-core`, `axe-core`.

**`adapter-static` in SPA fallback mode** (`fallback: '200.html'`) — a deliberate *non*-change. The original plan expected switching
to `adapter-node` once a real backend existed, but nothing needs SSR or a server `load`: every request originates client-side
against a separate-origin API. (The config comment calling this "Phase 1 only" is stale.)

## 3.2 The layer boundary — the single most load-bearing architectural rule
```
routes/ + lib/components/   →   lib/services/*.ts   →   lib/api/client.ts + mappers.ts   →   Django
        (never fetch)            (the only seam)          (the only fetch())
```

Components and routes talk **only** to `src/lib/services/*.ts`; no component contains inline fetch logic. This is what made the
Phase-1-mock → Phase-3-real-API swap cost **zero** route or component changes except two unavoidable ones (login/register
`handleSubmit` becoming `async`).

- **`client.ts`** — the one `fetch()` wrapper: `PUBLIC_API_BASE_URL` prefix, `Authorization: Token …` injection, JSON
  (de)serialization, and a real `ApiError` carrying the parsed DRF error body so callers can branch on *which* field failed.
  `get/post/patch/put/delete` (delete takes an optional body — needed by tag removal) plus `postForm` for multipart, where it must
  **not** set `Content-Type` so the browser can generate its own boundary.
- **`mappers.ts`** — one raw-JSON → TS function per domain type. **Id convention:** Discipline/Branch ids stay the backend slug,
  everything else is the numeric pk via `String(n)`, opaque outside this directory.
- **`lib/services/*.ts`** — 23 files, roughly one per backend app (`tutoring.ts` deliberately not `services.ts`, a self-referential
  path). **`lib/types/`** — 22 modules + a barrel. **`lib/utils/`** — `renderContent.ts` (§3.5), `labels.ts` (hand-mirrored small
  enums, each flagged in-file as the drift risk it is), `datetime.ts` (outside the rune module because
  `svelte/prefer-svelte-reactivity` refuses a mutable `Date` there), `commentTree`, `coverage`, `taxonomy`, `format`, `textInput`.
- **`lib/content/`** — the deliberate exception to the message-catalog rule: `privacy.ts` and `levels.ts` hold long-form documents
  per locale in one file, because a document must be reviewable *as a document*, not as 50 keys interleaved with button labels. The
  rule's actual purpose (nothing is ever English-only) still holds — both locales live in the one file.

## 3.3 Global state — rune modules (`lib/state/*.svelte.ts`)
18 modules. The notable ones, and why they're split the way they are:

- **`token.svelte.ts`** — the raw auth token, deliberately separate from `auth.svelte.ts`: `client.ts` must *read* it while
  `auth.svelte.ts` must *write* it and itself calls the client — a genuine circular import otherwise. Persisted to `localStorage`,
  so login survives a reload.
- **`auth.svelte.ts`** — real login/register/logout plus an `init()` hydrating from a persisted token at app start. Exposes
  `canModerate` (`isModerator || isNodeGovernor`) as the single frontend gate.
- **`notifications.svelte.ts`** — deliberately does **not** import `authStore` (same cycle reasoning); each call site guards itself.
  Opens the SSE connection from inside `refresh()` rather than making all three call sites remember, and `clear()` closes it on
  logout — otherwise a stream authenticated as the previous account keeps running.
- Plus `theme`, `displayPrefs` (12h/24h, Monday/Sunday — read directly by the components that draw a clock, while the pure geometry
  in `calendar.ts` takes `weekStartsOn` as a *parameter*), `locale`, `guestSet`, `browsingHistory` (seen ids + topic affinity,
  feeding the random-exercise weighting), `tagFollows`, `messages` (unread count, deliberately with no SSE), `featureFlags`,
  `taxonomy`, `materialTypes`, `materialsUi`, `moderationQueue`, `saveTargets`, `cachedList` + `offlineCache`.

A recurring `$effect` hazard, documented because it has bitten at least four times: `$effect(() => load(page.params.id!))` re-fires
on unrelated state changes with no navigation at all, so every dynamic route uses an **id-changed idempotency guard**. The
mirror-image bug is gating an initial load in `onMount`, which reads `authStore.isAuthenticated` exactly once — possibly before an
async `init()` resolves. The correct shape is an `$effect` keyed on that flag with a `loadedOnce` guard.

## 3.4 Routes and components
42 route pages under `src/routes/`, 95 components under `src/lib/components/` in 17 folders (`shared` 24, `course` 11, `material` 9,
`layout` 6, `profile` 6, `booking` 5, `event`/`exercise`/`service`/`settings` 4 each, `discussion` 3, …).

Routes cover the five-tab homepage (`?tab=` so reload/back/sharing all work, with real ARIA tab semantics including roving tabindex
and arrow keys), taxonomy browse (`/disciplines`, `/disciplines/[d]`, `/branches/[b]`), `/exercises/[id]`, `/materials` + `/[id]`,
`/my-set` and `/sets/[id]` (a shared set), `/submit` + `/submit-material`, `/search`, the `/courses` family (`new`, `mine`, `[id]`
+ `edit`/`manage`/`attachments/[a]`, `join/[token]`), `/services` (+ `new`, `[id]`, `watchlist`), `/bookings`, the `/events`
family, `/messages` (+ `new`, `[id]`), `/notifications`, `/users/[id]`, `/settings` + `/settings/profile`, `/moderation`,
`/levels`, `/privacy`, `/login`, `/register`.

Notable shared components: `MathContent`/`MathTitle`, `TagChip` (the hover menu: follow / notify / save-for-later / apply elsewhere
/ remove), `Popover` (the extracted open-Escape-click-outside-restore-focus primitive; `MeatballsMenu` deliberately keeps its own
copy — it works, is used in a dozen places, and rewriting it is real risk for no user-visible payoff, so the duplication is flagged
in both files), `ModalShell`, `FeatureGate`, `ReportButton`/`ReportModal`, `Tabs`, `TaxonomyOptions`, `StarRating`,
`VerifiedBadge`, `StaleRow`, `NewSinceNotice`.

The **navbar** (`layout/Header.svelte`) is the most intricate component: three groups (browse links, one "Add…" menu, one account
menu) that **collapse in stages** as the viewport narrows — Events → calendar icon at 1180px, account trigger → avatar at 1120px,
Materials at 1060px, Tutoring at 1000px, Add… → a bare plus at 950px, Disciplines → a search icon at 900px, the logo at 850px, the
language picker into the account menu at 800px (**a guest's stays visible** — the one control someone may need before they can read
anything must not hide behind a menu labelled in a language they can't read), Courses at 760px, the phone drawer at 720px. Bar
height/padding/gaps shrink as a linear function of width via `clamp()` with a `vw` middle term. On a phone the bar tucks away on
scroll down and returns on scroll up, and **the menu button is rendered outside `<header>`** so it survives the bar hiding. Item
lists are single-sourced snippets rendered into both the desktop popovers and the drawer, so a feature flag can't hide an entry in
one and leave it in the other. The drawer traps focus (a keydown cycle, not `inert`), locks background scroll, closes on route
change including the back button, and is moved off-canvas with `visibility: hidden` rather than unmounted — a translated element is
still focusable, so a hidden drawer of reachable links is a keyboard trap.

## 3.5 Content rendering — the pipeline order is the whole point

`lib/utils/renderContent.ts` does **not** run "Markdown → HTML → typeset math over the result". It:

1. extracts and **KaTeX-renders every `\(…\)` / `\[…\]` segment first**, stashing each behind an inert placeholder token;
2. runs the *remaining* text through `markdown-it`;
3. splices the real KaTeX HTML back over the placeholders;
4. **then** sanitizes (DOMPurify).

Because CommonMark treats `\[`, `\]`, `\(`, `\)` as escaped punctuation the instant that text is parsed as an ordinary paragraph
rather than passed through as a raw HTML block — so display math sitting as bare text *between* two `<p>` blocks (which a real chunk
of the corpus does) had its backslashes silently stripped while the inner `\mathbb`, `\to` survived, producing inert
`[ f:\mathbb{R}^n\to\mathbb{R} ]`. It shipped past svelte-check, eslint, a production build and 19 Playwright checks and was found
by a real user. Extracting math first makes the `<p>`-or-not question irrelevant.

A second, related trap: `renderContent.ts` used to return **raw, unsanitized HTML whenever `window` was undefined** (the SSR
bypass) — closed in the security pass.

## 3.6 i18n

Paraglide/inlang, scaffold copied verbatim from the sibling `2donet` project: `baseLocale: 'en'`, `locales: ['en','pl']`,
catalogs at `frontend/messages/{en,pl}.json` (**1500 lines / ~1000+ keys each**, verified key-set-identical programmatically).

**Standing rule:** no component contains a literal user-facing string, and any new or changed string is added to **both** catalogs
in the same change — a key with no Polish counterpart is an incomplete change, not a follow-up. Call sites carry a trailing
`// "Original text"` comment so a reader sees what renders without opening the catalog.

**Interface language and content language are two independent axes** — someone reading the English UI may deliberately want the
original Polish statement. UI strings are a small curated catalog; exercise translations are unbounded, community-submitted,
moderator-reviewed rows with their own picker.

**Note:** Paraglide here has **no URL strategy configured** — `/pl/...` is not a locale URL; the language is chosen through the
picker. Several e2e scripts learned this the hard way.

## 3.7 Theming

Light / dark / system via a token bridge: `_tokens.scss` defines light/dark variable pairs, `_theme.scss` is the only file that
reads them and re-exposes everything as CSS custom properties, swapped by a `data-theme` attribute, with a no-flash inline script in
`app.html`. Pattern carried over wholesale from `personalizacja_edukacji` rather than redesigned.

## 3.8 Tooling and tests
- `npm run check` (svelte-check), `lint` (prettier + eslint), `build`, `format`.
- **`check:katex`** — `scripts/check_katex_compatibility.ts` imports the **real** `renderContent.ts` (not a re-implementation) and
  scans every row dumped by `manage.py dump_text_fields` for a `.katex-error` element or a surviving literal delimiter. It strips
  `<annotation>` content first, because KaTeX echoes the raw TeX back into the DOM and the corpus's legitimate `\\[2mm]` syntax
  contains `\[` as a substring. Across the full 756-row corpus: **0 real issues**, confirmed statically and in a live browser.
- **`check:a11y`** — `scripts/check_accessibility.ts` drives headless Chromium and injects **axe-core** against the live DOM,
  anonymous and authenticated, across 13 pages — including the exercise page a second time with hint/answer/solution clicked open,
  since progressive reveal keeps that content out of the DOM otherwise. It guards the false-negative that a page failing to render
  trivially "passes": console errors and a body-text floor are hard failures of their own. It found four real violations (a 3.92:1
  contrast token, unlabelled `<nav>` landmarks, an invalid `role="tablist"`, a broken heading order) plus a missing favicon.
- **e2e:** ~21 `.mjs` scripts in `frontend/e2e/` driven by `playwright-core` against real running dev servers (booking, classroom,
  course-*, education-auth, events-and-nav, material-*, navbar-stages, schedule-editing, taxonomy-*, tutoring-*, …). They are
  check-counting scripts, not a framework suite; `test.md` documents each. **There is no CI.**

# 4. Notable root files

## Docs and briefs
| File | What it is |
|---|---|
| **`CLAUDE.md`** (435 KB) | The living blueprint: vision, corpus inventory, data model, phases, then the chronological build log §17A–§17AB, §18 open questions, §19 Polish↔English glossary. Authoritative. |
| **`README.md`** (8 KB) | Public description + the two setup commands. |
| **`LAUNCHCHECKLIST.md`** (47 KB) | Pre-launch blockers and risks, grounded against the real codebase. Also holds the **REP / SKILL / ENERGY** trust-system design that `/levels` explains to readers and `identity/standing.py` implements one term of. |
| **`QA.md`** (28 KB) | An independent QA pass re-verifying `CLAUDE.md`'s claims against the live repo, plus open findings (a clean-clone install check tops the "what I'd do next" list). |
| **`test.md`** (39 KB) | How to run both suites, what each covers, and the traps. |
| **`NAVBAR-BRIEF.md`** (10 KB) | Owner-dictated spec for the staged navbar collapse. The stage order **is** the specification. |
| **`PORTS-BRIEF.md`** (12 KB) | Design-only analysis of porting backend hot paths to Rust/Go/C. Superseded by the Redis work; archived on branch `outdated/port-rust`. |
| **`ENERGY-BRIEF.md`** (7 KB) | Where the real deployment's CPU/watts go, ordered by złoty saved per hour of work. Motivated the SSE/Redis rewrite. |
| **`MARYSIA.md`** | **Deleted (Aug 2026)** — a Polish setup walkthrough. Only the prose is gone; the scripts are unchanged. Recover with `git show c3e852f^:MARYSIA.md`. |
| `LICENSE` | — |

## Scripts and setup

- **`setup.sh`** — one-command install on a bare Ubuntu box: builds `.venv`, installs pip + npm deps, migrates, seeds; four
  variables at the top are the whole config. Two bugs found only by running it on a genuinely clean copy: `python3 -c 'import venv'`
  is **not** a test for `python3-venv` (Ubuntu splits out `ensurepip`), and changing the port silently broke the site because the
  API's CORS allowlist covers the default port only.
- **`run.sh`** — starts backend + frontend. Split from setup on purpose: rebuilding must never kill a running site and starting must
  never rebuild. Passes the chosen origin through and keeps `frontend/.env` in step with the backend port.
- **`requirements.txt`** (root) — a one-line `-r backend/requirements.txt`. **`backend/requirements.txt` is canonical.** The split
  is deliberate rather than sloppy: `deploy/DEPLOYMENT.md` rsyncs only `backend/`, `frontend/` and `deploy/`, so the root file never
  reaches the server, while a fresh local clone must install from the root because that's where `.venv` lives. They had drifted
  badly enough that a clean clone couldn't boot (`No module named 'postman'`); one list now.
- **`scripts/extract_mock_exercises.py`** — legacy: extracted the Phase-1 mock fixtures from the corpus using the generator's own
  parsing logic.

## Deployment (`deploy/`)

- **`DEPLOYMENT.md`** (21 KB) — the webek4 / edmat.net runbook: Part A routine sync, Part B full from-scratch setup.
  **`UPDATE-2026-08-10.md`** — the breaking-upgrade runbook (taxonomy rename etc.), applied 2026-08-10.
  **`apache/edmat.conf`** + **`edmat-stage1-http-only.conf`** — the real vhosts (TLS, and the pre-certificate bootstrap).

Production shape: **Apache + mod_wsgi** on webek4.fuw.edu.pl / edmat.net, `processes=2 threads=4` (8 slots — the number the SSE
rewrite exists to protect), SQLite, the SPA build served statically. Runs as `www-data`, with its own permission traps.

## `FUW/` — **untracked, contains live secrets**

Snapshots and notes from rescuing and upgrading the FUW server. **Holds a real `SECRET_KEY`, a TLS private key, ~15 API tokens and
weak passwords (`FUW/secrets.md`). Never commit it; always sanitise before restoring anything from it.** Contents:
`FUTURE-UPDATES.md` (read-me-first notes for the next update, learned the hard way), `UPDATE-20260810/` plus tarballs (the applied
payload), `rescue.zip` / `rescue-unpacked/`, `webek03.zip`, `logs.txt`, `todonet/`.

## Other
- **`Database-of-Student-Exercise/`** — the retired static-site generator plus the vendored 740-exercise corpus, kept as the
  historical record of what was migrated. Its README and every generated page carry a retirement banner pointing at EdMat, added so
  a rebuild-and-republish (the only publish path that project ever had) still carries the notice.
- **`Archive.zip`, `Database-of-Student-Exercise.zip`** — large legacy archives (~54 MB), not part of the build.
- **`.claude/`** — `settings.local.json`, `settings.json` (`bgIsolation: none` — this project's own convention is to work directly
  in the main checkout rather than spawning one, per the owner's explicit instruction; see below). ~30 stray agent worktrees
  (`navbar-*` variants, `booking-week-schedules`, `lesson-progress`, `redis-preload`, `port-rust`, `save-to-set`, five `agent-*`
  scratch trees, …) accumulated here and were removed 2026-08-13 — 1.4 GB reclaimed. **Removing a worktree only deletes its
  checkout, never its branch or commits**: every `worktree-*`/`agent-*`/`outdated/*` branch this project has ever used still exists
  in git history and (for most of them) on `origin`, confirmed before deleting. Several are genuinely **unmerged**, so branch-local
  docs may still claim section numbers `main` doesn't have — which is why the two navbar sections are numbered §17AA and §17Z in
  that odd order. **Standing convention now:** work in `/home/alojzy/Wymiana_VM/edmat` directly, not in a new worktree per session —
  that's what caused the pileup. A worktree is still the right tool for something genuinely parallel/isolated (several agents
  editing the same files at once); it just shouldn't become the default per-task habit, and should be removed the moment its
  branch is merged or abandoned rather than left to accumulate.
- **`.venv/`** — the single project virtualenv (Python 3.12). Historically duplicated three ways with absolute paths baked in from
  a different machine entirely; consolidated to one, don't recreate them. This sandbox has no `sudo` and no interactive TTY, so it
  was built with `python3 -m venv --without-pip` plus a manual `get-pip.py` bootstrap.
- **`backend/db.sqlite3.bak-*`** — dated pre-migration/pre-merge snapshots. `backend/{cachedata,logdata,media}/` are runtime data.

# 5. History highlights (`CLAUDE.md` §16–§17AB, compressed)
Phases: **0** plan → **1** fully-mocked SvelteKit frontend (38 real stratified fixtures, not synthetic filler) → **2** Django/DRF
backend + the corpus import (3 disciplines, 4 branches, 50 topics, 42 chapters, **742 exercises**, 7 materials) → **3** integration
(every service's internals swapped to real `fetch()`, all mocks deleted, ~zero component changes) → **4** hardening.

Then, roughly in order: **§17A** the random-exercise picker (prefer-unseen, then weighted-roulette by topic affinity, mirrored
server-side); **§17B** notifications, public profiles, privacy settings, donation links, cookie consent; **§17C** expanded material
types + the tag hover-menu; **§17D** the KaTeX sweep (756 rows, twice, zero real issues, permanent tooling); **§17E** the
accessibility audit; **§17F** the moderation-queue load test, which found a real N+1 on *both* sides (820→13 backend queries, a
115-request frontend fan-out collapsed into one `bulk/` call) plus a latent `many=True` serializer caching bug; **§17G–§17L** the
material detail page, real-time SSE, multi-moderator concurrency (a real 500 under simultaneous approvals, and the
`select_for_update()` detour that made it *worse* on SQLite), shared "my set", the translation-publish race, and the first
automated test suite — verified against pre-fix code to prove the tests catch the bugs they claim to; **§17M** node governors
(including a leak where a report action's *response* returned the unscoped queue); **§17N–§17Q** material uploads, requirements +
coverage discussion + price/time, tutoring listings and messaging, then the security follow-through (bleach on the write side, the
SSR sanitization bypass, avatar upload with a real crop and the validation the field had entirely lacked, auth rate limiting,
material provenance); **§17R–§17AB** OSM tutor locations, sign-in provider drafts + the USOS ground, user-run courses, booking
(then week/month calendars, then 24h/Monday defaults as real settings), events + the navbar rebuild + homepage tabs, `/levels`,
event updates, week-by-week schedule editing, the staged navbar collapse, and Redis.

**Recurring lessons the log keeps re-learning:**

1. **`svelte-check` does not catch `bind:value` on `<input type="number">`** — it binds a real `number`, not the `string` the
   surrounding code assumes, and the first live submit throws `.trim is not a function`. Hit at least three times; the fix is
   always `type="text"` + `inputmode`.
2. **Verification not driven in a real browser misses a whole class of bug** — the SSE 406, the crop panel accepting a renamed
   executable, the drawer opening and closing in one frame. Several were found by *looking at a screenshot*, not by an assertion.
3. **SQLite has no row-level locking**, and Django holds a write lock for a whole `atomic()` block. What works is one small
   WHERE-anchored `UPDATE` claiming a row, a bounded retry loop, and a raised `timeout`.
4. **A queryset filter is not a permission check** for anything addressed by pk.
5. **Refusals should carry their reason to the UI.** "Full" and "you were removed" are the same boolean, different sentences.

# 6. Working notes and traps
- **Run locally:** `./setup.sh` once, then `./run.sh`. Backend tests: `../.venv/bin/python3 manage.py test` from `backend/`.
- **`register` is throttled ~10/hour in a per-process cache.** A long e2e session exhausts it, and every later script then fails in
  ways that look exactly like a code regression (a page with no menus, a form that won't submit). Restart the backend to clear it,
  killing it **by the PID holding the port** — `pkill -f "manage.py runserver …"` also matches the shell issuing it and kills the
  replacement.
- **e2e scripts read `E2E_API`;** `test.md` documents `:8011` while several default to `:8000`, so set it explicitly.
- **Editing files while a browser script runs** triggers a Vite HMR reload underneath it and produces fake failures. Long chains of
  page loads can also exhaust Chromium/Vite and time out a navigation — re-run against a fresh dev server.
- **The Vite dev server has a ~3–5 s cold-load cost per fresh browser context**, absent from the production build. Don't chase it.
- **Whole-page text assertions are ambiguous** — one added sentence of copy silently broke a membership check matching the same
  phrase. Scope assertions to a section.
- The canonical checkout is `/home/alojzy/Wymiana_VM/edmat`; keep it at `origin/main` rather than making copies.

# 7. Known gaps / open questions
- **No email backend** (console backend; password reset is an honest always-200 stub) — one gap blocking both password reset and
  any "notify me by email" preference.
- **No CI.** Nothing runs the ~1145 backend tests or the ~21 e2e scripts automatically, and nothing exercises a clean-clone
  install — which is exactly how the requirements files drifted unnoticed.
- **No per-user timezone.** Everything is `TIME_ZONE` (UTC); `time_format`/`week_starts_on` say how a time is *drawn*, not which
  clock it comes from.
- **No failed-attempt lockout** (DRF throttles count requests, not outcomes), and **no shared cache unless Redis is configured**,
  so rates are per-worker without it.
- **No user search anywhere** — granting a governor role, adding course staff, contributing content and composing a message all
  require already knowing a numeric id. The single most-repeated "left open" note in the whole log.
- **Copyright/provenance of the corpus** is still unanswered — the exercises are transcribed from real course material.
- **Real ClamAV was never exercised against a positive detection**; only the "no daemon reachable" branch is live-tested.
- **No moderation/reporting surface** for Service listings, messages, bookings, events or avatars — all genuinely public UGC the
  `Report`/auto-hide system doesn't cover.
- **SSE auth still passes the token in the query string** (an `EventSource` limitation).
- Hosting beyond webek4, locales beyond en/pl (the data model already allows them), and PostgreSQL instead of SQLite are undecided.
