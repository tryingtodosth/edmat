import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// SCSS support for every component's <style lang="scss"> block. Every SCSS import uses a
	// plain relative path back to src/lib/styles rather than a `loadPaths` alias — that alias
	// approach works under a plain `vite build` but silently breaks under `svelte-check` (which
	// resolves this file through an extra layer of indirection, @sveltejs/load-config
	// re-resolving it via vite.config.ts). Relative paths sidestep the ambiguity entirely, the
	// same fix already proven in the sibling personalizacja_edukacji project.
	preprocess: vitePreprocess(),

	compilerOptions: {
		// Force runes mode across the project — Svelte 4's stores API is not used here.
		runes: true
	},

	kit: {
		// adapter-static in SPA fallback mode — deliberate, temporary (Phase 1 only, see CLAUDE.md
		// Section 13). Every route resolves its data entirely client-side from the mock service
		// layer; there is no server `load` anywhere yet. `fallback: '200.html'` is required, not
		// optional, given that shape — without it adapter-static refuses to build, since dynamic
		// routes like /exercises/[id] have no way to be prerendered ahead of time. Expected to
		// switch to adapter-node once Phase 2/3 wires in the real Django backend.
		adapter: adapter({ fallback: '200.html' }),
		// Inline EVERY stylesheet a page needs into its own <style> (the largest, the 48 KB / 12 KB
		// gzipped layout sheet, included). With one render-blocking <link> left, Lighthouse on slow 4G
		// still measured FCP at 5.9 s: over HTTP/2 that single file shares the link with ~80
		// modulepreloaded chunks and crawls, while the HTML that already holds the whole page sits
		// unpainted. Inlined, the first paint depends on the HTML alone. The price is one uncached
		// ~12 KB per full page load; client-side navigations still use the linked, cached files.
		// Inline any stylesheet under this size into the page's own <style>. The home page used to link
		// NINETEEN component stylesheets of ~1 KB each, every one render-blocking on its own round trip
		// — PageSpeed measured the prerendered <h1> waiting 2.3 s on them. Above the threshold (the
		// 12 KB gzipped layout sheet, the 10–23 KB per-route sheets) a link still wins, because it is
		// cached across visits. 8 KB rather than 5: the threshold is RAW bytes, and two ~6 KB component
		// sheets (1.7 KB on the wire) were still being linked — PageSpeed's next run named them.
		inlineStyleThreshold: 65536,
		// `/korki` and `/materialy` are the Polish addresses of the `tutoring` and `materials` routes (vite.config.ts `urlPatterns`). It is
		// not a route directory, so `'*'` — every non-dynamic route, the default — does not reach it,
		// and without this entry the default-locale reader lands on the SPA fallback for the one hub
		// page the navbar links to. The prerenderer runs `hooks.ts`'s reroute, so each resolves the
		// same page and writes `korki.html`/`materialy.html` beside their English twins.
		prerender: {
			entries: [
				'*',
				'/korki',
				'/materialy',
				// learning: showcase (G) — the seven design-showcase pages. `'*'` DOES already cover
				// them (they are non-dynamic routes), but they are named here for the same reason
				// `deploy/fuw/pack.sh` names its pages: a build that silently stopped emitting one of
				// them should fail a list somebody can read, not go unnoticed. Step H appends its
				// `/about/guide/**` pages below, which means putting a comma on the last line here.
				'/about/exercises',
				'/about/flashcards',
				'/about/learning-record',
				'/about/courses',
				'/about/schools',
				'/about/concepts',
				'/about/events',
				// contests: showcase (B) appends '/about/contests' directly below this comment, and the
				// manual chapter it writes under H's list further down.
				'/about/contests',
				// WP5 (2026-10-14): the four module pages.
				'/about/goals-and-work',
				'/about/tutoring',
				'/about/materials',
				'/about/conference',
				// WP6 (2026-10-15): your account, and licences and data.
				'/about/account',
				'/about/licences-and-data',

				// learning: guide (H) appends its /about/guide/** pages here, after G's.
				// The manual: the hub is an ordinary route and `'*'` would reach it, but the eleven
				// chapters are one DYNAMIC route (`/about/guide/[chapter]`), which the prerenderer
				// cannot enumerate on its own. `deploy/fuw/pack.sh` should check every name below.
				'/about/guide',
				'/about/guide/start',
				'/about/guide/exercises',
				'/about/guide/submit',
				'/about/guide/courses',
				'/about/guide/events',
				'/about/guide/tutoring',
				'/about/guide/concepts',
				'/about/guide/help',
				'/about/guide/messages',
				'/about/guide/moderation',
				'/about/guide/flashcards',
				// contests: showcase (B) — the manual's contests chapter, written against step A's
				// pages. The integrator re-shoots its screenshots after the merge.
				'/about/guide/contests'
			]
		}
	}
};

export default config;
