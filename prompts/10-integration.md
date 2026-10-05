# Integration — for the orchestrating session, after the eight land

Order: **H, G, F, E, D, C, B, A** into `ux/mission-nav-tutoring-volunteering` (the smallest
and most peripheral first, so that A — the one everybody referenced — merges last against the
fullest tree). Before each merge, re-run that branch's own "Verified" numbers from its board entry
on its worktree; an agent that said "verified" without numbers has not verified.

1. `git merge --no-ff learn/<x>-…`; resolve "both appended" with
   `~/.claude/projects/-Projects-edmat/memory/resolve_union.py`; then Prettier and
   `fix_labels_seams.py`; look for identical trailing lines folded into context (`};`, `}`,
   `</a>{/if}`).
2. After ANY branch with a migration: `manage.py migrate` on the main DB **before** any e2e.
3. Wire the seams the briefs left for you:
   - `work/providers.py`: `register('flashcards', 'flashcards', flashcards.work.work_items)` + the
     `_SECTION_ORDER` entry.
   - `identity/record.py`: `register_activity_provider(flashcards.record.activity_by_branch)` and
     `(courses.record.activity_by_branch)` — in `identity/apps.py: ready()` or wherever B says.
   - `backend/events/test_permission_matrix.py`: rows for `…/sessions/{id}/exercises/`,
     `…/related-courses/`, `/api/nodes/{kind}/{pk}/decks/`, `/api/users/{id}/learning-record/`,
     `/api/course-completions/{id}/`, `/api/creation/` (four personas each).
   - `deploy/fuw/pack.sh` prerender list: the pages G and H name on the board.
   - `CLAUDE.md`: apps 34 → 35 (`flashcards`), flags 28 → 31, the routes block (`/flashcards…`,
     `/about/<feature>`, `/about/guide/…`), the API block (`/api/decks/`, `/api/creation/`);
     `CLAUDE_MAP.md`: a `flashcards` section and the new modules (`config/creation.py`,
     `identity/record.py`, `concepts/paths.py`); `test.md`: one paragraph per new script.
   - Tell H that A has merged, so the flashcards chapter can be written (H's branch stays open
     for that one chapter; merge it again after).
4. The whole suite: `manage.py test --keepdb` (expect ~9 min of DB build the first time);
   `check`; `makemigrations --check`; `npm run check` 0/0; `npm run lint`; `npm run build`;
   `npm run check:a11y`; `npm run check:katex`; every `frontend/e2e/*.mjs` the eight added, plus
   `events-and-nav.mjs`, `polls.mjs`, `about-page.mjs`, on the main checkout's ports; look at
   the screenshots.
5. `HISTORY.md`: the §17BR preamble above the eight sub-sections (what the cycle was, the
   placement-visibility deviation from `00-DESIGN.md` §4.1, the Opus-everywhere decision, what
   integration found). Boards: one `done.md` entry for the integration; everything left open
   under "Learning cycle — left open" in `todo.md`.
6. Publishing is a replay (`CLAUDE.md`): a scratch worktree from `origin/main`, cherry-pick minus
   `grant/` and `deploy/`, and **ask before any push**. Production is on
   `UPDATE-20261001`; the runbook for the next bundle goes in `deploy/UPDATE-2026-10-xx.md`
   and is held back like the others.
