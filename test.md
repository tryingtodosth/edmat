# Testing EdMat

Two suites, deliberately different in kind:

| | What it is | Where | Count |
|---|---|---|---|
| **Backend** | Django's own test runner against a real (throwaway) database | `backend/*/tests.py`, `backend/accounts/test_profile_extras.py` | 458 |
| **Browser** | Playwright driving the real frontend against the real backend | `frontend/e2e/*.mjs` | 100 checks across 3 scripts |

The split is not arbitrary. The Django suite pins **rules** — who may see what, what is refused and
why — because those are the things that fail silently: a broken create flow announces itself
immediately, a roster leaking to strangers does not. The browser scripts pin **what a person
actually experiences**, which is the half no unit test can reach: that the same page renders three
different things to a stranger, a participant and the instructor.

---

## 1. Backend tests

### Running them

```sh
cd backend
../.venv/bin/python3 manage.py test          # everything (~3.5 min)
../.venv/bin/python3 manage.py test classroom  # one app
../.venv/bin/python3 manage.py test classroom.tests.DiscussionTests            # one class
../.venv/bin/python3 manage.py test classroom.tests.DiscussionTests.test_a_public_thread_is_readable_but_not_writable_by_outsiders  # one test
```

Useful flags:

```sh
manage.py test --keepdb      # reuse the test database — much faster on repeat runs
manage.py test --parallel 4  # split across processes
manage.py test -v 2          # name every test as it runs
manage.py test --failfast    # stop at the first failure
```

**Nothing needs to be running first**, and nothing touches `db.sqlite3` — Django creates a separate
test database, applies every migration, and destroys it afterwards.

### One quirk you will hit if you write more of these

Any test that makes an HTTP request must declare the telemetry log-shard databases, or it fails on
Django's cross-database isolation guard rather than on anything you wrote:

```python
class MyApiTests(TestCase):
    databases = set(all_log_shards()) | {'default'}
```

`classroom/tests.py` and `identity/tests.py` both have an `ApiTestCase` base doing exactly that —
inherit from it rather than repeating the line.

### What each app covers

| App | Focus |
|---|---|
| `classroom` (51) | Courses run by users: visibility, enrolment, lessons, discussion, notifications, settings |
| `identity` (36) | Sign-in provider drafts, schools, the USOS seam, consent gating, standing |
| `accounts` profile extras (16) | Experience, skills, the derived activity feed, and the demo-content seed |
| `moderation` | Reports, auto-hide, the queue, node governors, feature-flag kill switches |
| `exercises`, `materials`, `community`, `study`, `services`, `messaging`, `notifications`, `telemetry`, `accounts` | Their own domains |

#### `classroom` in more detail (the newest, and the most rule-heavy)

- **VisibilityTests** — a draft is invisible to everybody but its instructor; a published course is
  public without an account; discovery by subject.
- **EnrolmentTests** — open admits immediately, approval parks the request; the cap holds on *both*
  the joining and the approving path; a closed course refuses; an instructor cannot join their own;
  asking twice does not queue twice; leaving frees the seat and re-joining reuses the row; somebody
  removed cannot walk back in.
- **RosterTests** — the roster is not public; participants see each other, the instructor also sees
  pending requests.
- **LessonTests** — an outsider sees the lesson but not its notes (present but empty, so the response
  shape never changes with the caller); a pending request is not yet a participant.
- **AuthoringTests** — creating is not publishing; the creator becomes the instructor regardless of
  what was posted; somebody else's course cannot be edited; the cap cannot be cut below the people
  already admitted; a course cannot end before it starts.
- **DiscussionTests** — participants-only by default; a public thread is readable but **not writable**
  by outsiders; off means off, including for the instructor; a reply cannot be smuggled in from
  another thread.
- **NotificationTests** — a request reaches the instructor with the note; joining an *open* course
  notifies nobody; every decision reaches the person it is about; a new lesson reaches participants
  but not its own author; **a pending request is never told what is happening inside**.
- **NotificationSettingTests** — each of the three independent switches, on its own: the instructor's
  per-course announcements, the participant's per-course mute, and the account-wide category, plus
  muting one type without the rest.
- **KillSwitchTests** — the feature flag hides the whole surface (401 anonymous, 403 signed in) while
  a moderator keeps access.

---

## 2. Browser tests

These drive a real Chromium against **both servers running**, so they need a little setup. They are
not wired into `npm test` on purpose: they need two processes and a browser binary, and a test suite
that fails because you forgot to start a server teaches you nothing.

### One-time setup

Playwright is deliberately **not** a dependency of this repo — it is needed for these two scripts
and nothing else:

```sh
cd frontend
npx playwright install chromium
```

### Running them

Three terminals. Use ports **8011 / 5183** so the scripts never touch a dev server you have running
on the usual 8000 / 5173.

```sh
# 1 — backend, with the USOS stand-in connector on and the test origin allowed
cd backend
DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:5183 EDMAT_USOS_MOCK=true \
  ../.venv/bin/python3 manage.py runserver 127.0.0.1:8011
```

```sh
# 2 — frontend, pointed at that backend
cd frontend
echo 'PUBLIC_API_BASE_URL=http://127.0.0.1:8011/api' > .env.e2e
npx vite dev --mode e2e --port 5183 --strictPort
```

```sh
# 3 — the scripts
cd frontend
node e2e/classroom.mjs
node e2e/education-auth.mjs
node e2e/material-claims.mjs
```

