<script lang="ts">
	/**
	 * The contests hub — PLACEHOLDER written by the prep commit (CONTESTS-BRIEF.md §2) so that
	 * `utils/nodeHref.ts` can resolve `/contests/[id]` and the header's marker has an address.
	 * Step A (`prompts/18-contests-a-core.md`) replaces this whole file.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
</script>

<PageHead title={m.contests_title()} description={m.contests_placeholder()} />
<!-- "Contests" -->

<FeatureGate feature="contests">
	<section class="page">
		<h1>{m.contests_title()}</h1>
		<!-- "Contests" -->
		<p>{m.contests_placeholder()}</p>
		<!-- "Contests are being built. Nothing to see here yet." -->
	</section>
</FeatureGate>
