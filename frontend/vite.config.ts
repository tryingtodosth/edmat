import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// KaTeX ships its @font-face rules with `font-display: block`, so a title containing math shows
// NOTHING until the 26 KB math font has arrived — PageSpeed put those two fonts at the end of a
// 7.3 s critical chain on the home page. `swap` paints the text in the fallback face at once and
// swaps when the font lands. A build-time rewrite of the vendor stylesheet rather than a fork of
// it: the file is untouched in node_modules and the rule applies to whatever version is installed.
const katexFontDisplaySwap: Plugin = {
	name: 'edmat-katex-font-display-swap',
	enforce: 'pre',
	transform(code, id) {
		if (!id.includes('katex') || !id.endsWith('.css')) return null;
		return { code: code.replaceAll('font-display:block', 'font-display:swap'), map: null };
	}
};

// Ketcher (ketcher-react / ketcher-standalone, the chemistry editor behind
// components/chem/KetcherHost.svelte) imports two Node built-ins — `events` for its
// EventEmitter and `assert` as a plain function. Vite externalizes built-ins for the browser,
// which surfaced at runtime as `EventEmitter is not a constructor` the first time the editor
// was opened (the build itself passes silently). Both are aliased to real browser modules; the
// aliases are exact-name matches, so nothing else in the app can pick them up by accident.
const nodeBuiltinShims = [
	{
		find: /^events$/,
		replacement: fileURLToPath(new URL('./node_modules/events/events.js', import.meta.url))
	},
	{
		find: /^assert$/,
		replacement: fileURLToPath(new URL('./src/lib/shims/assert.ts', import.meta.url))
	}
];

export default defineConfig({
	resolve: { alias: nodeBuiltinShims },
	plugins: [
		katexFontDisplaySwap,
		sveltekit(),
		paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })
	],
	server: {
		fs: {
			// This worktree's `node_modules` is a symlink to the main checkout's copy (shared
			// across git worktrees to save disk — 31 of them at last count), so its real path is
			// outside this worktree's own directory tree. Vite's default `fs.allow` only covers
			// the workspace root it can find by walking up from here, which does not include
			// that target, so anything Vite serves straight off disk rather than bundling (KaTeX's
			// woff2/woff/ttf files, `font-display: swap` fetches them directly) 403s — found live
			// on the home page, whose title renders inline maths, during `frontend/e2e/polls.mjs`.
			allow: ['..', '/Projects/edmat/frontend']
		}
	}
});
