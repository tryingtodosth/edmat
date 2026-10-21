# frontend/ — SvelteKit 2 + Svelte 5 runes + TS, adapter-static SPA, Paraglide i18n

Scoped context for frontend work. Root `CLAUDE.md` holds the cross-cutting rules; `HISTORY.md`
holds the full build history (its taxonomy names are stale — Discipline was "Field", Branch was
"Course"; user-run courses are the `courses` app).

## The layer boundary — the single most load-bearing rule

```
routes/ + lib/components/  →  lib/services/*.ts  →  lib/api/client.ts + mappers.ts  →  Django
       (never fetch)            (the only seam)         (the only fetch())
```

No component or route contains fetch logic, ever. `client.ts` is the one fetch wrapper
(`PUBLIC_API_BASE_URL`, `Authorization: Token …`, a real `ApiError` carrying the parsed DRF
error body so callers branch on WHICH field failed; `delete` takes an optional body — tag
removal needs it; `postForm` for multipart must NOT set Content-Type so the browser generates
its own boundary). `mappers.ts`: one raw-JSON→TS function per type. **Id convention:**
Discipline/Branch ids are the backend slug; everything else `String(pk)`, opaque outside
`lib/api/`. `lib/services/tutoring.ts` is deliberately not named `services.ts`.

## Shallow routing: `page.url` does NOT follow `pushState`

A modal that should survive a refresh is a shallow route (`pushState` from `$app/navigation`,
`App.PageState` in `app.d.ts`): the task board pushes `/tasks/<id>` and draws the card in a
`ModalShell`; the plan page pushes `?step=<id>`. Two things to know, both found by a browser run
(2026-10-08, HISTORY §17BY): **SvelteKit keeps `page.url` at the page's own URL across a shallow
push** (the entry stores it as `sveltekit:pageurl`), so read the id from `page.state` while the
page is open and from the query only for the reload case; and closing is `history.back()` when
you pushed the state, but after a reload there is no entry to go back to — `goto(bare, {
replaceState: true })` instead. `utils/nodeHref.ts` is where "back to the parent" resolves a
node's page.

## Svelte 5 traps (each has produced a live production-path bug; svelte-check catches NONE)

1. **`bind:value` on `<input type="number">` binds a real `number` (or `undefined`)**, not the
   string the surrounding `.trim()` code assumes → `.trim is not a function` on first live
   submit. Hit at least four times. Always `type="text"` + `inputmode="numeric|decimal"`.
2. **`$effect(() => load(page.params.id!))` re-fires with no navigation at all** → every dynamic
   route needs an id-changed idempotency guard (`if (id === loadedForId) return`).
3. The mirror image: gating an initial load in `onMount` reads `authStore.isAuthenticated`
   exactly once — possibly before the async `init()` resolves (a hard reload then shows empty
   data despite a valid session). Correct shape: an `$effect` keyed on the flag + a `loadedOnce`
   guard (see `routes/moderation/+page.svelte`).
4. An `$effect` that reads the state it writes re-runs itself (the drawer once opened and closed
   in the same frame). Prefer restructuring (handle in the event handler); `untrack` only when
   the dependency is genuinely wrong.
5. **A top-level service call in a component runs during SSR with no token** — an uncaught 401
   once took down the whole Vite dev server process. Auth-gated initial loads go in
   `onMount`/`$effect`, never module/component top level. Same reason Leaflet is dynamically
   imported inside `onMount` (touches `window` at module scope).
6. Window listeners for gestures: attach unconditionally while the mode is active, null-check in
   the handler — conditionally attaching on gesture state loses events dispatched before the
   next flush (a one-tick drag registered as a click).
7. `svelte/prefer-svelte-reactivity`: mutable `Set`/`Date` in `$state` — use `SvelteSet`, and
   keep `Date`-building formatters in plain `.ts` (`lib/utils/datetime.ts`), not `.svelte.ts`.
8. Popover close-on-outside-click: use `event.composedPath()`, never `container.contains(target)`
   — a click that synchronously un-renders its own button detaches the target before the window
   listener runs.
9. **`<!-- svelte-ignore a b -->` silences only `a`.** Two codes in one comment looks like it works
   — the build passes, the first warning is gone — and the second rule still fires, so a file that
   is meant to be at the 0-warning bar quietly is not. One comment per code. (`ExerciseCard`'s
   card-wide click needs `a11y_click_events_have_key_events` AND
   `a11y_no_noninteractive_element_interactions`; `<article>` is a non-interactive ELEMENT, so the
   static-element rule is not the one that fires.)

## A form with no heading cannot say what it is doing

