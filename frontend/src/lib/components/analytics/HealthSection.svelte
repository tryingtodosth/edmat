<script lang="ts">
	/** The last seven days of the server's own behaviour: status classes, which routes returned 5xx
	 *  (with request ids to look up in the log), and the slowest routes. Always 7 days — the period
	 *  selector does not apply here. */
	import { m } from '$lib/paraglide/messages.js';
	import { getHealth } from '$lib/services/analytics';
	import { formatDateTime } from '$lib/utils/datetime';
	import BarList from './BarList.svelte';
	import CopyId from './CopyId.svelte';
	import { formatCount, formatMs } from './format';
	import { statusLabel } from './labels';
	import Section from './Section.svelte';

	let { reloadKey }: { reloadKey: number } = $props();
</script>

<Section
	id="health"
	title={m.analytics_health_title()}
	intro={m.analytics_health_intro()}
	deps={`${reloadKey}`}
	load={() => getHealth()}
>
	<!-- "Health (last 7 days)" / "Always the last 7 days, whatever period is selected above." -->
	{#snippet children(h)}
		<h3>{m.analytics_health_statuses()}</h3>
		<!-- "Responses by class" -->
		<BarList
			items={Object.entries(h.statuses).map(([k, v]) => ({
				key: k,
				label: statusLabel(k),
				value: v
			}))}
		/>
		<h3>{m.analytics_health_errors()}</h3>
		<!-- "Routes that returned a 5xx" -->
		{#if h.errors.length === 0}
			<p class="note">{m.analytics_health_noErrors()}</p>
			<!-- "No server errors in this window." -->
		{:else}
			<div class="table-wrap">
				<table class="atable">
					<caption class="sr">{m.analytics_health_errors()}</caption>
					<thead>
						<tr>
							<th scope="col">{m.analytics_col_route()}</th>
							<th scope="col">{m.analytics_col_method()}</th>
							<th scope="col" class="num">{m.analytics_col_count()}</th><!-- "Errors" -->
							<th scope="col">{m.analytics_col_lastSeen()}</th><!-- "Last seen" -->
						</tr>
					</thead>
					<tbody>
						{#each h.errors as e (e.method + e.route)}
							<tr>
								<th scope="row" class="mono routecell">{e.route}</th>
								<td>{e.method}</td>
								<td class="num">{formatCount(e.count)}</td>
								<td>{formatDateTime(e.lastSeen)}</td>
							</tr>
							<!-- The ids get a full-width row of their own: as a fifth column they pushed the
							     table five times taller than its content and off a phone screen. -->
							<tr class="ids-row">
								<td colspan="4">
									<span class="ids-label">{m.analytics_col_requestIds()}:</span
									><!-- "Request ids" -->
									<ul class="ids">
										{#each e.requestIds.slice(0, 5) as id (id)}<li><CopyId value={id} /></li>{/each}
									</ul>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		<h3>{m.analytics_health_slowest()}</h3>
		<!-- "Slowest routes" -->
		<div class="table-wrap">
			<table class="atable">
				<caption class="sr">{m.analytics_health_slowest()}</caption>
				<thead>
					<tr>
						<th scope="col">{m.analytics_col_route()}</th>
						<th scope="col">{m.analytics_col_method()}</th>
						<th scope="col" class="num">{m.analytics_col_requests()}</th>
						<th scope="col" class="num">{m.analytics_col_p50()}</th>
						<th scope="col" class="num">{m.analytics_col_p95Window()}</th><!-- "95th percentile" -->
						<th scope="col" class="num">{m.analytics_col_max()}</th><!-- "Slowest" -->
					</tr>
				</thead>
				<tbody>
					{#each h.slowest as s (s.method + s.route)}
						<tr>
							<th scope="row" class="mono routecell">{s.route}</th>
							<td>{s.method}</td>
							<td class="num">{formatCount(s.requests)}</td>
							<td class="num">{formatMs(s.p50Ms)}</td>
							<td class="num">{formatMs(s.p95Ms)}</td>
							<td class="num">{formatMs(s.maxMs)}</td>
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
	.ids {
		list-style: none;
		margin: var(--space-1) 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
	}
	.ids li {
		min-width: 0;
		max-width: 100%;
	}
	.ids-label {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.ids-row td {
		padding-top: 0;
		white-space: normal;
	}
	.routecell {
		color: var(--text-primary) !important;
		font-weight: 400 !important;
		white-space: normal !important;
		overflow-wrap: anywhere;
		min-width: 9ch;
	}
</style>
