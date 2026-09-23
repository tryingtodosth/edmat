<script lang="ts">
	/** What a staff member sees when the API refuses a day-of action with 409 `briefing_unread`.
	 *
	 * The refusal names the documents (house rule 6: a refusal carries its reason), so this is not a
	 * "you cannot do that" dialog — it is the briefing itself, in front of the person, with the
	 * button that unblocks them at the bottom of it. Read it, confirm it, and the action is retried.
	 *
	 * Steps D and F answer with the same shape for the scanner and the cloakroom desk at
	 * integration (CONFERENCE-BRIEF.md §5), so this component takes the block and an event id and
	 * nothing about check-in specifically. */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { acknowledgeDocument, getEventDocuments } from '$lib/services/documents';
	import { documentAcks } from '$lib/state/documentAcks.svelte';
	import type { BriefingBlock, EventDocument } from '$lib/types/document';
	import DocumentPreview from './DocumentPreview.svelte';

	let { eventId, block, onread }: { eventId: string; block: BriefingBlock; onread: () => void } =
		$props();

	let documents = $state<EventDocument[]>([]);
	let loading = $state(true);
	let error = $state('');
	let busy = $state('');

	onMount(async () => {
		try {
			const all = await getEventDocuments(eventId);
			documents = all.filter((d) => block.documentIds.includes(d.id));
		} catch {
			error = m.common_error(); // "Something went wrong."
		} finally {
			loading = false;
		}
	});

	const outstanding = $derived(documents.filter((d) => !d.acknowledged).length);

	async function confirm(doc: EventDocument) {
		busy = doc.id;
		error = '';
		try {
			const updated = await acknowledgeDocument(doc.id);
			documents = documents.map((d) => (d.id === doc.id ? updated : d));
			// The Documents panel further down the page holds its own copy of this list.
			documentAcks.bump();
			if (documents.every((d) => d.acknowledged)) onread();
		} catch {
			error = m.documents_superseded(); // "There is a newer version of this. Reload the page."
		} finally {
			busy = '';
		}
	}
</script>

<section class="briefing" role="alert">
	<h4>{m.documents_briefingHeading()}</h4>
	<!-- "Read this before you start" -->
	<p class="intro">{m.documents_briefingIntro()}</p>
	<!-- "This is locked until you confirm you have read the briefing." -->
	{#if loading}
		<p class="status">{m.common_loading()}</p>
		<!-- "Loading…" -->
	{:else if documents.length === 0}
		<p class="status">{block.titles.join(', ')}</p>
	{:else}
		<ul>
			{#each documents as doc (doc.id)}
				<li>
					<div class="head">
						<strong>{doc.title}</strong>
						<span class="version">{m.documents_version({ number: doc.version })}</span>
						<!-- "Version {number}" -->
					</div>
					{#if doc.kind === 'link'}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external absolute URL an organiser typed, not an app route -->
						<a href={doc.url} target="_blank" rel="noopener noreferrer">{m.documents_openLink()}</a>
						<!-- "Open the link" -->
					{:else}
						<DocumentPreview document={doc} />
					{/if}
					{#if doc.acknowledged}
						<p class="done">{m.documents_acknowledged()}</p>
						<!-- "Read" -->
					{:else}
						<button
							type="button"
							class="primary"
							disabled={busy === doc.id}
							onclick={() => confirm(doc)}>{m.documents_acknowledge()}</button
						>
						<!-- "Read and understood" -->
					{/if}
				</li>
			{/each}
		</ul>
		{#if outstanding === 0}
			<p class="done">{m.documents_briefingDone()}</p>
			<!-- "Thank you — try that again now." -->
		{/if}
	{/if}
	{#if error}<p class="error">{error}</p>{/if}
</section>

<style lang="scss">
	.briefing {
		border: 2px solid var(--status-warning);
		background: var(--status-warning-bg);
		border-radius: 10px;
		padding: 0.8rem 1rem;
		margin-top: 0.6rem;
	}
	h4 {
		margin: 0 0 0.2rem;
	}
	.intro,
	.status,
	.version {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.intro {
		margin: 0 0 0.5rem;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.7rem;
	}
	.head {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	button {
		min-height: 44px;
		padding: 0 0.9rem;
		margin-top: 0.4rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		cursor: pointer;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.done {
		font-size: 0.85rem;
		color: var(--status-success);
		margin: 0.3rem 0 0;
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
</style>
