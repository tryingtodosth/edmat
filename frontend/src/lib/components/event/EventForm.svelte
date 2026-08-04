<script lang="ts">
	// Shared by creating and editing, since they ask exactly the same questions — two copies would
	// drift the moment one gained a field. Same shape `CourseForm` establishes.
	import { onMount, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getFields } from '$lib/services/taxonomy';
	import type { Field } from '$lib/types/taxonomy';
	import type { EdmatEvent, EventDraft, EventLocationKind } from '$lib/types/event';

	let {
		initial = null,
		submitting = false,
		error = '',
		submitLabel,
		onsubmit
	}: {
		initial?: EdmatEvent | null;
		submitting?: boolean;
		error?: string;
		submitLabel: string;
		onsubmit: (draft: EventDraft) => void;
	} = $props();

	let title = $state(untrack(() => initial?.title ?? ''));
	let summary = $state(untrack(() => initial?.summary ?? ''));
	let description = $state(untrack(() => initial?.description ?? ''));
	// `<input type="datetime-local">` speaks "YYYY-MM-DDTHH:mm" in LOCAL time with no zone, while the
	// API speaks ISO with one. The two conversions are the whole reason this is not a plain bind —
	// see `toLocalInput`/`toIso` below.
	let startsAtLocal = $state(untrack(() => toLocalInput(initial?.startsAt)));
	let durationMinutes = $state(untrack(() => initial?.durationMinutes ?? 60));
	let locationKind = $state<EventLocationKind>(untrack(() => initial?.locationKind ?? 'onsite'));
	let locationText = $state(untrack(() => initial?.locationText ?? ''));
	let onlineUrl = $state(untrack(() => initial?.onlineUrl ?? ''));
	let capacity = $state(untrack(() => initial?.capacity ?? 0));
	let fieldSlug = $state(untrack(() => initial?.fieldSlug ?? ''));
	// Publishing is a checkbox rather than a status dropdown, because "draft" and "published" are the
	// only two a person can choose between here (cancelling has its own button, on the event itself)
	// and a two-value dropdown is a checkbox that takes an extra click. An event being edited that is
	// already published stays published — unchecking this would be an un-publish, which the backend
	// refuses for the same reason it refuses un-cancelling.
	let publishNow = $state(untrack(() => (initial ? initial.status === 'published' : true)));

	let fields = $state<Field[]>([]);
	onMount(async () => {
		try {
			fields = await getFields();
		} catch {
			// A taxonomy that will not load should not stop somebody announcing an event. The select
			// simply stays at "None", which is a legitimate value.
		}
	});

	/** ISO → the local "YYYY-MM-DDTHH:mm" the input wants. Built by hand rather than with
	 * `toISOString().slice(0,16)`, which would silently shift the value into UTC and show somebody a
	 * 20:00 seminar as 18:00. */
	function toLocalInput(iso: string | undefined): string {
		if (!iso) return '';
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	/** The local value back to a real ISO instant. `new Date('2026-08-10T18:00')` is interpreted in
	 * the browser's own zone, which is exactly what the person typing it meant. */
	function toIso(local: string): string {
		return local ? new Date(local).toISOString() : '';
	}

	let needsPlace = $derived(locationKind === 'onsite' || locationKind === 'hybrid');
	let needsLink = $derived(locationKind === 'online' || locationKind === 'hybrid');

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onsubmit({
			title: title.trim(),
			summary: summary.trim(),
			description: description.trim(),
			startsAt: toIso(startsAtLocal),
			durationMinutes: Number(durationMinutes) || 60,
			locationKind,
			// Blanked when the kind does not use them, so switching an event from onsite to online does
			// not leave a stale room number sitting in the record for nobody.
			locationText: needsPlace ? locationText.trim() : '',
			onlineUrl: needsLink ? onlineUrl.trim() : '',
			capacity: Number(capacity) || 0,
			fieldSlug: fieldSlug || null,
			status: publishNow ? 'published' : 'draft'
		});
	}
</script>

<form onsubmit={submit}>
	<label class="field">
		<span>{m.events_form_title()}</span>
		<input type="text" bind:value={title} maxlength="200" required />
	</label>

	<label class="field">
		<span>{m.events_form_summary()}</span>
		<input type="text" bind:value={summary} maxlength="300" />
	</label>

	<label class="field">
		<span>{m.events_form_description()}</span>
		<textarea bind:value={description} rows="5"></textarea>
	</label>

	<div class="row">
		<label class="field">
			<span>{m.events_form_startsAt()}</span>
			<input type="datetime-local" bind:value={startsAtLocal} required />
		</label>
		<label class="field">
			<span>{m.events_form_duration()}</span>
			<input type="number" bind:value={durationMinutes} min="5" max="1440" step="5" required />
		</label>
	</div>

	<label class="field">
		<span>{m.events_form_locationKind()}</span>
		<select bind:value={locationKind}>
			<option value="onsite">{m.events_locationKind_onsite()}</option>
			<option value="online">{m.events_locationKind_online()}</option>
			<option value="hybrid">{m.events_locationKind_hybrid()}</option>
		</select>
	</label>

	{#if needsPlace}
		<label class="field">
			<span>{m.events_form_locationText()}</span>
			<input type="text" bind:value={locationText} maxlength="300" required />
			<small>{m.events_form_locationTextHint()}</small>
		</label>
	{/if}

	{#if needsLink}
		<label class="field">
			<span>{m.events_form_onlineUrl()}</span>
			<input type="url" bind:value={onlineUrl} maxlength="500" required />
		</label>
	{/if}

	<div class="row">
		<label class="field">
			<span>{m.events_form_capacity()}</span>
			<input type="number" bind:value={capacity} min="0" max="10000" />
			<small>{m.events_form_capacityHint()}</small>
		</label>
		<label class="field">
			<span>{m.events_form_field()}</span>
			<select bind:value={fieldSlug}>
				<option value="">{m.events_form_none()}</option>
				{#each fields as field (field.id)}
					<option value={field.id}>{field.name}</option>
				{/each}
			</select>
		</label>
	</div>

	<label class="check">
		<input type="checkbox" bind:checked={publishNow} />
		<span>{m.events_form_publishNow()}</span>
	</label>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	<button type="submit" class="submit" disabled={submitting}>
		{submitting ? m.common_loading() : submitLabel}
	</button>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 640px;
	}
	.row {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		.field {
			flex: 1 1 12rem;
		}
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		span {
			font-size: var(--font-size-sm);
			font-weight: 600;
		}
		small {
			font-size: var(--font-size-xs);
			color: var(--text-secondary);
		}
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
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--status-danger, #c0392b);
		font-size: var(--font-size-sm);
	}
	.submit {
		@include mix.button-primary;
		align-self: flex-start;
	}
</style>
