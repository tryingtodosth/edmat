<script lang="ts">
	// Design A, "Team": 2donet's RosterList — one row per person, avatar, name, a role pill and
	// what they have done here — over a ProjectCard-style metrics strip. Outside contributors
	// (an accepted proposal from somebody who never joined) are listed after the team under their
	// own heading rather than dropped, because a roster that hides them would be describing the
	// team's opinion of itself rather than the material's history.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import type { CoopMember, CoopOverview } from '$lib/types/materialsCoop';
	import { MEMBER_ROLE_LABELS } from '$lib/components/coauthoring/labels';
	import CoopStatsStrip from './CoopStatsStrip.svelte';
	import MemberAvatar from './MemberAvatar.svelte';

	let { overview, compact = false }: { overview: CoopOverview; compact?: boolean } = $props();

	let shown = $derived(compact ? overview.members.slice(0, 5) : overview.members);
	let hidden = $derived(overview.members.length - shown.length);
	let contributors = $derived(compact ? overview.contributors.slice(0, 3) : overview.contributors);

	function activity(member: CoopMember): string {
		if (member.versionsCount === 0) return '';
		return m.coop_roster_activity({
			versions: member.versionsCount,
			published: member.publishedCount
		}); // "{versions} saved · {published} published"
	}
</script>

{#snippet row(member: CoopMember)}
	<li class="row">
		<MemberAvatar userId={member.userId} displayName={member.displayName} />
		<div class="who">
			<a class="name" href={resolve('/users/[id]', { id: member.userId })}>{member.displayName}</a>
			{#if activity(member)}
				<span class="activity">{activity(member)}</span>
			{/if}
		</div>
		{#if member.role}
			<span class="role role--{member.role}">{MEMBER_ROLE_LABELS[member.role]()}</span>
		{:else}
			<span class="role role--contributor">{m.coop_roster_contributor()}</span>
			<!-- "Contributor" -->
		{/if}
		{#if member.lastActiveAt && !compact}
			<span class="when">{formatDate(member.lastActiveAt)}</span>
		{/if}
	</li>
{/snippet}

<div class="roster">
	{#if overview.members.length === 0}
		<p class="hint">{m.coauth_panel_noCoauthors()}</p>
		<!-- "Nobody looks after this material yet." -->
	{:else}
		<ul class="rows">
			{#each shown as member (member.userId)}
				{@render row(member)}
			{/each}
		</ul>
		{#if hidden > 0}
			<p class="hint">{m.coop_roster_more({ count: hidden })}</p>
			<!-- "and {count} more" -->
		{/if}
	{/if}

	{#if contributors.length > 0}
		<h3>{m.coop_roster_contributorsHeading()}</h3>
		<!-- "Also contributed" -->
		<ul class="rows">
			{#each contributors as member (member.userId)}
				{@render row(member)}
			{/each}
		</ul>
	{/if}

	<CoopStatsStrip {overview} />
</div>

<style lang="scss">
	.roster {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h3 {
		margin: 0;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-surface-alt);
		border-radius: var(--radius-sm);
		min-width: 0;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.name {
		color: var(--text-primary);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.activity,
	.when,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.hint {
		margin: 0;
	}
	.role {
		font-size: var(--font-size-xs);
		font-weight: 500;
		padding: 2px var(--space-2);
		border-radius: 999px;
		white-space: nowrap;
	}
	.role--owner {
		color: var(--accent);
		background: var(--accent-soft);
	}
	.role--coauthor {
		color: var(--status-info);
		background: var(--status-info-bg);
	}
	.role--contributor {
		color: var(--status-neutral);
		background: var(--status-neutral-bg);
	}
</style>
