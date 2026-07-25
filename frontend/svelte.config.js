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
		adapter: adapter({ fallback: '200.html' })
	}
};

export default config;
