<script lang="ts">
	/** One contest on the hub.
	 *
	 * **The organiser is above the fold, on every card** — not as decoration but because EdMat is
	 * never the *przyrzekający*: it hosts the announcement and nothing else, and a card that showed
	 * a prize and a date without naming who promised them would be the site appearing to promise
	 * it (CONTESTS-BRIEF.md §1, last row).
	 *
	 * "The next thing that happens" is computed here rather than sent: the server has no opinion
	 * about which date matters most to this reader, and the three candidates (registration closes,
	 * a stage opens, the contest ends) are all already on the payload.
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import { contestStatusLabel, presetName } from '$lib/utils/labels';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import type { Contest } from '$lib/types/contest';

	let { contest }: { contest: Contest } = $props();

	const nextThing = $derived.by(() => {
		const now = Date.now();
		const candidates: { when: string; label: string }[] = [];
		if (contest.registrationClosesAt)
			candidates.push({
				when: contest.registrationClosesAt,
				label: m.contests_nextRegistrationCloses()
			}); // "Registration closes"
		if (contest.endsAt) candidates.push({ when: contest.endsAt, label: m.contests_nextEnds() }); // "Ends"
		if (contest.complaintsCloseAt)
			candidates.push({
				when: contest.complaintsCloseAt,
				label: m.contests_nextComplaintsClose()
			}); // "Complaints window closes"
		const future = candidates
			.filter((c) => new Date(c.when).getTime() > now)
			.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
		return future[0] ?? null;
	});
</script>

<article class="card">
	<header>
		<h3>
			<a href={resolve('/contests/[id]', { id: contest.id })}>
				<MathTitle text={contest.title} />
			</a>
		</h3>
		<p class="organiser">
			{m.contests_organisedBy({ name: contest.organiser?.displayName ?? '—' })}
			<!-- "Organised by {name}" -->
		</p>
	</header>

	<p class="chips">
		{#if contest.presetKey}
			<span class="chip chip--preset">{presetName(contest.presetKey)()}</span>
		{/if}
		<span class="chip">{contestStatusLabel(contest.status)()}</span>
		{#if contest.hasPrize}
			<span class="chip chip--prize">{m.contests_chipHasPrize()}</span>
			<!-- "With a prize" -->
		{:else}
			<span class="chip">{m.contests_chipNoPrize()}</span>
			<!-- "No prize" -->
		{/if}
		{#if contest.team}
			<span class="chip">{m.contests_chipTeam()}</span>
			<!-- "Teams" -->
		{/if}
	</p>

	<dl class="facts">
		{#if contest.startsAt}
			<dt>{m.contests_factStarts()}</dt>
			<!-- "Starts" -->
			<dd>{formatDate(contest.startsAt)}</dd>
		{/if}
		<dt>{m.contests_factStages()}</dt>
		<!-- "Stages" -->
		<dd>{contest.stageCount}</dd>
		<dt>{m.contests_factEntrants()}</dt>
		<!-- "Entrants" -->
		<dd>{contest.registrationCount}</dd>
	</dl>

	{#if nextThing}
		<p class="next">{nextThing.label}: <strong>{formatDate(nextThing.when)}</strong></p>
	{/if}

	{#if contest.myRole}
		<p class="mine">{m.contests_youAreStaff()}</p>
		<!-- "You help run this one." -->
	{:else if contest.isMember}
		<p class="mine">{m.contests_youAreTakingPart()}</p>
		<!-- "You are taking part." -->
	{/if}
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.card {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	h3 {
		margin: 0;
		font-size: var(--font-size-lg);
	}
	h3 a {
		color: var(--text-primary);
		text-decoration: none;
	}
	h3 a:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.organiser {
		margin: 0.15rem 0 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
	}
	.chip {
		@include mix.neutral-pill;
		font-size: var(--font-size-xs);
	}
	.chip--preset {
		border-color: var(--accent);
		color: var(--accent);
	}
	.chip--prize {
		background: var(--status-warning-bg);
		border-color: var(--status-warning);
		color: var(--text-primary);
	}
	.facts {
		display: grid;
		grid-template-columns: auto auto;
		gap: 0.1rem 0.6rem;
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.facts dt {
		color: var(--text-secondary);
	}
	.facts dd {
		margin: 0;
	}
	.next {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-primary);
	}
	.mine {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--accent);
	}
</style>
