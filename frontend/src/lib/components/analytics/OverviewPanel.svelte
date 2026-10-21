<script lang="ts">
	/** The top of the dashboard: how fresh the numbers are, the recompute button, and the KPI tiles
	 *  with their previous-period comparison. "Never rolled up" is said in words, because a page of
	 *  zeros would otherwise read as "no traffic". */
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getOverview, recomputeAnalytics } from '$lib/services/analytics';
	import type { AnalyticsDays, Delta, PeopleCount } from '$lib/types/analytics';
	import { formatDateTime } from '$lib/utils/datetime';
	import { formatCount, formatPercent, peopleText } from './format';
	import KpiTile from './KpiTile.svelte';
	import People from './People.svelte';
	import Section from './Section.svelte';

	interface Props {
		days: AnalyticsDays;
		reloadKey: number;
		onrecomputed: () => void;
	}
	let { days, reloadKey, onrecomputed }: Props = $props();

	let running = $state(false);
	let result = $state('');
	let failed = $state(false);

	async function recompute() {
		running = true;
		result = '';
		failed = false;
		try {
			const r = await recomputeAnalytics();
			result = m.analytics_recompute_done({ days: r.days.length }); // "Recounted {days} day(s)."
			onrecomputed();
		} catch (e) {
			failed = true;
			result = m.analytics_recompute_failed({ error: e instanceof Error ? e.message : String(e) }); // "Recount failed: {error}"
		} finally {
			running = false;
		}
	}

	/** "+12 % vs the previous 30 days (240)" — or the previous value alone when a percentage would
	 *  be meaningless (previous 0, a rate, a suppressed count). */
	function compare<T extends number | null>(
		d: Delta<T>,
		fmt: (v: number) => string,
		people = false
	): string {
		const prev = d.previous;
		if (prev === null || prev === undefined) {
			return people && d.value === null ? '' : m.analytics_cmp_none(); // "No comparison available"
		}
		const prevText = fmt(prev);
		if (typeof d.value === 'number' && prev > 0 && !people) {
			const delta = new Intl.NumberFormat(getLocale(), {
				style: 'percent',
				maximumFractionDigits: 0,
				signDisplay: 'exceptZero'
			}).format((d.value - prev) / prev);
			return m.analytics_cmp_change({ delta, days, previous: prevText }); // "{delta} vs the previous {days} days ({previous})"
		}
		return m.analytics_cmp_previous({ days, previous: prevText }); // "Previous {days} days: {previous}"
	}
	const cmpPeople = (d: Delta<PeopleCount>) =>
		!d.compared
			? m.analytics_cmp_none() // "No comparison available"
			: d.previous === null && d.value !== null
				? m.analytics_cmp_previous({ days, previous: peopleText(null) })
				: d.value === null && d.previous !== null
					? m.analytics_cmp_previous({ days, previous: peopleText(d.previous) })
					: d.value === null
						? ''
						: compare(d, formatCount, true);
</script>

<Section
	id="overview"
	title={m.analytics_overview_title()}
	deps={`${days}:${reloadKey}`}
	load={() => getOverview(days)}
