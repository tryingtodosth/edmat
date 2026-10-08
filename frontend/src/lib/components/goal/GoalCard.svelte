<script lang="ts">
	/**
	 * One goal: what it is, its definition of done, and the ticks that decide whether it is met.
	 *
	 * **Shared by `GoalsPanel` and `/goals/[id]`** from the start rather than after three strikes
	 * (house rule 13's usual threshold), because the two surfaces are not variations on a goal —
	 * they are the same goal in two places, and the affordances that matter (tick a condition, add
	 * one, remove one, rewrite the words) have to behave identically or the panel becomes a
	 * read-only preview nobody trusts.
	 *
	 * It owns no policy and no fetch of its own: the parent hands it the goal, the thread's policy
	 * (one batched request per panel — `rowDiscussions.svelte.ts`) and a callback, because a board
	 * of goals asking per row is the N+1 those helpers exist to avoid.
	 *
	 * **`met` is never offered as an action.** The server derives it from the criteria
	 * (`backend/goals/rules.py: recount`) and refuses a request for it, so the only thing this
	 * component can do about "done" is tick a condition — which is the whole feature, and why the
	 * note under the list says so in words.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import ManagementTextMenu from '$lib/components/translations/ManagementTextMenu.svelte';
	import LanguageNote from '$lib/components/translations/LanguageNote.svelte';
	import RowDiscussion from '$lib/components/discussion/RowDiscussion.svelte';
	import type { DiscussionPolicy } from '$lib/types/discussion';
	import type { Goal, GoalCriterion } from '$lib/types/goal';
	import {
		addCriterion,
		deleteGoal,
		removeCriterion,
		setCriterionMet,
		updateGoal
	} from '$lib/services/goals';
	import type { WrittenText } from '$lib/services/textVersions';
	import { GOAL_STATUS_LABELS, goalRefusalMessage } from '$lib/utils/labels';

	let {
		goal,
		policy,
		/** `true` in a list, where the title is how a reader reaches the goal's own page; `false` on
		 *  that page, where it is the heading. */
		linkTitle = true,
		onChanged,
		onRemoved
	}: {
		goal: Goal;
		policy?: DiscussionPolicy;
		linkTitle?: boolean;
		onChanged: (goal: Goal) => void;
		/** Called after a delete the server allowed. Absent on a surface with nowhere to go
		 *  afterwards, which then does not offer the item at all. */
		onRemoved?: () => void;
	} = $props();

	let adding = $state(false);
	let criterionText = $state('');
	let busy = $state(false);
	let error = $state('');

	async function run(work: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await work();
		} catch (e) {
			error = goalRefusalMessage(e, m.common_error());
		} finally {
			busy = false;
		}
	}

	function toggle(criterion: GoalCriterion, met: boolean) {
		// The server sends the GOAL back with the criterion, because ticking the last open condition
		// is what makes the goal `met` — a client that re-fetched to find out would draw a stale
		// "open" for a moment.
		void run(async () => {
			const { goal: updated } = await setCriterionMet(criterion.id, met);
			onChanged(updated);
		});
	}

	function add(event: SubmitEvent) {
		event.preventDefault();
		const text = criterionText.trim();
		if (!text) return;
		void run(async () => {
			const criterion = await addCriterion(goal.id, text);
			criterionText = '';
			adding = false;
			// Adding an OPEN condition to a goal the criteria had declared met re-opens it, so the
			// counters and the status are recomputed from the list rather than patched by hand.
			const criteria = [...goal.criteria, criterion];
			onChanged(recount({ ...goal, criteria }));
		});
	}

	function remove(criterion: GoalCriterion) {
		if (!window.confirm(m.goals_removeCriterionConfirm())) return;
		void run(async () => {
			await removeCriterion(criterion.id);
			const criteria = goal.criteria.filter((row) => row.id !== criterion.id);
			onChanged(recount({ ...goal, criteria }));
		});
	}

	/** The same arithmetic the server does (`goals/rules.py: recount`), applied locally so the card
	 *  does not have to re-fetch after an add or a remove. `abandoned` is left alone in both
	 *  directions, exactly as the server leaves it — and the next read from the API is the
	 *  authority either way. */
	function recount(next: Goal): Goal {
		const total = next.criteria.length;
		const met = next.criteria.filter((row) => row.isMet).length;
		let status = next.status;
		if (status !== 'abandoned') {
			if (total > 0 && met === total) status = 'met';
			else if (status === 'met') status = 'open';
		}
		return { ...next, status, criteriaCount: total, criteriaMetCount: met };
	}

	function destroy() {
		if (!window.confirm(m.goals_deleteConfirm())) return;
		void run(async () => {
			await deleteGoal(goal.id);
			onRemoved?.();
		});
	}

	function setStatus(status: 'open' | 'abandoned') {
		void run(async () => onChanged(await updateGoal(goal.id, { status })));
	}

	function applyText(written: WrittenText) {
		onChanged({
			...goal,
			title: written.heading,
			description: written.body,
			language: written.language,
			textVersions: written.textVersions
		});
	}
</script>

