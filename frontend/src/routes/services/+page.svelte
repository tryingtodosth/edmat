<script lang="ts">
	// The tutoring/services listings browse page — branch-scoped discovery (the whole reason a
	// Service is tied to real Courses, see backend/services/models.py's own doc comment) plus, for
	// an authenticated visitor, a "My listings" management tab. No +page.ts — same "plain
	// +page.svelte over client-side state" pattern every other route in this app already follows.
	//
	// **Managing a listing happens in a dialog, not inline.** A row used to swap itself for a whole
	// ServiceForm in place, and that form is tall — a title, a description, a branch picker, a rate,
	// three delivery-mode radios and, for an in-person listing, a Leaflet map. It pushed every other
	// row off the screen, so the one thing a provider most wants while editing (what their OTHER
	// listings already say, to keep them distinct) is exactly what disappeared. A dialog leaves the
	// list standing behind it.
	//
	// Nesting a form in a modal is safe HERE specifically, unlike `/submit`: `ServiceForm` has no
	// `ProposeNodeButton` of its own, so there is no modal-inside-a-modal. Confirmed by grep rather
	// than assumed — that button lives only on `/submit` and `/submit-material`. If tutoring ever
	// gains the propose-a-branch affordance those two have, this is the constraint to solve first.
	import type { Branch, Service, ServiceDraft } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { getAllBranches } from '$lib/services/taxonomy';
	import {
		createService,
		deleteService,
		getMyServices,
		getServices,
		updateService
	} from '$lib/services/tutoring';
	import ServiceCard from '$lib/components/service/ServiceCard.svelte';
	import ServiceForm from '$lib/components/service/ServiceForm.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';

	let branches = $state<Branch[]>([]);
	let courseFilter = $state('');
	// '' means "either" — deliberately not a third `hybrid` value: hybrid is something a tutor
	// OFFERS, not something a student searches for, and a hybrid listing already matches both of
	// these (services/views.py's own filter). See ServiceBrowseFilters (tutoring.ts).
	let modeFilter = $state<'' | 'online' | 'inPerson'>('');
	let listings = $state<Service[]>([]);
	let myListings = $state<Service[]>([]);
	let tab = $state<'browse' | 'mine'>('browse');
	let loading = $state(true);

	// Which dialog is open, held as the row itself rather than as an id: each one needs the listing's
	// own values anyway — the form's starting state, the title in the delete question — and an id
	// would mean re-finding the row on every render for something the click already had in hand.
	let editing = $state<Service | null>(null);
	let creating = $state(false);
	let pendingDelete = $state<Service | null>(null);
	// Guards the delete dialog's own button while the request is in flight. A second click would
	// fire a second DELETE for a row the first one is already removing, and the second comes back
	// 404 — a confusing "couldn't delete this" for something that was, in fact, deleted.
	let deleting = $state(false);

	function closeDialogs() {
		editing = null;
		creating = false;
		pendingDelete = null;
	}

	let branchNameById = $derived(new Map(branches.map((c) => [c.id, c.name])));

	async function loadCourses() {
		branches = await getAllBranches();
	}

	async function loadBrowse() {
		loading = true;
		try {
			listings = await getServices(courseFilter || undefined, {
				deliveryMode: modeFilter || undefined
			});
		} catch {
			// A real, live-found bug (the exact class already documented in
			// messages/+page.svelte's own comment): getServices() used to always succeed for an
			// anonymous caller, so a bare eager call at the script's top level never had anything to
			// catch. Once the tutoring kill switch (feature_gate('tutoring')) could make this
			// endpoint genuinely 401/403, that same eager call — which also runs during SSR — threw
			// an UNCAUGHT rejection that crashed the entire Vite dev server process outright, not
			// just this one page. FeatureGate already shows the real "unavailable" notice for this
			// exact case; a failed fetch here just needs to fail quietly, not surface a second,
			// redundant error.
			listings = [];
		}
		loading = false;
	}

	async function loadMine() {
		loading = true;
		try {
			myListings = await getMyServices();
		} catch {
			myListings = [];
		}
		loading = false;
	}

	function selectTab(next: 'browse' | 'mine') {
		tab = next;
		closeDialogs();
		deleteError = '';
		if (next === 'browse') loadBrowse();
		else loadMine();
	}

	// A real `$effect`, not a bare eager top-level call — `$effect` bodies are browser-only and
	// never run during SSR, which is the actual, categorical fix for the crash above (the try/catch
	// in loadBrowse/loadMine only helps once code is already running in the browser; it does
	// nothing for a request SSR itself would have fired). `loadedOnce` mirrors
	// messages/+page.svelte's own guard so this fires exactly once, not on every unrelated reactive
	// change.
	let loadedOnce = $state(false);
	$effect(() => {
		if (!loadedOnce) {
			loadedOnce = true;
			loadCourses();
			loadBrowse();
		}
	});

	async function handleCourseFilterChange() {
		await loadBrowse();
	}

	async function handleTogglePause(service: Service) {
		const updated = await updateService(service.id, {
			title: service.title,
			description: service.description,
			branchIds: service.branchIds,
			hourlyRate: service.hourlyRate !== null ? String(service.hourlyRate) : '',
			currency: service.currency,
			isActive: !service.isActive,
			// Carried through explicitly. This helper rebuilds the ENTIRE draft from the existing
			// listing just to flip one boolean, so anything omitted here is actively erased — for an
			// in-person listing that would mean pausing it silently deleted its location, and then
			// failing validation because an in-person listing requires one. Caught by the type
			// checker when ServiceDraft grew these fields, which is precisely why the draft type is
			// exhaustive rather than partial.
			deliveryMode: service.deliveryMode,
			locationLabel: service.location?.label ?? '',
			locationLat: service.location?.lat ?? null,
			locationLon: service.location?.lon ?? null,
			// Same reasoning as the location fields above, and the type checker caught exactly this
			// omission when ServiceDraft grew them: rebuilding the whole draft to flip one boolean
			// means anything left out is erased, so pausing a listing would otherwise have silently
			// reset how its availability is computed.
			availabilityMode: service.availabilityMode,
			sessionMinutes: String(service.sessionMinutes)
		});
		myListings = myListings.map((s) => (s.id === updated.id ? updated : s));
	}

	let deleteError = $state('');

	// Asking happens in the dialog below rather than through `window.confirm`, for two real reasons
	// rather than for the look of it. `confirm` renders in the BROWSER's own UI language, not the
	// interface locale, so a reader who had picked Polish was asked in English — a hole in the "no
	// user-facing string escapes the catalogue" rule that no amount of i18n discipline in this file
	// could close. And it leaves a refusal nowhere to go: the 409 below is the most interesting
	// answer this action has, and it used to print at the foot of the entire list, well away from the
	// row it was about, after the dialog had already blinked out of existence.
	async function confirmDelete() {
		if (!pendingDelete || deleting) return;
		deleting = true;
		deleteError = '';
		try {
			await deleteService(pendingDelete.id);
			myListings = myListings.filter((s) => s.id !== pendingDelete!.id);
			pendingDelete = null;
		} catch (e) {
			// The backend refuses to delete a listing somebody still has a session booked against — a
			// listing is an offer, a booking is an agreement, and deleting the first must not silently
			// take the second with it. Its own message names the alternative (pause), so it is shown
			// rather than swallowed into a generic failure. The dialog deliberately STAYS OPEN on this
			// path: the message is about the very listing it is asking about, and closing would file
			// the explanation somewhere the reader has already stopped looking.
			deleteError = e instanceof ApiError && e.status === 409 ? e.message : m.services_saveFailed();
		} finally {
			deleting = false;
		}
	}

	async function handleEditSubmit(id: string, draft: ServiceDraft) {
		const updated = await updateService(id, draft);
		myListings = myListings.map((s) => (s.id === updated.id ? updated : s));
		editing = null;
	}

	// A new listing lands straight in the list behind the dialog rather than re-fetching it, so the
	// provider sees the thing they just made appear where their others already are. `/services/new`
	// stays a real, deep-linkable route (the "Add…" menu still points at it) — this is the shortcut
	// for somebody already standing in their own list, not a replacement for it.
	async function handleCreateSubmit(draft: ServiceDraft) {
		const created = await createService(draft);
		myListings = [created, ...myListings];
		creating = false;
		tab = 'mine';
	}
