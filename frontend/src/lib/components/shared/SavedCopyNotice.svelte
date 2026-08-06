<script lang="ts">
	// "This is what you saw last time." Shown when a page is rendering a saved copy because the
	// network did not answer.
	//
	// Worth saying out loud rather than silently showing old data: a stale course list that looks
	// live is worse than an empty one, because somebody acts on it. Naming when it was saved is what
	// lets them judge whether it still matters.
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';

	let { savedAt, stale = false }: { savedAt: number | null; stale?: boolean } = $props();

	function when(ts: number): string {
		return new Date(ts).toLocaleString(getLocale());
	}
</script>

{#if savedAt}
	<p class="saved-copy" class:saved-copy--stale={stale} role="status">
		{m.offline_savedCopy({ when: when(savedAt) })}
	</p>
{/if}

<style lang="scss">
	.saved-copy {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		padding: var(--space-2) var(--space-3);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm, 4px);
	}
	// Past a day the copy is old enough that it should catch the eye rather than sit quietly.
	.saved-copy--stale {
		color: var(--status-warning, var(--text-secondary));
		border-style: solid;
	}
</style>
