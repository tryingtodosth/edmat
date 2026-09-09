<script lang="ts">
	/** The organiser's own questions for a `form` event, edited as a list and saved whole. */
	import { m } from '$lib/paraglide/messages.js';
	import type {
		RegistrationField,
		RegistrationFieldDraft,
		RegistrationFieldKind
	} from '$lib/types/event';
	import { untrack } from 'svelte';

	let {
		initial,
		busy = false,
		error = '',
		onsave
	}: {
		initial: RegistrationField[];
		busy?: boolean;
		error?: string;
		onsave: (fields: RegistrationFieldDraft[]) => void;
	} = $props();

	type Row = RegistrationFieldDraft & { optionsText: string };
	let rows = $state<Row[]>(
		untrack(() =>
			initial.map((f) => ({
				label: f.label,
				kind: f.kind,
				required: f.required,
				options: f.options,
				optionsText: f.options.join(', ')
			}))
		)
	);
	const KINDS: Record<RegistrationFieldKind, () => string> = {
		text: m.events_fieldKind_text,
		long_text: m.events_fieldKind_longText,
		choice: m.events_fieldKind_choice,
		multi: m.events_fieldKind_multi,
		checkbox: m.events_fieldKind_checkbox
	};
	function add() {
		rows = [...rows, { label: '', kind: 'text', required: false, options: [], optionsText: '' }];
	}
	function save(e: SubmitEvent) {
		e.preventDefault();
		onsave(
			rows
				.filter((r) => r.label.trim())
				.map(({ optionsText, ...r }) => ({
					...r,
					label: r.label.trim(),
					options:
						r.kind === 'choice' || r.kind === 'multi'
							? optionsText
									.split(',')
									.map((o) => o.trim())
									.filter(Boolean)
							: []
				}))
		);
	}
</script>

<form class="fields-editor" onsubmit={save}>
	<h3>{m.events_questionsHeading()}</h3>
	<p class="hint">{m.events_questionsHint()}</p>
	{#each rows as row, i (i)}
		<div class="row">
			<input
				type="text"
				bind:value={row.label}
				placeholder={m.events_questionLabel()}
				aria-label={m.events_questionLabel()}
				maxlength="200"
			/>
			<select bind:value={row.kind} aria-label={m.events_questionKind()}>
				{#each Object.keys(KINDS) as k (k)}<option value={k}
						>{KINDS[k as RegistrationFieldKind]()}</option
					>{/each}
			</select>
			{#if row.kind === 'choice' || row.kind === 'multi'}
				<input
					type="text"
					bind:value={row.optionsText}
					placeholder={m.events_questionOptions()}
					aria-label={m.events_questionOptions()}
				/>
			{/if}
			<label class="req"
				><input type="checkbox" bind:checked={row.required} /> {m.events_questionRequired()}</label
			>
			<button
				type="button"
				class="x"
				aria-label={m.common_remove()}
				onclick={() => (rows = rows.filter((_, j) => j !== i))}>×</button
			>
		</div>
	{/each}
	{#if error}<p class="error">{error}</p>{/if}
	<div class="actions">
		<button type="button" onclick={add}>{m.events_questionAdd()}</button>
		<button type="submit" class="primary" disabled={busy}>{m.common_save()}</button>
	</div>
</form>

<style lang="scss">
	.fields-editor {
		display: grid;
		gap: 0.5rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		margin-top: 1rem;
	}
	h3 {
		margin: 0;
	}
	.hint,
	.error {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin: 0;
	}
	.error {
		color: var(--status-danger);
	}
	.row {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		align-items: center;
	}
	input[type='text'],
	select {
		font: inherit;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		min-height: 40px;
		flex: 1 1 10rem;
	}
	.req {
		font-size: 0.85rem;
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
	}
	.x {
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 1.1rem;
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	.actions button {
		min-height: 40px;
		padding: 0 0.9rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
</style>