</script>

<svelte:head>
	<title>{m.services_heading()} — {m.common_appName()}</title>
</svelte:head>

<FeatureGate feature="tutoring">
	<div class="page">
		<div class="page__header">
			<div>
				<h1>{m.services_heading()}</h1>
				<p class="subtitle">{m.services_subtitle()}</p>
			</div>
			{#if authStore.isAuthenticated}
				<button type="button" class="new-listing" onclick={() => (creating = true)}>
					{m.services_newListing()}
				</button>
			{/if}
		</div>

		{#if authStore.isAuthenticated}
			<div class="tabs" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={tab === 'browse'}
					class:active={tab === 'browse'}
					onclick={() => selectTab('browse')}
				>
					{m.services_tab_browse()}
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === 'mine'}
					class:active={tab === 'mine'}
					onclick={() => selectTab('mine')}
				>
					{m.services_tab_mine()}
				</button>
			</div>
		{/if}

		{#if tab === 'browse'}
			<div class="filters">
				<label class="filter">
					<span>{m.services_filterByBranch()}</span>
					<select bind:value={courseFilter} onchange={handleCourseFilterChange}>
						<option value="">{m.services_allBranches()}</option>
						{#each branches as branch (branch.id)}
							<option value={branch.id}>{branch.name}</option>
						{/each}
					</select>
				</label>
				<label class="filter">
					<span>{m.services_filterByMode()}</span>
					<select bind:value={modeFilter} onchange={handleCourseFilterChange}>
						<option value="">{m.services_modeAny()}</option>
						<option value="online">{m.services_mode_online()}</option>
						<option value="inPerson">{m.services_mode_inPerson()}</option>
					</select>
				</label>
			</div>

			{#if loading}
				<p class="empty">{m.common_loading()}</p>
			{:else if listings.length === 0}
				<p class="empty">{m.services_empty()}</p>
			{:else}
				<div class="grid">
					{#each listings as service (service.id)}
						<ServiceCard
							{service}
							branchNames={service.branchIds.map((id) => branchNameById.get(id) ?? id)}
						/>
					{/each}
				</div>
			{/if}
		{:else if loading}
			<p class="empty">{m.common_loading()}</p>
		{:else if myListings.length === 0}
			<p class="empty">{m.services_mineEmpty()}</p>
		{:else}
			<ul class="mine-list">
				{#each myListings as service (service.id)}
					<li class="mine-row">
						<div class="mine-row__summary">
							<div>
								<strong>{service.title}</strong>
								<span class="status" class:status--paused={!service.isActive}>
									{service.isActive ? m.services_statusActive() : m.services_statusPaused()}
								</span>
							</div>
							<div class="mine-row__actions">
								<button type="button" onclick={() => (editing = service)}>
									{m.services_edit()}
								</button>
								<button type="button" onclick={() => handleTogglePause(service)}>
									{service.isActive ? m.services_pause() : m.services_reactivate()}
								</button>
								<button
									type="button"
									class="danger"
									onclick={() => {
										deleteError = '';
										pendingDelete = service;
									}}
								>
									{m.common_delete()}
								</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if creating}
		<ModalShell title={m.services_newListing()} onClose={() => (creating = false)}>
			<p class="dialog-intro">{m.services_newListingSubtitle()}</p>
			<ServiceForm {branches} onSubmit={handleCreateSubmit} onCancel={() => (creating = false)} />
		</ModalShell>
	{/if}

	{#if editing}
		<ModalShell title={m.services_editListing()} onClose={() => (editing = null)}>
			<ServiceForm
				initial={editing}
				{branches}
				onSubmit={(draft) => handleEditSubmit(editing!.id, draft)}
				onCancel={() => (editing = null)}
			/>
		</ModalShell>
	{/if}

	{#if pendingDelete}
		<ModalShell title={m.services_deleteHeading()} onClose={() => (pendingDelete = null)}>
			<p class="dialog-intro">{m.services_deleteConfirm()}</p>
			<p class="dialog-subject"><strong>{pendingDelete.title}</strong></p>
			{#if deleteError}
				<p class="delete-error">{deleteError}</p>
			{/if}
			<div class="dialog-actions">
				<button type="button" onclick={() => (pendingDelete = null)}>{m.common_cancel()}</button>
				<button type="button" class="danger" disabled={deleting} onclick={confirmDelete}>
					{m.common_delete()}
				</button>
			</div>
		</ModalShell>
	{/if}
</FeatureGate>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.delete-error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
	.dialog-intro {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin-bottom: var(--space-3);
	}
	/* The listing's own title, repeated inside the delete dialog. The question above it says "this
	   listing" and the dialog covers the row it came from, so without this the reader is confirming
	   a destructive act against something they can no longer see. */
	.dialog-subject {
		margin-bottom: var(--space-3);
	}
	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.dialog-actions .danger,
	.mine-row__actions .danger {
		color: var(--status-danger);
	}
	.dialog-actions button[disabled] {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.page {
		max-width: 900px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.page__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.subtitle {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.new-listing {
		@include mix.button-primary;
	}
	.tabs {
		display: flex;
		gap: var(--space-2);
		border-bottom: 1px solid var(--border-color);
		button {
			@include mix.focus-ring;
			background: none;
			border: none;
			padding: var(--space-2) var(--space-1);
			font-size: var(--font-size-sm);
			font-weight: 500;
			color: var(--text-secondary);
			border-bottom: 2px solid transparent;
			cursor: pointer;
			&.active {
				color: var(--accent);
				border-bottom-color: var(--accent);
			}
		}
	}
	.filter {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		font-weight: 500;
		select {
			@include mix.focus-ring;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
		}
	}
	.empty {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--space-3);
	}
	.mine-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.mine-row {
		@include mix.card-surface;
		padding: var(--space-3);
	}
	.mine-row__summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.status {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		margin-left: var(--space-2);
	}
	.status--paused {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		margin-left: var(--space-2);
	}
	.mine-row__actions {
		display: flex;
		gap: var(--space-2);
		button {
			@include mix.button-secondary;
			padding: var(--space-1) var(--space-3);
			font-size: var(--font-size-xs);
		}
		.danger {
			color: var(--status-danger);
			border-color: var(--status-danger);
		}
	}
</style>
