<script lang="ts">
	/**
	 * The ways into a comment, side by side (asked for as "different abilities to input a
	 * comment: .md, .json, latex, ketcher, chemdoodle, PDF, image"). Each is an INSERT into the one
	 * body the `RichEditor` beside it already owns, or a file beside it — never a second storage
	 * shape:
	 *
	 * - Markdown file — read into the body as text (the body IS Markdown).
	 * - LaTeX — a displayed equation, previewed live, inserted through the editor's maths node.
	 * - JSON — pasted or picked, validated and pretty-printed, inserted as a fenced code block.
	 * - Sketch — a freehand drawing made with the mouse on a FULLSCREEN board (Excalidraw, MIT),
	 *   saved through `/sketches/` and inserted as the `<img data-sketch>` the server hands back;
	 *   clicking it later reopens it, exactly like a chemistry drawing. Asked for as "pisanie jak
	 *   na Zoom" — a picture you draw rather than one you upload. Because this strip is mounted on
	 *   comments, co-authoring versions and concept markdown blocks, that one button puts a
	 *   whiteboard on all three.
	 * - Chemistry — a structure or reaction drawn in a modal, saved through `/chem-drawings/` and
	 *   inserted as the `<img data-chem>` the server hands back; clicking it later reopens it. The
	 *   button says what it makes, not which editor makes it; Ketcher is named in the modal's own
	 *   licence line, which is where the Apache 2.0 attribution has to be anyway.
	 *   (ChemDoodle was the second editor here for one afternoon; dropped as GPLv3 in an MIT repo.)
	 * - Picture — uploaded on the spot through `/inline-images/` and inserted INTO the body, so a
	 *   comment can mix words and pictures and be a small illustrated article. It used to hand the
	 *   file to the caller instead, to be uploaded as an attachment once the comment existed —
	 *   which put the picture in a row underneath the sentence that was about it.
	 * - PDF — the attachment picker (§17AR). An attachment is a document now, and only a document.
	 *
	 * The strip never touches storage directly: everything goes through the editor instance the
	 * caller binds in (`editor`), or back to the caller as files (`onFiles`).
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import type RichEditor from './RichEditor.svelte';
	import type { ChemDrawing } from '$lib/types/chem';
	import { getChemDrawing } from '$lib/services/chem';
	import type { Sketch } from '$lib/types/sketch';
	import { getSketch } from '$lib/services/sketches';
	import { uploadInlineImage } from '$lib/services/inlineImages';
	import { ApiError } from '$lib/api/client';

	let {
		editor,
		// Offers the PDF attachment picker. Pictures deliberately do NOT sit behind this: they go
		// into the body, so they make sense wherever this strip does — including an edit box, which
		// has no new comment for an attachment to hang off.
		allowFiles = false,
		onFiles
	}: {
		editor: RichEditor | null;
		allowFiles?: boolean;
		onFiles?: (files: File[]) => void;
	} = $props();

	const chemistryOn = $derived(featureFlagsStore.isEnabled('chemistry') || authStore.isModerator);
	const sketchesOn = $derived(featureFlagsStore.isEnabled('sketches') || authStore.isModerator);

	type Panel = 'latex' | 'json' | 'image' | null;
	let panel = $state<Panel>(null);
	let latex = $state('');
	let json = $state('');
	let jsonError = $state('');
	let fileError = $state('');

	// A picture is uploaded when Insert is pressed, not when it is picked: the description is part
	// of the upload, and picking a file by mistake should cost nothing.
	const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
	let imageFile = $state<File | null>(null);
	let imagePreview = $state('');
	let imageAlt = $state('');
	let imageBusy = $state(false);
	let imageError = $state('');

	// The chemistry modal is fetched on first use — it drags the whole editor stack behind it.
	let chemOpen = $state(false);
	let chemExisting = $state<ChemDrawing | null>(null);

	// The whiteboard is fetched on first use for the same reason: Excalidraw (and React with it)
	// is a chunk nobody who does not draw should ever download.
	let sketchOpen = $state(false);
	let sketchExisting = $state<Sketch | null>(null);

	function toggle(next: Panel) {
		panel = panel === next ? null : next;
	}

	function insertLatex() {
		const src = latex.trim();
		if (!src) return;
		editor?.insertMath(src, true);
		latex = '';
		panel = null;
	}

	function insertJson() {
		jsonError = '';
		const raw = json.trim();
		if (!raw) return;
		let pretty: string;
		try {
			pretty = JSON.stringify(JSON.parse(raw), null, 2);
		} catch (e) {
			jsonError = m.insert_jsonInvalid({ error: e instanceof Error ? e.message : String(e) });
			return;
		}
		editor?.insertCodeBlock(pretty, 'json');
		json = '';
		panel = null;
	}

	/** The preview is an object URL, which is a live handle on a blob: it has to be released by
	 * hand or every picture the person looks at and changes their mind about stays in memory for
	 * the life of the page. */
	function clearImage() {
		if (imagePreview) URL.revokeObjectURL(imagePreview);
		imagePreview = '';
		imageFile = null;
		imageAlt = '';
		imageError = '';
	}

	function pickImage(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const chosen = input.files?.[0];
		input.value = '';
		if (!chosen) return;
		clearImage();
		if (chosen.size > MAX_IMAGE_BYTES) {
			imageError = m.insert_imageTooBig(); // "A picture can be up to 5 MB."
			panel = 'image';
			return;
		}
		imageFile = chosen;
		imagePreview = URL.createObjectURL(chosen);
		// A filename is a poor description, but it is an honest one and it is never empty — which
		// is what an empty `alt` would be. The person is looking straight at the field.
		imageAlt = chosen.name;
		panel = 'image';
	}

	async function insertImage() {
		if (!imageFile || imageBusy) return;
		imageBusy = true;
		imageError = '';
		try {
			const uploaded = await uploadInlineImage(imageFile, imageAlt.trim());
			// The server's own tag, never one built here: it is the one the sanitizer will accept,
			// and it carries the intrinsic width and height that stop the page jumping.
			editor?.insertHtml(uploaded.embedHtml);
			clearImage();
			panel = null;
		} catch (e) {
			const detail =
				e instanceof ApiError && e.message === 'quota'
					? m.comment_fileTooBig() // "That file is too big."
					: e instanceof Error
						? e.message
						: String(e);
			imageError = m.insert_imageFailed({ error: detail }); // "Could not add the picture: {error}"
		} finally {
			imageBusy = false;
		}
	}

	async function readInto(e: Event, into: 'markdown' | 'json') {
		fileError = '';
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const text = await file.text();
			if (into === 'markdown') editor?.insertText(text);
			else {
				json = text;
				panel = 'json';
			}
		} catch {
			fileError = m.insert_fileUnreadable();
		}
	}

	function pickFiles(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const chosen = Array.from(input.files ?? []);
		input.value = '';
		if (chosen.length) onFiles?.(chosen);
	}

	function openChem() {
		chemExisting = null;
		chemOpen = true;
	}

	/** Reopen the drawing behind a clicked picture (RichEditor's `onChemEdit`). */
	export async function editChem(chemId: string) {
		try {
			const drawing = await getChemDrawing(chemId);
			chemExisting = drawing;
			chemOpen = true;
		} catch {
			/* a picture whose drawing is gone is just a picture */
		}
	}

	function openSketch() {
		sketchExisting = null;
		sketchOpen = true;
	}

	/** Reopen the board behind a clicked picture (RichEditor's `onSketchEdit`). */
	export async function editSketch(sketchId: string) {
		try {
			sketchExisting = await getSketch(sketchId);
			sketchOpen = true;
		} catch {
			/* a picture whose sketch is gone is just a picture */
		}
	}

	function sketchSaved(sketch: Sketch) {
		if (sketchExisting) {
			editor?.replaceSketchImage(sketch.id, sketch.imageUrl, sketch.label);
		} else {
			editor?.insertHtml(sketch.embedHtml);
		}
		sketchOpen = false;
		sketchExisting = null;
	}

	function chemSaved(drawing: ChemDrawing) {
		if (chemExisting) {
			editor?.replaceChemImage(drawing.id, drawing.imageUrl, drawing.label);
		} else {
			editor?.insertHtml(drawing.embedHtml);
		}
		chemOpen = false;
		chemExisting = null;
	}
