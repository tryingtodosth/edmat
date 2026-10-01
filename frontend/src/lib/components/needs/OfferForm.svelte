<script lang="ts">
	// Create/edit one volunteering offer — one component, both `/volunteering/new` and the edit
	// mode on `/volunteering/[id]`, off a single `initial?` prop. The same "two modes, one form"
	// shape `ServiceForm` and this app's submission forms already establish.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type {
		NeedKind,
		OfferStatus,
		SkillLevel,
		VolunteeringOffer,
		VolunteeringOfferDraft
	} from '$lib/types/need';
	import {
		NEED_KINDS,
		NEED_KIND_LABELS,
		OFFER_STATUSES,
		OFFER_STATUS_LABELS,
		SKILL_LEVELS,
		SKILL_LEVEL_LABELS
	} from '$lib/utils/labels';
	import { getLocale } from '$lib/paraglide/runtime';
	import RichEditor from '$lib/components/editor/RichEditor.svelte';
	import InsertStrip from '$lib/components/editor/InsertStrip.svelte';

	let {
		initial,
		onSubmit,
		onCancel
	}: {
		initial?: VolunteeringOffer;
		onSubmit: (draft: VolunteeringOfferDraft) => Promise<void>;
		onCancel?: () => void;
	} = $props();

	// One-time seed from `initial` — the same `untrack()` discipline every other edit form here
	// uses: the form starts from server state and is then freely local, so a prop that changed
	// underneath would otherwise overwrite what the person had typed.
	let title = $state(untrack(() => initial?.title ?? ''));
	let description = $state(untrack(() => initial?.description ?? ''));
	let kind = $state<NeedKind>(untrack(() => initial?.kind ?? 'help'));
	let skillLevel = $state<SkillLevel>(untrack(() => initial?.skillLevel ?? 'none'));
	let status = $state<OfferStatus>(untrack(() => initial?.status ?? 'open'));
	// Defaults to the interface language, which is the one they are typing in right now — and is
	// still a free text box, because `locale` is a free string everywhere on this site and an
	// offer written in Ukrainian is exactly the row this field exists to make findable.
	let language = $state(untrack(() => initial?.language ?? getLocale()));
	let spokenInput = $state(untrack(() => (initial?.spokenLanguages ?? []).join(', ')));
	// `type="text"` + inputmode, never `type="number"` — frontend/CLAUDE.md trap 1: a number input
	// binds a real number or `undefined`, and the `.trim()` below would throw on first submit.
	let hoursText = $state(
		untrack(() => (initial?.hoursPerWeek ? String(initial.hoursPerWeek) : ''))
	);
	let isRemote = $state(untrack(() => initial?.isRemote ?? true));
	let locationText = $state(untrack(() => initial?.locationText ?? ''));

	let editorRef = $state<RichEditor | null>(null);
	let strip = $state<InsertStrip | null>(null);
	let submitting = $state(false);
	let errorMessage = $state('');

	let canSubmit = $derived(title.trim().length > 0 && !submitting);

	/** Comma- or space-separated, because people type both. The server normalises again (lower
	 *  case, de-duplicate, cap) — this is only so the box is forgiving, never the only cleanup. */
	function parseSpoken(raw: string): string[] {
		return raw
			.split(/[,\s]+/)
			.map((part) => part.trim().toLowerCase())
			.filter(Boolean)
			.slice(0, 12);
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		submitting = true;
		errorMessage = '';
		const hours = Number.parseInt(hoursText.trim(), 10);
		try {
			await onSubmit({
				title: title.trim(),
				description,
				kind,
				skillLevel,
				status,
				language: language.trim().toLowerCase() || 'pl',
				spokenLanguages: parseSpoken(spokenInput),
				hoursPerWeek: Number.isFinite(hours) && hours > 0 ? hours : null,
				isRemote,
				locationText: locationText.trim()
			});
		} catch {
			errorMessage = m.common_error_generic();
		} finally {
			submitting = false;
		}
	}
</script>

<form class="offer-form" onsubmit={handleSubmit}>
	<label class="field">
		<span>{m.offers_field_title()}</span>
		<input type="text" bind:value={title} required maxlength="200" />
	</label>

	<!-- Prose, so the same input every prose field on this site has: LaTeX, a chemistry
	     structure, a sketch, a picture and a link all come from the strip below it. Sanitized on
	     write by `VolunteeringOffer.save()` (house rule 8). `allowFiles` is off — an offer has no
	     attachment table, and offering a picker for something that cannot be saved is worse than
	     not offering it. -->
	<label class="field">
		<span>{m.offers_field_description()} <em>({m.common_optional()})</em></span>
		<RichEditor
			bind:this={editorRef}
			bind:value={description}
			rows={4}
			onChemEdit={(id) => strip?.editChem(id)}
			onSketchEdit={(id) => strip?.editSketch(id)}
		/>
	</label>
	<InsertStrip bind:this={strip} editor={editorRef} allowFiles={false} />

	<div class="row">
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
		<label class="field">
			<span>{m.offers_field_status()}</span>
			<select bind:value={status}>
				{#each OFFER_STATUSES as s (s)}
					<option value={s}>{OFFER_STATUS_LABELS[s]()}</option>
				{/each}
			</select>
		</label>
	</div>

	<div class="row">
		<label class="field">
			<span>{m.offers_field_language()}</span>
			<input type="text" bind:value={language} maxlength="8" />
			<small>{m.offers_field_languageHint()}</small>
		</label>
		<label class="field">
			<span>{m.offers_field_spoken()}</span>
			<input type="text" bind:value={spokenInput} placeholder="pl, en, uk" />
			<small>{m.offers_field_spokenHint()}</small>
		</label>
		<label class="field">
			<span>{m.offers_field_hours()} <em>({m.common_optional()})</em></span>
			<input type="text" inputmode="numeric" bind:value={hoursText} maxlength="3" />
		</label>
	</div>

	<label class="checkbox">
		<input type="checkbox" bind:checked={isRemote} />
		<span>{m.offers_field_remote()}</span>
	</label>

	<label class="field">
		<span>{m.offers_field_location()} <em>({m.common_optional()})</em></span>
		<input type="text" bind:value={locationText} maxlength="300" />
		<small>{m.offers_field_locationHint()}</small>
	</label>

	{#if errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}

	<div class="actions">
		<button type="submit" class="submit" disabled={!canSubmit}>
			{submitting ? m.common_loading() : m.common_save()}
		</button>
		{#if onCancel}
			<button type="button" class="cancel" onclick={onCancel}>{m.common_cancel()}</button>
		{/if}
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;
	.offer-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	// `flex: 1 1 12rem` belongs ONLY to a field inside a `.row`. Applied to every `.field`, the
	// 12rem basis is read as a HEIGHT for the ones that are direct children of this column flex
	// container — which painted a 150px hole under the title box. Found by looking at a
	// screenshot, which is the only way it was ever going to be found: `svelte-check`, eslint and
	// a production build all pass on it.
	.row .field {
		flex: 1 1 12rem;
	}
	.field span {
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.field small {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	.row {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	input,
	select {
		@include mix.focus-ring;
		font: inherit;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.error {
		color: var(--status-danger);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.submit {
		@include mix.button-primary;
	}
	.cancel {
		@include mix.button-secondary;
	}
</style>
