<script lang="ts">
	/** The attendee's side of a `form` event (AUDIENCE-BRIEF.md §3.3): the baseline questions
	 * every form asks — attendance mode for a hybrid event, accessibility needs, the consent line
	 * naming who sees the answers — plus the organiser's own. Answers are keyed by field id;
	 * the baseline ones under reserved keys the export knows about. */
	import { m } from '$lib/paraglide/messages.js';
	import type { EdmatEvent, RegistrationAnswers } from '$lib/types/event';

	let {
		event,
		busy = false,
		onsubmit,
		oncancel
	}: {
		event: EdmatEvent;
		busy?: boolean;
		onsubmit: (answers: RegistrationAnswers) => void;
		oncancel: () => void;
	} = $props();

	let answers = $state<Record<string, string | string[] | boolean>>({});
	let attendanceMode = $state<'in_person' | 'online'>('in_person');
	let needs = $state('');
	let consent = $state(false);
	let missing = $state<string[]>([]);
	let consentMissing = $state(false);

	function toggleMulti(id: string, option: string, on: boolean) {
		const current = Array.isArray(answers[id]) ? (answers[id] as string[]) : [];
		answers = { ...answers, [id]: on ? [...current, option] : current.filter((o) => o !== option) };
	}
	function submit(e: SubmitEvent) {
		e.preventDefault();
		missing = event.registrationFields
			.filter((f) => f.required)
			.filter((f) => {
				const v = answers[f.id];
				return f.kind === 'checkbox'
					? v !== true
					: v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
			})
			.map((f) => f.id);
		consentMissing = !consent;
		if (missing.length > 0 || !consent) return;
		onsubmit({
			...answers,
			_attendance_mode:
				event.locationKind === 'hybrid'
					? attendanceMode
					: event.locationKind === 'online'
						? 'online'
						: 'in_person',
			_needs: needs.trim(),
			_consent: true
		});
	}
</script>

<form class="registration-form" onsubmit={submit}>
	<h3>{m.events_registerHeading()}</h3>
	{#if event.locationKind === 'hybrid'}
		<fieldset>
			<legend>{m.events_reg_attendanceMode()}</legend>
			<label
				><input type="radio" name="attendance-mode" value="in_person" bind:group={attendanceMode} />
				{m.events_locationKind_onsite()}</label
			>
			<label
				><input type="radio" name="attendance-mode" value="online" bind:group={attendanceMode} />
				{m.events_locationKind_online()}</label
			>
		</fieldset>
	{/if}
	{#each event.registrationFields as field (field.id)}
		<div class="field" class:field--missing={missing.includes(field.id)}>
			{#if field.kind === 'checkbox'}
				<label class="checkbox-row">
					<input
						type="checkbox"
						checked={answers[field.id] === true}
						onchange={(e) => (answers = { ...answers, [field.id]: e.currentTarget.checked })}
					/>
					<span
						>{field.label}{#if field.required}
							*{/if}</span
					>
				</label>
			{:else if field.kind === 'choice'}
				<label>
					<span
						>{field.label}{#if field.required}
							*{/if}</span
					>
					<select
						value={(answers[field.id] as string) ?? ''}
						onchange={(e) => (answers = { ...answers, [field.id]: e.currentTarget.value })}
					>
						<option value="">—</option>
						{#each field.options as o (o)}<option value={o}>{o}</option>{/each}
					</select>
				</label>
			{:else if field.kind === 'multi'}
				<fieldset>
					<legend
						>{field.label}{#if field.required}
							*{/if}</legend
					>
					{#each field.options as o (o)}
						<label class="checkbox-row">
							<input
								type="checkbox"
								checked={Array.isArray(answers[field.id]) &&
									(answers[field.id] as string[]).includes(o)}
								onchange={(e) => toggleMulti(field.id, o, e.currentTarget.checked)}
							/>
							<span>{o}</span>
						</label>
					{/each}
				</fieldset>
			{:else if field.kind === 'long_text'}
				<label>
					<span
						>{field.label}{#if field.required}
							*{/if}</span
					>
					<textarea
						rows="3"
						value={(answers[field.id] as string) ?? ''}
						oninput={(e) => (answers = { ...answers, [field.id]: e.currentTarget.value })}
					></textarea>
				</label>
			{:else}
				<label>
					<span
						>{field.label}{#if field.required}
							*{/if}</span
					>
					<input
						type="text"
						value={(answers[field.id] as string) ?? ''}
						oninput={(e) => (answers = { ...answers, [field.id]: e.currentTarget.value })}
					/>
				</label>
			{/if}
			{#if missing.includes(field.id)}<p class="error">{m.events_reg_required()}</p>{/if}
		</div>
	{/each}
	<label>
		<span>{m.events_reg_needs()} <em>({m.common_optional()})</em></span>
		<textarea rows="2" bind:value={needs} maxlength="500"></textarea>
	</label>
	<label class="checkbox-row consent">
		<input type="checkbox" bind:checked={consent} />
		<span>{m.events_reg_consent({ organiser: event.host.displayName })}</span>
	</label>
	{#if consentMissing}<p class="error">{m.events_reg_consentRequired()}</p>{/if}
	<div class="actions">
		<button type="submit" class="primary" disabled={busy}>{m.events_register()}</button>
		<button type="button" onclick={oncancel}>{m.common_cancel()}</button>
	</div>
</form>

<style lang="scss">
	.registration-form {
		display: grid;
		gap: 0.7rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 1rem;
		background: var(--bg-surface);
		margin-top: 0.8rem;
	}
	h3 {
		margin: 0;
	}
	label,
	.field {
		display: grid;
		gap: 0.25rem;
		font-size: 0.92rem;
	}
	.checkbox-row {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.checkbox-row input {
		margin-top: 0.3rem;
	}
	input[type='text'],
	select,
	textarea {
		font: inherit;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		min-height: 40px;
	}
	fieldset {
		border: 1px dashed var(--border);
		border-radius: 8px;
		padding: 0.5rem 0.8rem;
		display: grid;
		gap: 0.3rem;
	}
	.field--missing {
		outline: 2px solid var(--status-danger);
		outline-offset: 4px;
		border-radius: 6px;
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
		margin: 0;
	}
	.consent {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	.actions button {
		min-height: 44px;
		padding: 0 1rem;
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
