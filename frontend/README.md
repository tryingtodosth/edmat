# EdMat — frontend

SvelteKit frontend for EdMat. See [`../README.md`](../README.md) for full run instructions
(you need the `backend/` running alongside this) and [`../CLAUDE.md`](../CLAUDE.md) for the full
project blueprint.

Every route/component talks to `src/lib/services/*.ts`, which in turn goes through
`src/lib/api/client.ts` (a thin, DRF-token-authenticated `fetch()` wrapper) — nothing calls the
backend directly. `PUBLIC_API_BASE_URL` (`.env`, copy from `.env.example`) points at it.

## Developing

Requires the Django backend running at the URL in `.env` (defaults to `http://localhost:8000/api`,
see `../README.md`).

```sh
npm install
npm run dev -- --open
```

## Building

```sh
npm run build
npm run preview
```

## Checks

```sh
npm run check   # svelte-check
npm run lint     # prettier + eslint
```
