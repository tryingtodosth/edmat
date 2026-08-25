<script lang="ts">
	// The one place Exercise/Material content actually gets rendered — Markdown + LaTeX ->
	// sanitized, math-typeset HTML, via lib/utils/renderContent.ts. See CLAUDE.md Section 11.
	// The renderer is loaded on demand — see lib/utils/mathRender.ts for the SSR/client timings.
	import { loadMath, mathModule, plainText } from '$lib/utils/mathRender';

	let { source, tag = 'div' }: { source: string; tag?: 'div' | 'span' } = $props();
	let math = $state(mathModule());
	// Client-only by construction (effects never run on the server, where the module is already
	// loaded): fetch the renderer once and re-render when it lands.
	$effect(() => {
		if (!math) loadMath().then((m) => (math = m));
	});
	let html = $derived(math ? math.renderContent(source) : plainText(source));
</script>

{#if tag === 'span'}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- `html` is DOMPurify-sanitized in renderContent.ts (CLAUDE.md Section 11), or the escaped source text before the renderer arrives; this is the one deliberate, reviewed {@html} sink in the app -->
	<span class="math-content">{@html html}</span>
{:else}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- see the sibling branch above -->
	<div class="math-content">{@html html}</div>
{/if}

<style lang="scss">
	.math-content {
		line-height: 1.65;
		overflow-wrap: break-word;

		// The global reset makes every anchor `color: inherit; text-decoration: none`, which is
		// right where a whole card or nav row is the link and wrong inside prose: a link written
		// as Markdown rendered as an ordinary-looking word, so nobody could tell it was one.
		// Scoped to rendered content rather than fixed in the reset, because the reset's choice is
		// deliberate everywhere else.
		:global(a) {
			color: var(--accent);
			text-decoration: underline;
		}
		:global(a:hover),
		:global(a:focus-visible) {
			text-decoration-thickness: 2px;
		}

		:global(p) {
			margin: 0 0 var(--space-3) 0;
		}
		:global(p:last-child) {
			margin-bottom: 0;
		}
		:global(.katex-display) {
			overflow-x: auto;
			overflow-y: hidden;
			padding: var(--space-1) 0;
			margin: var(--space-2) 0;
		}
		:global(ul),
		:global(ol) {
			margin: 0 0 var(--space-3) 0;
			padding-left: 1.4em;
			list-style: revert;
		}
		:global(strong) {
			font-weight: 700;
		}
	}
</style>
