<script lang="ts">
	/** Requests per day by audience (bots shown, but hatched and last), daily server errors, and the
	 *  busiest routes. Percentiles of different days cannot be merged, so both columns are
	 *  request-weighted means of the daily values; the worst day's 95th is named under it only when
	 *  it is more than twice the typical one AND at least half a second (a one-off — a restart — rather
	 *  than a slow route; a 170 ms worst day is not news). */
	import { m } from '$lib/paraglide/messages.js';
	import { getTraffic } from '$lib/services/analytics';
	import type { AnalyticsDays } from '$lib/types/analytics';
	import { formatCount, formatMs } from './format';
	import Section from './Section.svelte';
	import TimeSeriesChart from './TimeSeriesChart.svelte';

	let { days, reloadKey }: { days: AnalyticsDays; reloadKey: number } = $props();
</script>

<Section
	id="traffic"
	title={m.analytics_traffic_title()}
	deps={`${days}:${reloadKey}`}
	load={() => getTraffic(days)}
>
	<!-- "Traffic" -->
	{#snippet children(t)}
		{@const dates = t.daily.map((d) => d.date)}
		<h3>{m.analytics_traffic_byAudience()}</h3>
		<!-- "Requests per day, by who sent them" -->
		<TimeSeriesChart
			{dates}
			stacked
			title={m.analytics_traffic_byAudience_summary({ days: t.period.days })}
			series={[
				{
					key: 'auth',
					label: m.analytics_aud_auth(),
					values: t.daily.map((d) => d.auth),
					color: 'var(--accent)'
				},
				{
					key: 'anon',
					label: m.analytics_aud_anon(),
					values: t.daily.map((d) => d.anon),
					color: 'var(--text-secondary)'
				},
				{
					key: 'bot',
					label: m.analytics_aud_bot(),
					values: t.daily.map((d) => d.bot),
					color: 'var(--status-neutral)',
					hatch: true
				}
			]}
		/><!-- "Daily requests over the last {days} days, split into signed-in, anonymous and bots" -->
		<h3>{m.analytics_traffic_errors()}</h3>
		<!-- "Server errors (5xx) per day" -->
		<TimeSeriesChart
			{dates}
			title={m.analytics_traffic_errors_summary({ days: t.period.days })}
			series={[
				{
					key: '5xx',
					label: m.analytics_traffic_errors_label(),
					values: t.daily.map((d) => d.status5xx),
					color: 'var(--status-danger)'
				}
			]}
		/><!-- "Daily server errors over the last {days} days" / "5xx responses" -->
		<h3>{m.analytics_traffic_routes()}</h3>
		<!-- "Busiest routes" -->
		<div class="table-wrap">
			<table class="atable">
				<caption class="sr">{m.analytics_traffic_routes()}</caption>
				<thead>
					<tr>
						<th scope="col">{m.analytics_col_route()}</th><!-- "Route" -->
						<th scope="col">{m.analytics_col_method()}</th><!-- "Method" -->
						<th scope="col" class="num">{m.analytics_col_requests()}</th><!-- "Requests" -->
						<th scope="col" class="num">4xx</th>
						<th scope="col" class="num">5xx</th>
						<th scope="col" class="num">{m.analytics_col_p50()}</th><!-- "Median" -->
						<th scope="col" class="num" title={m.analytics_col_p95_hint()}
							>{m.analytics_col_p95()}</th
						><!-- "95th, typical day" / "Percentiles of different days cannot be merged, so this is the daily 95th percentile averaged over the period, weighted by requests. …" -->
					</tr>
				</thead>
				<tbody>
					{#each t.routes as r (r.method + r.route)}
						<tr>
							<th scope="row" class="mono routecell">{r.route}</th>
							<td>{r.method}</td>
							<td class="num">{formatCount(r.requests)}</td>
							<td class="num">{formatCount(r.status4xx)}</td>
							<td class="num" class:danger={r.status5xx > 0}>{formatCount(r.status5xx)}</td>
							<td class="num">{formatMs(r.p50Ms)}</td>
							<td class="num">
								{formatMs(r.p95Ms)}
								{#if r.p95MsWorstDay > 2 * r.p95Ms && r.p95MsWorstDay >= 500}
									<span class="worst"
										>{m.analytics_route_worstDay({ ms: formatMs(r.p95MsWorstDay) })}</span
									><!-- "worst day: {ms}" -->
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if t.routeCount > t.routes.length}
			<p class="note">
				{m.analytics_traffic_routesShown({ shown: t.routes.length, total: t.routeCount })}
			</p>
			<!-- "Showing the {shown} busiest of {total} routes." -->
		{/if}
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
	.worst {
		display: block;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.danger {
		color: var(--status-danger);
		font-weight: 600;
	}
	.routecell {
		color: var(--text-primary) !important;
		font-weight: 400 !important;
		white-space: normal !important;
	}
</style>
