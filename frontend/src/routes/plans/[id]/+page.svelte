<script lang="ts">
	// One plan: its steps and sub-steps, its status, its suggestion box for readers and its
	// suggestion queue for editors (MANAGEMENT-BRIEF.md §3.D).
	//
	// Every button on this page reflects what the SERVER already said this reader may do
	// (`plan.canEdit`, `plan.suggestBlockReason`) rather than a client-side guess — house rule 4:
	// only the server holds both halves of a rule (the queryset filter AND the object check), and a
	// frontend that re-derived "may I edit this" would be drawing a button that then 403s.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import {
		addPlanStep,
		decidePlanSuggestion,
		deletePlan,
		deletePlanStep,
		getPlan,
		getPlanSuggestions,
		reorderPlanSteps,
		suggestOnPlan,
		transitionPlan,
		updatePlan,
		updatePlanStep,
		withdrawPlanSuggestion
	} from '$lib/services/plans';
	import type { NodeRef } from '$lib/types/node';
	import type { Plan, PlanStep, PlanStepStatus, PlanSuggestion } from '$lib/types/plan';
	import {
		PLAN_BLOCK_REASON_LABELS,
		PLAN_STATUS_LABELS,
		PLAN_STEP_STATUS_LABELS,
		PLAN_SUGGESTION_STATUS_LABELS
	} from '$lib/utils/labels';
	import { formatDateTime } from '$lib/utils/datetime';

	const STEP_STATUSES: PlanStepStatus[] = ['pending', 'in_progress', 'done', 'skipped'];

	let plan = $state<Plan | null>(null);
	let suggestions = $state<PlanSuggestion[]>([]);
	let mySuggestion = $state<PlanSuggestion | null>(null);
	let loading = $state(true);
	let notFound = $state(false);

	let editingDetails = $state(false);
	let editTitle = $state('');
	let editDescription = $state('');
	let editBusy = $state(false);
	let editError = $state('');

	let transitionBusy = $state(false);
	let transitionError = $state('');

	// `null` = closed; `'top'` = a new top-level step; a step id = a new sub-step under it;
	// `edit:<id>` = editing that existing step in place. One form, reused at both nesting levels and
	// for both create and edit — the SkillsModal precedent for a small, single-file reorder/edit UI.
	let formOpenFor = $state<string | null>(null);
	let formTitle = $state('');
	let formDescription = $state('');
	let formDueAt = $state('');
	let formBusy = $state(false);
	let formError = $state('');

	let suggestText = $state('');
	let suggestBusy = $state(false);
	let suggestError = $state('');

	function nodeHref(node: NodeRef | null): string {
		if (!node) return resolve('/');
		if (node.kind === 'course') return resolve('/courses/[id]', { id: node.id });
		if (node.kind === 'event') return resolve('/events/[id]', { id: node.id });
		if (node.kind === 'material') return resolve('/materials/[id]', { id: node.id });
		return resolve('/');
	}

	function reasonFromError(e: unknown): string {
		const body = (e as { body?: { detail?: string } } | undefined)?.body;
		const key = body?.detail as keyof typeof PLAN_BLOCK_REASON_LABELS | undefined;
		if (key && PLAN_BLOCK_REASON_LABELS[key]) return PLAN_BLOCK_REASON_LABELS[key]();
		return m.common_error_generic();
	}

	function toLocalInputValue(iso: string): string {
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	async function load(id: string) {
		loading = true;
		notFound = false;
		mySuggestion = null;
		try {
			const found = await getPlan(id);
			plan = found;
			suggestions = found.canEdit ? await getPlanSuggestions(id).catch(() => []) : [];
		} catch {
			notFound = true;
			plan = null;
		} finally {
			loading = false;
		}
	}

	async function reload() {
		if (plan) await load(plan.id);
	}

	// The id-changed idempotency guard every dynamic route needs (frontend/CLAUDE.md trap 2), keyed
	// on the session too since `canEdit`/`suggestBlockReason` change the moment it resolves.
	let loadedFor = $state('');
	$effect(() => {
		const id = page.params.id!;
		const key = `${id}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		load(id);
	});

	function startEditDetails() {
		if (!plan) return;
		editTitle = plan.title;
		editDescription = plan.description;
		editError = '';
		editingDetails = true;
	}

	async function saveDetails(event: SubmitEvent) {
		event.preventDefault();
		if (!plan) return;
		const title = editTitle.trim();
		if (!title) return;
		editBusy = true;
		editError = '';
		try {
			plan = await updatePlan(plan.id, { title, description: editDescription });
			editingDetails = false;
		} catch (e) {
			editError = reasonFromError(e);
		} finally {
			editBusy = false;
		}
	}

	async function doTransition(status: string) {
		if (!plan) return;
		transitionBusy = true;
		transitionError = '';
		try {
			plan = await transitionPlan(plan.id, status);
		} catch (e) {
			transitionError = reasonFromError(e);
		} finally {
			transitionBusy = false;
		}
	}

	async function confirmDelete() {
		if (!plan) return;
		if (!window.confirm(m.plans_detail_deleteConfirm())) return;
		const node = plan.node;
		await deletePlan(plan.id);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- nodeHref() calls resolve() itself; the rule only sees this call site
		goto(nodeHref(node));
	}

	function openCreateForm(parentId: string | null) {
		formOpenFor = parentId ?? 'top';
		formTitle = '';
		formDescription = '';
		formDueAt = '';
		formError = '';
	}

	function openEditForm(step: PlanStep) {
		formOpenFor = `edit:${step.id}`;
		formTitle = step.title;
		formDescription = step.description;
		formDueAt = step.dueAt ? toLocalInputValue(step.dueAt) : '';
		formError = '';
	}

	function closeForm() {
		formOpenFor = null;
	}

	async function submitForm(event: SubmitEvent) {
		event.preventDefault();
		if (!plan) return;
		const title = formTitle.trim();
		if (!title) return;
		formBusy = true;
		formError = '';
		try {
			if (formOpenFor?.startsWith('edit:')) {
				const stepId = formOpenFor.slice('edit:'.length);
				await updatePlanStep(stepId, {
					title,
					description: formDescription,
					dueAt: formDueAt || null
				});
			} else {
				const parentId = formOpenFor === 'top' ? null : formOpenFor;
				await addPlanStep(plan.id, {
					title,
					description: formDescription,
					dueAt: formDueAt || null,
					parentId
				});
			}
			formOpenFor = null;
			await reload();
		} catch (e) {
			formError = reasonFromError(e);
		} finally {
			formBusy = false;
		}
	}

	async function changeStepStatus(step: PlanStep, status: string) {
		await updatePlanStep(step.id, { status });
		await reload();
	}

	async function removeStep(step: PlanStep) {
		if (!window.confirm(m.plans_detail_removeStepConfirm())) return;
		await deletePlanStep(step.id);
		await reload();
	}

	async function moveStep(group: PlanStep[], index: number, by: -1 | 1, parentId: string | null) {
		if (!plan) return;
		const other = group[index + by];
		if (!other) return;
		const ids = group.map((s) => s.id);
		[ids[index], ids[index + by]] = [ids[index + by], ids[index]];
		plan = await reorderPlanSteps(plan.id, ids, parentId ?? undefined);
	}

	async function submitSuggestion(event: SubmitEvent) {
		event.preventDefault();
		if (!plan) return;
		const text = suggestText.trim();
		if (!text) return;
		suggestBusy = true;
		suggestError = '';
		try {
			mySuggestion = await suggestOnPlan(plan.id, text);
			suggestText = '';
		} catch (e) {
			suggestError = reasonFromError(e);
		} finally {
			suggestBusy = false;
		}
	}

	async function withdrawMySuggestion() {
		if (!mySuggestion) return;
		mySuggestion = await withdrawPlanSuggestion(mySuggestion.id);
	}

	async function decide(suggestion: PlanSuggestion, decision: 'accept' | 'reject') {
		await decidePlanSuggestion(suggestion.id, decision);
		await reload();
	}
</script>

<PageHead
	title={plan?.title || m.plans_panel_heading()}
	description={m.plans_detail_pageDescription()}
	noindex
/>

<FeatureGate feature="plans">
	<div class="page" data-plan-detail>
		{#if loading}
			<p class="hint">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if notFound || !plan}
			<p class="hint">{m.plans_detail_notFound()}</p>
			<!-- "This plan isn't here, or you can't see it yet." -->
		{:else}
			{#if plan.node}
				<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- nodeHref() calls resolve() itself; the rule only sees this attribute -->
					<a href={nodeHref(plan.node)}>{plan.node.title}</a>
				</nav>
			{/if}

			<header class="head">
				{#if editingDetails}
					<form class="edit-form" onsubmit={saveDetails}>
						<label>
							<span>{m.plans_detail_titleLabel()}</span>
							<input type="text" bind:value={editTitle} maxlength="200" disabled={editBusy} />
						</label>
						<label>
							<span>{m.plans_detail_descriptionLabel()}</span>
							<textarea bind:value={editDescription} rows="4" disabled={editBusy}></textarea>
						</label>
						<div class="actions">
							<button type="submit" disabled={editBusy || !editTitle.trim()}
								>{m.plans_detail_save()}</button
							>
							<button type="button" class="link" onclick={() => (editingDetails = false)}
								>{m.plans_detail_cancel()}</button
							>
						</div>
						{#if editError}<p class="error">{editError}</p>{/if}
					</form>
				{:else}
					<div class="title-row">
						<h1>{plan.title}</h1>
						<span class="status-pill status-{plan.status}" data-plan-status={plan.status}
							>{PLAN_STATUS_LABELS[plan.status]()}</span
						>
						{#if plan.canEdit}
							<button type="button" class="link" onclick={startEditDetails}
								>{m.plans_detail_edit()}</button
							>
						{/if}
					</div>
					{#if plan.description}<MathContent source={plan.description} />{/if}
				{/if}
				<p class="meta">
					{m.plans_detail_createdBy({
						date: formatDateTime(plan.createdAt),
						name: plan.createdByName
					})}
					· {m.plans_detail_progress({ done: plan.progress.done, total: plan.progress.total })}
				</p>
			</header>

			{#if plan.canEdit}
				<div class="content-section transitions">
					{#if plan.status === 'draft'}
						<button type="button" disabled={transitionBusy} onclick={() => doTransition('active')}
							>{m.plans_detail_activate()}</button
						>
						<button
							type="button"
							class="secondary"
							disabled={transitionBusy}
							onclick={() => doTransition('archived')}>{m.plans_detail_archive()}</button
						>
						<button type="button" class="danger" onclick={confirmDelete}
							>{m.plans_detail_delete()}</button
						>
					{:else if plan.status === 'active'}
						<button
							type="button"
							disabled={transitionBusy}
							onclick={() => doTransition('completed')}>{m.plans_detail_complete()}</button
						>
						<button
							type="button"
							class="secondary"
							disabled={transitionBusy}
							onclick={() => doTransition('archived')}>{m.plans_detail_archive()}</button
						>
					{:else if plan.status === 'completed'}
						<button type="button" disabled={transitionBusy} onclick={() => doTransition('archived')}
							>{m.plans_detail_archive()}</button
						>
					{/if}
					{#if transitionError}<p class="error">{transitionError}</p>{/if}
				</div>
			{/if}

			<section class="content-section">
				<div class="section-head">
					<h2>{m.plans_detail_stepsHeading()}</h2>
					{#if plan.canEdit}
						<button type="button" class="link" onclick={() => openCreateForm(null)}
							>{m.plans_detail_addStep()}</button
						>
					{/if}
				</div>

				{#if formOpenFor === 'top'}
					{@render stepForm()}
				{/if}

				{#if plan.steps.length === 0}
					<p class="hint">{m.plans_detail_noSteps()}</p>
				{:else}
					<ol class="steps" data-plan-steps>
						{#each plan.steps as step, index (step.id)}
							<li class="step">
								{@render stepRow(step, index, plan.steps, null)}
								{#if formOpenFor === step.id}
									{@render stepForm()}
								{/if}
								{#if step.substeps.length > 0}
									<ol class="substeps">
										{#each step.substeps as sub, subIndex (sub.id)}
											<li class="step substep">
												{@render stepRow(sub, subIndex, step.substeps, step.id)}
												{#if formOpenFor === sub.id}
													{@render stepForm()}
												{/if}
											</li>
										{/each}
									</ol>
								{/if}
							</li>
						{/each}
					</ol>
				{/if}
			</section>

			<section class="content-section">
				<h2>{m.plans_detail_suggestHeading()}</h2>
				{#if authStore.isAuthenticated}
					{#if plan.suggestBlockReason === null}
						<form class="suggest-form" data-suggest-form onsubmit={submitSuggestion}>
							<textarea
								bind:value={suggestText}
								placeholder={m.plans_detail_suggestPlaceholder()}
								rows="3"
								disabled={suggestBusy}></textarea>
							<button type="submit" disabled={suggestBusy || !suggestText.trim()}
								>{m.plans_detail_suggestSubmit()}</button
							>
						</form>
						{#if suggestError}<p class="error">{suggestError}</p>{/if}
					{:else}
						<p class="hint">
							{PLAN_BLOCK_REASON_LABELS[plan.suggestBlockReason]?.() ?? plan.suggestBlockReason}
						</p>
					{/if}
				{:else}
					<p class="hint"><a href={resolve('/login')}>{m.plans_detail_signInToSuggest()}</a></p>
				{/if}

				{#if mySuggestion}
					<p class="notice">
						{m.plans_detail_suggestSent()}
						({PLAN_SUGGESTION_STATUS_LABELS[mySuggestion.status]()})
						{#if mySuggestion.status === 'pending'}
							<button type="button" class="link" onclick={withdrawMySuggestion}
								>{m.plans_detail_withdraw()}</button
							>
						{/if}
					</p>
				{/if}
			</section>

			{#if plan.canEdit}
				<section class="content-section">
					<h2>{m.plans_detail_suggestionsHeading()}</h2>
					{#if suggestions.length === 0}
						<p class="hint">{m.plans_detail_suggestionsEmpty()}</p>
					{:else}
						<ul class="suggestions" data-suggestions-queue>
							{#each suggestions as suggestion (suggestion.id)}
								<li>
									<MathContent source={suggestion.text} tag="div" />
									<p class="meta">
										{m.plans_detail_by({ name: suggestion.userName })} ·
										{PLAN_SUGGESTION_STATUS_LABELS[suggestion.status]()}
									</p>
									{#if suggestion.status === 'pending'}
										<div class="actions">
											<button type="button" onclick={() => decide(suggestion, 'accept')}
												>{m.plans_detail_accept()}</button
											>
											<button
												type="button"
												class="secondary"
												onclick={() => decide(suggestion, 'reject')}
												>{m.plans_detail_reject()}</button
											>
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</FeatureGate>

{#snippet stepRow(step: PlanStep, index: number, group: PlanStep[], parentId: string | null)}
	<div class="step-row">
		<select
			value={step.status}
			disabled={!plan?.canEdit}
			onchange={(e) => changeStepStatus(step, e.currentTarget.value)}
		>
			{#each STEP_STATUSES as s (s)}
				<option value={s}>{PLAN_STEP_STATUS_LABELS[s]()}</option>
			{/each}
		</select>
		<span class="step-title" class:done={step.status === 'done'}>{step.title}</span>
		{#if step.dueAt}
			<span class="due">{m.plans_detail_dueLabel()}: {formatDateTime(step.dueAt)}</span>
		{/if}
		{#if plan?.canEdit}
			<div class="step-actions">
				<button
					type="button"
					aria-label={m.plans_detail_moveUp()}
					disabled={index === 0}
					onclick={() => moveStep(group, index, -1, parentId)}>↑</button
				>
				<button
					type="button"
					aria-label={m.plans_detail_moveDown()}
					disabled={index === group.length - 1}
					onclick={() => moveStep(group, index, 1, parentId)}>↓</button
				>
				<button type="button" onclick={() => openEditForm(step)}>{m.plans_detail_edit()}</button>
				{#if parentId === null}
					<button type="button" onclick={() => openCreateForm(step.id)}
						>{m.plans_detail_addSubstep()}</button
					>
				{/if}
				<button type="button" class="danger" onclick={() => removeStep(step)}
					>{m.plans_detail_removeStep()}</button
				>
			</div>
		{/if}
	</div>
	{#if step.description}<MathContent source={step.description} tag="div" />{/if}
{/snippet}

{#snippet stepForm()}
	<form class="step-form" onsubmit={submitForm}>
		<input
			type="text"
			bind:value={formTitle}
			placeholder={m.plans_detail_stepTitlePlaceholder()}
			maxlength="200"
			disabled={formBusy}
		/>
		<textarea bind:value={formDescription} rows="2" disabled={formBusy}></textarea>
		<label class="due-field">
			<span>{m.plans_detail_dueLabel()}</span>
			<input type="datetime-local" bind:value={formDueAt} disabled={formBusy} />
		</label>
		<div class="actions">
			<button type="submit" disabled={formBusy || !formTitle.trim()}>{m.plans_detail_save()}</button
			>
			<button type="button" class="link" onclick={closeForm}>{m.plans_detail_cancel()}</button>
		</div>
		{#if formError}<p class="error">{formError}</p>{/if}
	</form>
{/snippet}

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		h1 {
			margin: 0;
		}
	}
	.status-pill {
		font-size: var(--font-size-xs);
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
		&.status-active {
			background: var(--status-success-bg);
			color: var(--status-success);
		}
	}
	.meta {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.content-section {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.transitions {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
	}
	.steps,
	.substeps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.substeps {
		margin-left: var(--space-5);
		margin-top: var(--space-2);
		border-left: 2px solid var(--border-color);
		padding-left: var(--space-3);
	}
	.step-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.step-title {
		font-weight: 600;
		&.done {
			text-decoration: line-through;
			color: var(--text-secondary);
			font-weight: 400;
		}
	}
	.due {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.step-actions {
		display: flex;
		gap: var(--space-1);
		margin-left: auto;
	}
	.step-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		input,
		textarea {
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.due-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--font-size-sm);
	}
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		label {
			display: flex;
			flex-direction: column;
			gap: 2px;
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
	.suggest-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		textarea {
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.suggestions {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		li {
			border-top: 1px solid var(--border-color);
			padding-top: var(--space-2);
		}
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}
	.secondary {
		@include mix.button-secondary;
		min-height: 40px;
		padding: var(--space-2) var(--space-3);
	}
	.danger {
		color: var(--status-danger);
		background: none;
		border: 1px solid var(--status-danger);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.error {
		margin: 0;
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
