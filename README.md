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
├── Database-of-Student-Exercise/   the original, untouched source corpus (740+ exercises)
└── scripts/                          a Phase-1-only mock-fixture extraction tool (historical)
```

---

## For your eyes only

*(This section documents the exact environment already set up in this sandbox, so you can run the
same thing without redoing any setup — skip the two setup sections above entirely.)*

Everything above describes a **fresh** setup. You don't need one — a working `.venv` and a fully
`npm install`'d `frontend/node_modules` already exist on disk here, and the database already has the
full corpus imported and both demo/test data in it. Just start both servers directly:

```sh
# Terminal 1 — backend, using the existing venv (already has Django/DRF/etc. installed)
cd /home/alojzy/Zrzut_Na_Hosta/edmat/backend
../.venv/bin/python3 manage.py runserver 127.0.0.1:8000

# Terminal 2 — frontend, using the existing node_modules
cd /home/alojzy/Zrzut_Na_Hosta/edmat/frontend
npm run dev
```

Then open `http://localhost:5173/`.

**Why `../.venv/bin/python3 manage.py ...` and not `source .venv/bin/activate` first** — the venv's
own `activate` script works fine too if you prefer it (`source ../.venv/bin/activate` from
`backend/`, then plain `python3 manage.py ...`); I've been invoking the interpreter by its full path
directly instead, purely because that's what worked without needing an interactive shell in this
harness. Either approach uses the identical venv and produces identical results.

**Why this venv isn't just `pip install -r requirements.txt` in a normal venv** — worth knowing in
case you ever need to rebuild it: this sandbox has no `sudo`/root access and no interactive TTY, so
the usual `python3 -m venv .venv` failed here (`ensurepip` isn't available on the system Python, and
there's no `apt install python3-venv` path without a password prompt). It was built instead with
`python3 -m venv --without-pip .venv`, then bootstrapped by downloading and running
`get-pip.py` by hand. You almost certainly don't have this problem on your own machine — a plain
`python3 -m venv .venv` should just work there. Only reach for the `--without-pip` +
`get-pip.py` workaround if you hit the same `ensurepip is not available` error I did.

### What's actually in the database right now

The real 742-exercise corpus is fully imported. But the database also has **test data left over
from my own end-to-end verification** of the moderation/review/comment/registration flows — not
something you asked for, just the byproduct of me actually clicking through the app to prove it
works rather than assuming it does:

- **3 extra exercises** (ids `743`, `744`, `745`) — fake submissions I created and then approved
  through the real moderator flow, to prove that pipeline works. Titled things like "Test submitted
  exercise" / "Phase 3 e2e submitted exercise" — you'll notice them if you browse those courses.
- **2 reviews, 5 comments, 2 edit suggestions, 2 community translations** (a test English and a test
  German translation on real exercise `#1`/`#51`) — same reason.
- **5 throwaway user accounts** beyond the 5 real demo ones and the `admin` superuser I created for
  testing: `student1`, `realuser-abc123`, and three `verify-<timestamp>@example.com` registrations.

None of this corrupts the real corpus — it's all additive, clearly separable rows (every one of the
3 test exercises has a real `submitted_by`, unlike the 742 genuinely migrated ones, which are all
`submitted_by = NULL`). But if you want a database that's *just* the corpus with no test noise
before you start using this for real, ask me and I'll write the cleanup — I didn't run it
unprompted since deleting rows isn't something to do without confirmation first.

One account IS worth keeping, not cleanup fodder: `admin` / `admin12345`, a real Django superuser
I created so I could poke at `/admin/` while verifying things — use it instead of running
`createsuperuser` yourself if you just want admin access without making a new one.

### Ports already in use

If you're picking this up in the same session I was using it in, nothing should still be running —
I stop both dev servers at the end of each work session. If you find `127.0.0.1:8000` or
`localhost:5173` already occupied, check `ps aux | grep -E "runserver|vite"` before assuming
something's wrong.
