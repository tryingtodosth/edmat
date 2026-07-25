<script lang="ts">
	import { untrack } from 'svelte';
	import type { Comment, MaterialCoverage, User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { coverageDepth } from '$lib/utils/coverage';
	import { castCoverageVote, retractCoverageVote } from '$lib/services/materials';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { authStore } from '$lib/state/auth.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';
	import CoverageVoteWidget from './CoverageVoteWidget.svelte';

	let { coverage: initial, onClose }: { coverage: MaterialCoverage; onClose: () => void } =
		$props();

	// A local, mutable copy — voting/retracting return the server's own freshly-recomputed row
	// (vote_summary included), so this just gets reassigned wholesale rather than needing its own
	// optimistic-update math (same "server is authoritative, no client-side tallying" trust model
	// Exercise.averageRating/reviewCount already use elsewhere in this app).
	let coverage = $state(untrack(() => initial));
	let comments = $state<Comment[]>([]);
	let usersById = $state<Record<string, User>>({});
	let loading = $state(true);

	async function resolveUsers(ids: string[]) {
		const unique = [...new Set(ids)].filter((id) => !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const u of found) if (u) next[u.id] = u;
		usersById = next;
	}

	async function load() {
		loading = true;
		const cmts = await getCommentsForTarget('materialCoverage', coverage.id);
		comments = cmts;
		const authorIds = [
			...(coverage.proposedByUserId ? [coverage.proposedByUserId] : []),
			...cmts.map((c) => c.authorId)
		];
		await resolveUsers(authorIds);
		loading = false;
	}

	load();

	async function handleVote(value: 1 | -1) {
		coverage = await castCoverageVote(coverage.id, value);
	}

	async function handleRetract() {
		coverage = await retractCoverageVote(coverage.id);
	}

	async function handleComment(body: string, parentId?: string) {
		if (!authStore.user) return;
		const comment = await submitComment(
			'materialCoverage',
			coverage.id,
			authStore.user.id,
			body,
			parentId
		);
		comments = [...comments, comment];
	}

	let depth = $derived(coverageDepth(coverage.level));
	let popoverTitle = $derived(coverage.subtopicName ?? coverage.topicName);
</script>

<ModalShell title={popoverTitle} {onClose}>
	<div class="coverage-popover">
		<dl class="coverage-popover__meta">
			<div>
				<dt>{m.coverage_topicLabel()}</dt>
				<dd>{coverage.topicName}</dd>
			</div>
			{#if coverage.subtopicName}
				<div>
					<dt>{m.coverage_subtopicLabel()}</dt>
					<dd>{coverage.subtopicName}</dd>
				</div>
			{/if}
			<!-- The same `level` number, shown under BOTH readings deliberately, not collapsed into
				 one blended "depth" label — a material can be both a prerequisite claim ("you should
				 know this to roughly this depth before using it") AND a content claim ("this is how
				 much the material itself teaches on the topic"), and a reader shouldn't have to
				 guess which one a single figure meant. -->
			<div>
				<dt>{m.coverage_requirementLabel()}</dt>
				<dd class="depth depth--{depth}">{m.coverage_levelValue({ level: coverage.level })}</dd>
			</div>
			<div>
				<dt>{m.coverage_coversLabel()}</dt>
				<dd class="depth depth--{depth}">{m.coverage_levelValue({ level: coverage.level })}</dd>
			</div>
			<div>
				<dt>{m.coverage_depthLabel()}</dt>
				<dd class="depth depth--{depth}">
					{depth === 'light'
						? m.coverage_depth_light()
						: depth === 'moderate'
							? m.coverage_depth_moderate()
							: m.coverage_depth_deep()}
				</dd>
			</div>
		</dl>

		<section class="coverage-popover__section">
			<CoverageVoteWidget
				summary={coverage.voteSummary}
				onVote={handleVote}
				onRetract={handleRetract}
			/>
		</section>

		<section class="coverage-popover__section">
			<h3>{m.discussion_heading()}</h3>
			{#if loading}
				<p class="loading">{m.common_loading()}</p>
			{:else}
				<DiscussionThread {comments} {usersById} onSubmit={handleComment} />
			{/if}
		</section>
	</div>
</ModalShell>

<style lang="scss">
	.coverage-popover {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.coverage-popover__meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		font-size: var(--font-size-sm);
		dt {
			color: var(--text-secondary);
			font-size: var(--font-size-xs);
			text-transform: uppercase;
			letter-spacing: 0.04em;
		}
		dd {
			margin: 0;
			font-weight: 600;
		}
	}
	.depth--light {
		color: var(--text-secondary);
	}
	.depth--moderate {
		color: var(--status-info);
	}
	.depth--deep {
		color: var(--accent);
	}
	.coverage-popover__section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-color);
	}
	.coverage-popover__section h3 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.loading {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
</style>
