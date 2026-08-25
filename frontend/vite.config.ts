import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
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

export default defineConfig({
	plugins: [
		katexFontDisplaySwap,
		sveltekit(),
		paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })
	]
});
