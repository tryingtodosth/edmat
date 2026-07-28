<script lang="ts">
	// The materials search/filter/sort overhaul's own "genuine personalization dimension," surfaced
	// as a real, visible section — not just a hidden GET /api/materials/recommended/ capability
	// nobody ever calls. See materials/services.py's `get_recommended_materials` (backend) for the
	// full scoring rationale, and RecommendedMaterialsResult's own doc comment (material.ts) for why
	// `personalized` genuinely changes what heading renders here rather than always claiming
	// "Recommended for you" even for a visitor this app has no real signal for yet.
	import { m } from '$lib/paraglide/messages.js';
	import { getRecommendedMaterials } from '$lib/services/materials';
	import MaterialCard from './MaterialCard.svelte';

	// No `topics` prop: recommended materials can span several different courses at once, and
	// MaterialCard's own "add coverage" trigger needs a topic list scoped to ONE specific course to
	// mean anything — safely omitted here (MaterialCard already defaults it to `[]`, which just hides
	// that trigger) rather than passing a list that would be wrong for most of the cards shown.

	let loading = $state(true);
	let personalized = $state(false);
	let materials = $state<Awaited<ReturnType<typeof getRecommendedMaterials>>['materials']>([]);

	$effect(() => {
		loading = true;
		getRecommendedMaterials(6).then((result) => {
			personalized = result.personalized;
			materials = result.materials;
			loading = false;
		});
	});
</script>

{#if loading}
	<p class="loading">{m.common_loading()}</p>
{:else if materials.length > 0}
	<section class="recommended">
		<div class="recommended__heading">
			<h2>{personalized ? m.recommended_headingPersonalized() : m.recommended_headingDefault()}</h2>
			<p class="subtitle">
				{personalized ? m.recommended_subtitlePersonalized() : m.recommended_subtitleDefault()}
			</p>
		</div>
		<div class="recommended__grid">
			{#each materials as material (material.id)}
				<MaterialCard {material} />
			{/each}
		</div>
	</section>
{/if}

<style lang="scss">
	.loading {
		color: var(--text-secondary);
	}
	.recommended {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.recommended__heading h2 {
		font-size: var(--font-size-lg);
	}
	.subtitle {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.recommended__grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
</style>
