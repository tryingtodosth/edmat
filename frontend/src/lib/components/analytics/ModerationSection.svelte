<script lang="ts">
	/** The moderation queues: what waits, what was submitted and decided, and how long a decision
	 *  took. A queue that never stored WHEN something was decided says "not recorded" — it does not
	 *  show a median it cannot compute. */
	import { m } from '$lib/paraglide/messages.js';
	import { getModeration } from '$lib/services/analytics';
	import type { AnalyticsDays } from '$lib/types/analytics';
	import { formatCount } from './format';
	import { queueLabel } from './labels';
	import Section from './Section.svelte';

	let { days, reloadKey }: { days: AnalyticsDays; reloadKey: number } = $props();
</script>

<Section id="moderation" title={m.analytics_moderation_title()} deps={`${days}:${reloadKey}`} load={() => getModeration(days)}>
	<!-- "Moderation queues" -->
	{#snippet children(d)}
		<div class="table-wrap">
			<table class="atable">
				<caption class="sr">{m.analytics_moderation_title()}</caption>
				<thead>
					<tr>
						<th scope="col">{m.analytics_col_queue()}</th><!-- "Queue" -->
						<th scope="col" class="num">{m.analytics_col_pending()}</th><!-- "Waiting now" -->
						<th scope="col" class="num">{m.analytics_col_submitted()}</th><!-- "Submitted" -->
						<th scope="col" class="num">{m.analytics_col_decided()}</th><!-- "Decided" -->
						<th scope="col" class="num">{m.analytics_col_accepted()}</th><!-- "Accepted" -->
						<th scope="col" class="num">{m.analytics_col_median()}</th><!-- "Median time to decision" -->
					</tr>
				</thead>
				<tbody>
					{#each d.queues as q (q.queue)}
						<tr>
							<th scope="row">{queueLabel(q.queue)}</th>
							<td class="num">{formatCount(q.pending)}</td>
							<td class="num">{formatCount(q.submitted)}</td>
							<td class="num">
								{formatCount(q.decided)}
								<span class="basis"
									>{q.decidedBasis === 'decided_in_period'
										? m.analytics_basis_decided()
										: m.analytics_basis_submitted()}</span
								><!-- "decided in the period" / "of those submitted in the period" -->
							</td>
							<td class="num">{q.accepted === null ? '—' : formatCount(q.accepted)}</td>
							<td class="num">
								{#if !q.timingRecorded}
									<span class="norec" title={m.analytics_notRecorded_hint()}>{m.analytics_notRecorded()}</span><!-- "not recorded" / "This queue never stored when an item was decided, so a time to decision cannot be computed." -->
								{:else if q.medianHoursToDecision === null}
									—
								{:else}
									{m.analytics_hours({ n: Math.round(q.medianHoursToDecision * 10) / 10 })}<!-- "{n} h" -->
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="note">{m.analytics_moderation_note()}</p><!-- "Two ways of counting “decided”: where a queue records when it decided something, decisions made in the period are counted; where it does not, the count is of the decisions among what was submitted in the period. “Not recorded” means the queue never stored when an item was decided." -->
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
	.basis {
		display: block;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		white-space: normal;
	}
	.norec {
		color: var(--text-secondary);
		font-style: italic;
		cursor: help;
	}
</style>
