<script lang="ts">
	// Renders a title (Exercise/Material/Submission/Translation) with inline LaTeX support — see
	// lib/utils/renderContent.ts's own renderTitle() for why this is a deliberately lighter, separate
	// pipeline from MathContent.svelte's (a title is a plain string, never Markdown source, and must
	// never introduce a block-level element since every call site renders it inside a heading).
	import { renderTitle } from '$lib/utils/renderContent';

	let { text }: { text: string } = $props();
	let html = $derived(renderTitle(text));
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- `html` is DOMPurify-sanitized in renderContent.ts's renderTitle() (mirrors MathContent.svelte's own reviewed {@html} sink) -->
<span class="math-title">{@html html}</span>
