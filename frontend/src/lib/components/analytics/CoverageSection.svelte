<script lang="ts">
	/** How much of the corpus has a hint, a solution, a reviewed solution and a translation, per
	 *  discipline and branch. Counts of exercises, not of people. */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getCoverage } from '$lib/services/analytics';
	import type { AnalyticsDays } from '$lib/types/analytics';
	import { formatCount } from './format';
	import Section from './Section.svelte';

	let { days, reloadKey }: { days: AnalyticsDays; reloadKey: number } = $props();
</script>

<Section
	id="coverage"
	title={m.analytics_coverage_title()}
	intro={m.analytics_coverage_intro()}
	deps={`${days}:${reloadKey}:${getLocale()}`}
	load={() => getCoverage(days, getLocale())}
>
	<!-- "Coverage of the corpus" / "How many exercises in each branch have a hint, a solution, a verified solution and a translation." -->
	{#snippet children(c)}
		{#each c.disciplines as d (d.slug)}
			<div class="table-wrap">
				<table class="atable">
					<caption>{d.name}</caption>
					<thead>
						<tr>
							<th scope="col">{m.analytics_col_branch()}</th>
							<th scope="col" class="num">{m.analytics_col_exercises()}</th>
							<th scope="col" class="num">{m.analytics_col_withHint()}</th><!-- "With hint" -->
							<th scope="col" class="num">{m.analytics_col_withSolution()}</th>
							<th scope="col" class="num">{m.analytics_col_verified()}</th><!-- "Verified" -->
							{#each c.locales as loc (loc)}
								<th scope="col" class="num"
									>{m.analytics_col_translated({ locale: loc.toUpperCase() })}</th
								><!-- "Translated ({locale})" -->
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each d.branches as b (b.slug)}
							<tr>
								<th scope="row"
									><a href={resolve('/branches/[branch]', { branch: b.slug })}>{b.name}</a></th
								>
								<td class="num">{formatCount(b.exercises)}</td>
								<td class="num">{formatCount(b.withHint)}</td>
								<td class="num">{formatCount(b.withSolution)}</td>
								<td class="num">{formatCount(b.verified)}</td>
								{#each c.locales as loc (loc)}
									<td class="num">{formatCount(b.translated[loc] ?? 0)}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/each}
	{/snippet}
</Section>
