<script lang="ts">
	// Writing a version: the one form behind "start a material", "save a new version" and "improve
	// this material". Three modes, one set of fields, because they are the same act with different
	// permissions — a second form would be a second set of rules to keep in step.
	//
	//   create  — the project does not exist yet, so the PARENT owns the request (it has to create
	//             the project and this version in one call). The editor only collects; `collect()`
	//             is what the page asks for when its own submit button is pressed.
	//   draft   — a co-author saving. Save draft, and Publish when the server says they may.
	//   propose — anybody else. One button, and what comes back is waiting for a person.
	//
	// The notice above the buttons is factual and deliberately carries no licence text: LEGAL.md §2
	// says to check with Piotr before any new licensing wording, and "public, attributed, may be
	// improved by others" is true today regardless of what that wording turns out to be.
	import { m } from '$lib/paraglide/messages.js';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import RichEditor from '$lib/components/editor/RichEditor.svelte';
	import InsertStrip from '$lib/components/editor/InsertStrip.svelte';
	import { publishVersion, saveVersion, StaleVersionError } from '$lib/services/materialProjects';
	import type {
		MaterialVersion,
		MaterialVersionKind,
		MaterialVersionSummary,
		VersionDraft
	} from '$lib/types/materialProject';
	import { messageForError, VERSION_KIND_LABELS } from './labels';

	let {
		mode,
		projectId = '',
		basedOn = null,
		initial = null,
		canPublish = false,
		busy = false,
		onsaved = undefined,
		oncancel = undefined,
		headingLevel = 3
	}: {
		mode: 'create' | 'draft' | 'propose';
		/** Required in `draft`/`propose`; ignored in `create`, where no project exists yet. */
		projectId?: string;
		/** The version this one is written against — the head. */
		basedOn?: MaterialVersionSummary | MaterialVersion | null;
		/** Prefill, so improving something does not mean retyping it. */
		initial?: MaterialVersion | null;
		canPublish?: boolean;
		/** `create` only: the parent's request is in flight. */
		busy?: boolean;
		onsaved?: (version: MaterialVersion) => void;
		oncancel?: () => void;
		/** `h2` when this sits straight under the page's `h1`; `h3` inside a section (axe
		 * `heading-order`: a level may not be skipped). */
		headingLevel?: 2 | 3;
	} = $props();

	const KINDS: MaterialVersionKind[] = ['file', 'link', 'body'];
	// Same picker hint the material submission form uses; the real check is server-side either way
	// (the bytes are sniffed and re-encoded, house rule 7).
	const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.webp,.tex,.doc,.docx,.odt';

	// Seeded once from `initial`, deliberately: this form is mounted fresh each time it opens, so
	// what is wanted is the value at that moment, not a live link back to the prop that would
	// overwrite whatever has been typed (the CommentForm precedent).
	// svelte-ignore state_referenced_locally
	let kind = $state<MaterialVersionKind>(initial?.kind ?? 'file');
	// svelte-ignore state_referenced_locally
	let title = $state(initial?.title ?? '');
	// svelte-ignore state_referenced_locally
	let description = $state(initial?.description ?? '');
	// svelte-ignore state_referenced_locally
	let url = $state(initial?.url ?? '');
	// svelte-ignore state_referenced_locally
	let body = $state(initial?.body ?? '');
	let changeNote = $state('');
	let file = $state<File | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let editorRef = $state<RichEditor | null>(null);
	let strip = $state<InsertStrip | null>(null);

	let showPreview = $state(false);
	let saving = $state(false);
	let error = $state('');
	let notice = $state('');
	/** The head that landed while this was being written — see `StaleVersionError`. */
	let staleHead = $state<MaterialVersionSummary | null>(null);

	let working = $derived(saving || busy);

	function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		file = input.files?.[0] ?? null;
	}

	/** The backend field is a real `URLField`, which refuses a bare `example.edu/notes.pdf`.
	 *  Somebody typing a link by hand very reasonably omits the scheme (the submit-material form
	 *  makes the same repair rather than bouncing the whole thing over it). */
	function normalizeUrl(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) return '';
		return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	}

	/** A version needs a title and exactly one payload. Checked here so the button is honest,
	 *  rather than the refusal arriving after a round trip. */
	// A `file` version always needs a NEW file, even when this form was prefilled from one: the old
	// blob belongs to the old version, and a version row carries exactly one payload of its own.
	let hasPayload = $derived(
		kind === 'file' ? Boolean(file) : kind === 'link' ? Boolean(url.trim()) : Boolean(body.trim())
	);
	let canSubmit = $derived(Boolean(title.trim()) && hasPayload && !working);

	/**
	 * What this form currently holds, or null when it is not ready (and then `error` says why).
	 * Exported for `create` mode, where the page submits the catalogue and this payload together.
	 */
	export function collect(): { draft: VersionDraft; file: File | null } | null {
		error = '';
		if (!title.trim()) return null;
		if (!hasPayload) {
			error = m.coauth_editor_needPayload(); // "Add a file, a link or some text first."
			return null;
		}
		return {
			draft: {
				kind,
				title: title.trim(),
				description: description.trim(),
				url: kind === 'link' ? normalizeUrl(url) : '',
				body: kind === 'body' ? body : '',
				changeNote: changeNote.trim(),
				basedOnId: basedOn?.id
			},
			file
		};
	}

	/** Clears what should not survive a save. The title and the payload stay: saving again is
	 *  normally a correction to the same thing, not a fresh start. */
	function resetAfterSave() {
		changeNote = '';
		file = null;
		if (fileInput) fileInput.value = '';
	}

	async function save(thenPublish: boolean) {
		const collected = collect();
		if (!collected) return;
		saving = true;
		error = '';
		notice = '';
		staleHead = null;
		try {
			let version = await saveVersion(projectId, collected.draft, collected.file);
			if (thenPublish) version = await publishVersion(version.id);
			// A first publication that needs review comes back `proposed`, not `published` — read
			// what happened rather than assuming the button did what it says.
			notice =
				version.status === 'published'
					? m.coauth_editor_published({ number: version.number }) // "Published as version {number}."
					: version.status === 'proposed' && thenPublish
						? m.coauth_editor_queued() // "Sent to the moderators — a first publication is read by a person…"
						: version.status === 'proposed'
							? m.coauth_editor_proposed({ number: version.number }) // "Sent as version {number}. A co-author decides on it."
							: m.coauth_editor_savedDraft({ number: version.number }); // "Saved as version {number}."
			resetAfterSave();
			onsaved?.(version);
		} catch (e) {
			if (e instanceof StaleVersionError) {
				staleHead = e.head;
			} else {
				error = messageForError(e);
			}
		} finally {
			saving = false;
		}
	}
