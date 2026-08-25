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
		// Inline any stylesheet under this size into the page's own <style>. The home page used to link
		// NINETEEN component stylesheets of ~1 KB each, every one render-blocking on its own round trip
		// — PageSpeed measured the prerendered <h1> waiting 2.3 s on them. Above the threshold (the
		// 12 KB layout sheet) a link still wins, because it is shared by every page and cached.
		inlineStyleThreshold: 5000
	}
};

export default config;
