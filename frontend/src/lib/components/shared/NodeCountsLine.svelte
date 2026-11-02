<script lang="ts">
	/**
	 * What a discipline or branch card says it holds, through the reader's audience lens.
	 *
	 * On a card the lens admits: per kind, only the kinds that have something ("Exercises: 392 ·
	 * Materials: 17"). On a card folded under "For other groups": per BAND, every kind summed
	 * ("University: 392 · Adult learners: 3") — that card is there to say who it IS for. A node with
	 * nothing published at all says so rather than drawing "Exercises: 0".
	 */
	import type { Audience, NodeCounts } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { AUDIENCE_LABELS } from '$lib/utils/labels';
	import { bandTotals, COUNTED_KINDS, lensCount } from '$lib/utils/audienceCounts';

	let {
		counts,
		bands,
		folded = false
	}: { counts: NodeCounts | undefined; bands: Audience[]; folded?: boolean } = $props();

	const KIND_LABEL = {
		exercises: m.branch_exerciseCount, // "Exercises: {count}"
		materials: m.branch_materialCount, // "Materials: {count}"
		courses: m.browse_courseCount // "Courses: {count}"
	};

	let parts = $derived(
		folded
			? bandTotals(counts).map(([band, count]) =>
					m.browse_bandCount({ band: AUDIENCE_LABELS[band](), count })
				) // "{band}: {count}"
			: COUNTED_KINDS.map((kind) => [kind, lensCount(counts, bands, kind)] as const)
					.filter(([, count]) => count > 0)
					.map(([kind, count]) => KIND_LABEL[kind]({ count }))
	);
</script>

<span class="counts" data-testid="node-counts">
	{#if parts.length > 0}{parts.join(' · ')}{:else}{m.browse_nothingYet()}{/if}
	<!-- "Nothing published here yet." -->
</span>

<style lang="scss">
	// A count is a fact, not a link (2026-10-07 colour pass): weighted, not coloured.
	.counts {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-weight: 600;
	}
</style>
