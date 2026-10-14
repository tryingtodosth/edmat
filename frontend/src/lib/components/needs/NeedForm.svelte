<script lang="ts">
	// The one form that writes a need: the panel's "Post a need" and, since 2026-10-10, the "Edit"
	// behind the `⋯` on a need's row and on its own page. `TaskForm`'s shape and for its reason —
	// one form is also one place the `datetime-local` → ISO conversion and the "numeric input is a
	// string" coercion live.
	//
	// Until this existed a need's kind, skill level, hours, deadline, remote flag and wanted count
	// were **create-only**: `PATCH /api/needs/{id}/` has always accepted all six, and nothing in
	// the app ever sent them, so changing one meant Django admin. The owner asked for exactly this
	// ("add content management (eg edit…) to needs and etc").
	//
	// **`type="text"` + `inputmode`, never `type="number"`** for anything the surrounding code
	// treats as a string (frontend/CLAUDE.md trap 1).
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import {
		NEED_KINDS,
		NEED_KIND_LABELS,
		SKILL_LEVELS,
		SKILL_LEVEL_LABELS
	} from '$lib/utils/labels';
	import type { NeedDraft, NeedKind, SkillLevel } from '$lib/types/need';

	let {
		initialTitle = '',
		initialDescription = '',
		initialKind = 'help' as NeedKind,
		initialSkillLevel = 'none' as SkillLevel,
		initialEstimatedHours = null as number | null,
		initialDeadline = null as string | null,
		initialIsRemote = false,
		initialWantedCount = 1,
		busy = false,
		error = '',
		submitLabel,
		onsubmit,
		oncancel
	}: {
		initialTitle?: string;
		initialDescription?: string;
		initialKind?: NeedKind;
		initialSkillLevel?: SkillLevel;
		initialEstimatedHours?: number | null;
		initialDeadline?: string | null;
		initialIsRemote?: boolean;
		initialWantedCount?: number;
		busy?: boolean;
		/** The caller owns the request, so it owns the refusal it came back with (house rule 6). */
		error?: string;
		submitLabel: string;
		onsubmit: (draft: NeedDraft) => void;
		oncancel?: () => void;
	} = $props();

	// `untrack` on every seed: these are a STARTING value, not a binding — reading a prop straight
	// into `$state` is `state_referenced_locally` (svelte-check warns, and 0 warnings is the bar),
	// and making them track would throw away half a sentence whenever the parent re-rendered.
	let title = $state(untrack(() => initialTitle));
	let description = $state(untrack(() => initialDescription));
	let kind = $state<NeedKind>(untrack(() => initialKind));
	let skillLevel = $state<SkillLevel>(untrack(() => initialSkillLevel));
	let estimatedHours = $state(
		untrack(() => (initialEstimatedHours === null ? '' : String(initialEstimatedHours)))
	);
	// `<input type="datetime-local">` speaks 'YYYY-MM-DDTHH:mm' in the READER's own zone; the API
	// speaks ISO UTC. The conversion is here, once, and `slice(0, 16)` back the other way.
	let deadline = $state(toLocalInput(untrack(() => initialDeadline)));
	let isRemote = $state(untrack(() => initialIsRemote));
	let wantedCount = $state(String(untrack(() => initialWantedCount)));

	function toLocalInput(iso: string | null): string {
		if (!iso) return '';
		const when = new Date(iso);
		if (Number.isNaN(when.getTime())) return '';
		const offset = when.getTimezoneOffset() * 60000;
		return new Date(when.getTime() - offset).toISOString().slice(0, 16);
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = title.trim();
		if (!trimmed) return;
		const parsed = deadline ? new Date(deadline) : null;
		onsubmit({
			title: trimmed,
			description: description.trim(),
			kind,
			skillLevel,
			estimatedHours: estimatedHours.trim() ? Math.max(0, parseInt(estimatedHours, 10) || 0) : null,
			deadline: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
			isRemote,
			wantedCount: Math.max(1, parseInt(wantedCount, 10) || 1)
		});
	}
</script>

<form class="need-form" onsubmit={submit}>
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
		<button type="submit" class="primary" disabled={busy}>{submitLabel}</button>
		{#if oncancel}
			<button type="button" onclick={oncancel}>{m.common_cancel()}</button>
		{/if}
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.need-form {
		display: grid;
		gap: 0.6rem;
		border: 1px solid var(--border-color);
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
		border: 1px solid var(--border-color);
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
	button {
		min-height: 40px;
		padding: 0 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.primary {
		@include mix.button-primary;
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
</style>
