<script lang="ts">
	// One version, rendered as the thing it is: a PDF to page through, a picture to look at, a link
	// to follow, or text typeset here.
	//
	// The same three-way split the material detail page already makes, and for the same reasons —
	// the PDF viewer costs a ~1.5 MB chunk so it stays behind a click, while a picture IS the
	// material and is shown straight away. What this adds is the fourth kind: a version written in
	// the editor, which has no file at all and renders through MathContent like every other piece of
	// content in this app.
	import { m } from '$lib/paraglide/messages.js';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import PdfViewer from '$lib/components/material/PdfViewer.svelte';
	import type { MaterialVersion } from '$lib/types/materialProject';
	import { isPdfUrl, isPictureUrl } from './labels';

	let { version }: { version: MaterialVersion } = $props();

	let showPreview = $state(false);
	let isPdf = $derived(Boolean(version.fileUrl) && isPdfUrl(version.fileUrl));
	let isPicture = $derived(Boolean(version.fileUrl) && isPictureUrl(version.fileUrl));
	// A rejected or withdrawn version keeps its row and loses its blob (house rule 12 — the record
	// of the decision is the point). Saying so is better than a download link that 404s.
	let reclaimed = $derived(version.kind === 'file' && !version.fileUrl);
</script>

<div class="version-view">
	{#if version.description}
		<MathContent source={version.description} />
	{/if}

	{#if reclaimed}
		<p class="hint">{m.coauth_version_noPayload()}</p>
		<!-- "This version carries nothing to show: its file was reclaimed after the decision…" -->
	{:else if version.kind === 'file'}
		<p class="payload">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- our own media server, not an app route -->
			<a class="download" href={version.fileUrl} download>
				{m.coauth_versions_download()}
				<!-- "Download" -->
			</a>
			{#if version.fileName}<span class="file-name">{version.fileName}</span>{/if}
		</p>

		{#if isPdf}
			<div class="preview-head">
				<h3>{m.pdfPreview_heading()}</h3>
				<!-- "In-browser preview" -->
				<button type="button" class="toggle" onclick={() => (showPreview = !showPreview)}>
					{showPreview ? m.pdfPreview_hide() : m.pdfPreview_show()}
					<!-- "Hide preview" / "Show preview" -->
				</button>
			</div>
			{#if showPreview}
				<PdfViewer url={version.fileUrl} />
			{/if}
		{:else if isPicture}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- our own media server, not an app route -->
			<a href={version.fileUrl} target="_blank" rel="noopener noreferrer">
				<!-- "Open the full-size picture" -->
				<img
					src={version.fileUrl}
					alt={version.title}
					title={m.picturePreview_openFull()}
					loading="lazy"
				/>
			</a>
		{/if}
	{:else if version.kind === 'link'}
		<p class="payload">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- somebody else's site, not an app route -->
			<a class="download" href={version.url} target="_blank" rel="noopener noreferrer">
				{m.coauth_version_openLink()}
				<!-- "Open the link" -->
			</a>
			<span class="file-name">{version.url}</span>
		</p>
	{:else if version.body}
		<div class="body"><MathContent source={version.body} /></div>
	{/if}

	{#if version.scanStatus === 'flagged'}
		<p class="flagged">
			{m.coauth_scan_flagged()}
			<!-- "The scanner flagged this file." -->
			{#if version.scanDetail}<span class="detail">{version.scanDetail}</span>{/if}
		</p>
	{:else if version.scanStatus === 'skipped' && version.kind === 'file' && version.fileUrl}
		<p class="hint">{m.coauth_scan_skipped()}</p>
		<!-- "This file was not scanned — no scanner was available." -->
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.version-view {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.payload {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin: 0;
	}
	.download {
		@include mix.button-secondary;
		display: inline-block;
		padding: var(--space-1) var(--space-3);
		text-decoration: none;
	}
	.file-name {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.preview-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);

		h3 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	.toggle {
		@include mix.focus-ring;
		font: inherit;
		font-size: var(--font-size-xs);
		font-weight: 600;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
	}
	img {
		display: block;
		max-width: 100%;
		// Bounded in both directions, the same reasoning the material page's own picture preview
		// states: a tall scan would otherwise push everything below it off a phone screen.
		max-height: 80vh;
		width: auto;
		height: auto;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		// A re-encoded WebP keeps its alpha, and a diagram scanned as white-on-transparent is
		// invisible against the dark theme without this.
		background: #ffffff;
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.flagged {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
	.detail {
		font-size: var(--font-size-xs);
	}
</style>
