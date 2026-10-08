<script lang="ts">
	/** The seventh panel on `ManagementPanels`: what this node is trying to achieve, each goal with
	 * the definition of done that decides whether it has been (owner, 2026-10-08).
	 *
	 * It sits ABOVE the other panels on purpose — a goal is the thing the tasks, the needs and the
	 * plans below it are work towards, and a reader who meets the board before the goals meets a
	 * list of chores with no reason attached. On `/about` that ordering is the owner's own call:
	 * the twelve module plans stay exactly where they are and the goals go above them.
	 *
	 * Draws nothing when the kill switch is off (`ManagementPanels` already withheld `node` for a
	 * reader who cannot see it at all), and nothing at all for a reader with no goals to look at
	 * and no right to write one — an empty box on every course that has never used this would be
	 * the house-rule-3 failure in reverse.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { NodeRef } from '$lib/types/node';
	import type { Goal } from '$lib/types/goal';
	import { createGoal, getNodeGoals } from '$lib/services/goals';
	import GoalCard from './GoalCard.svelte';
	import { RowDiscussions } from '$lib/components/discussion/rowDiscussions.svelte';
	import { discussionKeyFor } from '$lib/utils/discussionKeys';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { goalRefusalMessage } from '$lib/utils/labels';

	let { node }: { node: NodeRef } = $props();

	const canSee = $derived(featureFlagsStore.isEnabled('goals') || authStore.isModerator);

	let goals = $state<Goal[]>([]);
	let loading = $state(true);
	let loadedFor = $state('');
	let showForm = $state(false);
	let busy = $state(false);
	let error = $state('');
	let title = $state('');
	let description = $state('');

	// Every goal's thread policy in ONE request (`rowDiscussions.svelte.ts`), re-asked when the
	// rows or the reader change — `canPost` moves the moment a session resolves.
	const rowDiscussions = new RowDiscussions();
	$effect(() =>
		rowDiscussions.load(
			goals.map((goal) => discussionKeyFor('goals', goal.id)),
			authStore.user?.id ?? 'anon'
		)
	);

	// Keyed on the node AND on who is asking, with the id-changed guard frontend/CLAUDE.md trap 2
	// requires: `canEdit`/`canTick` change the moment a session resolves.
	$effect(() => {
		const key = `${node.kind}:${node.id}:${authStore.user?.id ?? 'anon'}:${canSee}`;
		if (key === loadedFor) return;
		loadedFor = key;
		if (!canSee) {
			goals = [];
			loading = false;
			return;
		}
		loading = true;
		getNodeGoals(node.kind, node.id).then(
			(rows) => {
				if (loadedFor === key) {
					goals = rows;
					loading = false;
				}
			},
			() => {
				if (loadedFor === key) {
					goals = [];
					loading = false;
				}
			}
		);
	});

	function replace(updated: Goal) {
		goals = goals.map((goal) => (goal.id === updated.id ? updated : goal));
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const wanted = title.trim();
		if (!wanted) return;
		busy = true;
		error = '';
		try {
			const goal = await createGoal(node.kind, node.id, { title: wanted, description });
			goals = [...goals, goal];
			title = '';
			description = '';
			showForm = false;
		} catch (e) {
			error = goalRefusalMessage(e, m.common_error());
		} finally {
			busy = false;
		}
	}
</script>

{#if canSee && !loading && (goals.length > 0 || node.canManage)}
	<section class="goals-panel" aria-labelledby="goals-heading-{node.kind}-{node.id}">
		<div class="head">
			<h2 id="goals-heading-{node.kind}-{node.id}">{m.goals_heading()}</h2>
			<!-- "Goals" -->
			{#if node.canManage}
				<button type="button" class="link" onclick={() => (showForm = !showForm)}
					>{m.goals_addGoal()}</button
				>
				<!-- "Add a goal" -->
			{/if}
		</div>
		<p class="intro">{m.goals_panelIntro()}</p>
		<!-- "What this body is trying to achieve, and what will count as having achieved it." -->

		{#if showForm}
			<form class="form" onsubmit={submit}>
				<label>
					<span>{m.goals_formTitleLabel()}</span>
					<!-- "Title" -->
					<input
						type="text"
						bind:value={title}
						placeholder={m.goals_formTitlePlaceholder()}
						maxlength="200"
						disabled={busy}
					/>
				</label>
				<label>
					<span>{m.goals_formDescriptionLabel()}</span>
					<!-- "What this goal is" -->
					<textarea bind:value={description} rows="3" disabled={busy}></textarea>
				</label>
				<div class="actions">
					<button type="submit" disabled={busy || !title.trim()}>{m.goals_save()}</button>
					<button type="button" class="link" onclick={() => (showForm = false)}
						>{m.goals_cancel()}</button
					>
				</div>
				{#if error}<p class="error">{error}</p>{/if}
			</form>
		{/if}

		{#if goals.length === 0}
			<p class="intro">{m.goals_empty()}</p>
			<!-- "No goals yet." -->
		{:else}
			<ul class="list">
				{#each goals as goal (goal.id)}
					<li>
						<GoalCard
							{goal}
							policy={rowDiscussions.byKey[discussionKeyFor('goals', goal.id)]}
							onChanged={replace}
							onRemoved={() => (goals = goals.filter((row) => row.id !== goal.id))}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.goals-panel {
		@include mix.card-surface;
		display: grid;
		gap: var(--space-3, 0.75rem);
		padding: var(--space-3);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2, 0.5rem);
		flex-wrap: wrap;
		h2 {
			margin: 0;
			font-size: 1.05rem;
		}
	}
	.intro {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.form {
		display: grid;
		gap: var(--space-2);
		label {
			display: grid;
			gap: 2px;
			font-size: var(--font-size-sm);
		}
		input,
		textarea {
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}
	.error {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
