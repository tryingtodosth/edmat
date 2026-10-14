<script lang="ts">
	/** Retention: of the accounts that signed up in a given week, how many were active N weeks later.
	 *  Minors' accounts and requests from browsers that objected (GPC / DNT) are not in these numbers. */
	import { m } from '$lib/paraglide/messages.js';
	import { getCohorts } from '$lib/services/analytics';
	import type { AnalyticsDays } from '$lib/types/analytics';
	import CohortHeatmap from './CohortHeatmap.svelte';
	import Section from './Section.svelte';

	let { days, reloadKey }: { days: AnalyticsDays; reloadKey: number } = $props();
</script>

<Section id="cohorts" title={m.analytics_cohorts_title()} deps={`${days}:${reloadKey}`} load={() => getCohorts(days)}>
	<!-- "Retention by signup week" -->
	{#snippet children(c)}
		<p class="note">{m.analytics_cohorts_explain({ k: c.k })}</p><!-- "Each cell is the share of that week's new accounts that were active N weeks later; darker is higher. Groups of fewer than {k} people are shown as “<{k}”. Accounts of minors and browsers that sent Global Privacy Control or Do Not Track are not counted." -->
		<CohortHeatmap data={c} />
	{/snippet}
</Section>
