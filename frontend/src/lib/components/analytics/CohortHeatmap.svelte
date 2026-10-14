<script lang="ts">
	/**
	 * Retention cohorts as a table: a row per signup week, a column per week since signup, each cell
	 * the share of that cohort active that week. One hue (the accent), light to dark, scaled to the
	 * largest rate on the page; every cell prints its percentage so colour is never the only carrier.
	 * A suppressed cell (a small group) is "<10" on a neutral ground — not 0 %, which would be a claim.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { AnalyticsCohorts } from '$lib/types/analytics';
	import { formatPercent, PRIVACY_K, shortDate } from './format';
	import People from './People.svelte';

	let { data }: { data: AnalyticsCohorts } = $props();
	const offsets = $derived(Array.from({ length: data.maxOffset + 1 }, (_, i) => i));
	const top = $derived(
		Math.max(...data.cohorts.flatMap((c) => c.cells.map((x) => x.rate ?? 0)), 0.01)
	);
</script>

<div class="table-wrap">
	<table class="atable heat">
		<caption class="sr">{m.analytics_cohorts_caption()}</caption><!-- "Share of each signup week's accounts that were active, by weeks since signup" -->
		<thead>
			<tr>
				<th scope="col">{m.analytics_cohorts_signupWeek()}</th><!-- "Signed up (week of)" -->
				<th scope="col" class="num">{m.analytics_cohorts_size()}</th><!-- "Accounts" -->
				{#each offsets as o (o)}<th scope="col" class="num">{m.analytics_cohorts_weekN({ n: o })}</th>{/each}<!-- "W{n}" -->
			</tr>
		</thead>
		<tbody>
			{#each data.cohorts as c (c.cohortWeek)}
				<tr>
					<th scope="row">{shortDate(c.cohortWeek)}</th>
					<td class="num"><People value={c.size} /></td>
					{#each offsets as o (o)}
						{@const cell = c.cells.find((x) => x.offset === o)}
						{#if !cell}
							<td class="num empty">·</td>
						{:else if cell.rate === null}
							<td
								class="num hidden"
								title={cell.users === null
									? m.analytics_people_hidden({ k: PRIVACY_K })
									: m.analytics_cohorts_noCohort()}
							>
								{cell.users === null ? `<${PRIVACY_K}` : '–'}<!-- "fewer than {k} — hidden to protect privacy" / "No accounts in this cohort" -->
							</td>
						{:else}
							<td
								class="num cellrate"
								style:background={`color-mix(in srgb, var(--accent) ${Math.round((cell.rate / top) * 45)}%, var(--bg-surface))`}
								title={m.analytics_cohorts_cellTitle({ users: cell.users ?? 0 })}
							>
								{formatPercent(cell.rate)}<!-- "{users} active accounts" -->
							</td>
						{/if}
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style lang="scss">
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.hidden {
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
		font-style: italic;
	}
	.empty {
		color: var(--text-secondary);
	}
	.cellrate {
		color: var(--text-primary);
	}
</style>
