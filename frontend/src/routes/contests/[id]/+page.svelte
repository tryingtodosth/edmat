<script lang="ts">
	/**
	 * One contest — PLACEHOLDER written by the prep commit (CONTESTS-BRIEF.md §2). Step A replaces
	 * this whole file; until then the route exists so that a contest node's `nodeHref` resolves and
	 * the management panels have somewhere to mount.
	 */
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import ManagementPanels from '$lib/components/management/ManagementPanels.svelte';

	let id = $derived(page.params.id ?? '');
</script>

<PageHead title={m.contests_title()} description={m.contests_placeholder()} />
<!-- "Contests" -->

<FeatureGate feature="contests">
	<section class="page">
		<h1>{m.contests_title()}</h1>
		<!-- "Contests" -->
		<p>{m.contests_placeholder()}</p>
		<!-- "Contests are being built. Nothing to see here yet." -->
		{#if id}
			<ManagementPanels nodeKind="contest" nodeId={id} />
		{/if}
	</section>
</FeatureGate>
