<script lang="ts">
	// The one place Exercise/Material content actually gets rendered — Markdown + LaTeX ->
	// sanitized, math-typeset HTML, via lib/utils/renderContent.ts. See CLAUDE.md Section 11.
	import { renderContent } from '$lib/utils/renderContent';

	let { source, tag = 'div' }: { source: string; tag?: 'div' | 'span' } = $props();
	let html = $derived(renderContent(source));
</script>

{#if tag === 'span'}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- `html` is DOMPurify-sanitized in renderContent.ts (CLAUDE.md Section 11); this is the one deliberate, reviewed {@html} sink in the app -->
	<span class="math-content">{@html html}</span>
{:else}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- see the sibling branch above -->
	<div class="math-content">{@html html}</div>
{/if}

<style lang="scss">
	.math-content {
		line-height: 1.65;
		overflow-wrap: break-word;

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