>
	{#snippet children(o)}
		<p class="fresh">
			{#if o.freshness.lastRollupAt === null}
				<strong>{m.analytics_fresh_never()}</strong
				><!-- "Nothing has been rolled up yet. The zeros below mean "not counted", not "no visitors"." -->
			{:else}
				{m.analytics_fresh_last({
					when: formatDateTime(o.freshness.lastRollupAt)
				})}<!-- "Last rollup: {when}." -->
			{/if}
			{#if o.freshness.daysMissing.length > 0}
				{m.analytics_fresh_missing({
					count: o.freshness.daysMissing.length,
					days: o.period.days
				})}<!-- "{count} of these {days} days are not rolled up yet and show zero." -->
			{/if}
			{m.analytics_fresh_excluded({
				count: formatCount(o.freshness.excludedByObjection)
			})}<!-- "{count} requests were left out because the browser sent Global Privacy Control or Do Not Track." -->
		</p>
		<p class="actions">
			<button type="button" onclick={recompute} disabled={running}>
				{running
					? m.analytics_recompute_running()
					: m.analytics_recompute()}<!-- "Recounting…" / "Recompute today and yesterday" -->
			</button>
			{#if result}<span class:bad={failed} role="status">{result}</span>{/if}
		</p>
		{@const k = o.kpis}
		<div class="kpis">
			<KpiTile
				label={m.analytics_kpi_humanRequests()}
				comparison={compare(k.humanRequests, formatCount)}
				hint={m.analytics_kpi_humanRequests_hint()}
			>
				{#snippet value()}{formatCount(k.humanRequests.value)}{/snippet}
			</KpiTile><!-- "Human requests" / "API requests from browsers, bots not included" -->
			<KpiTile
				label={m.analytics_kpi_contentViews()}
				comparison={compare(k.contentViews, formatCount)}
			>
				{#snippet value()}{formatCount(k.contentViews.value)}{/snippet}
			</KpiTile><!-- "Content views" -->
			<KpiTile label={m.analytics_kpi_avgActive()} comparison={cmpPeople(k.avgDailyActiveUsers)}>
				{#snippet value()}<People value={k.avgDailyActiveUsers.value} />{/snippet}
			</KpiTile><!-- "Average daily active accounts" -->
			<KpiTile label={m.analytics_kpi_peakActive()} comparison={cmpPeople(k.peakDailyActiveUsers)}>
				{#snippet value()}<People value={k.peakDailyActiveUsers.value} />{/snippet}
			</KpiTile><!-- "Peak daily active accounts" -->
			<KpiTile label={m.analytics_kpi_registrations()} comparison={cmpPeople(k.registrations)}>
				{#snippet value()}<People value={k.registrations.value} />{/snippet}
			</KpiTile><!-- "Registrations" -->
			<KpiTile
				label={m.analytics_kpi_submissions()}
				comparison={compare(k.submissions, formatCount)}
			>
				{#snippet value()}{formatCount(k.submissions.value)}{/snippet}
			</KpiTile><!-- "Submissions" -->
			<KpiTile label={m.analytics_kpi_comments()} comparison={compare(k.comments, formatCount)}>
				{#snippet value()}{formatCount(k.comments.value)}{/snippet}
			</KpiTile><!-- "Comments" -->
			<KpiTile label={m.analytics_kpi_searches()} comparison={compare(k.searches, formatCount)}>
				{#snippet value()}{formatCount(k.searches.value)}{/snippet}
			</KpiTile><!-- "Searches" -->
			<KpiTile
				label={m.analytics_kpi_errorRate()}
				comparison={compare(k.errorRate, (v) => formatPercent(v, 2), true)}
				hint={m.analytics_kpi_errorRate_hint()}
			>
				{#snippet value()}{k.errorRate.value === null
						? '—'
						: formatPercent(k.errorRate.value, 2)}{/snippet}
			</KpiTile><!-- "Server error rate (5xx)" / "Share of all requests answered with a 5xx" -->
			<KpiTile
				label={m.analytics_kpi_pending()}
				comparison={compare(k.pendingInQueues, formatCount)}
				hint={m.analytics_kpi_pending_hint()}
			>
				{#snippet value()}{formatCount(k.pendingInQueues.value)}{/snippet}
			</KpiTile><!-- "Waiting in moderation queues" / "Right now, not over the period" -->
		</div>
	{/snippet}
</Section>

<style lang="scss">
	.fresh {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin: 0 0 var(--space-4);
		font-size: var(--font-size-sm);
	}
	.bad {
		color: var(--status-danger);
	}
	.kpis {
		display: grid;
		gap: var(--space-3);
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr));
	}
</style>
