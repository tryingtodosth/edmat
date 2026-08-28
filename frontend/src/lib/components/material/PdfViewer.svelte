<!-- In-browser PDF preview (root CLAUDE.md §17AJ): PDF.js rendering pages onto a canvas, chosen
     over the native browser viewer SPECIFICALLY so the /media/ Content-Disposition: attachment
     hardening stays untouched — pdf.js fetches the bytes, and a disposition header only governs
     navigation, so nothing about how uploads are served changes. pdfjs-dist (~1.5 MB + worker) is
     imported DYNAMICALLY in here, and this component only ever mounts once the reader asks for
     the preview — a page that never opens it never downloads any of it (the KaTeX/Leaflet lazy
     discipline, frontend/CLAUDE.md).

     Deliberately a functional pager (page prev/next, zoom, fit-width default), not a full reader:
     no text layer, so no in-document search or text selection in v1 — the download link right
     next to it remains the full-fidelity route. -->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

	let { url }: { url: string } = $props();

	// pdf.js types are only needed structurally here — the module itself arrives at runtime.
	type PdfDocument = {
		numPages: number;
		getPage: (n: number) => Promise<PdfPage>;
	};
	// In pdf.js v6 `destroy()` lives on the LOADING TASK, not the document proxy — calling it on
	// the doc was a real unmount-time page error, caught by the e2e's zero-console-errors rule.
	type PdfLoadingTask = { promise: Promise<unknown>; destroy: () => Promise<void> };
	type PdfPage = {
		getViewport: (opts: { scale: number }) => { width: number; height: number };
		render: (opts: unknown) => { promise: Promise<void> };
	};

	let container = $state<HTMLDivElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let doc: PdfDocument | null = null;
	let task: PdfLoadingTask | null = null;
	let pageCount = $state(0);
	let pageNumber = $state(1);
	let zoom = $state(1); // multiplier on the fit-width scale
	let loading = $state(true);
	let failed = $state(false);
	let rendering = false;
	let pendingRender = false;

	async function renderPage() {
		if (!doc || !canvas || !container) return;
		// One render at a time — pdf.js refuses concurrent renders into the same canvas; a click
		// arriving mid-render re-runs once the current one finishes instead of throwing.
		if (rendering) {
			pendingRender = true;
			return;
		}
		rendering = true;
		try {
			const page = await doc.getPage(pageNumber);
			const base = page.getViewport({ scale: 1 });
			// Fit the container's width, then apply the user's zoom, then render at devicePixelRatio
			// so text is sharp on 2x screens — the canvas is downscaled by CSS to the layout size.
			const fitScale = (container.clientWidth - 2) / base.width;
			const scale = fitScale * zoom;
			const dpr = Math.min(window.devicePixelRatio || 1, 3);
			const viewport = page.getViewport({ scale: scale * dpr });
			canvas.width = Math.floor(viewport.width);
			canvas.height = Math.floor(viewport.height);
			canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
			canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
			const context = canvas.getContext('2d');
			if (!context) return;
			await page.render({ canvasContext: context, viewport }).promise;
		} finally {
			rendering = false;
			if (pendingRender) {
				pendingRender = false;
				renderPage();
			}
		}
	}

	onMount(() => {
		let cancelled = false;
		(async () => {
			try {
				const pdfjs = await import('pdfjs-dist');
				const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
				pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
				const loadingTask = pdfjs.getDocument({ url }) as unknown as PdfLoadingTask;
				const loaded = (await loadingTask.promise) as PdfDocument;
				if (cancelled) {
					loadingTask.destroy();
					return;
				}
				task = loadingTask;
				doc = loaded;
				pageCount = doc.numPages;
				loading = false;
				// `loading = false` is what RENDERS the canvas — `bind:this` resolves on the flush,
				// so without this tick the first renderPage() sees canvas === null and silently
				// no-ops, leaving the default 300×150 blank element (a real bug, found by a
				// screenshot after the pixel probe passed vacuously on transparent pixels).
				await tick();
				await renderPage();
			} catch {
				if (!cancelled) {
					failed = true;
					loading = false;
				}
			}
		})();
		return () => {
			cancelled = true;
			task?.destroy();
			task = null;
			doc = null;
		};
	});

	function go(delta: number) {
		const next = pageNumber + delta;
		if (next < 1 || next > pageCount) return;
		pageNumber = next;
		renderPage();
	}

	function setZoom(delta: number) {
		zoom = Math.min(3, Math.max(0.5, Math.round((zoom + delta) * 10) / 10));
		renderPage();
	}
</script>

<div class="pdf-viewer" bind:this={container}>
	{#if loading}
		<p class="pdf-viewer__status">{m.common_loading()}</p>
	{:else if failed}
		<p class="pdf-viewer__status">{m.pdfPreview_failed()}</p>
	{:else}
		<div class="pdf-viewer__controls">
			<button
				type="button"
				disabled={pageNumber <= 1}
				onclick={() => go(-1)}
				aria-label={m.pdfPreview_previousPage()}>‹</button
			>
			<span class="pdf-viewer__page"
				>{m.pdfPreview_pageOf({ page: pageNumber, total: pageCount })}</span
			>
			<button
				type="button"
				disabled={pageNumber >= pageCount}
				onclick={() => go(1)}
				aria-label={m.pdfPreview_nextPage()}>›</button
			>
			<span class="pdf-viewer__spacer"></span>
			<button type="button" onclick={() => setZoom(-0.2)} aria-label={m.pdfPreview_zoomOut()}
				>−</button
			>
			<span class="pdf-viewer__zoom">{Math.round(zoom * 100)}%</span>
			<button type="button" onclick={() => setZoom(0.2)} aria-label={m.pdfPreview_zoomIn()}
				>+</button
			>
		</div>
		<div class="pdf-viewer__scroll">
			<canvas bind:this={canvas}></canvas>
		</div>
	{/if}
</div>

<style lang="scss">
	.pdf-viewer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.pdf-viewer__status {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.pdf-viewer__controls {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		button {
			font: inherit;
			min-width: 2rem;
			padding: var(--space-1);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
			cursor: pointer;
			&:disabled {
				opacity: 0.4;
				cursor: default;
			}
		}
	}
	.pdf-viewer__page,
	.pdf-viewer__zoom {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.pdf-viewer__spacer {
		flex: 1;
	}
	.pdf-viewer__scroll {
		overflow: auto;
		max-height: 75vh;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		canvas {
			display: block;
			margin: 0 auto;
		}
	}
</style>
