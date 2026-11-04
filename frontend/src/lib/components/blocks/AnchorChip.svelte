<script lang="ts">
	/**
	 * The line above a comment that is about PART of something: "On the statement: “on [0, 1]”",
	 * "On: “f'(x) = 0”". Pressing it brings that part into view and marks the passage
	 * (`anchoring.focusAnchor`); when the passage is no longer in the text — its author has edited
	 * it — the reader is told so in words rather than shown a highlight on the wrong thing, and
	 * when the whole block is gone the chip says that instead of pointing nowhere.
	 *
	 * `scope` is whose blocks the anchor names: the PARENT comment for a reply, the thread's target
	 * for a top-level comment (`backend/community/anchors.py`, "Which subject").
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { Anchor } from '$lib/types/blocks';
	import { onMount } from 'svelte';
	import { findBlock, focusAnchor } from './anchoring';
	import { blockKindPlace, implicitBlockLabel } from './labels';

	let { anchor, scope }: { anchor: Anchor; scope: string } = $props();

	let note = $state('');

	// A notebook block has no name of its own, so the line names its KIND — "On the formula:" —
	// read from the block on the page once it is drawn. The parent comment is drawn before its
	// replies, so by mount it is there; when it is not (another page), the line says "one part".
	let kind = $state<string | null>(null);
	onMount(() => {
		kind = findBlock(scope, anchor.block)?.dataset.kind ?? null;
	});
	const place = $derived(implicitBlockLabel(anchor.block) ?? blockKindPlace(kind));
	const detached = $derived(anchor.state === 'detached');

	function go() {
		const found = focusAnchor(scope, anchor);
		if (found === 'missing')
			note = m.anchor_notOnPage(); // "That part is not shown on this page."
		else if (found === 'quote-gone')
			note = m.anchor_quoteChanged(); // "The passage has changed since this was written."
		else note = '';
	}
</script>

<div class="anchor" class:anchor--detached={detached}>
	{#if detached}
		<span class="anchor__label">{m.anchor_detached()}</span>
		<!-- "On a part that has since been removed" -->
		{#if anchor.quote}<q class="anchor__quote">{anchor.quote}</q>{/if}
	{:else}
		<button type="button" class="anchor__go" onclick={go}>
			<span class="anchor__label">{place ? m.anchor_onPlace({ place }) : m.anchor_onBlock()}</span>
			<!-- "On {place}:" / "On one part:" -->
			{#if anchor.quote}<q class="anchor__quote">{anchor.quote}</q>{/if}
		</button>
	{/if}
	{#if note}<span class="anchor__note" role="status">{note}</span>{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.anchor {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		border-left: 3px solid var(--accent);
		padding-left: var(--space-2);
		margin-bottom: var(--space-1);
	}
	.anchor--detached {
		border-left-color: var(--border-color);
	}
	.anchor__go {
		@include mix.focus-ring;
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: center;
		border: 0;
		background: none;
		padding: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.anchor__go:hover .anchor__label {
		color: var(--accent);
		text-decoration: underline;
	}
	.anchor__label {
		font-weight: 600;
	}
	.anchor__quote {
		font-style: italic;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.anchor__note {
		@include mix.status-message(info);
	}
</style>