</script>

<div class="insert-strip">
	<div class="insert-strip__row" role="group" aria-label={m.insert_label()}>
		<span class="insert-strip__label">{m.insert_label()}</span>
		<label class="insert-strip__file">
			<input
				type="file"
				accept=".md,.markdown,.txt,text/markdown"
				onchange={(e) => readInto(e, 'markdown')}
			/>
			<span>{m.insert_markdownFile()}</span>
		</label>
		<button
			type="button"
			class:on={panel === 'latex'}
			aria-pressed={panel === 'latex'}
			onclick={() => toggle('latex')}>{m.insert_latex()}</button
		>
		<button
			type="button"
			class:on={panel === 'json'}
			aria-pressed={panel === 'json'}
			onclick={() => toggle('json')}>{m.insert_json()}</button
		>
		{#if chemistryOn && authStore.isAuthenticated}
			<button type="button" title={m.insert_chemHint()} onclick={openChem}
				>{m.insert_chemistry()}</button
			>
		{/if}
		{#if sketchesOn && authStore.isAuthenticated}
			<button type="button" title={m.insert_sketchHint()} onclick={openSketch}
				>{m.insert_sketch()}</button
			>
			<!-- "Sketch" -->
		{/if}
		{#if authStore.isAuthenticated}
			<label class="insert-strip__file" class:on={panel === 'image'}>
				<input type="file" accept="image/png,image/jpeg,image/webp" onchange={pickImage} />
				<span title={m.insert_imageHint()}>{m.insert_image()}</span>
			</label>
		{/if}
		{#if allowFiles}
			<label class="insert-strip__file">
				<input type="file" accept="application/pdf" multiple onchange={pickFiles} />
				<span>{m.insert_pdf()}</span>
			</label>
		{/if}
	</div>
	{#if fileError}<p class="insert-strip__error" role="alert">{fileError}</p>{/if}

	{#if panel === 'latex'}
		<div class="insert-strip__panel">
			<p class="insert-strip__hint">{m.insert_latexHint()}</p>
			<textarea rows="3" bind:value={latex} placeholder={'\\frac{a}{b}'} spellcheck="false"
			></textarea>
			{#if latex.trim()}
				<div class="insert-strip__preview">
					<span class="insert-strip__hint">{m.insert_preview()}</span>
					<MathContent source={`\\[${latex}\\]`} />
				</div>
			{/if}
			<div class="insert-strip__actions">
				<button type="button" class="primary" disabled={!latex.trim()} onclick={insertLatex}
					>{m.insert_insert()}</button
				>
				<button type="button" onclick={() => (panel = null)}>{m.common_cancel()}</button>
			</div>
		</div>
	{:else if panel === 'image'}
		<div class="insert-strip__panel">
			<p class="insert-strip__hint">{m.insert_imageHint()}</p>
			{#if imagePreview}
				<img class="insert-strip__thumb" src={imagePreview} alt={imageAlt} />
			{/if}
			{#if imageFile}
				<label class="insert-strip__field">
					<span>{m.insert_imageAlt()}</span>
					<input type="text" bind:value={imageAlt} maxlength="300" />
				</label>
				<p class="insert-strip__hint">{m.insert_imageAltHint()}</p>
			{/if}
			{#if imageError}<p class="insert-strip__error" role="alert">{imageError}</p>{/if}
			<div class="insert-strip__actions">
				<button
					type="button"
					class="primary"
					disabled={!imageFile || imageBusy}
					onclick={insertImage}>{imageBusy ? m.insert_imageAdding() : m.insert_insert()}</button
				>
				<button
					type="button"
					onclick={() => {
						clearImage();
						panel = null;
					}}>{m.common_cancel()}</button
				>
			</div>
		</div>
	{:else if panel === 'json'}
		<div class="insert-strip__panel">
			<p class="insert-strip__hint">{m.insert_jsonHint()}</p>
			<textarea rows="5" bind:value={json} placeholder={'{ "x": 1 }'} spellcheck="false"></textarea>
			{#if jsonError}<p class="insert-strip__error" role="alert">{jsonError}</p>{/if}
			<div class="insert-strip__actions">
				<button type="button" class="primary" disabled={!json.trim()} onclick={insertJson}
					>{m.insert_insert()}</button
				>
				<label class="insert-strip__file">
					<input
						type="file"
						accept=".json,application/json"
						onchange={(e) => readInto(e, 'json')}
					/>
					<span>{m.insert_jsonFile()}</span>
				</label>
				<button type="button" onclick={() => (panel = null)}>{m.common_cancel()}</button>
			</div>
		</div>
	{/if}
</div>

{#if chemOpen}
	{#await import('$lib/components/chem/ChemEditorModal.svelte') then { default: ChemEditorModal }}
		<ChemEditorModal
			existing={chemExisting}
			onSaved={chemSaved}
			onClose={() => {
				chemOpen = false;
				chemExisting = null;
			}}
		/>
	{/await}
{/if}

{#if sketchOpen}
	{#await import('$lib/components/sketch/SketchEditorModal.svelte') then { default: SketchEditorModal }}
		<SketchEditorModal
			existing={sketchExisting}
			onSaved={sketchSaved}
			onClose={() => {
				sketchOpen = false;
				sketchExisting = null;
			}}
		/>
	{/await}
{/if}

<style lang="scss">
	.insert-strip {
		display: grid;
		gap: 0.35rem;
		font-size: 0.85rem;
	}
	.insert-strip__row {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.insert-strip__label {
		color: var(--text-secondary);
		margin-right: 0.2rem;
	}
	.insert-strip__row button,
	.insert-strip__file,
	.insert-strip__actions button {
		min-height: 32px;
		padding: 0 0.55rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
	}
	.insert-strip__row button.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.insert-strip__file {
		position: relative;
		input {
			position: absolute;
			width: 1px;
			height: 1px;
			opacity: 0;
		}
		&:focus-within {
			outline: 2px solid var(--accent);
			outline-offset: 1px;
		}
	}
	.insert-strip__panel {
		display: grid;
		gap: 0.4rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface-alt, var(--bg-surface));
	}
	.insert-strip__hint {
		margin: 0;
		color: var(--text-secondary);
	}
	.insert-strip__error {
		margin: 0;
		color: var(--status-danger);
	}
	.insert-strip__file.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.insert-strip__thumb {
		max-width: 100%;
		max-height: 12rem;
		width: auto;
		height: auto;
		border-radius: 6px;
		align-self: start;
	}
	.insert-strip__field {
		display: grid;
		gap: 0.2rem;
		span {
			color: var(--text-secondary);
		}
		input {
			font: inherit;
			font-size: 0.85rem;
			padding: 0.4rem 0.6rem;
			border: 1px solid var(--border);
			border-radius: 6px;
			background: var(--bg-surface);
			color: var(--text-primary);
			box-sizing: border-box;
			width: 100%;
		}
	}
	.insert-strip__preview {
		display: grid;
		gap: 0.2rem;
		padding: 0.3rem 0.5rem;
		background: var(--bg-surface);
		border-radius: 6px;
	}
	.insert-strip__actions {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.insert-strip__actions .primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	textarea {
		font: inherit;
		font-family: monospace;
		font-size: 0.85rem;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		box-sizing: border-box;
	}
</style>