`/plans/[id]` reuses ONE `stepForm` snippet for three jobs — a new top-level step, a new sub-step
under a row, and editing a row — and until 2026-10-08 the edit case had **no render condition at
all**: `openEditForm` set `formOpenFor = 'edit:<id>'`, the markup only tested `'top'`, `step.id` and
`sub.id`, so clicking Edit set state and drew nothing. Present since the plans app landed, invisible
to `svelte-check`, `eslint` and the build, because every handler was correct (house rule 2 again:
verify by running it). It is fixed, and the snippet now takes a **caption** naming the job, which is
the part worth copying: a reused form needs to say which of its jobs it is doing, or its absence
looks the same as its presence.

## Rendering math (`lib/utils/renderContent.ts`) — the pipeline ORDER is the point

**The renderer is loaded on demand** (`lib/utils/mathRender.ts`): `MathTitle`/`MathContent` never
import `renderContent.ts` statically — it is a ~380 KB chunk fetched by the first component that
needs it; the root `+layout.ts` awaits it server-side so prerendering typesets synchronously, and
the KaTeX stylesheet stays in the root layout so prerendered math never paints unstyled. A page with
no math never downloads it. Keep it that way: one static import of `renderContent` from anything in
the layout tree puts it back into every page's entry. The same discipline covers Leaflet (maps) and
`pdfjs-dist` (~420 KB + worker — the material-page PDF preview, dynamically imported inside
`PdfViewer.svelte`, which itself mounts only on the "Show preview" click).

Extract + KaTeX-render every `\(…\)`/`\[…\]` FIRST (stash behind inert placeholders) → run the
remainder through markdown-it → splice the KaTeX back → THEN DOMPurify. CommonMark treats `\[`
as escaped punctuation in ordinary paragraphs, so display math between `<p>` blocks silently
lost its backslashes under the "markdown first" order (shipped past every check; found by a real
user). Also: never let the SSR path return unsanitized HTML (the old `window === undefined`
bypass). After content-pipeline changes: `npm run check:katex` (imports the REAL renderContent
against a `manage.py dump_text_fields` dump; strips `<annotation>` first — corpus `\\[2mm]`
contains `\[` legitimately).

## i18n — the standing rule

