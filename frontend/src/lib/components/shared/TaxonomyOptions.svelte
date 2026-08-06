<script lang="ts">
	// The <select> half of the "Others" grouping — settled nodes first, then anything somebody has
	// proposed, under an <optgroup>.
	//
	// <optgroup> rather than a disabled "— Others —" separator option or a suffix on each label:
	// it is the native element for exactly this, so a screen reader announces the group name with
	// each option inside it, and every browser already renders it as a labelled block. A separator
	// row is a visual trick that says nothing to anybody not looking at it.
	//
	// Renders bare <option>/<optgroup> elements and nothing else, so it can sit directly inside a
	// <select> — Svelte adds no wrapper of its own.
	import { m } from '$lib/paraglide/messages.js';
	import { splitByStatus } from '$lib/utils/taxonomy';
	import type { TaxonomyStatus } from '$lib/types';

	/** Structural, so one component serves Discipline, Branch and Topic alike. */
	interface Option {
		id: string;
		name: string;
		status: TaxonomyStatus;
	}

	let { nodes }: { nodes: Option[] } = $props();
	let grouped = $derived(splitByStatus(nodes));
</script>

{#each grouped.settled as node (node.id)}
	<option value={node.id}>{node.name}</option>
{/each}
{#if grouped.proposed.length > 0}
	<optgroup label={m.taxonomy_others()}>
		{#each grouped.proposed as node (node.id)}
			<option value={node.id}>{node.name}</option>
		{/each}
	</optgroup>
{/if}
