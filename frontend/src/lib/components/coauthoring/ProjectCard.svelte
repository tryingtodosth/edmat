<script lang="ts">
	// One project, as a row in a listing. Compact on purpose — the same "compact card, rich detail
	// page" split every other listing in this app makes.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import type { MaterialProject } from '$lib/types/materialProject';
	import { MEMBER_ROLE_LABELS, VERSION_STATUS_LABELS } from './labels';

	// `headingLevel` for the same reason `MaterialCard` has one: a card's own title is an `h3` under
	// a section heading, but a `h2` when the list sits straight under the page's `h1` — and a skipped
	// level is a real axe `heading-order` violation, which is how this one was found.
	let { project, headingLevel = 3 }: { project: MaterialProject; headingLevel?: 2 | 3 } = $props();

	let headStatus = $derived(project.headVersion?.status ?? null);
</script>

<article class="project-card">
	<svelte:element this={`h${headingLevel}`}>
		<a href={resolve('/material-projects/[id]', { id: project.id })}>
			{project.title || m.coauth_project_noHead()}
			<!-- "Nothing has been written yet." -->
		</a>
	</svelte:element>

	<p class="meta">
		<span>{project.branchName}</span>
		{#if headStatus}
			<span class="badge">{VERSION_STATUS_LABELS[headStatus]()}</span>
		{/if}
		{#if project.seekingCoauthors}
			<span class="badge badge--seeking">{m.coauth_card_seeking()}</span>
			<!-- "Looking for co-authors" -->
		{/if}
		{#if project.myRole}
			<span class="badge">{MEMBER_ROLE_LABELS[project.myRole]()}</span>
		{/if}
	</p>

	{#if project.seekingNote}
		<p class="note">{project.seekingNote}</p>
	{/if}

	<p class="meta">
		<span>{m.coauth_card_members({ count: project.memberCount })}</span>
		<!-- "Co-authors: {count}" -->
		{#if project.pendingProposalsCount > 0}
			<span class="badge badge--waiting">
				{m.coauth_card_pendingProposals({ count: project.pendingProposalsCount })}
				<!-- "Waiting for a decision: {count}" -->
			</span>
		{/if}
		<span>{formatDate(project.createdAt)}</span>
	</p>
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.project-card {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	h3 {
		margin: 0;
		font-size: var(--font-size-md);

		a {
			color: var(--text-primary);
			text-decoration: none;

			&:hover,
			&:focus-visible {
				color: var(--accent);
				text-decoration: underline;
			}
		}
	}
	.meta {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.note {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.badge {
		border-radius: 999px;
		padding: 1px var(--space-2);
		background: var(--bg-surface-alt);
	}
	.badge--seeking {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
	}
	.badge--waiting {
		@include mix.status-pill(var(--status-warning, var(--status-info)), var(--status-info-bg));
	}
</style>
