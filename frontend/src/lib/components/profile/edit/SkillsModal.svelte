<script lang="ts">
	// Add, edit, reorder and remove skills.
	//
	// **There is no evidence picker, and its absence is the point.** `evidence` is what makes a skill
	// worth reading — `registry` means an institution said so — and the API refuses to let anybody type
	// that value (`SkillViewSet.perform_create` downgrades it). So anything created here is
	// self-declared by definition, the form says so in words, and `registry` rows arrive from a
	// transferred transcript instead. Offering a dropdown with a value that silently changes on save
	// would be worse than offering none.
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import { createSkill, deleteSkill, swapOrder, updateSkill } from '$lib/services/profileExtras';
	import type { SkillEntry, SkillLevel } from '$lib/types/profileExtras';

	let {
		skills,
		onChanged,
		onClose
	}: {
		skills: SkillEntry[];
		onChanged: () => Promise<void>;
		onClose: () => void;
	} = $props();

	let editing = $state<string | null>(null);
	let draft = $state({ label: '', level: 'comfortable' as SkillLevel });
	let busy = $state(false);
	let error = $state('');

	const LEVELS: SkillLevel[] = ['learning', 'comfortable', 'teaching'];
	const LEVEL_LABEL: Record<SkillLevel, () => string> = {
		learning: () => m.profile_skill_learning(), // "Learning it"
		comfortable: () => m.profile_skill_comfortable(), // "Comfortable"
		teaching: () => m.profile_skill_teaching() // "Could teach it"
	};
	const EVIDENCE_LABEL: Record<string, () => string> = {
		self_declared: () => m.profile_skill_selfDeclared(), // "self-declared"
		coursework: () => m.profile_skill_coursework(), // "coursework here"
		registry: () => m.profile_skill_registry() // "confirmed by the registry"
	};

	function start(entry: SkillEntry | null) {
		editing = entry?.id ?? '';
		draft = { label: entry?.label ?? '', level: entry?.level ?? 'comfortable' };
		error = '';
	}

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		error = '';
		try {
			await fn();
			await onChanged();
			editing = null;
		} catch (e) {
			// The one refusal worth reporting in its own words: a duplicate label is a real 400 with a
			// real message, and "something went wrong" would send somebody hunting for a network fault.
			const body = (e as { body?: { label?: string[] } }).body;
			error = body?.label?.[0] ?? m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		const payload = { label: draft.label.trim(), level: draft.level };
		if (!payload.label) return;
		const id = editing;
		run(() => (id ? updateSkill(id, payload) : createSkill({ ...payload, order: skills.length })));
	}

	function move(index: number, by: -1 | 1) {
		const other = skills[index + by];
		if (!other) return;
		run(() => swapOrder('skill', skills[index], other));
	}

	function remove(entry: SkillEntry) {
		if (!window.confirm(m.profile_edit_confirmRemove({ label: entry.label }))) return;
		run(() => deleteSkill(entry.id));
	}
</script>

<ModalShell title={m.profile_skillsHeading()} {onClose}>
	<!-- "Skills" -->
	{#if skills.length > 0}
		<ul class="rows">
			{#each skills as skill, index (skill.id)}
				<li class="row">
					<div class="row__text">
						<span class="row__title">{skill.label}</span>
						<span class="row__meta">
							{LEVEL_LABEL[skill.level]?.() ?? skill.level} ·
							{EVIDENCE_LABEL[skill.evidence]?.() ?? skill.evidence}
						</span>
					</div>
					<div class="row__actions">
						<button
							type="button"
							aria-label={m.profile_edit_moveUp()}
							disabled={busy || index === 0}
							onclick={() => move(index, -1)}>↑</button
						>
						<button
							type="button"
							aria-label={m.profile_edit_moveDown()}
							disabled={busy || index === skills.length - 1}
							onclick={() => move(index, 1)}>↓</button
						>
						<button type="button" disabled={busy} onclick={() => start(skill)}>
							{m.profile_edit_edit()}
						</button>
						<button type="button" class="danger" disabled={busy} onclick={() => remove(skill)}>
							{m.profile_edit_remove()}
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if editing === null}
		<button type="button" class="primary" onclick={() => start(null)}>
			{m.profile_edit_addSkill()}
			<!-- "Add a skill" -->
		</button>
	{:else}
		<form class="edit-form" onsubmit={save}>
			<label>
				{m.profile_edit_label()}
				<!-- "Skill" -->
				<input type="text" bind:value={draft.label} required />
			</label>
			<label>
				{m.profile_edit_level()}
				<!-- "Level" -->
				<select bind:value={draft.level}>
					{#each LEVELS as level (level)}
						<option value={level}>{LEVEL_LABEL[level]()}</option>
					{/each}
				</select>
			</label>
			<p class="hint">{m.profile_edit_evidenceHint()}</p>
			<!-- "Anything you add here is marked self-declared. A skill confirmed by your university's
			     registry arrives with a transferred transcript instead — it is not something to type." -->
			<div class="actions">
				<button type="submit" class="primary" disabled={busy}>{m.common_save()}</button>
				<button type="button" disabled={busy} onclick={() => (editing = null)}>
					{m.common_cancel()}
				</button>
			</div>
		</form>
	{/if}

	{#if error}
		<p class="error">{error}</p>
	{/if}
</ModalShell>

<style lang="scss">
	// Local rather than a shared mixin — see ExperienceModal's own note on why.
	@use '../../../styles/mixins' as mix;

	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border-color);
		&:last-child {
			border-bottom: none;
			padding-bottom: 0;
		}
	}
	.row__text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 8rem;
	}
	.row__title {
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.row__meta {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.row__actions {
		display: flex;
		gap: var(--space-1);
		button {
			@include mix.focus-ring;
			background: var(--bg-page);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			color: var(--text-secondary);
			font-size: var(--font-size-xs);
			min-width: 32px;
			min-height: 32px;
			padding: 0 var(--space-2);
			cursor: pointer;
			&:disabled {
				opacity: 0.4;
				cursor: default;
			}
		}
		.danger {
			color: var(--status-danger);
			border-color: var(--status-danger);
		}
	}
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--font-size-sm);
	}
	input,
	select {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
		font: inherit;
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
	}
	.actions button:not(.primary) {
		@include mix.button-secondary;
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
