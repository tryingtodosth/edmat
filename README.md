# EdMat

A community-driven database of university exercises (math/CS/physics) — full statement, hint,
answer, and solution per exercise, LaTeX-rendered, filterable by topic/difficulty/source, with
community reviews, threaded discussion, moderated submissions, and translation of both the
interface and individual exercises. See [`CLAUDE.md`](./CLAUDE.md) for the full project blueprint
(requirements, data model, build history).

Two parts, run separately:

- **`backend/`** — Django 5.2 + Django REST Framework, SQLite, the real 742-exercise corpus
  imported from `Database-of-Student-Exercise/`.
- **`frontend/`** — SvelteKit + TypeScript + Svelte 5, talks to the backend over `fetch()`.

---

## Prerequisites

- **Python 3.12** (the backend was built and tested against `3.12.3`)
- **Node.js 20+** (built and tested against `24.18.0`) and npm
- No system-level packages need installing beyond these two — SQLite ships with Python, no database
  server to stand up separately.

## 1. Backend setup

```sh
cd edmat
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cd backend
../.venv/bin/python3 manage.py migrate
../.venv/bin/python3 manage.py import_legacy_corpus   # imports all 742 real exercises — idempotent, safe to re-run
../.venv/bin/python3 manage.py seed_demo_users         # creates the 5 demo accounts (see below)
../.venv/bin/python3 manage.py createsuperuser         # optional — for /admin/ access

../.venv/bin/python3 manage.py runserver 127.0.0.1:8000
```

Leave that running. The API is now live at `http://127.0.0.1:8000/api/` (and the Django admin at
`http://127.0.0.1:8000/admin/`, if you made a superuser).

## 2. Frontend setup

In a second terminal:

```sh
cd edmat/frontend
cp .env.example .env      # PUBLIC_API_BASE_URL=http://localhost:8000/api — the default is already correct
npm install
npm run dev
```

Open the URL Vite prints (`http://localhost:5173/` by default). The frontend talks to the backend
you started in step 1 — both need to be running at the same time.

> The backend's CORS allowlist (`backend/config/settings.py`) only permits
> `localhost`/`127.0.0.1` on ports `5173`/`5174` — if Vite picks a different port (it will if 5173 is
> already taken), either free up 5173 or add the new port to `CORS_ALLOWED_ORIGINS`.

## Demo accounts

Every account below shares the password `password123` (also shown on the login page itself):

| Email | Role |
|---|---|
| `kasia@edmat.example` | Moderator (`is_staff`) — can see `/moderation` and approve/reject the queue |
| `michal@edmat.example` | Verified contributor |
| `ola@edmat.example` | Ordinary registered user |
| `bartek@edmat.example` | Ordinary registered user |
| `julia@edmat.example` | Ordinary registered user |

You can also register a brand-new account from `/register` — real password validation applies (a
weak/common password like `password123` itself will be rejected for a *new* account; the demo
accounts above were seeded directly, bypassing that check, which is why they're allowed to share
one).

## Useful commands

```sh
# Backend — from edmat/backend/, using ../.venv/bin/python3
manage.py check                    # sanity check
manage.py import_legacy_corpus     # (re-)import the real corpus, idempotent
manage.py import_legacy_corpus --dry-run   # same, but rolls back — nothing written
manage.py seed_demo_users          # (re-)seed the 5 demo accounts

# Frontend — from edmat/frontend/
npm run check     # svelte-check
npm run lint       # prettier + eslint
npm run build       # production build (adapter-static, output in build/)
```

## Project layout

```
edmat/
├── CLAUDE.md               # the full project blueprint — read this for the "why"
├── requirements.txt         # backend Python deps
├── .venv/                   # backend virtualenv (created by you in step 1)
├── backend/                  # Django + DRF project
│   ├── manage.py
│   ├── config/                settings, root urls
│   ├── accounts/               User profiles, auth endpoints
│   ├── taxonomy/                Field / Course / Topic / Chapter
│   ├── exercises/                 Exercise / ExerciseTranslation / Tag
│   ├── materials/                  course PDFs
│   ├── community/                   reviews, threaded comments
│   ├── moderation/                   submissions, edit suggestions, moderation queue
│   ├── study/                         "My Set" (server-side, for registered users)
│   ├── db.sqlite3                      the database file itself
│   └── media/                           uploaded material PDFs, served by the dev server
├── frontend/                # SvelteKit app
│   └── src/
│       ├── lib/api/            client.ts (fetch wrapper) + mappers.ts (JSON <-> TS)
│       ├── lib/services/        one file per domain — the only layer routes/components call
│       ├── lib/state/            auth/token/theme/guestSet/browsingHistory (Svelte 5 runes)
│       └── routes/                SvelteKit pages
├── Database-of-Student-Exercise/   the original source corpus — see note below
│   └── content/                       ✅ vendored/tracked in this repo (fields/courses/exercises/
│                                       materials, 742 exercises); everything else in that project
│                                       (its own static-site generator, build output, docs, tests)
│                                       is gitignored here since EdMat's `import_legacy_corpus`
│                                       command only ever reads `content/` — see below
└── scripts/                          a Phase-1-only mock-fixture extraction tool (historical)
```

**The exercise corpus ships with this repo — nothing extra to clone or download.**
`Database-of-Student-Exercise/content/` (742 exercises, their PDFs, and the field/course/topic
metadata) is tracked directly in this repository, not fetched separately — it's what `manage.py
import_legacy_corpus` (step 1 above) reads to populate the database, so the setup steps above work
as written on a completely fresh clone. It originated as its own project
([`github.com/mar2000/Database-of-Student-Exercise`](https://github.com/mar2000/Database-of-Student-Exercise));
only its content data is vendored here, not its static-site-generator tooling (`build.py`,
`generator/`, `site/`), which EdMat has no use for.

> ⚠️ The corpus is transcribed from real university course material (exam/midterm/exercise-sheet
> problems). Whether redistributing it publicly needs instructor permission is an open question —
> see `CLAUDE.md` Section 18, item 2 — worth a real answer before this goes beyond a
> personal/prototype deployment.

`backend/db.sqlite3` and `backend/media/` are **not** committed (see `.gitignore`) — both are fully
regenerated by the setup steps above (`migrate` + `import_legacy_corpus`, which re-copies the PDFs
from the vendored corpus into `media/` on every run).
