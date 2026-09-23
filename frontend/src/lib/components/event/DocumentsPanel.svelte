<script lang="ts">
	/** The event's documents, grouped by who may see them (CONFERENCE-BRIEF.md §3.C).
	 *
	 * Everybody sees the tiers they have; an organiser also gets the upload/link form, the withdraw
	 * and new-version controls, and the read-receipt table — which is the half that matters, because
	 * a list of acknowledgements alone answers a question nobody asks. What an organiser needs to
	 * know on the morning is who has NOT read the fire plan.
	 *
	 * Behind the `event_documents` kill switch, with the `is_staff` bypass every other surface uses:
	 * with the flag off this whole panel goes, and check-in keeps working exactly as it did before
	 * (house rule 3 — the gate in `documents/access.py` answers "nothing owed" while the flag is
	 * off, so the neighbouring surface is not left half-broken). */
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { documentAcks } from '$lib/state/documentAcks.svelte';
	import { formatDateTime } from '$lib/utils/datetime';
	import { downloadBlob } from '$lib/utils/download';
	import { DOCUMENT_TIERS, DOCUMENT_TIER_LABELS } from '$lib/utils/labels';
	import {
		acknowledgeDocument,
		createEventDocument,
		getDocumentFile,
		getDocumentReceipts,
		getEventDocuments,
		removeEventDocument,
		replaceEventDocument
	} from '$lib/services/documents';
	import type { EdmatEvent } from '$lib/types/event';
	import type { DocumentReceipt, EventDocument, EventDocumentDraft } from '$lib/types/document';
	import DocumentPreview from './DocumentPreview.svelte';

	let { event }: { event: EdmatEvent } = $props();

	const enabled = $derived(featureFlagsStore.isEnabled('event_documents') || authStore.isModerator);

	let documents = $state<EventDocument[]>([]);
	let receipts = $state<DocumentReceipt[]>([]);
	let showReceipts = $state(false);
	let loading = $state(true);
	let error = $state('');
	let busy = $state('');
	let openPreview = $state('');
	// A plain variable, NOT `$state`: an effect that reads the state it writes re-runs itself
	// (frontend/CLAUDE.md trap 4), and this only exists to stop a reload per re-render.
	let loadedFor = '';

	let showForm = $state(false);
	// `replacingId` is the id whose NEXT VERSION the form will upload; empty means a new document.
	let replacingId = $state('');
	let draft = $state<EventDocumentDraft>({
		title: '',
		kind: 'file',
		visibility: 'staff',
		requiresAcknowledgement: false,
		url: ''
	});
	let chosenFile = $state<File | null>(null);

	$effect(() => {
		// Keyed on the acknowledgement counter as well as the event, so a briefing confirmed in the
		// check-in interstitial (a sibling component with no relationship to this one) re-reads this
		// list instead of leaving a stale "still to read" pill behind — see state/documentAcks.
		const stamp = `${event.id}:${documentAcks.version}`;
		if (!enabled) return;
		if (loadedFor === stamp) return;
		loadedFor = stamp;
		load(event.id);
	});

	async function load(id: string) {
		loading = true;
		try {
			documents = await getEventDocuments(id);
			if (event.canOrganise) receipts = await getDocumentReceipts(id);
		} catch {
			documents = [];
		} finally {
			loading = false;
		}
	}

	const groups = $derived(
		DOCUMENT_TIERS.map((tier) => ({
			tier,
			rows: documents.filter((d) => d.visibility === tier)
		})).filter((g) => g.rows.length > 0)
	);
	const outstanding = $derived(
		documents.filter((d) => d.requiresAcknowledgement && !d.acknowledged).length
	);

	function fileName(doc: EventDocument): string {
		const extension = doc.contentType.includes('pdf') ? '.pdf' : '.webp';
		return `${doc.title}${extension}`;
	}

	function explain(e: unknown): string {
		return e instanceof ApiError
			? String((e.body as { detail?: string } | undefined)?.detail ?? e.message)
			: m.common_error(); // "Something went wrong."
	}

	/** Anything that CHANGES a document: do it, then re-read the list, because a replacement, a
	 *  withdrawal and an acknowledgement all change rows other than the one that was clicked. */
	async function run(id: string, action: () => Promise<unknown>) {
		busy = id;
		error = '';
		try {
			await action();
			await load(event.id);
		} catch (e) {
			error = explain(e);
		} finally {
			busy = '';
		}
	}

	/** Deliberately NOT through `run`: fetching the bytes changes nothing, and reloading the list
	 *  after it made the whole panel blink through its loading state on a download (seen in an e2e
	 *  screenshot — nothing asserted it, which is the point of looking at them). */
	async function download(doc: EventDocument) {
		busy = doc.id;
		error = '';
		try {
			downloadBlob(fileName(doc), await getDocumentFile(doc.id));
		} catch (e) {
			error = explain(e);
		} finally {
			busy = '';
		}
	}

	function startNew() {
		replacingId = '';
		draft = {
			title: '',
			kind: 'file',
			visibility: 'staff',
			requiresAcknowledgement: false,
			url: ''
		};
		chosenFile = null;
		showForm = true;
	}

	function startReplace(doc: EventDocument) {
		replacingId = doc.id;
		draft = {
			title: doc.title,
			kind: doc.kind,
			visibility: doc.visibility,
			requiresAcknowledgement: doc.requiresAcknowledgement,
			url: doc.url
		};
		chosenFile = null;
		showForm = true;
	}

	async function submit(submitEvent: SubmitEvent) {
		submitEvent.preventDefault();
		const payload: EventDocumentDraft = { ...draft, file: chosenFile ?? undefined };
		await run('form', async () => {
			if (replacingId) await replaceEventDocument(replacingId, payload);
			else await createEventDocument(event.id, payload);
			showForm = false;
			replacingId = '';
			chosenFile = null;
		});
	}

	function receiptsFor(documentId: string): DocumentReceipt[] {
		return receipts.filter((r) => r.documentId === documentId);
	}