No component contains a literal user-facing string. Every new/changed string lands in **both**
`messages/en.json` AND `messages/pl.json` in the same change (~1000+ keys each, key-set
identical — verify programmatically). Call sites carry a trailing `// "Original text"` comment.
After adding keys, paraglide must recompile (stale generated messages throw
`m.x is not a function` at runtime). Long-form documents (`lib/content/privacy.ts`,
`levels.ts`) are the deliberate exception — both locales in one file, reviewable as documents.
**No URL locale PREFIX** — `/pl/...` is not a route; language is chosen via the picker. But two
routes do have a localized address (2026-10-01, owner's call, a deliberate exception to the root
`CLAUDE.md` rule that URL segments are neutral English): **`/tutoring` ↔ `/korki`** and
**`/materials` ↔ `/materialy`**. Three pieces make that work and all three are needed —
`urlPatterns` in `vite.config.ts` (ORDER MATTERS: the catch-all would swallow `/korki`, and the
catch-all itself is not optional, because without it Paraglide's default pattern starts emitting
`/en/...` for every route); `hooks.ts`, which already reroutes through `deLocalizeUrl`; and
`lib/utils/localizedPath.ts` at the call site, `localizedPath(resolve('/tutoring'))`. It is
REACTIVE — `locale.svelte.ts` overwrites `getLocale` with a rune, so the picker rewrites the
address with no reload. Both Polish addresses are prerendered by name (`svelte.config.js`
`prerender.entries`, and `deploy/fuw/pack.sh` refuses a build missing them), because `pl` is the
base locale and otherwise the default reader gets the SPA shell on a hub page.
`svelte/no-navigation-without-resolve` cannot see through the wrapper without type-aware linting,
so each call site carries a disable comment. **Do not "fix" that by turning `projectService` on**:
it works, and `npx eslint .` then takes 13 minutes and dies with a heap OOM, against 19 seconds
without it.
**The base locale is `pl`** (2026-09-23): a fresh context paints Polish, `/api/locale-hint/` offers
English once when the country is known and not Poland, and `edmat.localeChoice` marks an explicit pick
(Paraglide's own cookie is written on the first visit, so a cookie is not a choice). e2e scripts that
assert English copy use `e2e/english.mjs` (`e2e/CLAUDE.md` trap 24).
Interface language and content language are independent axes (a `?lang=` picker per exercise).

## Page titles

Every tab is `EdMat: <page>`, shaped in ONE place (`lib/utils/pageTitle.ts`). Two callers:
`PageHead.svelte` (which also owns description/canonical/OG and is the right thing to reach for on
a new route) and the 41 routes that still write a bare `<title>` by hand. **Never both on one
page** — a second `<title>` is not an error anybody is told about; the first silently wins and the
page is stuck on one name. `e2e/material-open-and-titles.mjs` asserts `head title` count is 1.

## State (`lib/state/*.svelte.ts`, 18 modules)

`token.svelte.ts` is a dependency-free leaf (client reads it, auth writes it — the split
prevents a genuine circular import; persisted to localStorage). `auth.svelte.ts` exposes
`canModerate` as the single frontend moderation gate. `notifications.svelte.ts` deliberately
does NOT import authStore (same cycle); it opens the SSE stream inside `refresh()` (one
integration point, not three call sites remembering) and `clear()` must close it on logout.
`displayPrefs` (24h/Monday defaults — real settings, not locale inferences) is read directly by
clock-drawing components, while pure geometry (`components/booking/calendar.ts`) takes
`weekStartsOn` as a parameter and imports nothing from the domain.

## Ketcher (the chemistry editor, `components/chem/`) — a React island with Node shims

`ketcher-react` + `ketcher-standalone` (Apache 2.0; Indigo as WASM, a 21 MB chunk) are mounted
through React inside `KetcherHost.svelte`, every import lazy inside `onMount`. Three things it
needed that nothing else here does, each found by a browser run and invisible to the build:
`globalThis.process`/`global` shims set right before the imports (the host does this), and `events`

- `assert` aliased to real browser modules in `vite.config.ts` (Vite externalizes Node built-ins
  silently and the editor died at first open with `EventEmitter is not a constructor`). `ketcher-react`
  depends on `ketcher-core` as `*` — pin all three to the same version or the bundler reports missing
  exports. Its engines field wants Node ≥ 24.14 and `.npmrc` is `engine-strict`, so the build machine
  runs Node 24 (setup.sh installs it). A drawing is saved through `/api/chem-drawings/` and embedded
  as `<img data-chem=…>`; `editor/chemImage.ts` reopens it on click. ChemDoodle was the second
  editor for one afternoon and was dropped as GPLv3 in an MIT repo — don't re-add it.
  **`components/sketch/` is the same island pattern with Excalidraw (MIT)** — no Node-builtin aliases
  needed, only the `process`/`global` shims; fonts copied into `static/excalidraw/fonts/` so nothing is
  fetched from esm.sh; `editor/sketchImage.ts` extends `ChemImage` (one Tiptap node type per name).
  `tldraw` is not MIT and must not be added.

## One control for "which language is this written in?"

`components/shared/ContentLocaleSelect.svelte` (2026-10-08) is the only place that answers it. Five
forms asked separately before — two as **free text boxes** (`SolutionEntrySection`'s hint/solution
composer and `TranslateForm`) and three as hand-written `<option value="pl">PL</option>` pairs
(`/submit`, `/submit-material`, `CatalogueForm`). Its options are `SUPPORTED_CONTENT_LOCALES` plus
the reader's own opted-in extras plus whatever the row already is, and **`exclude` narrows the list
but may never empty it** — an exercise already published in every offered language would otherwise
get a select with no options, which is exactly what the first wiring of `TranslateForm` produced.

**The default is the INTERFACE language, everywhere.** The composer used to seed itself from
`contentLocale` — the language the exercise was being _read_ in — so a Polish-interface reader
looking at the English rendering got `en` pre-filled for the Polish solution they were typing. What
somebody is about to write is better guessed by the language they are reading the site in, and it is
a picker, so a wrong guess costs one click. The list is bounded **for now** by the owner's own word:
a content locale is a free string server-side and the content axis is unbounded on purpose.

## Hand-maintained mirrors of backend enums

`lib/utils/labels.ts` (notification types/categories, currencies, donation platforms, …) —
flagged in-file as the drift risk it is. Adding a backend enum value means updating here too.

## Structure and conventions

42 route pages, 95 components in 17 folders. `Popover` is the extracted
open/Escape/click-outside/restore-focus primitive (`MeatballsMenu` keeps its own copy on
purpose — flagged in both files). Feature-gated nav/menu items are single-sourced snippets
rendered into both desktop popovers and the phone drawer, so a FeatureFlag can't hide a link in
one and leave it in the other. Killing a feature removes LINKS as well as pages (`FeatureGate`).
Theming: token bridge (`_tokens.scss` → `_theme.scss` → CSS custom properties, `data-theme`
swap, no-flash inline script in `app.html`). **Four mixins hold the theme values** — `light-theme-vars`,
`dark-theme-vars`, `high-contrast-light-vars`, `high-contrast-dark-vars` — so a new token is added in
exactly four places and nowhere else; the high-contrast blocks were hand-copied until 2026-10-07 and
the dark one had inherited the LIGHT block's darkened status hues (≈2.3:1 on black) for months. **An
undefined custom property does not "fall back to nothing": it drops the whole declaration** —
`border: 1px solid var(--border)` with `--border` undefined draws NO border — and ~130 such reads
(`--border`, `--surface`, `--text-on-accent`, `--danger`, `--font-size-md`, the whole `--color-*`
family in the polls components) rendered as missing borders, transparent panels and white-on-light-teal
text for months because nothing checks it. Before calling a style done: `grep -rhoE 'var\(--[a-z0-9-]+'
src | sort -u` against the names `_theme.scss` defines. The real names are `--bg-page/-surface/
-surface-alt/-elevated/-menu`, `--border-color`, `--text-primary/-secondary`, `--accent/-soft/
-contrast`, `--status-{success,danger,warning,info,neutral}` and their `-bg` tints, `--stage`,
`--rating`, `--shadow-popover/-modal`, `--backdrop`, `--space-*`, `--radius-*`, `--font-size-*`,
`--font-mono`, `--z-*`. **Colour vocabulary (HISTORY.md §17BV, the 2026-10-07 colour pass):** the
accent means interactive, selected/current, and progress — nothing else; `--stage` (violet) is the
one reveal hue of the learning flow and may be read only by `routes/exercises/[id]`,
`SolutionEntrySection` and the flashcard review page, never as a background; `--rating` is a named
alias of the accent for filled stars (`StarRating`, `LessonFeedback` only). The five status pairs
mean: info = an open question for the reader (counts, open polls/needs, review), success = done/
verified/ON, warning = near/stuck/short/drifted, danger = overdue/wrong/auto-hidden, neutral =
closed/over/a fact. `_mixins.scss` carries the seven shapes — `pending-pill` (neutral + dashed, "not
settled"), `neutral-pill` (a fact), `selected-soft` (the ON state: tint + accent text + 1px accent
border — the border is load-bearing in dark mode), `count-badge` (info fill, contrast digits),
`progress-track`/`progress-fill` (accent fill, never success), and **`status-message(<kind>)`** for a
SENTENCE in a status colour — an error, a "saved", a "request sent", a stale-text warning (`kind` is
one of the five pair names and nothing else). A pill is a short label and keeps `white-space: nowrap`;
a sentence styled as a pill runs off a phone (audit finding 6, 2026-10-15: a booking confirmation's
link sat at x=396 on a 390 screen, and ~65 `.notice`/`.error` rules had that shape, half patched one
by one with `white-space: normal`). If the content is a sentence, it is a message, however short.
Use these rather than re-typing the pair; `status-pill(var(--accent), var(--accent-soft))` must have
zero readers and a filled accent box is a command (`button-primary`, the brand tile), never a
selection. Never opacity on content: dim a closed row's title to `--text-secondary`. `adapter-static` SPA fallback is a deliberate
non-change — nothing needs SSR.

## First paint

Only prerendered routes paint from HTML; everything else is the SPA fallback `200.html`, whose body
div is empty except SvelteKit's bootstrap `<script>`. `app.html` carries a boot shell hidden by
`body:has(> div[style] > :not(script))` — keep the `:not(script)` or the shell never shows. Static
hub pages should get a `+page.ts` with `export const prerender = true` (not pages that read
`url.searchParams` at load — `/search` fails the build). **A prerendered page must not call a
service at component top level**: that runs at build time too, where `fetch('/api/…')` has no
origin and the production build dies (`/submit` did, only under `PUBLIC_API_BASE_URL=/api` — the
dev `.env` names a real host, so `npm run build` alone hides it). Put the initial load in `onMount`. Measure with `e2e/fcp.mjs` against a static
serve of `build/` that falls back to 200.html; the dev server's paint is not representative.

## Verify

`npm run check` (0 errors/0 warnings expected), `npm run lint`, `npm run build`,
`npm run check:katex`, `npm run check:a11y`, `npm run check:plain` (the manual's and the showcase's
words are plain text, drawn as typed — it refuses `*emphasis*`, `_this_`, backticks and Markdown
links in their string literals; WP11). Real-browser verification is mandatory for
anything interactive — see `e2e/CLAUDE.md`; several real bugs were only ever found by looking
at a screenshot.
