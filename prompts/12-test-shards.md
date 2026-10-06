# A. Test shards — make `manage.py test --parallel 4` work — brief for one agent

| | |
|---|---|
| **Model** | Opus 5 (every step runs on Opus, owner decision 2026-10-05) |
| **Branch** | `close/a-test-shards` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/close-a-test-shards/` |
| **Ports** | API `8141`, Vite `5241` (you will barely need them — this step is the backend suite) |
| **Base commit** | `4a57d6d` — there is no prep commit this cycle, `11-closing-design.md` §3 says why |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 (the always-list, in order) and §5 (the rules), then
`prompts/11-closing-design.md` — §4 of it is the file-ownership table and the two files in it that
are **not** yours matter for this step more than for any other.

## The task

The documented way to run the backend suite — `manage.py test --parallel 4 --keepdb`, the
"~9 minutes" that `test.md` and every brief promise — does not work at all, and the serial run that
does work takes about 52 minutes for 2 686 tests and prints tens of thousands of lines of traceback.
Both have the same cause. Fix the cause everywhere it occurs, make the parallel runner report its
failures instead of dying, and leave the suite runnable the way the docs already say it is.

**The cause.** `telemetry/middleware.py` writes a `RequestLog` row for every request, into one of
nine SQLite shards (`telemetry/routers.py: all_log_shards`). Django's test runner forbids a test from
touching a database alias its class did not declare, so any test class that reaches an endpoint
needs

```python
databases = set(all_log_shards()) | {'default'}
```

Serially, the middleware's `except Exception` at `telemetry/middleware.py:111` swallows the
resulting `DatabaseOperationForbidden` and logs a full traceback — once per request, which is the
noise. Under `--parallel` the same thing surfaces as a hard `setUpClass` error, and then the runner
itself dies trying to ship that error back to the parent process:
`TypeError: cannot pickle 'traceback' object`.

Forty test classes already carry the line (`grep -rn "databases = " backend/`); `events/tests.py:33`
is the model, with the docstring that says why it is copied rather than imported. **137 classes in
28 files do not** — the list is below, and the script that produced it is yours to re-run until it
prints zero.

## What "finished" means

- [ ] The script in "Context" prints **`0 classes still unresolved`** on your branch.
- [ ] Where a file has an in-file base class (`shifts/tests.py: RotaTestCase`,
      `plans/tests.py: PlansTestCase`, `galleries/tests.py: GalleryBase`, `accounts/test_avatar.py`'s
      `AvatarTestCase`, `accounts/test_throttling.py`'s `ThrottleTestCase`), the line is on the
      **base**, once, with a one-sentence comment in the shape `events/tests.py:33` uses. Where
      there is none, it is on each class. Do not invent a shared base across apps for this — that is
      the "three strikes" rule (root `CLAUDE.md` house rule 13) applied in the wrong direction: the
      existing forty copies chose repetition on purpose so one app's fixtures cannot break another's.
- [ ] `tblib` is in `backend/requirements.txt` (and the root `requirements.txt` if that is where the
      venv is built from — check which one `setup.sh` reads) and installed in the venv, so that a
      parallel failure is *reported* rather than crashing the runner.
- [ ] `../.venv/bin/python3 manage.py test --parallel 4 --keepdb` **completes** from your worktree,
      and the board entry says the wall-clock time and the test count. If it still fails, the entry
      says on which test and why, and the serial run's number stands beside it.
- [ ] A serial `manage.py test <three apps you touched>` prints **no** `Failed to write a request
      log row` traceback. That line disappearing is the proof the fix is the right one, not just a
      declaration that silences a guard.
- [ ] `test.md` §"Running the suite" (grep for `--parallel`) says what is now true: the parallel
      command, the time it takes on this machine, and the one-line rule for any new test class.
- [ ] **Not yours and left alone:** `backend/events/test_permission_matrix.py` (`PermissionMatrixTests`)
      and `backend/community/test_discussions.py` (`DiscussionEndpointTests`,
      `DiscussionLocationAdminTests`). Steps B and E add the line to those three classes on their own
      branches; your script will keep reporting them as unresolved until integration, and your
      board entry says so by name so the integrator does not think you missed them.
- [ ] `HISTORY.md` has `## 17BT.A …` appended at the very end, with "Verified" (numbers) and "Left
      open". Your `done.md` entry has the commit hash, the parallel wall-clock, the serial
      per-app runs you did, and the three classes you deliberately skipped.

## Context — what you need and where it is

| Need | Where | Why |
|---|---|---|
| The model declaration and its reason | `backend/events/tests.py:33–39` (`ApiTestCase`) | copy its shape and its docstring's argument |
| The shard list | `backend/telemetry/routers.py:39` (`all_log_shards`) | the import every class needs |
| The swallow that makes serial runs noisy | `backend/telemetry/middleware.py:95–115` | read it; do **not** change it — the guard is right, the tests were wrong |
| Why the shards exist at all | `backend/telemetry/routers.py` module docstring; `backend/telemetry/CLAUDE.md` | so your comments say the true reason |
| How the suite is documented | `test.md` — grep `--parallel`, `--keepdb`, `9 min` | the paragraphs that promise what currently does not work |
| What the integrator found | `HISTORY.md` §17BR, the "parallel" paragraph; `todo.md` "Learning cycle — left open", bullet 2 | the symptom list you are closing |
| `tblib` | <https://pypi.org/project/tblib/> — Django's own docs name it under "Running tests in parallel" | so a pickled traceback crosses the process boundary |

