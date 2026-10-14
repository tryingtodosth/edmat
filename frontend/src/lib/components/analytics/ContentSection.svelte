<script lang="ts">
	/** What people look at: views per day and by kind, the most-viewed exercises and materials, and
	 *  the branches with the least solved material. Counts about content are plain numbers; none of
	 *  them is a count of people. */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getContent } from '$lib/services/analytics';
	import type { AnalyticsDays } from '$lib/types/analytics';
	import { localizedPath } from '$lib/utils/localizedPath';
	import BarList from './BarList.svelte';
	import { formatCount, formatPercent } from './format';
	import { kindLabel } from './labels';
	import Section from './Section.svelte';
	import TimeSeriesChart from './TimeSeriesChart.svelte';

	let { days, reloadKey }: { days: AnalyticsDays; reloadKey: number } = $props();
</script>

<Section
	id="content"
	title={m.analytics_content_title()}
	deps={`${days}:${reloadKey}:${getLocale()}`}
	load={() => getContent(days, getLocale())}
>
	<!-- "Content" -->
	{#snippet children(c)}
		<h3>{m.analytics_content_perDay()}</h3><!-- "Content views per day" -->
		<TimeSeriesChart
			dates={c.daily.map((d) => d.date)}
			title={m.analytics_content_perDay_summary({ days: c.period.days })}
			series={[{ key: 'views', label: m.analytics_content_views(), values: c.daily.map((d) => d.views), color: 'var(--accent)' }]}
		/><!-- "Daily content views over the last {days} days" / "Views" -->
		<div class="grid2">
			<div>
				<h3>{m.analytics_content_byKind()}</h3><!-- "Views by kind of page" -->
				<BarList items={c.byKind.map((k) => ({ key: k.kind, label: kindLabel(k.kind), value: k.views }))} />
			</div>
			<div>
				<h3>{m.analytics_content_topExercises()}</h3><!-- "Most viewed exercises" -->
				{#if c.topExercises.length === 0}
					<p class="note">{m.analytics_empty()}</p><!-- "Nothing to show for this period." -->
				{:else}
					<BarList
						items={c.topExercises.map((e) => ({
							key: e.id,
							label: e.title || `#${e.number}`,
							note: `${e.branch} · #${e.number}`,
							value: e.views,
							href: resolve('/exercises/[id]', { id: e.id })
						}))}
					/>
				{/if}
			</div>
			<div>
				<h3>{m.analytics_content_topMaterials()}</h3><!-- "Most viewed materials" -->
				{#if c.topMaterials.length === 0}
					<p class="note">{m.analytics_empty()}</p>
				{:else}
					<BarList
						items={c.topMaterials.map((x) => ({
							key: x.id,
							label: x.title,
							value: x.views,
							href: localizedPath(resolve('/materials/[id]', { id: x.id }))
						}))}
					/>
				{/if}
			</div>
		</div>
		<h3>{m.analytics_content_leastCovered()}</h3><!-- "Branches with the least solved material" -->
		<div class="table-wrap">
			<table class="atable">
				<caption class="sr">{m.analytics_content_leastCovered()}</caption>
				<thead>
					<tr>
						<th scope="col">{m.analytics_col_branch()}</th><!-- "Branch" -->
						<th scope="col">{m.analytics_col_discipline()}</th><!-- "Discipline" -->
						<th scope="col" class="num">{m.analytics_col_exercises()}</th><!-- "Exercises" -->
						<th scope="col" class="num">{m.analytics_col_withSolution()}</th><!-- "With solution" -->
						<th scope="col" class="num">{m.analytics_col_solutionShare()}</th><!-- "Solved share" -->
					</tr>
				</thead>
				<tbody>
					{#each c.leastCovered as b (b.slug)}
						<tr>
							<th scope="row"><a href={resolve('/branches/[branch]', { branch: b.slug })}>{b.name}</a></th>
							<td>{b.discipline}</td>
							<td class="num">{formatCount(b.exercises)}</td>
							<td class="num">{formatCount(b.withSolution)}</td>
							<td class="num">{formatPercent(b.solutionShare)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/snippet}
</Section>

<style lang="scss">
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