</script>

{#if enabled}
	<section class="documents">
		<div class="head">
			<h3>{m.documents_heading()}</h3>
			<!-- "Documents" -->
			{#if outstanding > 0}
				<span class="pill pill--warn">{m.documents_outstanding({ count: outstanding })}</span>
				<!-- "{count} still to read" -->
			{/if}
			{#if event.canOrganise}
				<button type="button" onclick={startNew}>{m.documents_add()}</button>
				<!-- "Add a document" -->
			{/if}
		</div>

		{#if loading && documents.length === 0}
			<p class="status">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if !loading && documents.length === 0}
			<p class="status">{m.documents_empty()}</p>
			<!-- "Nothing has been shared here yet." -->
		{/if}

		{#if showForm && event.canOrganise}
			<form onsubmit={submit}>
				{#if replacingId}
					<p class="status">{m.documents_replaceHint()}</p>
					<!-- "The old version is kept, and everybody who had read it is asked again." -->
				{/if}
				<label>
					{m.documents_title()}
					<!-- "Title" -->
					<input type="text" bind:value={draft.title} required maxlength="200" />
				</label>
				<label>
					{m.documents_kind()}
					<!-- "What is it" -->
					<select bind:value={draft.kind}>
						<option value="file">{m.documents_kindFile()}</option>
						<!-- "A file" -->
						<option value="link">{m.documents_kindLink()}</option>
						<!-- "A link" -->
					</select>
				</label>
				{#if draft.kind === 'file'}
					<label>
						{m.documents_file()}
						<!-- "File (a PDF or a picture)" -->
						<input
							type="file"
							accept="application/pdf,image/png,image/jpeg,image/webp"
							onchange={(e) => (chosenFile = e.currentTarget.files?.[0] ?? null)}
						/>
					</label>
				{:else}
					<label>
						{m.documents_url()}
						<!-- "Address" -->
						<input type="url" bind:value={draft.url} />
					</label>
				{/if}
				<label>
					{m.documents_visibility()}
					<!-- "Who may see it" -->
					<select bind:value={draft.visibility}>
						{#each DOCUMENT_TIERS as tier (tier)}
							<option value={tier}>{DOCUMENT_TIER_LABELS[tier]()}</option>
						{/each}
					</select>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={draft.requiresAcknowledgement} />
					{m.documents_requiresAcknowledgement()}
					<!-- "Everybody who can see it has to confirm they have read it" -->
				</label>
				<div class="actions">
					<button type="submit" class="primary" disabled={busy === 'form'}
						>{busy === 'form' ? m.documents_saving() : m.documents_save()}</button
					>
					<!-- "Adding…" / "Add" -->
					<button type="button" onclick={() => (showForm = false)}>{m.common_cancel()}</button>
					<!-- "Cancel" -->
				</div>
			</form>
		{/if}

		{#each groups as group (group.tier)}
			<div class="group">
				<h4>
					<span class="pill">{DOCUMENT_TIER_LABELS[group.tier]()}</span>
				</h4>
				<ul>
					{#each group.rows as doc (doc.id)}
						<li>
							<div class="row-head">
								<strong>{doc.title}</strong>
								{#if doc.version > 1}
									<span class="meta">{m.documents_version({ number: doc.version })}</span>
									<!-- "Version {number}" -->
								{/if}
								{#if doc.requiresAcknowledgement}
									<span class="pill pill--warn">{m.documents_mandatory()}</span>
									<!-- "Must be read" -->
								{/if}
								{#if doc.uploadedBy}
									<span class="meta"
										>{m.documents_uploadedBy({ name: doc.uploadedBy.displayName })}</span
									>
									<!-- "Added by {name}" -->
								{/if}
							</div>
							<div class="actions">
								{#if doc.kind === 'link'}
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external absolute URL an organiser typed, not an app route -->
									<a href={doc.url} target="_blank" rel="noopener noreferrer"
										>{m.documents_openLink()}</a
									>
									<!-- "Open the link" -->
								{:else}
									<button
										type="button"
										onclick={() => (openPreview = openPreview === doc.id ? '' : doc.id)}
										>{openPreview === doc.id
											? m.documents_hidePreview()
											: m.documents_preview()}</button
									>
									<!-- "Hide the preview" / "Preview" -->
									<button type="button" disabled={busy === doc.id} onclick={() => download(doc)}
										>{m.documents_open()}</button
									>
									<!-- "Download" -->
									{#if !doc.scanned && doc.contentType.includes('pdf')}
										<span class="meta">{m.documents_notScanned()}</span>
										<!-- "Not virus-scanned" -->
									{/if}
								{/if}
								{#if doc.requiresAcknowledgement}
									{#if doc.acknowledged}
										<span class="pill pill--ok">{m.documents_acknowledged()}</span>
										<!-- "Read" -->
									{:else}
										<button
											type="button"
											class="primary"
											disabled={busy === doc.id}
											onclick={() => run(doc.id, () => acknowledgeDocument(doc.id))}
											>{m.documents_acknowledge()}</button
										>
										<!-- "Read and understood" -->
									{/if}
								{/if}
								{#if event.canOrganise}
									<button type="button" onclick={() => startReplace(doc)}
										>{m.documents_replace()}</button
									>
									<!-- "Upload a new version" -->
									<button
										type="button"
										class="danger"
										disabled={busy === doc.id}
										onclick={() => run(doc.id, () => removeEventDocument(doc.id))}
										>{m.documents_remove()}</button
									>
									<!-- "Withdraw" -->
								{/if}
							</div>
							{#if openPreview === doc.id && doc.kind === 'file'}
								<DocumentPreview document={doc} />
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/each}

		{#if event.canOrganise && receipts.length > 0}
			<div class="receipts">
				<button type="button" onclick={() => (showReceipts = !showReceipts)}
					>{showReceipts ? m.documents_receiptsHide() : m.documents_receiptsShow()}</button
				>
				<!-- "Hide the read receipts" / "Who has read what" -->
				{#if showReceipts}
					{#each documents.filter((d) => d.requiresAcknowledgement) as doc (doc.id)}
						<h4>{doc.title}</h4>
						<ul class="people">
							{#each receiptsFor(doc.id) as row (row.userId)}
								<li>
									<span>{row.userDisplayName}</span>
									{#if row.outstanding}
										<span class="pill pill--warn">{m.documents_receiptsOutstanding()}</span>
										<!-- "Not yet" -->
									{:else}
										<span class="meta">{formatDateTime(row.acknowledgedAt ?? '')}</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/each}
				{/if}
			</div>
		{/if}

		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</section>
{/if}

<style lang="scss">
	.documents {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.9rem 1rem;
		margin-top: 1rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	h3,
	h4 {
		margin: 0;
	}
	.group {
		margin-top: 0.8rem;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0.4rem 0 0;
		display: grid;
		gap: 0.5rem;
	}
	li {
		padding: 0.5rem 0.7rem;
		border-radius: 8px;
		background: var(--bg-surface-alt);
	}
	.row-head {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.3rem;
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--bg-surface);
		border: 1px solid var(--border);
	}
	.pill--warn {
		background: var(--status-warning-bg);
		color: var(--status-warning);
		border-color: transparent;
	}
	.pill--ok {
		background: var(--status-success-bg);
		color: var(--status-success);
		border-color: transparent;
	}
	.meta,
	.status {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	button {
		min-height: 44px;
		padding: 0 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.danger {
		color: var(--status-danger);
	}
	form {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.6rem;
		padding: 0.7rem;
		border: 1px dashed var(--border);
		border-radius: 8px;
	}
	label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.88rem;
	}
	label.check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	input[type='text'],
	input[type='url'],
	select {
		min-height: 44px;
		padding: 0 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
	}
	.receipts {
		margin-top: 0.8rem;
	}
	.people {
		margin-top: 0.3rem;
	}
	.people li {
		display: flex;
		justify-content: space-between;
		gap: 0.6rem;
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
</style>
