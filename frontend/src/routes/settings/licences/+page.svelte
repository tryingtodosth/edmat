<script lang="ts">
	// Settings → Licences: everything you have posted, the licence each piece carries, and one move
	// that widens many of them at once (backend `licensing/bulk.py`, 2026-10-22).
	//
	// The page decides nothing. What each item may become is the server's `allowed` list, asked of
	// the same rules the item page's "Change licence" control asks; the move itself goes item by item
	// through those rules, and every refusal comes back with its reason (house rule 6). Only widening
	// exists — a Creative Commons grant cannot be taken back — so the confirm step says so before
	// anything is sent.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { authStore } from '$lib/state/auth.svelte';
	import { bulkChangeLicence, BulkLicenceError, getMyLicences } from '$lib/services/licences';
	import type {
		BulkLicenceResult,
		Licence,
		LicensedKind,
		MyLicensedItem,
		MyLicences
	} from '$lib/types/licence';
	import {
		LICENCE_NAMES,
		LICENCE_FACTS,
		LICENCE_SUMMARIES,
		SELECTABLE_LICENCES,
		licenceReasonLabel,
		licenceShort
	} from '$lib/utils/labels';
	import { localizedPath } from '$lib/utils/localizedPath';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	const KINDS: LicensedKind[] = ['exercise', 'solution_entry', 'material', 'concept_article'];
	// The four kinds' headings; mirrors `licensing/targets.py: LICENSED_KINDS`.
	const KIND_HEADINGS: Record<LicensedKind, () => string> = {
		exercise: m.licbulk_kind_exercise, // "Exercises"
		solution_entry: m.licbulk_kind_solutionEntry, // "Hints and solutions"
		material: m.licbulk_kind_material, // "Materials"
		concept_article: m.licbulk_kind_conceptArticle // "Concept articles"
	};
	// A CC licence only — `edmat-only` is where everything starts and nothing can move back to it.
	const TARGETS: Licence[] = SELECTABLE_LICENCES.filter((key) => key !== 'edmat-only');

	let data = $state<MyLicences | null>(null);
	let loadError = $state(false);
	let loadedOnce = false;

	let kindFilter = $state<LicensedKind | 'all'>('all');
	let licenceFilter = $state<Licence | 'all'>('all');
	let query = $state('');
	let selected = $state<Record<string, boolean>>({});
	let target = $state<Licence | ''>('');
	let step = $state<'pick' | 'confirm' | 'done'>('pick');
	let busy = $state(false);
	let results = $state<BulkLicenceResult[]>([]);
	let wholeError = $state('');

	// ---- the default licence for NEW content (`Profile.default_licence`, §17CX) -------------------
	// A prefill for every create form's LicencePicker, nothing more: blank = none chosen, each form
	// keeps its own suggestion. Seeded from the session once it is there; saved through the same
	// PATCH /api/auth/me/ every other preference uses.
	let defaultChoice = $state<Licence | ''>('');
	let defaultSeeded = false;
	let defaultState = $state<'idle' | 'busy' | 'saved' | 'error'>('idle');
	$effect(() => {
		const user = authStore.user;
		if (!user || defaultSeeded) return;
		defaultSeeded = true;
		defaultChoice = user.defaultLicence ?? '';
	});
	const defaultDirty = $derived((authStore.user?.defaultLicence ?? '') !== defaultChoice);

	async function saveDefault(event: SubmitEvent) {
		event.preventDefault();
		defaultState = 'busy';
		const res = await authStore.updateProfile({ defaultLicence: defaultChoice });
		defaultState = res.ok ? 'saved' : 'error';
	}

	function deedHref(lic: Licence): string {
		const url = LICENCE_FACTS[lic].deedUrl;
		return url ? `${url}deed.${getLocale()}` : '';
	}

	const key = (item: { kind: string; id: string }) => `${item.kind}:${item.id}`;

	$effect(() => {
		if (!authStore.isAuthenticated || loadedOnce) return;
		loadedOnce = true;
		load();
	});
	onMount(() => {
		if (authStore.isAuthenticated && !loadedOnce) {
			loadedOnce = true;
			load();
		}
	});

	async function load() {
		loadError = false;
		try {
			data = await getMyLicences(getLocale());
		} catch {
			loadError = true;
		}
	}

	const allItems = $derived<MyLicensedItem[]>(
		data ? KINDS.flatMap((kind) => data!.byKind[kind].items) : []
	);
	const presentLicences = $derived<Licence[]>([...new Set(allItems.map((i) => i.licence))]);

	function matches(item: MyLicensedItem): boolean {
		if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
		if (licenceFilter !== 'all' && item.licence !== licenceFilter) return false;
		const q = query.trim().toLocaleLowerCase();
		return !q || item.title.toLocaleLowerCase().includes(q);
	}

	const visibleByKind = $derived(
		KINDS.map((kind) => ({
			kind,
			items: (data?.byKind[kind].items ?? []).filter(matches),
			truncated: data?.byKind[kind].truncated ?? false
		})).filter((group) => group.items.length > 0 || group.truncated)
	);

	const chosen = $derived<MyLicensedItem[]>(allItems.filter((item) => selected[key(item)]));
	// What the confirm step forecasts: of the chosen items, which the rules would move to the target.
	const movable = $derived(chosen.filter((item) => target && item.allowed.includes(target)));
	const notMovable = $derived(chosen.filter((item) => !target || !item.allowed.includes(target)));

	function selectable(item: MyLicensedItem): boolean {
		return item.allowed.length > 0;
	}

	function setGroup(items: MyLicensedItem[], on: boolean) {
		const next = { ...selected };
		for (const item of items) if (selectable(item)) next[key(item)] = on;
		selected = next;
	}

	function groupState(items: MyLicensedItem[]): 'all' | 'some' | 'none' {
		const pickable = items.filter(selectable);
		const n = pickable.filter((item) => selected[key(item)]).length;
		if (n === 0) return 'none';
		return n === pickable.length ? 'all' : 'some';
	}

	function itemHref(item: MyLicensedItem): string {
		if (item.kind === 'material' && item.materialId)
			return localizedPath(resolve('/materials/[id]', { id: item.materialId }));
		if (item.kind === 'concept_article' && item.conceptSlug)
			return resolve('/concepts/[slug]', { slug: item.conceptSlug });
		return resolve('/exercises/[id]', { id: item.exerciseId || item.id });
	}

	function itemSubline(item: MyLicensedItem): string {
		if (item.kind !== 'solution_entry') return '';
		const what = item.entryKind === 'hint' ? m.licbulk_entry_hint() : m.licbulk_entry_solution();
		// "Hint" / "Solution"
		return item.partLabel ? m.licbulk_entry_withPart({ what, part: item.partLabel }) : what;
		// "{what}, part {part}"
	}

	function blockedLine(reason: string): string {
		return licenceReasonLabel(reason);
	}

	async function apply() {
		if (!target || !data) return;
		busy = true;
		wholeError = '';
		try {
			results = await bulkChangeLicence(
				target,
				chosen.map((item) => ({ kind: item.kind, id: item.id })),
				data.maxPerRequest
			);
		} catch (e) {
			if (e instanceof BulkLicenceError) {
				results = e.done;
				wholeError = licenceReasonLabel(e.reason);
			} else {
				wholeError = m.common_error();
			}
		} finally {
			busy = false;
			step = 'done';
			selected = {};
			await load();
		}
	}

	const titleOf = (r: BulkLicenceResult) =>
		allItems.find((item) => key(item) === key(r))?.title ?? `#${r.id}`;
	const changedCount = $derived(results.filter((r) => r.ok).length);
	const refusedResults = $derived(results.filter((r) => !r.ok));
