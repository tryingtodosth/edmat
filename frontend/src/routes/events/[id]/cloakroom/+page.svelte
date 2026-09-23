<script lang="ts">
	// The cloakroom desk, from behind the counter (CONFERENCE-BRIEF.md §3.F).
	//
	// Four things happen here and they are four tabs rather than four pages, because a clerk with a
	// queue in front of them switches between "take this in" and "hand that back" every few seconds
	// and a navigation between them would cost a page load each time.
	//
	// Nothing on this page ever asks who anybody is. The Deposit flow produces a ticket; the Return
	// flow consumes one; the exception dialog is the only place a person is described at all, and
	// what it records is the COAT plus the kind of document shown — never a number, never a name.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import CloakroomSlip from '$lib/components/cloakroom/CloakroomSlip.svelte';
	import RackGrid from '$lib/components/cloakroom/RackGrid.svelte';
	import ExceptionDialog from '$lib/components/cloakroom/ExceptionDialog.svelte';
	import { getEvent } from '$lib/services/events';
	import {
		createCloakroomDesk,
		depositCloakroomItem,
		getCloakroomCsv,
		getCloakroomDesk,
		getCloakroomItems,
		getEventCloakroomDesks,
		reconcileCloakroomDesk,
		returnByToken,
		returnCloakroomItem,
		returnCloakroomItemByException
	} from '$lib/services/cloakroom';
	import {
		CLOAKROOM_BLOCK_REASON_LABELS,
		CLOAKROOM_ITEM_STATUS_LABELS,
		CLOAKROOM_RETURN_RESULT_LABELS
	} from '$lib/utils/labels';
	import { downloadText } from '$lib/utils/download';
	import { pageTitle } from '$lib/utils/pageTitle';
	import type { EdmatEvent } from '$lib/types/event';
	import type {
		CloakroomBlockReason,
		CloakroomDesk,
		CloakroomIdentityKind,
		CloakroomItem,
		CloakroomReturnResult
	} from '$lib/types/cloakroom';

	let eventId = $derived(page.params.id ?? '');
	let event = $state<EdmatEvent | null>(null);
	let desks = $state<CloakroomDesk[]>([]);
	let deskId = $state('');
	let items = $state<CloakroomItem[]>([]);
	let loading = $state(true);
	let error = $state('');

	let desk = $derived(desks.find((d) => d.id === deskId) ?? null);
	let stored = $derived(items.filter((item) => item.status === 'stored'));
	let unclaimed = $derived(items.filter((item) => item.status === 'unclaimed'));
	// What is physically on the rail — the grid's occupancy, which after a desk closes still
	// includes whatever nobody came back for.
	let occupied = $derived(
		items.filter((item) => item.status === 'stored' || item.status === 'unclaimed')
	);

	type Tab = 'deposit' | 'return' | 'racks' | 'close';
	let tab = $state<Tab>('deposit');

	// ---- the Deposit flow -------------------------------------------------------------------
	let pickedRack = $state('');
	let description = $state('');
	let slip = $state<CloakroomItem | null>(null);
	let busy = $state(false);

	// ---- the Return flow --------------------------------------------------------------------
	// `type="text"`, never `type="number"`: a token is `K7MQ2XPD`, and frontend/CLAUDE.md trap 1 is
	// what a numeric input does to a `bind:value` anyway.
	let tokenInput = $state('');
	let verdict = $state<{ result: CloakroomReturnResult; item: CloakroomItem | null } | null>(null);
	let scanning = $state(false);
	let scanError = $state('');
	let video = $state<HTMLVideoElement | null>(null);
	// `@zxing/browser`'s own handle on the camera. Kept untyped-by-inference through a tiny local
	// shape rather than a static type import, so nothing about the scanner reaches the entry bundle.
	let scanControls: { stop: () => void } | null = null;

	// ---- the exception dialog ---------------------------------------------------------------
	let exceptionItem = $state<CloakroomItem | null>(null);
	let exceptionError = $state('');

	// ---- closing the desk -------------------------------------------------------------------
	let reconciled = $state<CloakroomItem[] | null>(null);

	// ---- opening one ------------------------------------------------------------------------
	let newName = $state('');
	let newRacks = $state('1-40');
	let newNote = $state('');

	/** Free text off a form into a list of hooks: commas, newlines or spaces, and `1-40` expanded.
	 * Typing forty labels by hand is the kind of chore that makes somebody skip the feature. */
	function parseRacks(raw: string): string[] {
		const out: string[] = [];
		for (const chunk of raw.split(/[\s,;]+/)) {
			const piece = chunk.trim();
			if (!piece) continue;
			const range = /^(\d+)-(\d+)$/.exec(piece);
			if (range) {
				const from = Number(range[1]);
				const to = Number(range[2]);
				if (to >= from && to - from < 400) {
					for (let i = from; i <= to; i++) out.push(String(i));
					continue;
				}
			}
			out.push(piece);
		}
		return out.filter((label, index) => out.indexOf(label) === index);
	}

	// A refusal carries its reason (house rule 6) and this is where it becomes a sentence. Two
	// fields, because the two shapes of refusal say it differently: a block reason arrives as
	// `detail`, and a 409 on a return arrives as `result` — the same verdict vocabulary the Return
	// flow renders on the happy path.
	function say(e: unknown): string {
		if (e instanceof ApiError) {
			const body = e.body as { detail?: string; result?: string } | undefined;
			const word = body?.detail ?? body?.result;
			if (word) {
				const reason = CLOAKROOM_BLOCK_REASON_LABELS[word as CloakroomBlockReason];
				if (reason) return reason();
				const verdict =
					CLOAKROOM_RETURN_RESULT_LABELS[word as keyof typeof CLOAKROOM_RETURN_RESULT_LABELS];
				if (verdict) return verdict();
				return word;
			}
		}
		return m.cloakroom_error(); // "That did not work."
	}

	async function refresh(id: string) {
		const [fresh, rows] = await Promise.all([getCloakroomDesk(id), getCloakroomItems(id)]);
		desks = desks.map((d) => (d.id === id ? fresh : d));
		items = rows;
	}

	// One load per event id, with the id-changed guard every dynamic route here needs
	// (frontend/CLAUDE.md trap 2 — an `$effect` re-fires with no navigation at all).
	let loadedForId = '';
	async function load(id: string) {
		loading = true;
		error = '';
		try {
			const [ev, list] = await Promise.all([getEvent(id), getEventCloakroomDesks(id)]);
			event = ev;
			desks = list;
			const operable = list.find((d) => d.canOperate && d.status === 'open') ?? list[0];
			if (operable) {
				deskId = operable.id;
				await refresh(operable.id);
			}
		} catch (e) {
			error = say(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const id = eventId;
		if (!id || id === loadedForId) return;
		loadedForId = id;
		void load(id);
	});

	// The camera must never outlive the page.
	onMount(() => () => stopScanning());

	async function selectDesk(id: string) {
		deskId = id;
		slip = null;
		verdict = null;
		reconciled = null;
		try {
			await refresh(id);
		} catch (e) {
			error = say(e);
		}
	}

	async function openDesk() {
		if (!event) return;
		busy = true;
		error = '';
		try {
			const created = await createCloakroomDesk(event.id, {
				name: newName.trim(),
				racks: parseRacks(newRacks),
				opensNote: newNote.trim()
			});
			desks = [...desks, created];
			await selectDesk(created.id);
		} catch (e) {
			error = say(e);
		} finally {
			busy = false;
		}
	}

	async function deposit() {
		if (!desk || !pickedRack) return;
		busy = true;
		error = '';
		try {
			slip = await depositCloakroomItem(desk.id, pickedRack, description.trim());
			pickedRack = '';
			description = '';
			await refresh(desk.id);
		} catch (e) {
			error = say(e);
		} finally {
			busy = false;
		}
	}

	async function handBackByToken() {
		if (!desk) return;
		busy = true;
		error = '';
		try {
			verdict = await returnByToken(desk.id, tokenInput.trim());
			if (verdict.result === 'returned') tokenInput = '';
			await refresh(desk.id);
		} catch (e) {
			error = say(e);
		} finally {
			busy = false;
		}
	}

	async function handBackItem(item: CloakroomItem) {
		if (!desk) return;
		busy = true;
		error = '';
		try {
			verdict = await returnCloakroomItem(desk.id, item.id);
			await refresh(desk.id);
		} catch (e) {
			error = say(e);
		} finally {
			busy = false;
		}
	}

	async function confirmException(
		itemDescription: string,
		identityKind: CloakroomIdentityKind,
		note: string
	) {
		if (!desk || !exceptionItem) return;
		busy = true;
		exceptionError = '';
		try {
			await returnCloakroomItemByException(desk.id, exceptionItem.id, {
				description: itemDescription,
				identityKind,
				note
			});
			exceptionItem = null;
			await refresh(desk.id);
		} catch (e) {
			exceptionError = say(e);
		} finally {
			busy = false;
		}
	}

	async function closeDesk() {
		if (!desk) return;
		busy = true;
		error = '';
		try {
			const result = await reconcileCloakroomDesk(desk.id);
			desks = desks.map((d) => (d.id === result.desk.id ? result.desk : d));
			reconciled = result.unclaimed;
			items = await getCloakroomItems(desk.id);
		} catch (e) {
			error = say(e);
		} finally {
			busy = false;
		}
	}

	async function downloadCsv() {
		if (!desk) return;
		try {
			downloadText(`edmat-cloakroom-${desk.id}.csv`, await getCloakroomCsv(desk.id), 'text/csv');
		} catch (e) {
			error = say(e);
		}
	}

	/** The camera, imported at the moment it is asked for (house rule 11) — `@zxing/browser` is a
	 * large dependency that matters to one button on one staff page, and `e2e/event-cloakroom.mjs`
	 * asserts it is not in the entry bundle. A refusal here is never fatal: the typed field beside
	 * it is the real input, and the camera is the shortcut. */
	async function startScanning() {
		scanError = '';
		try {
			const { BrowserQRCodeReader } = await import('@zxing/browser');
			const reader = new BrowserQRCodeReader();
			scanning = true;
			scanControls = await reader.decodeFromVideoDevice(undefined, video ?? undefined, (result) => {
				if (!result) return;
				tokenInput = result.getText().trim().toUpperCase();
				stopScanning();
				void handBackByToken();
			});
		} catch {
			scanning = false;
			scanError = m.cloakroom_scanUnavailable(); // "The camera could not be opened here — type the number instead."
		}
	}

	function stopScanning() {
		scanControls?.stop();
		scanControls = null;
		scanning = false;
	}
</script>

<svelte:head>
	<title>{pageTitle(m.cloakroom_pageTitle())}</title>
</svelte:head>

<FeatureGate feature="cloakroom">
	<div class="page">
		<p class="back">
			{#if eventId}
				<a href={resolve('/events/[id]', { id: eventId })}>{m.cloakroom_backToEvent()}</a>
			{/if}
		</p>
		<h1>{m.cloakroom_pageTitle()}{event ? ` — ${event.title}` : ''}</h1>

		{#if loading}
			<p class="status">{m.cloakroom_loading()}</p>
		{:else}
			{#if desks.length > 1}
				<label class="desk-select">
					<span>{m.cloakroom_deskSelect()}</span>
					<select value={deskId} onchange={(e) => selectDesk(e.currentTarget.value)}>
						{#each desks as option (option.id)}
							<option value={option.id}>{option.name}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if error}
				<p class="error" data-cloakroom-error>{error}</p>
			{/if}

			{#if !desk || !desk.canOperate}
				<!-- Three different "you cannot work this desk" situations, and they are three different
				     sentences (house rule 6): an organiser with no desk yet opens one below; somebody
				     who is not staff at a desk that exists is told exactly that, not that the desk does
				     not exist; anybody else is told there is no cloakroom. -->
				<p class="status">
					{#if event?.canOrganise}
						{m.cloakroom_noDesksStaff()}
					{:else if desks.length > 0}
						{CLOAKROOM_BLOCK_REASON_LABELS.not_staff()}
					{:else}
						{m.cloakroom_noDesks()}
					{/if}
				</p>
				{#if event?.canOrganise}
					<section class="card new-desk">
						<h2>{m.cloakroom_newDeskHeading()}</h2>
						<label>
							<span>{m.cloakroom_nameLabel()}</span>
							<input type="text" bind:value={newName} name="desk_name" />
						</label>
						<label>
							<span>{m.cloakroom_racksLabel()}</span>
							<textarea bind:value={newRacks} name="desk_racks" rows="2"></textarea>
							<small>{m.cloakroom_racksHint()}</small>
						</label>
						<label>
							<span>{m.cloakroom_opensNoteLabel()}</span>
							<input
								type="text"
								bind:value={newNote}
								name="desk_note"
								placeholder={m.cloakroom_opensNotePlaceholder()}
							/>
						</label>
						<button
							type="button"
							class="primary"
							disabled={busy || !newName.trim() || parseRacks(newRacks).length === 0}
							onclick={openDesk}
						>
							{m.cloakroom_create()}
						</button>
					</section>
				{/if}
			{:else}
				<p class="counts" data-cloakroom-counts>
					{m.cloakroom_counts({
						stored: desk.storedCount,
						returned: desk.returnedCount,
						free: desk.freeRacks.length
					})}
				</p>
				{#if desk.status === 'closed'}
					<p class="notice">{m.cloakroom_closedNotice({ count: desk.unclaimedCount })}</p>
				{/if}

				<nav class="tabs">
					<button type="button" class:active={tab === 'deposit'} onclick={() => (tab = 'deposit')}>
						{m.cloakroom_tabDeposit()}
					</button>
					<button type="button" class:active={tab === 'return'} onclick={() => (tab = 'return')}>
						{m.cloakroom_tabReturn()}
					</button>
					<button type="button" class:active={tab === 'racks'} onclick={() => (tab = 'racks')}>
						{m.cloakroom_tabRacks()}
					</button>
					<button type="button" class:active={tab === 'close'} onclick={() => (tab = 'close')}>
						{m.cloakroom_tabClose()}
					</button>
				</nav>

				{#if tab === 'deposit'}
					<section class="card">
						{#if slip}
							<CloakroomSlip
								token={slip.token}
								rackLabel={slip.rackLabel}
								description={slip.description}
							/>
							<div class="actions no-print">
								<button type="button" onclick={() => window.print()}>{m.cloakroom_print()}</button>
								<button type="button" class="primary" onclick={() => (slip = null)}>
									{m.cloakroom_nextItem()}
								</button>
							</div>
						{:else if desk.freeRacks.length === 0}
							<p class="status">{m.cloakroom_noFreeRacks()}</p>
						{:else}
							<h2>{m.cloakroom_pickRack()}</h2>
							<RackGrid
								racks={desk.racks}
								{occupied}
								mode="deposit"
								selected={pickedRack}
								onpick={(rack) => (pickedRack = rack)}
							/>
							<label class="description">
								<span>{m.cloakroom_descriptionLabel()}</span>
								<input
									type="text"
									bind:value={description}
									name="description"
									placeholder={m.cloakroom_descriptionPlaceholder()}
								/>
							</label>
							<button
								type="button"
								class="primary"
								disabled={busy || !pickedRack || desk.status !== 'open'}
								onclick={deposit}
							>
								{m.cloakroom_deposit()}
							</button>
						{/if}
					</section>
				{:else if tab === 'return'}
					<section class="card">
						<label>
							<span>{m.cloakroom_tokenLabel()}</span>
							<input
								type="text"
								class="token-input"
								bind:value={tokenInput}
								name="token"
								autocomplete="off"
								spellcheck="false"
							/>
						</label>
						<div class="actions">
							<button
								type="button"
								class="primary"
								disabled={busy || !tokenInput.trim()}
								onclick={handBackByToken}
							>
								{m.cloakroom_handBack()}
							</button>
							{#if scanning}
								<button type="button" onclick={stopScanning}>{m.cloakroom_scanStop()}</button>
							{:else}
								<button type="button" onclick={startScanning}>{m.cloakroom_scanStart()}</button>
							{/if}
						</div>
						{#if scanning}
							<video bind:this={video} class="camera" autoplay muted playsinline></video>
						{/if}
						{#if scanError}
							<p class="status">{scanError}</p>
						{/if}
						{#if verdict}
							<p
								class="verdict"
								class:good={verdict.result === 'returned'}
								data-cloakroom-verdict={verdict.result}
							>
								{verdict.result === 'returned'
									? m.cloakroom_resultReturned({ rack: verdict.item?.rackLabel ?? '' })
									: CLOAKROOM_RETURN_RESULT_LABELS[verdict.result]()}
							</p>
						{/if}
					</section>
				{:else if tab === 'racks'}
					<section class="card">
						<RackGrid
							racks={desk.racks}
							{occupied}
							mode="manage"
							selected={pickedRack}
							onpick={(rack) => (pickedRack = rack)}
						/>
						<ul class="stored-list">
							{#each stored as item (item.id)}
								<li>
									<span class="rack">{item.rackLabel}</span>
									<span class="what">{item.description || m.cloakroom_rackNoDescription()}</span>
									<span class="state">{CLOAKROOM_ITEM_STATUS_LABELS[item.status]()}</span>
									<button
										type="button"
										disabled={busy || desk.status !== 'open'}
										onclick={() => handBackItem(item)}
									>
										{m.cloakroom_handBack()}
									</button>
									<button
										type="button"
										class="ghost"
										disabled={busy || desk.status !== 'open'}
										onclick={() => {
											exceptionError = '';
											exceptionItem = item;
										}}
									>
										{m.cloakroom_exceptionOpen()}
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{:else}
					<section class="card">
						<p class="lead">{m.cloakroom_closeLead()}</p>
						<button
							type="button"
							class="primary"
							disabled={busy || desk.status !== 'open'}
							onclick={closeDesk}
						>
							{m.cloakroom_closeConfirm()}
						</button>

						{#if reconciled || desk.status === 'closed'}
							{@const rows = reconciled ?? unclaimed}
							<h2 data-cloakroom-unclaimed>
								{m.cloakroom_unclaimedHeading({ count: rows.length })}
							</h2>
							{#if rows.length === 0}
								<p class="status">{m.cloakroom_unclaimedEmpty()}</p>
							{:else}
								<ul class="stored-list">
									{#each rows as item (item.id)}
										<li>
											<span class="rack">{item.rackLabel}</span>
											<span class="what">{item.description || m.cloakroom_rackNoDescription()}</span
											>
											<span class="state">{item.token}</span>
										</li>
									{/each}
								</ul>
							{/if}
							<div class="actions">
								<button type="button" onclick={downloadCsv}>{m.cloakroom_downloadCsv()}</button>
							</div>
							<p class="status">{m.cloakroom_csvNote()}</p>
						{/if}
					</section>
				{/if}
			{/if}
		{/if}
	</div>

	{#if exceptionItem}
		<ExceptionDialog
			item={exceptionItem}
			{busy}
			error={exceptionError}
			onconfirm={confirmException}
			oncancel={() => (exceptionItem = null)}
		/>
	{/if}
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 940px;
		margin: 0 auto;
		padding: var(--space-4);
	}
	.back {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-sm);
	}
	h1 {
		margin: 0 0 var(--space-3);
	}
	h2 {
		margin: var(--space-3) 0 var(--space-2);
		font-size: var(--font-size-lg);
	}
	.counts {
		margin: 0 0 var(--space-3);
		color: var(--text-secondary);
	}
	.status {
		color: var(--text-secondary);
	}
	.notice {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--status-warning-bg);
	}
	.error {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--status-danger-bg);
		color: var(--status-danger);
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.tabs button.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-contrast);
	}
	.card {
		padding: var(--space-4);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-lg);
		background: var(--bg-surface);
	}
	.new-desk {
		margin-top: var(--space-3);
	}
	label {
		display: block;
		margin: var(--space-3) 0;
	}
	label span {
		display: block;
		margin-bottom: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	label small {
		display: block;
		margin-top: var(--space-1);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	input,
	select,
	textarea {
		width: 100%;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.token-input {
		font-family: ui-monospace, 'SFMono-Regular', 'Consolas', monospace;
		font-size: var(--font-size-xl);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.desk-select {
		max-width: 320px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	button {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
	}
	button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-contrast);
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.camera {
		width: 100%;
		max-width: 360px;
		margin-top: var(--space-3);
		border-radius: var(--radius-md);
		background: #000;
	}
	// The verdict is the whole point of the Return flow, so it is the largest thing on the card.
	.verdict {
		margin-top: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--status-danger-bg);
		color: var(--status-danger);
		font-size: var(--font-size-lg);
		font-weight: 600;
	}
	.verdict.good {
		background: var(--status-success-bg);
		color: var(--status-success);
	}
	.stored-list {
		margin: var(--space-3) 0 0;
		padding: 0;
		list-style: none;
	}
	.stored-list li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		border-top: 1px solid var(--border-color);
	}
	.stored-list .rack {
		min-width: 3ch;
		font-weight: 700;
	}
	.stored-list .what {
		flex: 1 1 200px;
	}
	.stored-list .state {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.lead {
		margin: 0;
		color: var(--text-secondary);
	}
</style>
