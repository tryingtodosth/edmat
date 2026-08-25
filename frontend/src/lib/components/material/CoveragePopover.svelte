<script lang="ts">
	import { untrack } from 'svelte';
	import type { Comment, MaterialCoverage, User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { coverageDepth, depthLabel } from '$lib/utils/coverage';
	import {
		castCoverageVote,
		castImportanceVote,
		retractCoverageVote,
		retractImportanceVote
	} from '$lib/services/materials';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { authStore } from '$lib/state/auth.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';
	import CoverageVoteWidget from './CoverageVoteWidget.svelte';
	import ImportanceVoteWidget from './ImportanceVoteWidget.svelte';

	// `onVoteChange`: a vote cast here changes the claim's tallies — and, for the importance vote,
	// the ORDER the parent lists claims in — so the updated row is handed back up rather than left
	// to go stale until a reload.
	let {
		coverage: initial,
		onClose,
		onVoteChange
	}: {
		coverage: MaterialCoverage;
		onClose: () => void;
		onVoteChange?: (updated: MaterialCoverage) => void;
	} = $props();

	// A local, mutable copy — every vote endpoint returns the server's own freshly-recomputed row,
	// so this is reassigned wholesale rather than tallied client-side.
	let coverage = $state(untrack(() => initial));
	// A material's claim and a course's claim have their own comment endpoints; the rest is shared.
	const threadTarget = untrack(() =>
		initial.ownerKind === 'course'
			? ('courseClaim' as const)
			: initial.ownerKind === 'exercise'
				? ('exerciseClaim' as const)
				: ('materialCoverage' as const)
	);
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
		const cmts = await getCommentsForTarget(threadTarget, coverage.id);
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
		coverage = await castCoverageVote(coverage, value);
		onVoteChange?.(coverage);
	}

	async function handleRetract() {
		coverage = await retractCoverageVote(coverage);
		onVoteChange?.(coverage);
	}

	async function handleImportance(value: 1 | -1) {
		coverage = await castImportanceVote(coverage, value);
		onVoteChange?.(coverage);
	}

	async function handleImportanceRetract() {
		coverage = await retractImportanceVote(coverage);
		onVoteChange?.(coverage);
	}

	async function handleComment(body: string, parentId?: string) {
		if (!authStore.user) return;
		const comment = await submitComment(
			threadTarget,
			coverage.id,
			authStore.user.id,
			body,
			parentId
		);
		comments = [...comments, comment];
	}

	// One sentence naming what kind of claim this is, worded for what it is a claim ABOUT.
	function kindExplanation(): string {
		if (coverage.ownerKind === 'course') {
			return isRequirement
				? m.coverage_kindExplainRequiresCourse()
				: m.coverage_kindExplainCoversCourse();
		}
		if (coverage.ownerKind === 'exercise') {
			return isRequirement
				? m.coverage_kindExplainRequiresExercise()
				: m.coverage_kindExplainCoversExercise();
		}
		return isRequirement ? m.coverage_kindExplainRequires() : m.coverage_kindExplainCovers();
	}

	let depth = $derived(coverageDepth(coverage.level));
	let isRequirement = $derived(coverage.kind === 'requires');
	let popoverTitle = $derived(
		(isRequirement ? m.coverage_popoverTitleRequires() : m.coverage_popoverTitleCovers()) +
			': ' +
			(coverage.subtopicName ?? coverage.topicName)
	);
</script>

<ModalShell title={popoverTitle} {onClose}>
	<div class="coverage-popover">
		<p class="coverage-popover__kind coverage-popover__kind--{coverage.kind}">
			{kindExplanation()}
		</p>
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
			<!-- One number, under the ONE label its kind means. A claim answers a single question;
				 the other reading is a different claim, listed in the other group. -->
			<div>
				<dt>{isRequirement ? m.coverage_requirementLabel() : m.coverage_coversLabel()}</dt>
				<dd class="depth depth--{depth}">
					{m.coverage_levelValue({ level: coverage.level })}
					<span class="depth-word">· {depthLabel(coverage.kind, depth)}</span>
				</dd>
			</div>
			{#if coverage.proposedByUserId && usersById[coverage.proposedByUserId]}
				<div>
					<dt>{m.coverage_proposedBy()}</dt>
					<dd>{usersById[coverage.proposedByUserId].displayName}</dd>
				</div>
			{/if}
		</dl>

		<section class="coverage-popover__section">
			<CoverageVoteWidget
				summary={coverage.voteSummary}
				question={isRequirement ? m.coverage_voteQuestionRequires : m.coverage_voteQuestion}
				onVote={handleVote}
				onRetract={handleRetract}
			/>
		</section>

		<section class="coverage-popover__section">
			<ImportanceVoteWidget
				summary={coverage.importanceSummary}
				onVote={handleImportance}
				onRetract={handleImportanceRetract}
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
	@use '../../styles/mixins' as mix;

	.coverage-popover {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.coverage-popover__kind {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		border-left: 3px solid var(--status-info);
		background: var(--status-info-bg);
	}
	.coverage-popover__kind--requires {
		border-left-color: var(--status-warning);
		background: var(--status-warning-bg);
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
	.depth-word {
		font-weight: 400;
		color: var(--text-secondary);
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
