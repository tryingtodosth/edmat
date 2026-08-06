<script lang="ts">
	// Shared create/edit form for a Service listing — one component, both routes/services/new and
	// the "My listings" inline editor on routes/services/+page.svelte, the same "off one `initial?`
	// prop, two modes" shape this app's own submission forms already establish elsewhere.
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type {
		AvailabilityMode,
		Branch,
		Service,
		ServiceCurrency,
		ServiceDeliveryMode,
		ServiceDraft
	} from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import LocationPicker from './LocationPicker.svelte';
	import { splitByStatus } from '$lib/utils/taxonomy';

	let {
		initial,
		branches,
		onSubmit,
		onCancel
	}: {
		initial?: Service;
		branches: Branch[];
		onSubmit: (draft: ServiceDraft) => Promise<void>;
		onCancel?: () => void;
	} = $props();

	// Proposed branches stay selectable, under their own "Others" sub-list — see lib/utils/taxonomy.ts.
	let groupedBranches = $derived(splitByStatus(branches));

	// One-time seed from `initial` (edit mode) — same `untrack()` discipline this app's own
	// EditSuggestionForm/TranslateForm/AddCoverageForm/CoveragePopover already establish for a form
	// that starts from server state but is then locally, freely editable.
	let title = $state(untrack(() => initial?.title ?? ''));
	let description = $state(untrack(() => initial?.description ?? ''));
	// SvelteSet, not a plain Set in $state() — this project's own eslint config
	// (svelte/prefer-svelte-reactivity) flags calling .add()/.delete() on a bare Set; SvelteSet is
	// reactive to in-place mutation directly, matching routes/settings/+page.svelte's own
	// `mutedTypes` precedent for the identical reason.
	let selectedCourseIds = new SvelteSet<string>(untrack(() => initial?.branchIds ?? []));
	let hourlyRate = $state(
		untrack(() =>
			initial?.hourlyRate !== null && initial?.hourlyRate !== undefined
				? String(initial.hourlyRate)
				: ''
		)
	);
	let currency = $state<ServiceCurrency>(untrack(() => initial?.currency ?? 'PLN'));
	let isActive = $state(untrack(() => initial?.isActive ?? true));
	// "Do you teach online, in person, or either?" — see ServiceDeliveryMode (types/service.ts) for
	// why this is one union rather than two booleans. Defaults to `online`, matching the backend
	// field's own default and the only honest answer for a listing that has declared nothing.
	let deliveryMode = $state<ServiceDeliveryMode>(untrack(() => initial?.deliveryMode ?? 'online'));
	let locationLabel = $state(untrack(() => initial?.location?.label ?? ''));
	let locationLat = $state<number | null>(untrack(() => initial?.location?.lat ?? null));
	let locationLon = $state<number | null>(untrack(() => initial?.location?.lon ?? null));
	// How the availability students see is computed for THIS listing — the load-bearing choice the
	// whole booking feature turns on. Presented as two radios with a sentence each rather than a
	// select, because the difference between them is a paragraph, not a word, and a tutor picking
	// `declared` should be reading what it means at the moment they pick it.
	let availabilityMode = $state<AvailabilityMode>(
		untrack(() => initial?.availabilityMode ?? 'derived')
	);
	let sessionMinutes = $state(untrack(() => String(initial?.sessionMinutes ?? 60)));
	let submitting = $state(false);
	let errorMessage = $state('');

	let needsLocation = $derived(deliveryMode === 'inPerson' || deliveryMode === 'hybrid');

	function toggleCourse(id: string) {
		if (selectedCourseIds.has(id)) {
			selectedCourseIds.delete(id);
		} else {
			selectedCourseIds.add(id);
		}
	}

	// A location is genuinely required for in-person/hybrid — the backend rejects it outright
	// (ServiceWriteSerializer.validate), so blocking submit here turns a round-trip 400 into
	// immediate, local feedback rather than duplicating the rule as the only place it is enforced.
	let canSubmit = $derived(
		Boolean(title.trim()) && (!needsLocation || (locationLat !== null && locationLon !== null))
	);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		submitting = true;
		errorMessage = '';
		try {
			await onSubmit({
				title: title.trim(),
				description: description.trim(),
				branchIds: Array.from(selectedCourseIds),
				hourlyRate,
				currency,
				isActive,
				deliveryMode,
				// Sent as cleared when the mode does not need them, rather than passing whatever is
				// still sitting in local state — the backend clears its own copy too, and sending a
				// stale pin here would just be asking it to.
				locationLabel: needsLocation ? locationLabel : '',
				locationLat: needsLocation ? locationLat : null,
				locationLon: needsLocation ? locationLon : null,
				availabilityMode,
				sessionMinutes
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

	{#if branches.length > 0}
		<fieldset class="field">
			<legend>{m.services_field_courses()}</legend>
			<div class="branch-list">
				{#each groupedBranches.settled as branch (branch.id)}
					<label class="checkbox">
						<input
							type="checkbox"
							checked={selectedCourseIds.has(branch.id)}
							onchange={() => toggleCourse(branch.id)}
						/>
						<span>{branch.name}</span>
					</label>
				{/each}
			</div>
			<!-- A checkbox group cannot use <optgroup>, so the same "Others" separation is a labelled
			     sub-list. Still selectable — a proposed branch is real and filable against. -->
			{#if groupedBranches.proposed.length > 0}
				<p class="branch-list__othersLabel">{m.taxonomy_others()}</p>
				<div class="branch-list">
					{#each groupedBranches.proposed as branch (branch.id)}
						<label class="checkbox">
							<input
								type="checkbox"
								checked={selectedCourseIds.has(branch.id)}
								onchange={() => toggleCourse(branch.id)}
							/>
							<span>{branch.name}</span>
						</label>
					{/each}
				</div>
			{/if}
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

	<fieldset class="field mode-field">
		<legend>{m.services_field_deliveryMode()}</legend>
		{#each [{ value: 'online', label: m.services_mode_online(), hint: m.services_mode_onlineHint() }, { value: 'inPerson', label: m.services_mode_inPerson(), hint: m.services_mode_inPersonHint() }, { value: 'hybrid', label: m.services_mode_hybrid(), hint: m.services_mode_hybridHint() }] as option (option.value)}
			<label class="mode-option">
				<input
					type="radio"
					name="delivery-mode"
					value={option.value}
					checked={deliveryMode === option.value}
					onchange={() => (deliveryMode = option.value as ServiceDeliveryMode)}
				/>
				<span>
					{option.label}
					<small>{option.hint}</small>
				</span>
			</label>
		{/each}
	</fieldset>

	{#if needsLocation}
		<div class="field">
			<span class="field-legend">{m.services_field_location()}</span>
			<LocationPicker
				label={locationLabel}
				lat={locationLat}
				lon={locationLon}
				onchange={(loc) => {
					locationLabel = loc.label;
					locationLat = loc.lat;
					locationLon = loc.lon;
				}}
			/>
		</div>
	{/if}

	<fieldset class="field mode-field">
		<legend>{m.booking_field_availabilityMode()}</legend>
		<!-- Deliberately spelled out on the form rather than left to a help page: `declared` is a
		     promise the tutor is making to students about what "available" will mean on their
		     listing, and nobody should discover which promise they made afterwards. -->
		{#each [{ value: 'derived', label: m.booking_mode_derived(), hint: m.booking_mode_derivedHint() }, { value: 'declared', label: m.booking_mode_declared(), hint: m.booking_mode_declaredHint() }] as option (option.value)}
			<label class="mode-option">
				<input
					type="radio"
					name="availability-mode"
					value={option.value}
					checked={availabilityMode === option.value}
					onchange={() => (availabilityMode = option.value as AvailabilityMode)}
				/>
				<span>
					{option.label}
					<small>{option.hint}</small>
				</span>
			</label>
		{/each}
	</fieldset>

	<label class="field session-field">
		<span>{m.booking_field_sessionMinutes()}</span>
		<!-- type="text", not "number", for the same reason the hourly rate above is: bind:value on a
		     number input hands back a real JS number, and ServiceDraft keeps this a string until
		     submit. -->
		<input type="text" inputmode="numeric" pattern="[0-9]*" bind:value={sessionMinutes} />
		<small>{m.booking_field_sessionMinutesHint()}</small>
	</label>

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
	.mode-field {
		border: none;
		padding: 0;
		margin: 0;
		legend {
			padding: 0;
			font-weight: 600;
			font-size: var(--font-size-sm);
		}
	}
	.mode-option {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		padding: var(--space-1) 0;
		cursor: pointer;
		small {
			display: block;
			color: var(--text-secondary);
			font-size: var(--font-size-xs);
		}
	}
	.field-legend {
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.session-field small {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		font-weight: 400;
	}

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
	.branch-list {
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
	/* Marks where the settled list ends and suggestions begin. */
	.branch-list__othersLabel {
		margin-top: var(--space-2);
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}
</style>