**The sweep script.** Run it from `<worktree>/backend` with the venv's python; it resolves
`databases` through in-file inheritance and names only the classes that still need the line. It is
the "finished" check, so put it somewhere `test.md` can point at —
`backend/testing/check_databases_declared.py` is the natural home (the `testing/` package already
holds `personas.py`) — and give it a docstring saying what it is for.

```python
import ast, pathlib
report = {}
for p in sorted(pathlib.Path('.').rglob('test*.py')):
    if 'migrations' in str(p):
        continue
    src = p.read_text()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        continue
    classes = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)}
    def has_db(name, seen=()):
        n = classes.get(name)
        if n is None or name in seen:
            return False
        if any(isinstance(s, ast.Assign) and any(getattr(t, 'id', '') == 'databases' for t in s.targets)
               for s in n.body):
            return True
        return any(has_db(ast.unparse(b), seen + (name,)) for b in n.bases)
    for name, n in classes.items():
        bases = [ast.unparse(b) for b in n.bases]
        if not any('TestCase' in b for b in bases):
            continue
        if 'self.client.' not in (ast.get_source_segment(src, n) or ''):
            continue
        if has_db(name):
            continue
        report.setdefault(str(p), []).append((n.lineno, name))
print(sum(len(v) for v in report.values()), 'classes still unresolved, in', len(report), 'files')
for f, v in report.items():
    print(f'  {f}: ' + ', '.join(f'{n}@{l}' for l, n in v))
```

Its output at `4a57d6d` — **137 classes, 28 files**:

```
accounts/test_avatar.py: AvatarApiTests@187
accounts/test_throttling.py: LoginIpThrottleTests@61, ForgedForwardedForTests@96, LoginUsernameThrottleTests@144, ScopedThrottleTests@196
accounts/tests.py: RegisterViewTests@22, LoginViewTests@49, MeViewNodeGovernorTests@76, UserReviewsViewTests@107, UserServiceReviewsViewTests@274
booking/test_week_schedules.py: WeekEndpointTests@199, WeekApplyTests@477
community/test_discussions.py: DiscussionEndpointTests@181, DiscussionLocationAdminTests@323      ← E's, not yours
community/tests.py: ReviewTests@15, CommentTests@77, ReviewReplyTests@195, CommentEditDeleteTests@309, CommentVoteTests@533
config/test_dbsearch.py: BrowseSearchDiacriticsTests@106
courses/test_claims.py: CourseClaimTests@16
decisions/tests.py: PollAPITests@219, VisibilityRegressionTests@453
events/test_permission_matrix.py: PermissionMatrixTests@89                                        ← B's, not yours
exercises/test_claims.py: ExerciseClaimTests@14
exercises/test_material_links.py: 4 classes
exercises/test_solution_entries.py: 10 classes
exercises/tests.py: 5 classes
galleries/tests.py: GalleryBase@42
materials/tests.py: 17 classes
messaging/test_encryption.py: 3 classes
messaging/tests.py: 5 classes
moderation/test_governor_applications.py: 4 classes
moderation/test_submission_material_links.py: 3 classes
moderation/tests.py: 17 classes
needs/tests.py: ApiTests@143, VolunteeringOfferTests@369
plans/tests.py: PlansTestCase@17 (+7 subclasses that inherit the fix)
services/test_location.py: 3 classes
services/tests.py: 9 classes
shifts/tests.py: RotaTestCase@31 (+12 subclasses that inherit the fix)
study/tests.py: 4 classes
taxonomy/tests.py: 4 classes
```

(`booking/test_week_schedules.py` mixes a mixin and `ApiTestCase` from `booking/tests.py` — check
whether the import is the base that already has the line before adding a second copy.)

## Shapes fixed in advance

- The line is exactly `databases = set(all_log_shards()) | {'default'}` with
  `from telemetry.routers import all_log_shards`. Not `'__all__'` — `config/test_locale_hint.py:53`
  uses that and it is the one place that should; a class that declares every database will happily
  pass a test that writes to the wrong one.
- The middleware's `except Exception` stays. Its class docstring says why a logging failure must
  never fail a request; the tests are what were wrong.

## Left open, by design

- You do not touch `events/test_permission_matrix.py` or `community/test_discussions.py` (above).
- You do not reorganise test files, rename classes, or extract a cross-app base. If a file has
  twenty classes with no base, it gets twenty lines; say in the board entry which files would
  benefit from a base and leave it.
- If `--parallel 4` completes but is slower than the documented ~9 minutes, that is a fact to record,
  not a problem to fix here.

## Verify

From `/Projects/edmat/.claude/worktrees/close-a-test-shards/backend`, venv python
`../.venv/bin/python3`:

```bash
python3 testing/check_databases_declared.py          # expect: 0 classes (modulo the three named above)
../.venv/bin/python3 manage.py check
../.venv/bin/python3 manage.py makemigrations --check --dry-run
../.venv/bin/python3 manage.py test shifts plans materials 2>&1 | grep -c "Failed to write a request log row"   # expect 0
time ../.venv/bin/python3 manage.py test --parallel 4 --keepdb                                                # the number this step exists for
```

Never alongside anyone's e2e run (`README.md` §5 rule 9); the file cache and the SQLite file are
shared with nobody in your worktree, but the CPU is. Numbers in the board entry, every one of them.