<article class="goal" class:goal--met={goal.status === 'met'} data-goal-id={goal.id}>
	<header class="goal__head">
		{#if linkTitle}
			<a
				class="goal__title"
				href={resolve('/goals/[id]', { id: goal.id })}
				title={m.goals_openGoal({ title: goal.title })}>{goal.title}</a
			>
			<!-- "Open the goal “{title}”" -->
		{:else}
			<h2 class="goal__title">{goal.title}</h2>
		{/if}
		<span class="goal__pill goal__pill--{goal.status}">{GOAL_STATUS_LABELS[goal.status]()}</span>
		<span class="goal__count"
			>{m.goals_progress({ met: goal.criteriaMetCount, total: goal.criteriaCount })}</span
		>
		<!-- "{met} of {total} met" -->
		{#if goal.canEdit}
			<ManagementTextMenu
				kind="goal"
				id={goal.id}
				versions={goal.textVersions}
				fallbackHeading={goal.title}
				fallbackBody={goal.description}
				headingLabel={m.goals_formTitleLabel()}
				bodyLabel={m.goals_formDescriptionLabel()}
				label={m.goals_rowActionsLabel()}
				items={[
					{
						label: goal.status === 'abandoned' ? m.goals_reopen() : m.goals_abandon(),
						danger: goal.status !== 'abandoned',
						onselect: () => setStatus(goal.status === 'abandoned' ? 'open' : 'abandoned')
					},
					// Offered only where there is somewhere to go afterwards. Whether it is allowed
					// at all is the SERVER's answer (409 `has_work` / `has_comments`), and the
					// refusal lands in the line below — "has anybody commented here" is not
					// something this component can know without asking.
					...(onRemoved ? [{ label: m.goals_delete(), danger: true, onselect: destroy }] : [])
				]}
				onSaved={applyText}
			/>
		{/if}
	</header>

	<LanguageNote language={goal.language} />
	{#if goal.description}
		<MathContent source={goal.description} tag="div" />
	{/if}

	<section class="goal__dod">
		<h3>{m.goals_definitionHeading()}</h3>
		<!-- "Definition of done" -->
		{#if goal.criteria.length === 0}
			<p class="goal__hint">{m.goals_definitionEmpty()}</p>
			<!-- "Nobody has said what done means here yet, so this goal cannot be met." -->
		{:else}
			<ul class="goal__criteria">
				{#each goal.criteria as criterion (criterion.id)}
					<li class="criterion" class:criterion--met={criterion.isMet}>
						<label class="criterion__check">
							<input
								type="checkbox"
								checked={criterion.isMet}
								disabled={!goal.canTick || busy}
								aria-label={criterion.isMet
									? m.goals_untickCriterion({ text: criterion.text })
									: m.goals_tickCriterion({ text: criterion.text })}
								onchange={(e) => toggle(criterion, e.currentTarget.checked)}
							/>
							<!-- "Mark “{text}” as met" / "Mark “{text}” as not met" -->
							<span class="criterion__text">{criterion.text}</span>
						</label>
						{#if criterion.isMet && criterion.metBy}
							<span class="criterion__by"
								>{m.goals_metBy({ name: criterion.metBy.displayName })}</span
							>
							<!-- "Met — recorded by {name}" -->
						{/if}
						{#if goal.canEdit}
							<button
								type="button"
								class="criterion__remove"
								disabled={busy}
								onclick={() => remove(criterion)}>{m.goals_removeCriterion()}</button
							>
							<!-- "Remove" -->
						{/if}
					</li>
				{/each}
			</ul>
			<p class="goal__hint">{m.goals_derivedNote()}</p>
			<!-- "A goal is met when every condition is. Nobody ticks it directly." -->
		{/if}

		{#if goal.canEdit}
			{#if adding}
				<form class="goal__add" onsubmit={add}>
					<input
						type="text"
						bind:value={criterionText}
						placeholder={m.goals_criterionPlaceholder()}
						maxlength="300"
						disabled={busy}
					/>
					<button type="submit" disabled={busy || !criterionText.trim()}>{m.goals_save()}</button>
					<button type="button" class="link" onclick={() => (adding = false)}
						>{m.goals_cancel()}</button
					>
				</form>
			{:else}
				<button type="button" class="link" onclick={() => (adding = true)}
					>{m.goals_addCriterion()}</button
				>
				<!-- "Add a condition" -->
			{/if}
		{/if}
	</section>

	{#if error}<p class="goal__error">{error}</p>{/if}

	<RowDiscussion {policy} title={goal.title} />
</article>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.goal {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
	}
	.goal__head {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.goal__title {
		font-size: var(--font-size-base);
		font-weight: 600;
		margin: 0;
		color: var(--text-primary);
		&:hover {
			color: var(--accent);
		}
	}
	// The five status meanings of the colour pass (frontend/CLAUDE.md): success = done/verified,
	// neutral = closed/a fact. An abandoned goal is a fact, not a failure, so it is NOT danger.
	.goal__pill {
		@include mix.neutral-pill;
		&.goal__pill--met {
			@include mix.status-pill(var(--status-success), var(--status-success-bg));
		}
		&.goal__pill--open {
			@include mix.pending-pill;
		}
	}
	.goal__count {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.goal__dod {
		display: grid;
		gap: var(--space-2);
		h3 {
			margin: 0;
			font-size: var(--font-size-sm);
			font-weight: 600;
			color: var(--text-secondary);
			text-transform: none;
		}
	}
	.goal__criteria {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.3rem;
	}
	.criterion {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.criterion__check {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		input {
			margin: 0;
		}
	}
	// Never opacity on content (frontend/CLAUDE.md): a met condition is dimmed to the secondary
	// text colour and struck, not faded out.
	.criterion--met .criterion__text {
		color: var(--text-secondary);
		text-decoration: line-through;
	}
	.criterion__by,
	.goal__hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		margin: 0;
	}
	.criterion__remove {
		background: none;
		border: 0;
		padding: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		cursor: pointer;
		&:hover {
			color: var(--status-danger);
		}
	}
	.goal__add {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		input {
			flex: 1 1 14rem;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
		text-align: left;
	}
	.goal__error {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
