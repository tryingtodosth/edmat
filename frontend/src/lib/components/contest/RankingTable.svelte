<script lang="ts">
	/** The published ranking. Rank, the name the participant's own consent allows, points, title.
	 *
	 * The name is the SERVER's answer (`ContestResultSerializer`): initials unless the participant
	 * opted in and the contest's own default allows a full name — two separate conditions, neither
	 * of which this component re-decides. A frontend that assembled the rule from `publishName` and
	 * `publicationDefault` would be a second implementation of a consent.
	 *
	 * Ties share a rank, so the rank column repeats and then skips. That is not a bug to tidy: a
	 * tie broken by anything other than merit is the draw this whole module is built to make
	 * impossible.
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { resultTitleLabel } from '$lib/utils/labels';
	import type { ContestResultRow } from '$lib/types/contest';

	let {
		contestId,
		rows,
		showCertificates = true
	}: { contestId: string; rows: ContestResultRow[]; showCertificates?: boolean } = $props();
</script>

{#if rows.length === 0}
	<p class="empty">{m.contests_noResultsYet()}</p>
	<!-- "No results have been published yet." -->
{:else}
	<table class="ranking">
		<caption class="sr-only">{m.contests_rankingCaption()}</caption>
		<!-- "The published ranking" -->
		<thead>
			<tr>
				<th scope="col">{m.contests_colRank()}</th>
				<!-- "#" -->
				<th scope="col">{m.contests_colWho()}</th>
				<!-- "Entrant" -->
				<th scope="col">{m.contests_colPoints()}</th>
				<!-- "Points" -->
				<th scope="col">{m.contests_colTitle()}</th>
				<!-- "Title" -->
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.id)}
				<tr class:mine={row.isMe}>
					<td>{row.rank}</td>
					<td>
						<span class="who">{row.displayName}</span>
						<span class="number">#{row.registrationNumber}</span>
						{#if row.isMe}
							<span class="you">{m.contests_thatIsYou()}</span>
							<!-- "that is you" -->
						{/if}
					</td>
					<td>
						{row.totalPoints}{#if row.maxPoints}<span class="of">/{row.maxPoints}</span>{/if}
					</td>
					<td>
						<span class="title title--{row.title}">{resultTitleLabel(row.title)()}</span>
						{#if showCertificates && row.isMe && row.title !== 'participant'}
							<a
								class="certificate"
								href={resolve('/contests/[id]/certificate/[resultId]', {
									id: contestId,
									resultId: row.id
								})}>{m.contests_certificateLink()}</a
							>
							<!-- "Certificate" -->
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style lang="scss">
	.ranking {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sm);
	}
	th,
	td {
		text-align: left;
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--border-color);
	}
	th {
		color: var(--text-secondary);
		font-weight: 600;
	}
	tr.mine {
		background: var(--accent-soft);
	}
	.number,
	.of {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	.you {
		font-size: var(--font-size-xs);
		color: var(--accent);
	}
	.title {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0 0.3rem;
		font-size: var(--font-size-xs);
	}
	.title--laureate {
		border-color: var(--status-success);
		color: var(--status-success);
	}
	.title--finalist {
		border-color: var(--status-info);
		color: var(--status-info);
	}
	.title--distinction {
		border-color: var(--status-warning);
		color: var(--status-warning);
	}
	.certificate {
		margin-left: 0.4rem;
		font-size: var(--font-size-xs);
	}
	.empty {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
