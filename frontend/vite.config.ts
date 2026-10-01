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
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			// The ONE localized address on this site (owner's call, 2026-10-01). The root CLAUDE.md
			// says URL segments are neutral English — `/branches/`, not `/przedmioty/` — and that rule
			// still holds for every other route; tutoring is the deliberate exception, because "korki"
			// is the word Polish readers search for and the address is the first thing they read.
			//
			// Three things make this work together, and all three are needed:
			//
			//  1. These patterns. The route on disk is `routes/tutoring/`; `/korki` is what a Polish
			//     reader sees. ORDER MATTERS — the catch-all below would swallow `/korki` if it came
			//     first, and `deLocalizeUrl` takes the first element that matches.
			//  2. The catch-all second entry, which maps every other path to ITSELF in both locales.
			//     Without it Paraglide falls back to its default pattern, which prefixes the non-base
			//     locale — `/en/exercises/683` — and this app has no URL locale strategy at all
			//     (`strategy` is cookie/globalVariable/baseLocale). The catch-all is what keeps that
			//     default switched off.
			//  3. `hooks.ts`, which already reroutes through `deLocalizeUrl`, so `/korki/12` resolves
			//     the `tutoring/[id]` route without a second route directory existing for it.
			//
			// Links are localized at the call site with `localizeHref(resolve('/tutoring'))`, and that
			// is reactive here rather than merely correct on load: `lib/state/locale.svelte.ts`
			// overwrites `getLocale` with a rune, so switching language in the picker rewrites the
			// address without a reload, the same way it rewrites every `m.*()` string.
			urlPatterns: [
				{
					pattern: '/tutoring/:rest(.*)?',
					localized: [
						['pl', '/korki/:rest(.*)?'],
						['en', '/tutoring/:rest(.*)?']
					]
				},
				{
					pattern: '/:path(.*)?',
					localized: [
						['pl', '/:path(.*)?'],
						['en', '/:path(.*)?']
					]
				}
			]
		})
	]
});
