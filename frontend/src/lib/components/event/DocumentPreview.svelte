<script lang="ts">
	/** The bytes of one event document, shown in place.
	 *
	 * The file is NOT a URL anybody can link to: `documents/views.py` re-checks the tier on every
	 * request and serves the bytes itself, so they arrive here as a Blob fetched through
	 * `lib/api/client.ts` with the token attached, and the object URL is made — and revoked — here.
	 *
	 * pdf.js arrives through the same double-lazy route the concept renderer uses (house rule 11):
	 * `PdfViewer` is imported dynamically, and it imports `pdfjs-dist` dynamically inside its own
	 * `onMount`, so a reader who never opens a PDF never downloads the ~1.5 MB of it — asserted in
	 * `e2e/event-documents.mjs` against the built entry chunk, the way KaTeX is kept out. */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getDocumentFile } from '$lib/services/documents';
	import type { EventDocument } from '$lib/types/document';

	let { document: doc }: { document: EventDocument } = $props();

	let objectUrl = $state('');
	let failed = $state(false);

	const isPdf = $derived(doc.contentType.includes('pdf'));

	onMount(() => {
		let revoked = '';
		(async () => {
			try {
				const blob = await getDocumentFile(doc.id);
				revoked = URL.createObjectURL(blob);
				objectUrl = revoked;
			} catch {
				failed = true;
			}
		})();
		return () => {
			if (revoked) URL.revokeObjectURL(revoked);
		};
	});
</script>

<div class="preview">
	{#if failed}
		<p class="status">{m.documents_previewUnavailable()}</p>
		<!-- "This file could not be shown here — download it instead." -->
	{:else if !objectUrl}
		<p class="status">{m.common_loading()}</p>
		<!-- "Loading…" -->
	{:else if isPdf}
		{#await import('$lib/components/material/PdfViewer.svelte') then { default: PdfViewer }}
			<PdfViewer url={objectUrl} />
		{/await}
	{:else}
		<img src={objectUrl} alt={doc.title} />
	{/if}
</div>

<style lang="scss">
	.preview {
		margin-top: 0.5rem;
	}
	.status {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	img {
		max-width: 100%;
		border-radius: 8px;
		border: 1px solid var(--border);
	}
</style>
