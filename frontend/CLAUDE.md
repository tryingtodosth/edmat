# frontend/ — SvelteKit 2 + Svelte 5 runes + TS, adapter-static SPA, Paraglide i18n

Scoped context for frontend work. Root `CLAUDE.md` holds full history (its taxonomy names are
stale — Discipline was "Field", Branch was "Course"; user-run courses are the `courses` app).

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

## Rendering math (`lib/utils/renderContent.ts`) — the pipeline ORDER is the point

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
**No URL locale strategy** — `/pl/...` is not a route; language is chosen via the picker.
Interface language and content language are independent axes (a `?lang=` picker per exercise).

## State (`lib/state/*.svelte.ts`, 18 modules)

`token.svelte.ts` is a dependency-free leaf (client reads it, auth writes it — the split
prevents a genuine circular import; persisted to localStorage). `auth.svelte.ts` exposes
`canModerate` as the single frontend moderation gate. `notifications.svelte.ts` deliberately
does NOT import authStore (same cycle); it opens the SSE stream inside `refresh()` (one
integration point, not three call sites remembering) and `clear()` must close it on logout.
`displayPrefs` (24h/Monday defaults — real settings, not locale inferences) is read directly by
clock-drawing components, while pure geometry (`components/booking/calendar.ts`) takes
`weekStartsOn` as a parameter and imports nothing from the domain.

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
swap, no-flash inline script in `app.html`). `adapter-static` SPA fallback is a deliberate
non-change — nothing needs SSR.

## Verify

`npm run check` (0 errors/0 warnings expected), `npm run lint`, `npm run build`,
`npm run check:katex`, `npm run check:a11y`. Real-browser verification is mandatory for
anything interactive — see `e2e/CLAUDE.md`; several real bugs were only ever found by looking
at a screenshot.
