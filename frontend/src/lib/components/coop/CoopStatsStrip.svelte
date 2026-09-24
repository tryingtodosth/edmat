<script lang="ts">
	// The `<dl>` metrics strip from 2donet's ProjectCard: small labels over larger values, laid
	// out as flex columns so it wraps on a phone instead of squeezing. Which numbers appear is the
	// caller's: a reader is not shown a "waiting" count the server gave them as zero because it is
	// none of their business.
	import { m } from '$lib/paraglide/messages.js';
	import type { CoopOverview } from '$lib/types/materialsCoop';

	let { overview }: { overview: CoopOverview } = $props();
	let stats = $derived(overview.stats);
</script>

<dl class="strip">
	<div>
		<dt>{m.coop_stat_members()}</dt>
		<!-- "Co-authors" -->
		<dd>{stats.membersCount}</dd>
	</div>
	<div>
		<dt>{m.coop_stat_versions()}</dt>
		<!-- "Versions" -->
		<dd>{stats.versionsTotal}</dd>
	</div>
	<div>
		<dt>{m.coop_stat_published()}</dt>
		<!-- "Published" -->
		<dd>{stats.publishedCount}</dd>
	</div>
	{#if overview.canEdit}
		<div>
			<dt>{m.coop_stat_waiting()}</dt>
			<!-- "Waiting" -->
			<dd class:attention={stats.proposalsPending + stats.joinRequestsPending > 0}>
				{stats.proposalsPending + stats.joinRequestsPending}
			</dd>
		</div>
	{/if}
	<div>
		<dt>{m.coop_stat_comments()}</dt>
		<!-- "Comments" -->
		<dd>{stats.commentCount}</dd>
	</div>
</dl>

<style lang="scss">
	.strip {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3) var(--space-4);
		margin: 0;
		div {
			display: flex;
			flex-direction: column;
			min-width: 4.5rem;
		}
		dt {
			font-size: var(--font-size-xs);
			color: var(--text-secondary);
		}
		dd {
			margin: 0;
			font-size: var(--font-size-base);
			font-weight: 500;
		}
	}
	.attention {
		color: var(--status-warning);
	}
</style>
