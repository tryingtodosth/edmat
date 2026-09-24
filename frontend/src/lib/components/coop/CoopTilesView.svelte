<script lang="ts">
	// Design C, "Tiles": 2donet's dashboard grid (GridLayoutA's Status/Members tiles and
	// GridLayoutB's avatar stack), four tiles that each answer one question — what is current,
	// who, what just happened, what is waiting.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import type { CoopOverview } from '$lib/types/materialsCoop';
	import { POLICY_HINTS, TIMELINE_KIND_LABELS } from './labels';
	import CoopTile from './CoopTile.svelte';
	import MemberAvatar from './MemberAvatar.svelte';
	import PolicyBadge from './PolicyBadge.svelte';

	let { overview }: { overview: CoopOverview } = $props();

	let stack = $derived([...overview.members, ...overview.contributors].slice(0, 8));
	let stackMore = $derived(overview.members.length + overview.contributors.length - stack.length);
	let recent = $derived(overview.timeline.slice(0, 3));
	let waiting = $derived(overview.stats.proposalsPending + overview.stats.joinRequestsPending);
</script>

<div class="grid">
	<CoopTile title={m.coop_tile_status()}>
		<!-- "Status" -->
		{#if overview.publishedVersion}
			<p class="big">
				{m.coauth_versions_number({ number: overview.publishedVersion.number })}
				<!-- "Version {number}" -->
			</p>
			{#if overview.publishedVersion.publishedAt}
				<p class="muted">{formatDate(overview.publishedVersion.publishedAt)}</p>
			{/if}
		{:else}
			<p class="muted">{m.coauth_block_not_published()}</p>
			<!-- "Nothing has been published here yet, so there is nothing to improve." -->
		{/if}
		<p><PolicyBadge policy={overview.policy} /></p>
		<p class="muted small">{POLICY_HINTS[overview.policy]()}</p>
	</CoopTile>

	<CoopTile title={m.coop_tile_team()}>
		<!-- "Team" -->
		{#if stack.length === 0}
			<p class="muted">{m.coauth_panel_noCoauthors()}</p>
			<!-- "Nobody looks after this material yet." -->
		{:else}
			<div class="stack">
				{#each stack as person (person.userId)}
					<a class="stack__item" href={resolve('/users/[id]', { id: person.userId })}>
						<MemberAvatar userId={person.userId} displayName={person.displayName} size={36} />
					</a>
				{/each}
				{#if stackMore > 0}
					<span class="stack__more">+{stackMore}</span>
				{/if}
			</div>
			<p class="muted">
				{m.coop_tile_teamLine({
					members: overview.stats.membersCount,
					contributors: overview.stats.contributorsCount
				})}
				<!-- "{members} co-authors · {contributors} people contributed" -->
			</p>
		{/if}
	</CoopTile>

	<CoopTile title={m.coop_tile_recent()}>
		<!-- "Recently" -->
		{#if recent.length === 0}
			<p class="muted">{m.coop_timeline_empty()}</p>
			<!-- "Nothing has happened here yet." -->
		{:else}
			<ul class="recent">
				{#each recent as event, i (event.at + i)}
					<li>
						<strong>{event.actorDisplayName || m.coop_timeline_someone()}</strong>
						{TIMELINE_KIND_LABELS[event.kind]()}
						<span class="muted small">· {formatDate(event.at)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</CoopTile>

	<CoopTile title={m.coop_tile_open()}>
		<!-- "Open" -->
		{#if overview.canEdit}
			<p class="big" class:attention={waiting > 0}>{waiting}</p>
			<p class="muted">
				{m.coop_tile_openLine({
					proposals: overview.stats.proposalsPending,
					requests: overview.stats.joinRequestsPending
				})}
				<!-- "{proposals} proposals · {requests} applications" -->
			</p>
		{:else}
			<p class="big">{overview.stats.commentCount}</p>
			<p class="muted">{m.coop_stat_comments()}</p>
			<!-- "Comments" -->
		{/if}
	</CoopTile>
</div>

<style lang="scss">
	.grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-2);
		@media (max-width: 900px) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		@media (max-width: 560px) {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	p {
		margin: 0;
	}
	.big {
		font-size: var(--font-size-lg);
		font-weight: 600;
	}
	.attention {
		color: var(--status-warning);
	}
	.muted {
		color: var(--text-secondary);
	}
	.small {
		font-size: var(--font-size-xs);
	}
	.stack {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}
	.stack__item {
		display: inline-flex;
		border-radius: 50%;
	}
	.stack__more {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		padding-left: var(--space-1);
	}
	.recent {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		li {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>
