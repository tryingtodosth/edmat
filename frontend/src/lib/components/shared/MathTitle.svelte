<script lang="ts">
	// Renders a title (Exercise/Material/Submission/Translation) with inline LaTeX support — see
	// lib/utils/renderContent.ts's own renderTitle() for why this is a deliberately lighter, separate
	// pipeline from MathContent.svelte's (a title is a plain string, never Markdown source, and must
	// never introduce a block-level element since every call site renders it inside a heading).
	// The renderer is loaded on demand — see lib/utils/mathRender.ts for the SSR/client timings.
	import { loadMath, mathModule, plainText } from '$lib/utils/mathRender';

	let { text }: { text: string } = $props();
	let math = $state(mathModule());
	// Client-only by construction (effects never run on the server, where the module is already
	// loaded): fetch the renderer once and re-render when it lands.
	$effect(() => {
		if (!math) loadMath().then((m) => (math = m));
	});
	let html = $derived(math ? math.renderTitle(text) : plainText(text));
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- `html` is DOMPurify-sanitized in renderContent.ts's renderTitle(), or the escaped source text before the renderer arrives (mirrors MathContent.svelte's own reviewed {@html} sink) -->
<span class="math-title">{@html html}</span>
