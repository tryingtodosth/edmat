#!/usr/bin/env bash
#
# EdMat — starts both halves and stops them together.
#
#   ./run.sh
#
# Press Ctrl+C once to stop everything. Run ./setup.sh first, once.

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Change these if the ports are taken. They must match what ./setup.sh wrote
# into frontend/.env — if you change the backend port here, change it there too.
# ─────────────────────────────────────────────────────────────────────────────

BACKEND_PORT=8000
FRONTEND_PORT=5173

# ─────────────────────────────────────────────────────────────────────────────

cd "$(dirname "$0")"
ROOT="$(pwd)"

[ -d .venv ] || { echo "No .venv — run ./setup.sh first." >&2; exit 1; }
[ -d frontend/node_modules ] || { echo "No frontend packages — run ./setup.sh first." >&2; exit 1; }

# One trap, so Ctrl+C takes the backend down with the frontend instead of leaving a stray server
# holding the port — which is the thing that makes the next ./run.sh mysteriously fail.
cleanup() {
  trap - INT TERM EXIT
  [ -n "${BACKEND_PID:-}" ] && kill "${BACKEND_PID}" 2>/dev/null || true
  wait 2>/dev/null || true
  echo
  echo "Stopped."
}
trap cleanup INT TERM EXIT

echo "Starting the API on port ${BACKEND_PORT}…"
# The API only accepts browser requests from origins it knows about, and its built-in list covers the
# default port only. Passing the chosen one through is what makes changing FRONTEND_PORT above
# actually work — without this the site loads but every request fails, which looks like a broken app
# rather than a port mismatch.
export DJANGO_CORS_ALLOWED_ORIGINS="http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}"
(cd "${ROOT}/backend" && "${ROOT}/.venv/bin/python3" manage.py runserver "127.0.0.1:${BACKEND_PORT}") &
BACKEND_PID=$!

sleep 3
printf '\n\033[32mOpen  http://localhost:%s\033[0m\n' "${FRONTEND_PORT}"
printf 'Log in with  kasia@edmat.example  /  password123\n'
printf 'Press Ctrl+C to stop.\n\n'

cd "${ROOT}/frontend"
# Keeps frontend/.env in step with BACKEND_PORT above, so changing the port in one place is enough.
printf 'PUBLIC_API_BASE_URL=http://localhost:%s/api\n' "${BACKEND_PORT}" > .env
npm run dev -- --port "${FRONTEND_PORT}" --strictPort
