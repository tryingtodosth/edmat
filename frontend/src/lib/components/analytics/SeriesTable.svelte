<script lang="ts">
	/** Weekly series as a table: label, a tiny weekly trend, the period total, the all-time total.
	 *  The sparkline is decoration; the weekly numbers are in the row's title for hover and the
	 *  totals are real cells. */
	import { m } from '$lib/paraglide/messages.js';
	import type { WeeklySeries } from '$lib/types/analytics';
	import { formatCount } from './format';
	import Sparkline from './Sparkline.svelte';

	interface Props {
		caption: string;
		rows: { key: string; label: string; series: WeeklySeries }[];
	}
	let { caption, rows }: Props = $props();
</script>

<div class="table-wrap">
	<table class="atable">
		<caption>{caption}</caption>
		<thead>
			<tr>
				<th scope="col">{m.analytics_col_name()}</th><!-- "Name" -->
				<th scope="col">{m.analytics_col_weekly()}</th><!-- "By week" -->
				<th scope="col" class="num">{m.analytics_col_period()}</th><!-- "This period" -->
				<th scope="col" class="num">{m.analytics_col_allTime()}</th><!-- "All time" -->
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.key)}
				<tr>
					<th scope="row">{r.label}</th>
					<td title={r.series.weekly.map((w) => w.count).join(' · ')}>
						<Sparkline values={r.series.weekly.map((w) => w.count)} />
					</td>
					<td class="num">{formatCount(r.series.periodTotal)}</td>
					<td class="num">{formatCount(r.series.allTime)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