Each prints one `ok`/`FAIL` line per check, a total, and any console or page errors. Exit code is 0
only when **both** the failures and the error list are empty — a page error is a failure here even if
every assertion passed.

`.env.e2e` is a mode-specific file, so it overrides `.env` **without changing it** — your ordinary
`npm run dev` setup keeps working untouched.

### What they cover

**`e2e/classroom.mjs` (44 checks)** — three people in three separate browser contexts, because the
entire feature is about who is looking:

1. anyone can browse; the nav offers it
2. creating a course leaves it a draft, invisible to everybody else
3. publishing it, with approval required
4. a lesson: public blurb, participant-only notes
5. a student asks to join, and waits
6. the instructor sees the request *with the note*, and approves
7. being in the course is what unlocks the notes and the roster
8. "My courses" splits teaching from taking part
9. leaving gives the seat back and re-locks the notes
10. a full course refuses in its own words, with no join button
11. uncapping is accepted
12. discussion is participants-only by default — a stranger gets no composer
13. the post notification arrives and links back to the course
14. a public thread is readable by anyone, writable only by participants
15. turning discussion off removes it entirely
16. muting one course stops its notifications without leaving it
17. the account-wide notification category and its per-type rows exist

**`e2e/education-auth.mjs` (42 checks)** — the sign-in drafts and the USOS ground: all four providers
offered and labelled drafts, each modal describing its own provider's real quirk and blockers, the
repository link, Escape closing it, the school picker distinguishing a university that runs USOS from
one that does not, **no session created by any of it**, then connect → transfer diploma/grades →
consent one field at a time → un-publish → delete.

**`e2e/material-claims.mjs` (14 checks)** — a material card previews only its top few coverage and
requirement claims (the real corpus has materials with 30), so the "+N more" count beside them is the
only route to the rest from a grid — and it was an inert `<span>`. Pins that it is a real button with
an accessible name, that it opens a modal holding **every** claim rather than only the hidden
remainder, in the same sort order the card established, that drilling into one claim and closing it
returns to the list rather than the card, that two modals are never stacked, and that the whole path
works from the keyboard.

### Two things worth knowing before you debug a failure

- **They talk to a real, persistent database.** Both scripts create their own accounts and use a
  unique course title per run for exactly this reason, but leftovers accumulate. If you want a clean
  slate: stop the backend, delete `backend/db.sqlite3`, then re-run `migrate`,
  `migrate_log_shards`, `import_legacy_corpus` and `seed_demo_users`.
- **Repeated runs will eventually hit `429 Too Many Requests`** on registration — the auth throttle
  (`accounts/throttles.py`) is real and doing its job. The throttle history lives in the process
  cache, so **restarting the backend clears it**. A run that fails with "the panel did not render"
  right after several earlier runs is almost always this, not a regression.

---

## 3. Checking a fresh install

`setup.sh` is the thing a new person runs, so it is worth checking on something that has never been
built before rather than on your own working copy — the failures it is meant to prevent only happen
on a clean machine.

```sh
# a genuinely clean copy of the repository, with no .venv, no node_modules and no database
TREE=$(git write-tree) && mkdir -p /tmp/edmat-fresh
git archive "$TREE" --format=tar | tar -x -C /tmp/edmat-fresh
cd /tmp/edmat-fresh && ./setup.sh && ./run.sh
```

Two bugs this caught that no other check would have:

- **`python3 -c 'import venv'` is not a test for python3-venv.** The `venv` module ships with Python
  itself, so it imports fine on a machine where `python3 -m venv` cannot build a working
  environment. What Ubuntu splits into that package is `ensurepip`, which is what the script now
  looks for.
- **Changing the ports broke the site silently.** `run.sh` invites you to change them, but the API
  only accepts browser requests from origins it knows, and its built-in list covers the default port
  only — so a changed port produced "Something went wrong" with no clue as to why. `run.sh` now
  passes the chosen origin through.

---

## 4. Other checks

```sh
cd frontend
npm run check   # svelte-check — expect 0 errors, 0 warnings
npm run build   # production build; also what regenerates the Paraglide message modules
npm run lint    # prettier + eslint (pre-existing formatting debt in older files)
```

**If `npm run check` reports dozens of "Cannot find module '$lib/paraglide/messages'"**, the message
modules simply have not been generated in this checkout yet. Run `npm run build` (or start
`npm run dev`) once and re-check — those files are generated, and gitignored. The same applies after
adding a message key: build before the new `m.*` accessor type-checks.

```sh
cd backend
../.venv/bin/python3 manage.py check          # system check
../.venv/bin/python3 manage.py makemigrations --check --dry-run   # fails if a model change has no migration
```

---

## 5. Adding tests

- **A rule belongs in the Django suite.** Ask "what would fail silently?" — that is the test worth
  writing. Most of `classroom/tests.py` is refusals rather than happy paths for exactly that reason.
- **An experience belongs in a browser script**, and only when it genuinely depends on the browser:
  who sees what, whether a control appears, whether one page's change shows up on another.
- **Assert on scoped text, not whole pages.** A real failure caught while writing these: the phrase
  "taking part in this course" appeared both in the membership notice and in the new
  discussion notice, so a whole-page match started reporting a member as a non-member. The app was
  right; the assertion was ambiguous. Scope to the section (`.enrol`, `.roster`) instead.
- **Chromium's `innerText` returns *rendered* text**, so a heading styled `text-transform: uppercase`
  reads back uppercase. Match case-insensitively or you are testing the stylesheet.