</script>

<PageHead title={m.licbulk_pageTitle()} description={m.licbulk_intro()} />

<div class="page" data-testid="licences-page">
	<a class="back" href={resolve('/settings')}>← {m.account_back()}</a>
	<!-- "Back to settings" -->
	<h1>{m.licbulk_pageTitle()}</h1>
	<!-- "Licences of your content" -->
	<p class="intro">{m.licbulk_intro()}</p>
	<!-- "Everything you have posted, with the licence each piece carries. Choose several and open them up in one go." -->

	{#if authStore.isAuthenticated && authStore.user && step === 'pick'}
		<form class="card default" onsubmit={saveDefault} data-testid="default-licence-form">
			<h2>{m.licdefault_heading()}</h2>
			<!-- "Your default licence for new content" -->
			<p class="hint">{m.licdefault_body()}</p>
			<!-- "Every form where you add something new — an exercise, a hint or solution, a material, a concept article — starts with this licence. You can still change it on each one." -->
			<fieldset class="licences">
				<legend class="visually-hidden">{m.licdefault_heading()}</legend>
				<label class="radio">
					<input type="radio" name="default-licence" value="" bind:group={defaultChoice} />
					<span>
						<span class="name"><strong>{m.licdefault_none()}</strong></span>
						<!-- "No default" -->
						<span class="summary">{m.licdefault_noneSummary()}</span>
						<!-- "Each form suggests one: CC BY 4.0 for your own work, EdMat only once it names a source." -->
					</span>
				</label>
				{#each SELECTABLE_LICENCES as lic (lic)}
					<label class="radio">
						<input
							type="radio"
							name="default-licence"
							value={lic}
							bind:group={defaultChoice}
							data-testid="default-licence-{lic}"
						/>
						<span>
							<span class="name"
								><strong>{licenceShort(lic)}</strong>{#if LICENCE_FACTS[lic].code}&nbsp;— {LICENCE_NAMES[
										lic
									]()}{/if}</span
							>
							<span class="summary">{LICENCE_SUMMARIES[lic]()}</span>
							{#if deedHref(lic)}
								<!-- eslint-disable svelte/no-navigation-without-resolve -- creativecommons.org, not an app route -->
								<a class="deed" href={deedHref(lic)} target="_blank" rel="noopener noreferrer"
									>{m.licence_readDeed()}</a
								>
								<!-- "What it means" -->
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{/if}
						</span>
					</label>
				{/each}
			</fieldset>
			<div class="row">
				<button
					type="submit"
					class="primary"
					disabled={!defaultDirty || defaultState === 'busy'}
					data-testid="default-licence-save"
				>
					{m.licdefault_save()}
					<!-- "Save default" -->
				</button>
				{#if defaultState === 'saved' && !defaultDirty}
					<span class="ok" role="status" data-testid="default-licence-saved"
						>{m.licdefault_saved()}</span
					>
					<!-- "Saved. New forms start with it." -->
				{:else if defaultState === 'error'}
					<span class="error" role="alert">{m.common_error()}</span>
				{/if}
			</div>
		</form>
	{/if}

	{#if authStore.restoring}
		<p>{m.common_loading()}</p>
	{:else if !authStore.isAuthenticated}
		<p><a href={resolve('/login')}>{m.settings_loginRequired()}</a></p>
	{:else if loadError}
		<p class="error" role="alert">{m.common_error()}</p>
	{:else if !data}
		<p>{m.common_loading()}</p>
	{:else if allItems.length === 0}
		<section class="card" data-testid="licences-empty">
			<p>{m.licbulk_empty()}</p>
			<!-- "You have not posted anything yet. Whatever you post appears here with its licence." -->
			<a href={resolve('/submit')}>{m.licbulk_emptyLink()}</a>
			<!-- "Add an exercise" -->
		</section>
	{:else if step === 'done'}
		<section class="card" role="status" data-testid="licences-results">
			<h2>{m.licbulk_doneHeading()}</h2>
			<!-- "Done" -->
			<p class="ok">{m.licbulk_doneChanged({ count: changedCount })}</p>
			<!-- "{count} item(s) now carry the new licence." -->
			{#if wholeError}
				<p class="error" role="alert">{wholeError}</p>
			{/if}
			{#if refusedResults.length > 0}
				<p>{m.licbulk_doneRefused({ count: refusedResults.length })}</p>
				<!-- "{count} item(s) kept their licence:" -->
				<ul class="refused" data-testid="licences-refused">
					{#each refusedResults as r (key(r))}
						<li>
							<span class="title">{titleOf(r)}</span>
							<span class="reason">{licenceReasonLabel(r.reason)}</span>
						</li>
					{/each}
				</ul>
			{/if}
			<button
				type="button"
				class="secondary"
				onclick={() => {
					step = 'pick';
					results = [];
					target = '';
				}}>{m.licbulk_again()}</button
			>
			<!-- "Back to the list" -->
		</section>
	{:else if step === 'confirm' && target}
		<section class="card confirm" data-testid="licences-confirm">
			<h2>{m.licbulk_confirmHeading({ licence: licenceShort(target) })}</h2>
			<!-- "Open {count} item(s) under {licence}?" -->
			<p>
				{m.licbulk_confirmMovable({ count: movable.length, licence: licenceShort(target) })}
			</p>
			<!-- "{count} item(s) will be licensed under {licence}." -->
			{#if notMovable.length > 0}
				<p class="hint">{m.licbulk_confirmSkipped({ count: notMovable.length })}</p>
				<!-- "{count} of the chosen items cannot move to this licence and will keep theirs — the result lists why." -->
			{/if}
			<p class="summary">{LICENCE_SUMMARIES[target]()}</p>
			<p class="irrevocable" data-testid="licences-irrevocable">
				<strong>{m.licbulk_irrevocableLead()}</strong>
				<!-- "This cannot be undone." -->
				{m.licbulk_irrevocableBody()}
				<!-- "A Creative Commons licence, once granted, stays with every copy anyone has already taken. You can later open an item further, never close it again." -->
			</p>
			<div class="row">
				<button
					type="button"
					class="primary"
					onclick={apply}
					disabled={busy || movable.length === 0}
					data-testid="licences-apply"
				>
					{busy ? m.licbulk_applying() : m.licbulk_apply({ count: movable.length })}
					<!-- "Changing…" / "Change {count} item(s)" -->
				</button>
				<button type="button" class="secondary" onclick={() => (step = 'pick')} disabled={busy}>
					{m.licbulk_back()}
					<!-- "Back" -->
				</button>
			</div>
		</section>
	{:else}
		<section class="card filters" aria-label={m.licbulk_filtersLabel()}>
			<!-- "Filter your content" -->
			<label class="field">
				<span>{m.licbulk_filterKind()}</span>
				<!-- "Kind" -->
				<select bind:value={kindFilter} data-testid="licences-filter-kind">
					<option value="all">{m.licbulk_filterAll()}</option>
					<!-- "All" -->
					{#each KINDS as kind (kind)}
						<option value={kind}>{KIND_HEADINGS[kind]()}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>{m.licbulk_filterLicence()}</span>
				<!-- "Current licence" -->
				<select bind:value={licenceFilter} data-testid="licences-filter-licence">
					<option value="all">{m.licbulk_filterAll()}</option>
					{#each presentLicences as lic (lic)}
						<option value={lic}>{licenceShort(lic)}</option>
					{/each}
				</select>
			</label>
			<label class="field grow">
				<span>{m.licbulk_filterTitle()}</span>
				<!-- "Title contains" -->
				<input type="search" bind:value={query} data-testid="licences-filter-title" />
			</label>
		</section>

		{#each visibleByKind as group (group.kind)}
			{@const state = groupState(group.items)}
			<section class="card group" data-testid="licences-group-{group.kind}">
				<header class="group-head">
					<label class="check">
						<input
							type="checkbox"
							checked={state === 'all'}
							indeterminate={state === 'some'}
							disabled={!group.items.some(selectable)}
							onchange={(e) => setGroup(group.items, (e.currentTarget as HTMLInputElement).checked)}
							data-testid="licences-select-all-{group.kind}"
						/>
						<h2>{KIND_HEADINGS[group.kind]()}</h2>
					</label>
					<span class="count">{group.items.length}</span>
				</header>
				{#if group.truncated}
					<p class="hint">{m.licbulk_truncated({ count: data.limitPerKind })}</p>
					<!-- "Only your newest {count} are listed here; open the rest from their own pages." -->
				{/if}
				<ul class="items">
					{#each group.items as item (key(item))}
						<li class:blocked={!selectable(item)} data-testid="licences-item">
							<label class="check">
								<input
									type="checkbox"
									bind:checked={selected[key(item)]}
									disabled={!selectable(item)}
									aria-describedby={!selectable(item) ? `why-${key(item)}` : undefined}
								/>
								<span class="item-text">
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- itemHref() returns resolve() (wrapped in localizedPath for a material), which the rule cannot see through -->
									<a href={itemHref(item)}>{item.title}</a>
									{#if itemSubline(item)}<span class="sub">{itemSubline(item)}</span>{/if}
									{#if !selectable(item)}
										<span class="why" id="why-{key(item)}">{blockedLine(item.blockedReason)}</span>
									{/if}
								</span>
							</label>
							<span class="badge" data-licence={item.licence}>{licenceShort(item.licence)}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/each}

		<section class="card target" aria-labelledby="target-heading">
			<h2 id="target-heading">{m.licbulk_targetHeading({ count: chosen.length })}</h2>
			<!-- "Licence for the {count} chosen item(s)" -->
			{#if chosen.length === 0}
				<p class="hint">{m.licbulk_chooseFirst()}</p>
				<!-- "Tick the items you want to open up first." -->
			{/if}
			<fieldset class="licences" disabled={chosen.length === 0}>
				<legend class="visually-hidden">{m.licbulk_targetHeading({ count: chosen.length })}</legend>
				{#each TARGETS as lic (lic)}
					{@const n = chosen.filter((item) => item.allowed.includes(lic)).length}
					<label class="radio" class:dim={chosen.length > 0 && n === 0}>
						<input type="radio" name="target" value={lic} bind:group={target} />
						<span>
							<span class="name"><strong>{licenceShort(lic)}</strong> — {LICENCE_NAMES[lic]()}</span
							>
							<span class="summary">{LICENCE_SUMMARIES[lic]()}</span>
							{#if chosen.length > 0}
								<span class="fit" data-testid="licences-fit-{lic}"
									>{m.licbulk_fits({ count: n, total: chosen.length })}</span
								>
								<!-- "{count} of {total} can move to it" -->
							{/if}
						</span>
					</label>
				{/each}
			</fieldset>
			<button
				type="button"
				class="primary"
				disabled={!target || chosen.length === 0}
				onclick={() => (step = 'confirm')}
				data-testid="licences-next"
			>
				{m.licbulk_next()}
				<!-- "Continue" -->
			</button>
		</section>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 860px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.back {
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
	h1 {
		font-size: var(--font-size-xl);
		margin: 0;
	}
	h2 {
		font-size: var(--font-size-lg);
		margin: 0;
	}
	.intro {
		margin: 0;
		color: var(--text-secondary);
		line-height: 1.5;
	}
	.card {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		p {
			margin: 0;
			line-height: 1.5;
		}
		a {
			color: var(--accent);
		}
	}
	.filters {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: flex-end;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
		&.grow {
			flex: 1 1 12rem;
		}
	}
	select,
	input[type='search'] {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: inherit;
		font: inherit;
	}
	.group-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.count {
		@include mix.neutral-pill;
		font-variant-numeric: tabular-nums;
	}
	.check {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		min-width: 0;
		input {
			margin-top: 4px;
			flex: none;
		}
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		li {
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
			gap: var(--space-3);
			padding: var(--space-2) 0;
			border-top: 1px solid var(--border-color);
		}
	}
	.item-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.sub,
	.why,
	.hint,
	.summary,
	.fit {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.why {
		font-style: italic;
	}
	.blocked a {
		color: var(--text-secondary);
	}
	.badge {
		@include mix.neutral-pill;
		flex: none;
		white-space: nowrap;
	}
	.licences {
		border: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.radio {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		input {
			margin-top: 4px;
			flex: none;
		}
		> span {
			display: flex;
			flex-direction: column;
			gap: 2px;
		}
		// A licence none of the chosen items can move to: told by colour, never by opacity on
		// content (frontend/CLAUDE.md).
		&.dim .name,
		&.dim .name strong {
			color: var(--text-secondary);
		}
	}
	.default .deed {
		font-size: var(--font-size-sm);
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
	}
	.secondary {
		@include mix.button-secondary;
		align-self: flex-start;
	}
	.irrevocable {
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--status-warning-bg);
		color: var(--text-primary);
	}
	.ok {
		color: var(--status-success);
	}
	.error {
		color: var(--status-danger);
	}
	.refused {
		margin: 0;
		padding-left: var(--space-4);
		li {
			display: flex;
			flex-direction: column;
			margin-bottom: var(--space-1);
		}
		.reason {
			color: var(--text-secondary);
			font-size: var(--font-size-sm);
		}
	}
</style>
