<script lang="ts">
	// Add, edit, reorder and remove experience entries.
	//
	// The list and the form share one panel rather than being two screens, because editing here is
	// almost always "fix the thing I can see" — and the reason the whole editor is modals in the first
	// place is that a person opens one area, deals with it, and closes it.
	//
	// **The parent owns the data and reloads it.** Every write calls `onChanged`, which re-fetches from
	// the server rather than patching a local array: the server owns `order` and applies its own sort,
	// so guessing the new arrangement client-side is how this list ends up disagreeing with the one
	// everybody else sees.
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import {
		createExperience,
		deleteExperience,
		swapOrder,
		updateExperience
	} from '$lib/services/profileExtras';
	import type { ExperienceEntry, ExperienceKind } from '$lib/types/profileExtras';

	let {
		entries,
		onChanged,
		onClose
	}: {
		entries: ExperienceEntry[];
		onChanged: () => Promise<void>;
		onClose: () => void;
	} = $props();

	// `null` is "nothing being edited"; an id is that row; the empty string is a new one, which is
	// genuinely different from editing the row whose id happens to be ''.
	let editing = $state<string | null>(null);
	let draft = $state({
		kind: 'study' as ExperienceKind,
		title: '',
		organisation: '',
		startedOn: '',
		endedOn: '',
		description: ''
	});
	let busy = $state(false);
	let error = $state('');

	const KINDS: ExperienceKind[] = ['study', 'work', 'teaching', 'project', 'other'];
	const KIND_LABEL: Record<ExperienceKind, () => string> = {
		study: () => m.profile_kind_study(), // "Study"
		work: () => m.profile_kind_work(), // "Work"
		teaching: () => m.profile_kind_teaching(), // "Teaching"
		project: () => m.profile_kind_project(), // "Project"
		other: () => m.profile_kind_other() // "Other"
	};

	function start(entry: ExperienceEntry | null) {
		editing = entry?.id ?? '';
		draft = {
			kind: entry?.kind ?? 'study',
			title: entry?.title ?? '',
			organisation: entry?.organisation ?? '',
			startedOn: entry?.startedOn ?? '',
			endedOn: entry?.endedOn ?? '',
			description: entry?.description ?? ''
		};
		error = '';
	}

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		error = '';
		try {
			await fn();
			await onChanged();
			editing = null;
		} catch {
			error = m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		const payload = {
			kind: draft.kind,
			title: draft.title.trim(),
			organisation: draft.organisation.trim(),
			startedOn: draft.startedOn || null,
			endedOn: draft.endedOn || null,
			description: draft.description.trim()
		};
		if (!payload.title) return;
		const id = editing;
		run(() =>
			id ? updateExperience(id, payload) : createExperience({ ...payload, order: entries.length })
		);
	}

	function move(index: number, by: -1 | 1) {
		const other = entries[index + by];
		if (!other) return;
		run(() => swapOrder('experience', entries[index], other));
	}

	function remove(entry: ExperienceEntry) {
		// A native confirm rather than a bespoke dialog: this is already inside one, and a modal over a
		// modal for a yes/no is worse than the browser's own.
		if (!window.confirm(m.profile_edit_confirmRemove({ label: entry.title }))) return;
		run(() => deleteExperience(entry.id));
	}
</script>

<ModalShell title={m.profile_experienceHeading()} {onClose}>
	<!-- "Experience" -->
	{#if entries.length > 0}
		<ul class="rows">
			{#each entries as entry, index (entry.id)}
				<li class="row">
					<div class="row__text">
						<span class="row__title">{entry.title}</span>
						<span class="row__meta">
							{[KIND_LABEL[entry.kind]?.() ?? entry.kind, entry.organisation]
								.filter(Boolean)
								.join(' · ')}
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
							disabled={busy || index === entries.length - 1}
							onclick={() => move(index, 1)}>↓</button
						>
						<button type="button" disabled={busy} onclick={() => start(entry)}>
							{m.profile_edit_edit()}
							<!-- "Edit" -->
						</button>
						<button type="button" class="danger" disabled={busy} onclick={() => remove(entry)}>
							{m.profile_edit_remove()}
							<!-- "Remove" -->
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if editing === null}
		<button type="button" class="primary" onclick={() => start(null)}>
			{m.profile_edit_addExperience()}
			<!-- "Add an entry" -->
		</button>
	{:else}
		<form class="edit-form" onsubmit={save}>
			<label>
				{m.profile_edit_title()}
				<!-- "Title" -->
				<input type="text" bind:value={draft.title} required />
			</label>
			<div class="pair">
				<label>
					{m.profile_edit_kind()}
					<!-- "Kind" -->
					<select bind:value={draft.kind}>
						{#each KINDS as kind (kind)}
							<option value={kind}>{KIND_LABEL[kind]()}</option>
						{/each}
					</select>
				</label>
				<label>
					{m.profile_edit_organisation()}
					<!-- "Where" -->
					<input type="text" bind:value={draft.organisation} />
				</label>
			</div>
			<div class="pair">
				<label>
					{m.profile_edit_startedOn()}
					<!-- "From" -->
					<input type="date" bind:value={draft.startedOn} />
				</label>
				<label>
					{m.profile_edit_endedOn()}
					<!-- "Until" -->
					<input type="date" bind:value={draft.endedOn} />
					<span class="hint">{m.profile_edit_endedOnHint()}</span>
					<!-- "Leave empty if it is still going." -->
				</label>
			</div>
			<label>
				{m.profile_edit_description()}
				<!-- "Description" -->
				<textarea rows="3" bind:value={draft.description}></textarea>
			</label>
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
	// Styled locally rather than through a shared mixin, matching what every other profile child
	// component here already does. A mixin emitting these selectors into three modals would emit the
	// ones a given modal does not use too, and Svelte reports each of those as an unused-selector
	// warning — so the "shared" version costs a warning per unused class in exchange for saving a
	// repeated block.
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
			// 32px, not the 44 a primary control gets: these sit four to a row on a phone, and at 44 the
			// row wraps into a stack that hides the entry it belongs to.
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
	.pair {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		label {
			flex: 1;
			min-width: 9rem;
		}
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--font-size-sm);
	}
	input,
	select,
	textarea {
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
