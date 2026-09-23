<script lang="ts">
	/**
	 * An article's history: every revision this reader is allowed to see, newest first.
	 *
	 * Newest first even though the backend orders by number ascending — a history is read from what
	 * happened last. The row says what state it ended in, because "revision 4" means something
	 * different when it was rejected than when it is the one people are reading.
	 *
	 * Selection is client-side rather than a route of its own: the history page holds one list and
	 * one reader beside it, and a URL per revision would be a page with no content of its own.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import type { ConceptRevision } from '$lib/types/concept';
	import { REVISION_STATUS_LABELS } from './labels';

	let {
		revisions,
		currentId = null,
		onselect
	}: {
		revisions: ConceptRevision[];
		currentId?: string | null;
		onselect: (revision: ConceptRevision) => void;
	} = $props();

	const ordered = $derived([...revisions].sort((a, b) => b.number - a.number));
</script>

<section class="revisions">
	<h2>{m.concept_revisions_heading()}</h2>
	<!-- "Revisions" -->
	{#if ordered.length === 0}
		<p class="hint">{m.concept_revisions_empty()}</p>
		<!-- "No revisions yet." -->
	{:else}
		<ul>
			{#each ordered as revision (revision.id)}
				<li class:here={revision.id === currentId}>
					<button type="button" onclick={() => onselect(revision)}>
						<span class="number">{m.concept_revisions_number({ number: revision.number })}</span>
						<!-- "Revision {number}" -->
						<span class="badge badge--{revision.status}"
							>{REVISION_STATUS_LABELS[revision.status]()}</span
						>
						<span class="when">{formatDate(revision.publishedAt ?? revision.createdAt)}</span>
						{#if revision.createdByDisplayName}
							<span class="who">{m.concept_by({ name: revision.createdByDisplayName })}</span>
							<!-- "by {name}" -->
						{/if}
					</button>
					{#if revision.changeNote}
						<p class="note">{revision.changeNote}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.revisions {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	li {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.here {
		border-color: var(--accent);
	}
	li > button {
		@include mix.focus-ring;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.number {
		font-weight: 600;
	}
	.badge {
		font-size: var(--font-size-xs);
		border-radius: 999px;
		padding: 1px var(--space-2);
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
	}
	.badge--published {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.badge--pending {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
	}
	.badge--rejected {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.when,
	.who,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.note {
		margin: 0;
		font-size: var(--font-size-sm);
	}
</style>
