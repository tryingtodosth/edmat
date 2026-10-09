<script lang="ts">
	/** The stage ladder: every round with its dates, what it does to who goes on, and "opens in".
	 *
	 * A stage is a link only when there is something behind it for this reader — the page refuses
	 * to show problems before the stage opens, and a link that leads to a refusal is house rule 3
	 * the wrong way round. Staff always get the link, because choosing the problems is what they do
	 * there before it opens.
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import { advancementLabel, stageStatusLabel } from '$lib/utils/labels';
	import type { ContestStage } from '$lib/types/contest';

	let {
		contestId,
		stages,
		isStaff = false
	}: { contestId: string; stages: ContestStage[]; isStaff?: boolean } = $props();

	/** Whole days until a date, or null once it is in the past. Days rather than a live countdown:
	 *  the countdown that matters is on the stage page itself, next to the answer boxes. */
	function daysUntil(iso: string | null): number | null {
		if (!iso) return null;
		const ms = new Date(iso).getTime() - Date.now();
		if (ms <= 0) return null;
		return Math.ceil(ms / 86_400_000);
	}
</script>

{#if stages.length === 0}
	<p class="empty">{m.contests_noStagesYet()}</p>
	<!-- "This contest has no stages yet. It cannot be announced until it has at least one." -->
{:else}
	<ol class="ladder">
		{#each stages as stage (stage.id)}
			{@const opensIn = daysUntil(stage.opensAt)}
			{@const closesIn = daysUntil(stage.closesAt)}
			{@const reachable = isStaff || stage.problemsVisible}
			<li class="stage" class:stage--open={stage.status === 'open'}>
				<div class="stage__head">
					<h4>
						{#if reachable}
							<a
								href={resolve('/contests/[id]/stages/[stageId]', {
									id: contestId,
									stageId: stage.id
								})}>{stage.title}</a
							>
						{:else}
							{stage.title}
						{/if}
					</h4>
					<span class="stage__status">{stageStatusLabel(stage.status)()}</span>
				</div>
				<p class="stage__meta">
					{#if stage.mode === 'onsite'}
						<span>{m.contests_stageOnsite()}</span>
						<!-- "In a room" -->
						{#if stage.event}
							<a href={resolve('/events/[id]', { id: stage.event.id })}>{stage.event.title}</a>
						{/if}
					{:else}
						<span>{m.contests_stageOnline()}</span>
						<!-- "Answered here" -->
					{/if}
					<span>·</span>
					<span>{advancementLabel(stage.advancement)()}</span>
					{#if stage.advancement === 'top_n' && stage.advanceCount}
						<span>({stage.advanceCount})</span>
					{/if}
					{#if stage.advancement === 'threshold' && stage.advanceThreshold !== null}
						<span>(≥ {stage.advanceThreshold})</span>
					{/if}
				</p>
				<p class="stage__dates">
					{#if stage.opensAt}
						{m.contests_stageOpensOn({ date: formatDate(stage.opensAt) })}
						<!-- "Opens {date}" -->
					{/if}
					{#if stage.closesAt}
						· {m.contests_stageClosesOn({ date: formatDate(stage.closesAt) })}
						<!-- "closes {date}" -->
					{/if}
					{#if opensIn !== null && stage.status === 'scheduled'}
						<strong>· {m.contests_stageOpensIn({ days: opensIn })}</strong>
						<!-- "opens in {days} days" -->
					{:else if closesIn !== null && stage.status === 'open'}
						<strong>· {m.contests_stageClosesIn({ days: closesIn })}</strong>
						<!-- "closes in {days} days" -->
					{/if}
				</p>
				{#if stage.description}
					<p class="stage__note">{stage.description}</p>
				{/if}
				{#if isStaff}
					<p class="stage__counts">
						{m.contests_stageCounts({
							problems: stage.problemCount,
							submissions: stage.submissionCount,
							points: stage.maxPoints
						})}
						<!-- "{problems} problems, {submissions} handed in, {points} points available" -->
						{#if stage.advancedAt}
							· {m.contests_stageAdvanced({ count: stage.advancedCount })}
							<!-- "{count} advanced" -->
						{/if}
					</p>
				{/if}
			</li>
		{/each}
	</ol>
{/if}

<style lang="scss">
	.ladder {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.stage {
		border: 1px solid var(--border-color);
		border-left: 3px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.8rem;
		background: var(--bg-surface);
	}
	.stage--open {
		border-left-color: var(--accent);
	}
	.stage__head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.6rem;
	}
	h4 {
		margin: 0;
		font-size: var(--font-size-md);
	}
	.stage__status {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.stage__meta,
	.stage__dates,
	.stage__counts,
	.stage__note {
		margin: 0.2rem 0 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.stage__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.empty {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
</style>
