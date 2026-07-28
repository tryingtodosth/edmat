<script lang="ts">
	// Shared create/edit form for a Service listing — one component, both routes/services/new and
	// the "My listings" inline editor on routes/services/+page.svelte, the same "off one `initial?`
	// prop, two modes" shape this app's own submission forms already establish elsewhere.
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { Course, Service, ServiceCurrency, ServiceDraft } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';

	let {
		initial,
		courses,
		onSubmit,
		onCancel
	}: {
		initial?: Service;
		courses: Course[];
		onSubmit: (draft: ServiceDraft) => Promise<void>;
		onCancel?: () => void;
	} = $props();

	// One-time seed from `initial` (edit mode) — same `untrack()` discipline this app's own
	// EditSuggestionForm/TranslateForm/AddCoverageForm/CoveragePopover already establish for a form
	// that starts from server state but is then locally, freely editable.
	let title = $state(untrack(() => initial?.title ?? ''));
	let description = $state(untrack(() => initial?.description ?? ''));
	// SvelteSet, not a plain Set in $state() — this project's own eslint config
	// (svelte/prefer-svelte-reactivity) flags calling .add()/.delete() on a bare Set; SvelteSet is
	// reactive to in-place mutation directly, matching routes/settings/+page.svelte's own
	// `mutedTypes` precedent for the identical reason.
	let selectedCourseIds = new SvelteSet<string>(untrack(() => initial?.courseIds ?? []));
	let hourlyRate = $state(
		untrack(() =>
			initial?.hourlyRate !== null && initial?.hourlyRate !== undefined
				? String(initial.hourlyRate)
				: ''
		)
	);
	let currency = $state<ServiceCurrency>(untrack(() => initial?.currency ?? 'PLN'));
	let isActive = $state(untrack(() => initial?.isActive ?? true));
	let submitting = $state(false);
	let errorMessage = $state('');

	function toggleCourse(id: string) {
		if (selectedCourseIds.has(id)) {
			selectedCourseIds.delete(id);
		} else {
			selectedCourseIds.add(id);
		}
	}

	let canSubmit = $derived(Boolean(title.trim()));

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		submitting = true;
		errorMessage = '';
		try {
			await onSubmit({
				title: title.trim(),
				description: description.trim(),
				courseIds: Array.from(selectedCourseIds),
				hourlyRate,
				currency,
				isActive
			});
		} catch {
			errorMessage = m.services_saveFailed();
		} finally {
			submitting = false;
		}
	}
</script>

<form class="service-form" onsubmit={handleSubmit}>
	<label class="field">
		<span>{m.services_field_title()}</span>
		<input type="text" bind:value={title} required maxlength="200" />
	</label>

	<label class="field">
		<span>{m.services_field_description()} <em>({m.common_optional()})</em></span>
		<textarea rows="3" bind:value={description}></textarea>
	</label>

	{#if courses.length > 0}
		<fieldset class="field">
			<legend>{m.services_field_courses()}</legend>
			<div class="course-list">
				{#each courses as course (course.id)}
					<label class="checkbox">
						<input
							type="checkbox"
							checked={selectedCourseIds.has(course.id)}
							onchange={() => toggleCourse(course.id)}
						/>
						<span>{course.name}</span>
					</label>
				{/each}
			</div>
		</fieldset>
	{/if}

	<div class="field-row">
		<label class="field">
			<span>{m.services_field_hourlyRate()} <em>({m.common_optional()})</em></span>
			<!-- type="text", not "number" — Svelte's bind:value on a number input coerces to a
			     real JS number, not the string draftToBody (tutoring.ts) assumes throughout (the
			     exact runtime bug CLAUDE.md's own node-governor grant-form note already documents
			     and fixes the identical way) — inputmode="decimal" keeps the numeric mobile keyboard
			     without losing the string binding. -->
			<input type="text" inputmode="decimal" pattern="[0-9]*\.?[0-9]*" bind:value={hourlyRate} />
		</label>
		<label class="field">
			<span>{m.services_field_currency()}</span>
			<select bind:value={currency}>
				<option value="PLN">PLN</option>
				<option value="EUR">EUR</option>
				<option value="USD">USD</option>
			</select>
		</label>
	</div>

	{#if initial}
		<label class="checkbox">
			<input type="checkbox" bind:checked={isActive} />
			<span>{m.services_field_isActive()}</span>
		</label>
	{/if}

	{#if errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}

	<div class="actions">
		<button type="submit" class="submit" disabled={!canSubmit || submitting}>
			{submitting ? m.common_loading() : m.common_save()}
		</button>
		{#if onCancel}
			<button type="button" class="cancel" onclick={onCancel}>{m.common_cancel()}</button>
		{/if}
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.service-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
		border: none;
		padding: 0;
		margin: 0;
		em {
			color: var(--text-secondary);
			font-weight: 400;
		}
	}
	legend {
		padding: 0;
		font-weight: 500;
	}
	.field-row {
		display: grid;
		grid-template-columns: 1fr 120px;
		gap: var(--space-2);
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
		font-family: inherit;
		resize: vertical;
	}
	.course-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-height: 200px;
		overflow-y: auto;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		font-weight: 400;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
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
