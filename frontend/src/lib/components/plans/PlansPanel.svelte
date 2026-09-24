<script lang="ts">
	// The roadmaps behind one node — mount point D in ManagementPanels.svelte
	// (MANAGEMENT-BRIEF.md §3.D). Draws nothing while the `plans` switch is off (unless this reader
	// moderates — the backend's own `feature_gate` bypass, mirrored client-side by `FeatureGate`),
	// and nothing at all once loaded if there is nothing to show a reader who cannot manage the
	// node (the CoopPanel precedent: an empty panel is not a box with nothing in it).
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { createPlan, getNodePlans } from '$lib/services/plans';
	import type { NodeRef } from '$lib/types/node';
	import type { Plan, PlanStep } from '$lib/types/plan';
	import { PLAN_STATUS_LABELS } from '$lib/utils/labels';

	let { node }: { node: NodeRef } = $props();

	let plans = $state<Plan[]>([]);
	let creating = $state(false);
	let title = $state('');
	let busy = $state(false);
	let error = $state('');

	let enabled = $derived(featureFlagsStore.isEnabled('plans') || authStore.isModerator);

	// Keyed on the node AND on who is asking (the ManagementPanels/CoopPanel precedent): every
	// `canManage` changes the moment a session resolves.
	let loadedFor = $state('');
	$effect(() => {
		if (!enabled) return;
		const key = `${node.kind}:${node.id}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		plans = [];
		getNodePlans(node.kind, node.id)
			.then((found) => (plans = found))
			.catch(() => (plans = []));
	});

	function nextOpenStep(plan: Plan): string | null {
		const flat: PlanStep[] = plan.steps.flatMap((step) => [step, ...step.substeps]);
		const open = flat.find((step) => step.status !== 'done' && step.status !== 'skipped');
		return open?.title ?? null;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const value = title.trim();
		if (!value) return;
		busy = true;
		error = '';
		try {
			const plan = await createPlan(node.kind, node.id, { title: value });
			plans = [plan, ...plans];
			title = '';
			creating = false;
		} catch {
			error = m.plans_panel_createError(); // "Could not create the plan."
		} finally {
			busy = false;
		}
	}
</script>

{#if enabled && (plans.length > 0 || node.canManage)}
	<section class="plans-panel" data-plans-panel>
		<header class="head">
			<h2>{m.plans_panel_heading()}</h2>
			<!-- "Plans" -->
			{#if node.canManage}
				<button type="button" class="secondary" onclick={() => (creating = !creating)}>
					{creating ? m.plans_panel_cancel() : m.plans_panel_new()}
					<!-- "Cancel" / "New plan" -->
				</button>
			{/if}
		</header>

		{#if creating}
			<form class="create-form" onsubmit={submit}>
				<input
					type="text"
					bind:value={title}
					placeholder={m.plans_panel_titlePlaceholder()}
					disabled={busy}
					maxlength="200"
				/>
				<!-- "Roadmap title" -->
				<button type="submit" disabled={busy || !title.trim()}>{m.plans_panel_create()}</button>
				<!-- "Create" -->
			</form>
			{#if error}<p class="error">{error}</p>{/if}
		{/if}

		{#if plans.length > 0}
			<ul class="plan-list">
				{#each plans as plan (plan.id)}
					<li class="plan-row">
						<a class="plan-link" data-plan-card href={resolve('/plans/[id]', { id: plan.id })}>
							<span class="plan-title">{plan.title}</span>
							<span class="plan-status status-{plan.status}"
								>{PLAN_STATUS_LABELS[plan.status]()}</span
							>
						</a>
						<div class="progress-track" aria-hidden="true">
							<div class="progress-fill" style={`width: ${plan.progress.percent}%`}></div>
						</div>
						<span class="progress-text">{plan.progress.done}/{plan.progress.total}</span>
						{#if nextOpenStep(plan)}
							<span class="next-step"
								>{m.plans_panel_next({ title: nextOpenStep(plan) ?? '' })}</span
							>
							<!-- "Next: {title}" -->
						{/if}
					</li>
				{/each}
			</ul>
		{:else if node.canManage}
			<p class="empty">{m.plans_panel_empty()}</p>
			<!-- "No roadmap yet." -->
		{/if}
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.plans-panel {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
			flex: 1;
		}
	}
	.secondary {
		@include mix.button-secondary;
		min-height: 40px;
		padding: var(--space-2) var(--space-3);
	}
	.create-form {
		display: flex;
		gap: var(--space-2);
		input {
			flex: 1;
			min-height: 40px;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.error {
		margin: 0;
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.plan-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.plan-row {
		display: grid;
		gap: var(--space-1);
	}
	.plan-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		color: var(--text-primary);
		text-decoration: none;
		&:hover .plan-title {
			text-decoration: underline;
		}
	}
	.plan-title {
		font-weight: 600;
	}
	.plan-status {
		font-size: var(--font-size-xs);
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
		&.status-active {
			background: var(--status-success-bg);
			color: var(--status-success);
		}
		&.status-completed {
			background: var(--accent-soft);
			color: var(--accent);
		}
	}
	.progress-track {
		height: 6px;
		border-radius: 999px;
		background: var(--bg-surface-alt);
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: var(--accent);
	}
	.progress-text,
	.next-step {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.empty {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
