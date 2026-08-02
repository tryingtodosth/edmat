<script lang="ts">
	// Shared by creating and editing, since they ask exactly the same questions — two copies would
	// drift the moment one gained a field.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { TaughtCourse, TaughtCourseDraft } from '$lib/types/classroom';

	let {
		initial = null,
		submitting = false,
		error = '',
		submitLabel,
		onsubmit
	}: {
		initial?: TaughtCourse | null;
		submitting?: boolean;
		error?: string;
		submitLabel: string;
		onsubmit: (draft: TaughtCourseDraft) => void;
	} = $props();

	let title = $state(untrack(() => initial?.title ?? ''));
	let summary = $state(untrack(() => initial?.summary ?? ''));
	let description = $state(untrack(() => initial?.description ?? ''));
	let status = $state<TaughtCourse['status']>(untrack(() => initial?.status ?? 'draft'));
	let enrollmentPolicy = $state<TaughtCourse['enrollmentPolicy']>(
		untrack(() => initial?.enrollmentPolicy ?? 'open')
	);
	let capacity = $state(untrack(() => initial?.capacity ?? 0));
	let language = $state(untrack(() => initial?.language ?? 'pl'));
	let startsOn = $state(untrack(() => initial?.startsOn ?? ''));
	let endsOn = $state(untrack(() => initial?.endsOn ?? ''));
	let price = $state(untrack(() => initial?.price ?? ''));

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onsubmit({
			title: title.trim(),
			summary: summary.trim(),
			description: description.trim(),
			// Subject/field tagging is a separate picker this first version does not have; sending
			// what already exists keeps an edit from silently clearing tags set elsewhere.
			subjects: initial?.subjectSlugs ?? [],
			field: initial?.fieldSlug ?? null,
			status,
			enrollmentPolicy,
			capacity: Number(capacity) || 0,
			language,
			startsOn: startsOn || null,
			endsOn: endsOn || null,
			price: price || null,
			currency: initial?.currency || 'PLN'
		});
	}
</script>

<form onsubmit={submit}>
	<label class="field">
		<span>{m.classroom_form_title()}</span>
		<input type="text" bind:value={title} maxlength="200" required />
	</label>

	<label class="field">
		<span>{m.classroom_form_summary()}</span>
		<input type="text" bind:value={summary} maxlength="300" />
		<span class="hint">{m.classroom_form_summaryHint()}</span>
	</label>

	<label class="field">
		<span>{m.classroom_form_description()}</span>
		<textarea bind:value={description} rows="6"></textarea>
	</label>

	<label class="field">
		<span>{m.classroom_form_status()}</span>
		<select bind:value={status}>
			<option value="draft">{m.classroom_status_draft()}</option>
			<option value="open">{m.classroom_status_open()}</option>
			<option value="running">{m.classroom_status_running()}</option>
			<option value="finished">{m.classroom_status_finished()}</option>
		</select>
		<!-- Said here rather than discovered later: a course nobody can see is the default, and that
		     is deliberate — creating something is not the same as announcing it. -->
		<span class="hint">{m.classroom_form_statusHint()}</span>
	</label>

	<label class="field">
		<span>{m.classroom_form_policy()}</span>
		<select bind:value={enrollmentPolicy}>
			<option value="open">{m.classroom_form_policyOpen()}</option>
			<option value="approval">{m.classroom_form_policyApproval()}</option>
		</select>
	</label>

	<label class="field">
		<span>{m.classroom_form_capacity()}</span>
		<input type="number" bind:value={capacity} min="0" />
		<span class="hint">{m.classroom_form_capacityHint()}</span>
	</label>

	<div class="row">
		<label class="field">
			<span>{m.classroom_form_startsOn()}</span>
			<input type="date" bind:value={startsOn} />
		</label>
		<label class="field">
			<span>{m.classroom_form_endsOn()}</span>
			<input type="date" bind:value={endsOn} />
		</label>
	</div>

	<label class="field">
		<span>{m.classroom_form_price()}</span>
		<input type="text" bind:value={price} inputmode="decimal" />
		<!-- Display-only, exactly like a tutoring listing's rate: nothing here takes money. -->
		<span class="hint">{m.classroom_form_priceHint()}</span>
	</label>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	<button type="submit" class="primary" disabled={submitting}>{submitLabel}</button>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.row {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		> :global(*) {
			flex: 1;
			min-width: 10rem;
		}
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	.hint {
		font-weight: 400;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	input,
	select,
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font: inherit;
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
	}
</style>
