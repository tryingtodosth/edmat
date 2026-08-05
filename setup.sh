#!/usr/bin/env bash
#
# EdMat — one-command setup for a fresh Ubuntu machine.
#
#   ./setup.sh
#
# Installs what is missing, builds both halves, creates the database and fills it with demo content.
# Safe to run twice: every step checks before doing anything, so re-running fixes a half-finished
# install rather than breaking a working one.
#
# It does NOT start the servers — that is ./run.sh, so you can re-run this without killing a running
# site.

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Things you might want to change. Everything below this block is machinery.
# ─────────────────────────────────────────────────────────────────────────────

BACKEND_PORT=8000        # the API
FRONTEND_PORT=5173       # the website
SEED_DEMO_CONTENT=yes    # 'no' for an empty site with no example profiles/courses/reviews
IMPORT_EXERCISES=yes     # 'no' to skip the 742-exercise corpus (much faster, but a bare site)

# ─────────────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")"
ROOT="$(pwd)"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
blue()  { printf '\033[34m\n== %s\033[0m\n' "$1"; }
warn()  { printf '\033[33m%s\033[0m\n' "$1"; }
die()   { printf '\033[31mError: %s\033[0m\n' "$1" >&2; exit 1; }

blue "1/6  Checking what is already installed"

MISSING=()
command -v python3 >/dev/null 2>&1 || MISSING+=(python3)
# `import venv` is NOT the right check and this bit me while testing: the venv module ships with
# Python itself, so it imports fine on a machine where `python3 -m venv` cannot actually build a
# working environment. What Ubuntu splits out into python3-venv is `ensurepip` — so that is what to
# look for.
# Only needed to BUILD the environment — if a working one is already here (a re-run), demanding the
# package again would send somebody to install something they no longer need.
if [ ! -x .venv/bin/pip ]; then
  python3 -c 'import ensurepip' >/dev/null 2>&1 || MISSING+=(python3-venv)
fi
command -v node >/dev/null 2>&1 || MISSING+=(nodejs)
command -v npm  >/dev/null 2>&1 || MISSING+=(npm)

if [ ${#MISSING[@]} -gt 0 ]; then
  warn "Missing: ${MISSING[*]}"
  echo "Installing them with apt — you will be asked for your password."
  # Ubuntu's own nodejs package is old enough on some releases that Vite refuses to start, so the
  # version is checked below rather than assumed.
  sudo apt-get update -qq
  sudo apt-get install -y python3 python3-venv python3-pip nodejs npm
else
  green "Everything needed is already installed."
fi

NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
if [ -z "${NODE_MAJOR}" ] || [ "${NODE_MAJOR}" -lt 20 ]; then
  warn "Node $(node -v 2>/dev/null || echo 'not found') is too old — this project needs 20 or newer."
  echo "Installing a current Node from NodeSource…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  [ "${NODE_MAJOR}" -ge 20 ] || die "Node is still too old (v${NODE_MAJOR}). Install Node 20+ and re-run."
fi
green "Python $(python3 --version 2>&1 | cut -d' ' -f2), Node $(node -v)"

blue "2/6  Python environment"
if [ ! -d .venv ]; then
  python3 -m venv .venv || die "Could not create the Python environment. Run: sudo apt install python3-venv    then try again."
  green "Created .venv"
else
  green ".venv already exists"
fi
# A half-built .venv (the usual leftover of an interrupted first run) has no pip and every later step
# would fail with something far less obvious than this.
[ -x .venv/bin/pip ] || die ".venv exists but has no pip — delete it and re-run:  rm -rf .venv && ./setup.sh"
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r requirements.txt
green "Python packages installed"

blue "3/6  Website packages (this is the slow one — a minute or two)"
cd "${ROOT}/frontend"
[ -f .env ] || printf 'PUBLIC_API_BASE_URL=http://localhost:%s/api\n' "${BACKEND_PORT}" > .env
npm install --no-audit --no-fund --silent
green "Website packages installed"

blue "4/6  Database"
cd "${ROOT}/backend"
PY="${ROOT}/.venv/bin/python3"
"${PY}" manage.py migrate --noinput
# The activity log lives in its own set of databases, which `migrate` alone does not touch. Missing
# this is the single most common way a fresh install ends up throwing on every page.
"${PY}" manage.py migrate_log_shards
green "Database ready"

blue "5/6  Content"
if [ "${IMPORT_EXERCISES}" = "yes" ]; then
  "${PY}" manage.py import_legacy_corpus
else
  warn "Skipped the exercise corpus (IMPORT_EXERCISES=no)"
fi
"${PY}" manage.py seed_demo_users
if [ "${SEED_DEMO_CONTENT}" = "yes" ]; then
  "${PY}" manage.py seed_demo_content
else
  warn "Skipped the demo profiles/courses/reviews (SEED_DEMO_CONTENT=no)"
fi

blue "6/6  Building the website"
cd "${ROOT}/frontend"
# Also what generates the translation modules, which the dev server needs before it can start.
NODE_OPTIONS=--max-old-space-size=3072 npm run build --silent >/dev/null
green "Built"

cd "${ROOT}"
cat <<EOF

$(green "Done.")

Start it with:

    ./run.sh

Then open  http://localhost:${FRONTEND_PORT}

Log in with any of these — the password for all of them is  password123

    kasia@edmat.example    (moderator — can see the moderation queue)
    michal@edmat.example   (ordinary user)
    ania@edmat.example     (runs the "Analiza od zera" course)
    piotr@edmat.example    (has people waiting to join his course)

EOF
