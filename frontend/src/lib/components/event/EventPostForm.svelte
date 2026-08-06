<script lang="ts">
	// Writing an update, and editing one. Shared by both for `EventForm`'s own reason: two copies
	// drift the moment one gains a field.
	//
	// The three inputs are deliberately in the order a person composes in — words, then the picture,
	// then the links — rather than in the order the API lists them. Somebody posting "we are running
	// twenty minutes late" is done after the first field, and every field below it should be
	// skippable without looking at it.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import type { EventPost, EventPostDraft } from '$lib/types/event';

	let {
		initial = null,
		submitting = false,
		error = '',
		submitLabel,
		onsubmit,
		oncancel = null
	}: {
		initial?: EventPost | null;
		submitting?: boolean;
		error?: string;
		submitLabel: string;
		onsubmit: (draft: EventPostDraft) => void;
		/** Absent when composing (there is nothing to go back to), present when editing. */
		oncancel?: (() => void) | null;
	} = $props();

	let body = $state(untrack(() => initial?.body ?? ''));
	// One blank row to start, so the first link needs no "add" click. Kept as an array of strings
	// rather than one textarea: a row per link makes it obvious that they are separate things, and
	// makes removing the middle one a click instead of a careful selection.
	let links = $state<string[]>(untrack(() => [...(initial?.links ?? []), '']));

	// Three states, not two, and they are genuinely different on an EDIT:
	//   `undefined` — untouched, leave whatever is stored
	//   `null`      — remove the stored picture
	//   `File`      — replace it
	// The service layer maps exactly these onto the backend's own absent/null/file distinction.
	let image = $state<File | null | undefined>(undefined);
	// A local object URL for the newly chosen file; the stored one already has a real URL.
	let pickedPreview = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);

	let shownImage = $derived(
		image instanceof File ? pickedPreview : image === null ? '' : (initial?.imageUrl ?? '')
	);

	function pickImage(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		// Revoked before being replaced — an object URL pins the whole file in memory until it is,
		// and somebody trying three photos in a row would pin all three.
		if (pickedPreview) URL.revokeObjectURL(pickedPreview);
		pickedPreview = URL.createObjectURL(file);
		image = file;
	}

	function dropImage() {
		if (pickedPreview) URL.revokeObjectURL(pickedPreview);
		pickedPreview = '';
		// `null` rather than `undefined`: this is an instruction to remove, which on an edit has to be
		// told apart from never having touched the field.
		image = null;
		// The input keeps its old value otherwise, so re-picking the same file would fire no `change`
		// event and the removal would look stuck.
		if (fileInput) fileInput.value = '';
	}

	function setLink(index: number, value: string) {
		links[index] = value;
		// Grow a fresh row as soon as the last one is used, so adding several never needs a button.
		if (index === links.length - 1 && value.trim()) links.push('');
	}

	function removeLink(index: number) {
		links.splice(index, 1);
		if (links.length === 0) links.push('');
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const draft: EventPostDraft = {
			body,
			// Blank rows are the scaffolding above, not something the host typed — dropped here rather
			// than sent for the server to ignore.
			links: links.map((l) => l.trim()).filter(Boolean)
		};
		// Only ever sent when it is actually an instruction; see the three states above.
		if (image !== undefined) draft.image = image;
		onsubmit(draft);
	}
</script>

<form onsubmit={submit}>
	<label class="field">
		<span>{m.eventPosts_form_body()}</span>
		<textarea bind:value={body} rows="3" placeholder={m.eventPosts_form_bodyPlaceholder()}
		></textarea>
	</label>

	<div class="field">
		<span>{m.eventPosts_form_image()}</span>
		{#if shownImage}
			<div class="preview">
				<img src={shownImage} alt="" />
				<button type="button" class="link-button" onclick={dropImage}>
					{m.eventPosts_form_removeImage()}
				</button>
			</div>
		{/if}
		<input
			bind:this={fileInput}
			type="file"
			accept="image/png,image/jpeg,image/webp"
			onchange={pickImage}
		/>
		<small>{m.eventPosts_form_imageHint()}</small>
	</div>

	<fieldset class="links">
		<legend>{m.eventPosts_form_links()}</legend>
		{#each links as link, index (index)}
			<div class="link-row">
				<input
					type="url"
					value={link}
					placeholder="https://"
					oninput={(e) => setLink(index, (e.target as HTMLInputElement).value)}
				/>
				{#if links.length > 1}
					<button
						type="button"
						class="link-button"
						onclick={() => removeLink(index)}
						aria-label={m.eventPosts_form_removeLink()}
					>
						×
					</button>
				{/if}
			</div>
		{/each}
		<small>{m.eventPosts_form_linksHint()}</small>
	</fieldset>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	<div class="actions">
		<button type="submit" class="submit" disabled={submitting}>
			{submitting ? m.common_loading() : submitLabel}
		</button>
		{#if oncancel}
			<button type="button" class="cancel" onclick={oncancel} disabled={submitting}>
				{m.common_cancel()}
			</button>
		{/if}
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		span {
			font-size: var(--font-size-sm);
			font-weight: 600;
		}
	}
	small {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	input,
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font: inherit;
	}
	.preview {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		img {
			max-width: 100%;
			// Bounded so a tall photo cannot push the submit button off the screen — the composer has
			// to stay usable while the picture is being judged.
			max-height: 14rem;
			border-radius: var(--radius-sm);
			border: 1px solid var(--border-color);
		}
	}
	.links {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
		legend {
			font-size: var(--font-size-sm);
			font-weight: 600;
			padding: 0 var(--space-1);
		}
	}
	.link-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		input {
			flex: 1 1 auto;
			min-width: 0;
		}
	}
	.link-button {
		@include mix.focus-ring;
		background: none;
		border: none;
		padding: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		cursor: pointer;
		text-decoration: underline;
	}
	.error {
		color: var(--status-danger, #c0392b);
		font-size: var(--font-size-sm);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.submit {
		@include mix.button-primary;
	}
	.cancel {
		@include mix.button-secondary;
	}
</style>
