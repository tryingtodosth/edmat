<script lang="ts">
	// The tutoring/services listings browse page — course-scoped discovery (the whole reason a
	// Service is tied to real Courses, see backend/services/models.py's own doc comment) plus, for
	// an authenticated visitor, a "My listings" management tab (edit/pause/delete their own, inline,
	// reusing the same ServiceForm the create page uses). No +page.ts — same "plain +page.svelte
	// over client-side state" pattern every other route in this app already follows.
	import { resolve } from '$app/paths';
	import type { Course, Service, ServiceDraft } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { getAllCourses } from '$lib/services/taxonomy';
	import { deleteService, getMyServices, getServices, updateService } from '$lib/services/tutoring';
	import ServiceCard from '$lib/components/service/ServiceCard.svelte';
	import ServiceForm from '$lib/components/service/ServiceForm.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';

	let courses = $state<Course[]>([]);
	let courseFilter = $state('');
	// '' means "either" — deliberately not a third `hybrid` value: hybrid is something a tutor
	// OFFERS, not something a student searches for, and a hybrid listing already matches both of
	// these (services/views.py's own filter). See ServiceBrowseFilters (tutoring.ts).
	let modeFilter = $state<'' | 'online' | 'inPerson'>('');
	let listings = $state<Service[]>([]);
	let myListings = $state<Service[]>([]);
	let tab = $state<'browse' | 'mine'>('browse');
	let loading = $state(true);
	let editingId = $state<string | null>(null);

	let courseNameById = $derived(new Map(courses.map((c) => [c.id, c.name])));

	async function loadCourses() {
		courses = await getAllCourses();
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
		editingId = null;
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
			courseIds: service.courseIds,
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
			locationLon: service.location?.lon ?? null
		});
		myListings = myListings.map((s) => (s.id === updated.id ? updated : s));
	}

	async function handleDelete(id: string) {
		if (!confirm(m.services_deleteConfirm())) return;
		await deleteService(id);
		myListings = myListings.filter((s) => s.id !== id);
	}

	async function handleEditSubmit(id: string, draft: ServiceDraft) {
		const updated = await updateService(id, draft);
		myListings = myListings.map((s) => (s.id === updated.id ? updated : s));
		editingId = null;
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
				<a class="new-listing" href={resolve('/services/new')}>{m.services_newListing()}</a>
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
					<span>{m.services_filterByCourse()}</span>
					<select bind:value={courseFilter} onchange={handleCourseFilterChange}>
						<option value="">{m.services_allCourses()}</option>
						{#each courses as course (course.id)}
							<option value={course.id}>{course.name}</option>
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
							courseNames={service.courseIds.map((id) => courseNameById.get(id) ?? id)}
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
						{#if editingId === service.id}
							<ServiceForm
								initial={service}
								{courses}
								onSubmit={(draft) => handleEditSubmit(service.id, draft)}
								onCancel={() => (editingId = null)}
							/>
						{:else}
							<div class="mine-row__summary">
								<div>
									<strong>{service.title}</strong>
									<span class="status" class:status--paused={!service.isActive}>
										{service.isActive ? m.services_statusActive() : m.services_statusPaused()}
									</span>
								</div>
								<div class="mine-row__actions">
									<button type="button" onclick={() => (editingId = service.id)}>
										{m.services_edit()}
									</button>
									<button type="button" onclick={() => handleTogglePause(service)}>
										{service.isActive ? m.services_pause() : m.services_reactivate()}
									</button>
									<button type="button" class="danger" onclick={() => handleDelete(service.id)}>
										{m.common_delete()}
									</button>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;
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