</script>

<section class="editor">
	<svelte:element this={`h${headingLevel}`}>
		{mode === 'create'
			? m.coauth_editor_heading_create() // "The first version"
			: mode === 'propose'
				? m.coauth_editor_heading_propose() // "Propose a change"
				: m.coauth_editor_heading_draft()}
		<!-- "Save a new version" -->
	</svelte:element>

	<p class="public-notice">{m.coauth_publicNotice()}</p>
	<!-- "What you publish here is public, attributed to you, and may be improved by others." -->

	<fieldset class="kinds">
		<legend>{m.coauth_editor_kind()}</legend>
		<!-- "What is this version?" -->
		{#each KINDS as option (option)}
			<label class="kind-option">
				<input type="radio" name="version-kind" value={option} bind:group={kind} />
				<span>{VERSION_KIND_LABELS[option]()}</span>
			</label>
		{/each}
		<p class="hint">{m.coauth_editor_kindHint()}</p>
		<!-- "A file to download, a link to where it already lives, or text written here." -->
	</fieldset>

	<label class="field">
		<span>{m.submitMaterial_field_title()}</span>
		<!-- "Title" -->
		<input type="text" bind:value={title} maxlength="300" required />
	</label>

	<label class="field">
		<span>{m.submitMaterial_field_description()} <em>({m.common_optional()})</em></span>
		<!-- "Description" / "optional" -->
		<textarea rows="3" bind:value={description}></textarea>
	</label>

	{#if kind === 'file'}
		<label class="field">
			<span>{m.submitMaterial_field_file()}</span>
			<!-- "File" -->
			<input
				bind:this={fileInput}
				type="file"
				accept={ACCEPTED_EXTENSIONS}
				onchange={handleFileChange}
			/>
			<span class="hint">{m.submitMaterial_fileHint()}</span>
			<!-- "PDF, PNG, JPEG, .tex, .doc, .docx, or .odt." -->
			{#if file}<span class="picked">{file.name}</span>{/if}
		</label>
	{:else if kind === 'link'}
		<label class="field">
			<span>{m.submitMaterial_field_url()}</span>
			<!-- "Link to the material" -->
			<!-- `type="text"` with a url inputmode, not `type="url"`: native validation refuses a
			     perfectly reasonable `example.edu/notes.pdf` typed without a scheme, which
			     `normalizeUrl` repairs instead. -->
			<!-- "example.edu/notes.pdf" -->
			<input
				type="text"
				inputmode="url"
				bind:value={url}
				maxlength="500"
				placeholder={m.submitMaterial_urlPlaceholder()}
			/>
			<span class="hint">{m.submitMaterial_urlHint()}</span>
			<!-- "For something you should not re-host — a recording, a department page…" -->
		</label>
	{:else}
		<div class="field">
			<span>{m.coauth_kind_body()}</span>
			<!-- "Written here" -->
			<!-- "Write the material here. LaTeX between \( … \) is typeset." -->
			<RichEditor
				bind:this={editorRef}
				bind:value={body}
				rows={10}
				placeholder={m.coauth_editor_bodyPlaceholder()}
				onChemEdit={(id) => strip?.editChem(id)}
			/>
			<!-- No file picker on the strip: a file belongs in a `file` version, where it is scanned,
			     size-capped and counted against the quota. Pictures still go into the body itself. -->
			<InsertStrip bind:this={strip} editor={editorRef} allowFiles={false} />
			<button type="button" class="ghost" onclick={() => (showPreview = !showPreview)}>
				{showPreview ? m.entry_hidePreview() : m.entry_showPreview()}
				<!-- "Hide preview" / "Show preview" -->
			</button>
			{#if showPreview && body.trim()}
				<div class="preview"><MathContent source={body} /></div>
			{/if}
		</div>
	{/if}

	{#if mode !== 'create'}
		<label class="field">
			<span>{m.coauth_editor_changeNote()} <em>({m.common_optional()})</em></span>
			<!-- "What changed" / "optional" -->
			<input type="text" bind:value={changeNote} maxlength="500" />
			<span class="hint">{m.coauth_editor_changeNoteHint()}</span>
			<!-- "One line. Whoever decides on this reads it first." -->
		</label>
	{/if}

	{#if staleHead}
		<div class="stale">
			<p>{m.coauth_editor_stale({ number: staleHead.number })}</p>
			<!-- "Somebody saved version {number} while you were writing." -->
			<p>{m.coauth_editor_staleHead({ title: staleHead.title })}</p>
			<!-- "The current version is “{title}”." -->
			<p>{m.coauth_editor_staleReload()}</p>
			<!-- "Reload the page, read what changed, and make your change on top of it." -->
			<button type="button" class="ghost" onclick={() => location.reload()}>
				{m.coauth_editor_reload()}
				<!-- "Reload" -->
			</button>
		</div>
	{/if}

	{#if error}<p class="error">{error}</p>{/if}
	{#if notice}<p class="notice">{notice}</p>{/if}

	{#if mode !== 'create'}
		<div class="actions">
			{#if oncancel}
				<button type="button" class="ghost" onclick={oncancel}>{m.common_cancel()}</button>
				<!-- "Cancel" -->
			{/if}
			{#if mode === 'propose'}
				<button type="button" class="primary" disabled={!canSubmit} onclick={() => save(false)}>
					{m.coauth_editor_propose()}
					<!-- "Propose" -->
				</button>
			{:else}
				<button type="button" class="secondary" disabled={!canSubmit} onclick={() => save(false)}>
					{m.coauth_editor_saveDraft()}
					<!-- "Save draft" -->
				</button>
				{#if canPublish}
					<button type="button" class="primary" disabled={!canSubmit} onclick={() => save(true)}>
						{m.coauth_editor_publish()}
						<!-- "Publish" -->
					</button>
				{/if}
			{/if}
		</div>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.editor {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);

		h3 {
			margin: 0;
			font-size: var(--font-size-md);
		}
	}
	.public-notice {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
		margin: 0;
		white-space: normal;
	}
	.kinds {
		border: none;
		margin: 0;
		padding: 0;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;

		legend {
			padding: 0;
			font-size: var(--font-size-sm);
			font-weight: 600;
		}
	}
	.kind-option {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);

		input[type='text'],
		textarea {
			@include mix.focus-ring;
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.hint,
	.picked {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.preview {
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-3);
	}
	.stale {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		white-space: normal;

		p {
			margin: 0;
		}
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.primary {
		@include mix.button-primary;
		min-height: 44px;
		padding: var(--space-2) var(--space-4);
	}
	.secondary,
	.ghost {
		@include mix.button-secondary;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
		align-self: flex-start;
	}
</style>
