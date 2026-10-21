<script lang="ts">
	/** What people do on the site: weekly activity and feature use, accounts, and the contribution
	 *  funnel. Counts of PEOPLE (registrations, accounts, the funnel) can be suppressed (`null`) and
	 *  are drawn "<10". */
	import { m } from '$lib/paraglide/messages.js';
	import { getCommunity } from '$lib/services/analytics';
	import type { AnalyticsDays } from '$lib/types/analytics';
	import BarList from './BarList.svelte';
	import { formatPercent, shortDate } from './format';
	import { activityLabel, featureLabel } from './labels';
	import People from './People.svelte';
	import Section from './Section.svelte';
	import SeriesTable from './SeriesTable.svelte';

	let { days, reloadKey }: { days: AnalyticsDays; reloadKey: number } = $props();
</script>

<Section
	id="community"
	title={m.analytics_community_title()}
	deps={`${days}:${reloadKey}`}
	load={() => getCommunity(days)}
>
	<!-- "Community" -->
	{#snippet children(c)}
		<SeriesTable
			caption={m.analytics_community_activity()}
			rows={Object.entries(c.activity).map(([key, series]) => ({
				key,
				label: activityLabel(key),
				series
			}))}
		/><!-- "Activity by week" -->
		<h3>{m.analytics_community_accounts()}</h3>
		<!-- "Accounts" -->
		<div class="grid2">
			<div>
				<p class="note">{m.analytics_community_registrationsPerWeek()}</p>
				<!-- "Registrations per week" -->
				<BarList
					people
					items={c.accounts.weekly.map((w) => ({
						key: w.week,
						label: shortDate(w.week),
						value: w.count
					}))}
				/>
			</div>
			<dl class="facts">
				<dt>{m.analytics_community_registered()}</dt>
				<!-- "Registered in this period" -->
				<dd><People value={c.accounts.registered} /></dd>
				<dt>{m.analytics_community_total()}</dt>
				<!-- "Accounts in total" -->
				<dd><People value={c.accounts.totalAccounts} /></dd>
				<dt>{m.analytics_community_confirmation()}</dt>
				<!-- "Email confirmation rate" -->
				<dd>
					{c.accounts.confirmationRate === null ? '—' : formatPercent(c.accounts.confirmationRate)}
				</dd>
				<dt>{m.analytics_community_guardian()}</dt>
				<!-- "Created by a guardian" -->
				<dd><People value={c.accounts.guardianCreated} /></dd>
			</dl>
		</div>
		<h3>{m.analytics_community_funnel()}</h3>
		<!-- "Contribution funnel" -->
		<p class="note">{m.analytics_community_funnel_note()}</p>
		<!-- "Of the accounts registered in this period: how many submitted something, and how many had something accepted." -->
		<BarList
			people
			items={[
				{ key: 'registered', label: m.analytics_funnel_registered(), value: c.funnel.registered },
				{ key: 'submitted', label: m.analytics_funnel_submitted(), value: c.funnel.submitted },
				{ key: 'accepted', label: m.analytics_funnel_accepted(), value: c.funnel.accepted }
			]}
		/><!-- "Registered" / "Submitted something" / "Had something accepted" -->
		<!-- The table's own caption is the heading here; an <h3> above it printed the title twice. -->
		<SeriesTable
			caption={m.analytics_community_features()}
			rows={Object.entries(c.features).map(([key, series]) => ({
				key,
				label: featureLabel(key),
				series
			}))}
		/>
	{/snippet}
</Section>

<style lang="scss">
	.facts {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		font-size: var(--font-size-sm);
		align-content: start;
	}
	.facts dt {
		color: var(--text-secondary);
	}
	.facts dd {
		margin: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
