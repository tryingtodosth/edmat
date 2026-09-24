<script lang="ts">
	/** Mount point C on `ManagementPanels` (MANAGEMENT-BRIEF.md §3.C): the open needs on this node,
	 * a post-a-need form for its manager, and a link into each need's own page for the rest (apply,
	 * withdraw, the applications queue). Draws nothing when the kill switch is off or this reader
	 * cannot see the node at all — `ManagementPanels` itself already withheld `node` in the second
	 * case, so the only thing left to check here is the flag. */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import type { NodeRef } from '$lib/types/node';
	import type { Need, NeedDraft, NeedKind, SkillLevel } from '$lib/types/need';
	import { createNeed, getNodeNeeds } from '$lib/services/needs';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { ApiError } from '$lib/api/client';
	import {
		NEED_KINDS,
		NEED_KIND_LABELS,
		NEED_STATUS_LABELS,
		SKILL_LEVELS,
		SKILL_LEVEL_LABELS
	} from '$lib/utils/labels';

	let { node }: { node: NodeRef } = $props();

	const canSee = $derived(featureFlagsStore.isEnabled('needs') || authStore.isModerator);

	let needs = $state<Need[]>([]);
	let loading = $state(true);
	let loadedFor = $state('');
	let showForm = $state(false);
	let busy = $state(false);
	let error = $state('');

	let title = $state('');
	let description = $state('');
	let kind = $state<NeedKind>('help');
	let skillLevel = $state<SkillLevel>('none');
	let estimatedHours = $state('');
	let deadline = $state('');
	let isRemote = $state(false);
	let wantedCount = $state('1');

	async function load() {
		loading = true;
		try {
			needs = await getNodeNeeds(node.kind, node.id);
		} catch {
			// A kind the API does not (yet) support, or a network hiccup — an empty panel is the
			// honest thing to show rather than an error nobody on this page can act on.
			needs = [];
		} finally {
			loading = false;
		}
	}

	// Keyed on the node, the same idempotency guard `ManagementPanels` itself uses — an unguarded
	// effect reading `needs` after `load()` assigns it would re-enter itself.
	$effect(() => {
		const key = `${node.kind}:${node.id}`;
		if (!canSee || key === loadedFor) return;
		loadedFor = key;
		void load();
	});

	function resetForm() {
		title = '';
		description = '';
		kind = 'help';
		skillLevel = 'none';
		estimatedHours = '';
		deadline = '';
		isRemote = false;
		wantedCount = '1';
		error = '';
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!title.trim()) return;
		busy = true;
		error = '';
		try {
			const draft: NeedDraft = {
				title: title.trim(),
				description: description.trim(),
				kind,
				skillLevel,
				estimatedHours: estimatedHours.trim()
					? Math.max(0, parseInt(estimatedHours, 10) || 0)
					: null,
				deadline: deadline ? new Date(deadline).toISOString() : null,
				isRemote,
				wantedCount: Math.max(1, parseInt(wantedCount, 10) || 1)
			};
			const created = await createNeed(node.kind, node.id, draft);
			needs = [created, ...needs];
			showForm = false;
			resetForm();
		} catch (err) {
			error =
				err instanceof ApiError
					? (((err.body as Record<string, unknown> | undefined)?.detail as string | undefined) ??
						m.common_error())
					: m.common_error();
		} finally {
			busy = false;
		}
	}
</script>

{#if canSee}
	<section class="needs-panel" data-needs-panel>
		<div class="head">
			<h2>{m.needs_panelHeading()}</h2>
			{#if node.canManage && !showForm}
				<button type="button" class="primary" onclick={() => (showForm = true)}>
					{m.needs_addNeed()}
				</button>
			{/if}
		</div>

		{#if showForm}
			<form class="add-form" onsubmit={submit}>
				<label class="field grow">
					<span>{m.needs_formTitleLabel()}</span>
					<input type="text" bind:value={title} required maxlength="200" />
				</label>
				<label class="field">
					<span>{m.needs_formKindLabel()}</span>
					<select bind:value={kind}>
						{#each NEED_KINDS as k (k)}
							<option value={k}>{NEED_KIND_LABELS[k]()}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>{m.needs_formSkillLevelLabel()}</span>
					<select bind:value={skillLevel}>
						{#each SKILL_LEVELS as level (level)}
							<option value={level}>{SKILL_LEVEL_LABELS[level]()}</option>
						{/each}
					</select>
				</label>
				<label class="field grow">
					<span>{m.needs_formDescriptionLabel()}</span>
					<textarea rows="3" bind:value={description}></textarea>
				</label>
				<label class="field">
					<span>{m.needs_formEstimatedHoursLabel()}</span>
					<input type="text" inputmode="numeric" bind:value={estimatedHours} />
				</label>
				<label class="field">
					<span>{m.needs_formDeadlineLabel()}</span>
					<input type="datetime-local" bind:value={deadline} />
				</label>
				<label class="field">
					<span>{m.needs_formWantedCountLabel()}</span>
					<input type="text" inputmode="numeric" bind:value={wantedCount} />
				</label>
				<label class="checkbox">
					<input type="checkbox" bind:checked={isRemote} />
					<span>{m.needs_formRemoteLabel()}</span>
				</label>
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<div class="actions">
					<button type="submit" class="primary" disabled={busy}>{m.common_save()}</button>
					<button
						type="button"
						onclick={() => {
							showForm = false;
							resetForm();
						}}>{m.common_cancel()}</button
					>
				</div>
			</form>
		{/if}

		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if needs.length === 0}
			<p class="status">{m.needs_panelEmpty()}</p>
		{:else}
			<ul class="list">
				{#each needs as need (need.id)}
					<li class="row">
						<a class="title" href={resolve('/needs/[id]', { id: need.id })}>{need.title}</a>
						<span class="kind">{NEED_KIND_LABELS[need.kind]()}</span>
						<span class="pill pill--{need.status}">{NEED_STATUS_LABELS[need.status]()}</span>
						<span class="count"
							>{m.needs_acceptedOfWanted({
								accepted: need.acceptedCount,
								wanted: need.wantedCount
							})}</span
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style lang="scss">
	.needs-panel {
		display: grid;
		gap: var(--space-3, 0.75rem);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2, 0.5rem);
		flex-wrap: wrap;
	}
	.head h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	button {
		min-height: 40px;
		padding: 0 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.status {
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
	.add-form {
		display: grid;
		gap: 0.6rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1rem;
		background: var(--bg-surface);
	}
	.field {
		display: grid;
		gap: 0.2rem;
		font-size: 0.9rem;
	}
	.grow {
		grid-column: 1 / -1;
	}
	input,
	select,
	textarea {
		font: inherit;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		min-height: 40px;
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
	}
	.checkbox input {
		min-height: auto;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.title {
		font-weight: 600;
	}
	.kind,
	.count {
		font-size: 0.82rem;
		color: var(--text-secondary);
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border);
	}
	.pill--open {
		background: var(--status-success-bg);
		color: var(--status-success);
		border-color: transparent;
	}
	.pill--in_progress {
		background: var(--status-warning-bg);
		color: var(--status-warning);
		border-color: transparent;
	}
	.pill--fulfilled {
		background: var(--status-info-bg, var(--bg-surface));
		color: var(--text-secondary);
	}
	.pill--cancelled {
		opacity: 0.7;
	}
</style>
