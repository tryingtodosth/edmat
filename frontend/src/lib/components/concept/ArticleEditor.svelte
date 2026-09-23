<script lang="ts" module>
	import type { ConceptRevisionStatus } from '$lib/types/concept';

	/** What the editor tells its route once a write has landed. Deliberately thin: the route
	 *  decides where to go next, and the editor keeps the sentence about what happened. */
	export interface ArticleEditorOutcome {
		slug: string;
		articleId: string | null;
		/** The revision's state afterwards, where the answer says one — `published` when it went
		 *  live, `pending` when a person reads it first, `draft` when nothing was submitted. */
		status: ConceptRevisionStatus | null;
	}
</script>

<script lang="ts">
	/**
	 * Writing an article: the one form behind "start a concept", "write your own article" and
	 * "improve this one". Three modes, one set of fields, because they are the same act with
	 * different permissions — a second form would be a second set of rules to keep in step (the
	 * `VersionEditor` precedent).
	 *
	 *   create — no concept exists yet: branches and tags are collected here too, and the whole
	 *            thing (concept + article + revision 1) goes in one request.
	 *   write  — a new article for an existing concept, a PEER of whatever is already on that
	 *            (audience, locale) page. Not a fight over somebody else's text.
	 *   edit   — a revision of an article, yours or anybody else's. The audience and the language
	 *            are fixed: they are the article's identity, not this revision's.
	 *
	 * Two refusals have whole dialogues rather than a line, because each has an action attached:
	 * 409 `stale` means somebody published while this was being written (reload, read what changed,
	 * redo the change on top — the turn-based rule, CONCEPTS-BRIEF.md §0), and 409 `draft_exists`
	 * means you already have an unfinished revision here, which is an invitation to open it.
	 *
	 * The notice above the buttons is factual and deliberately carries no licence text: LEGAL.md §2
	 * says to check before any new licensing wording, and "public, attributed, may be improved by
	 * others" is true today regardless of what that wording turns out to be.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import AudienceSelect from '$lib/components/shared/AudienceSelect.svelte';
	import TaxonomyOptions from '$lib/components/shared/TaxonomyOptions.svelte';
	import { contentLocalesStore, SUPPORTED_CONTENT_LOCALES } from '$lib/state/contentLocales.svelte';
	import {
		createArticle,
		createConcept,
		createRevision,
		DraftExistsError,
		saveDraft,
		StaleRevisionError,
		submitRevision
	} from '$lib/services/concepts';
	import type { Branch } from '$lib/types';
	import type { Audience } from '$lib/types/audience';
	import type {
		ConceptBlock,
		ConceptRevision,
		ConceptRevisionDraft,
		ConceptRevisionSummary
	} from '$lib/types/concept';
	import BlockEditor from './BlockEditor.svelte';
	import { messageForError } from './labels';

	let {
		mode,
		slug = '',
		articleId = '',
		branches = [],
		initial = null,
		draftId = '',
		basedOnId = '',
		audience: initialAudience = '',
		locale: initialLocale = '',
		willPublish = false,
		onsaved = undefined,
		onopendraft = undefined,
		headingLevel = 2
	}: {
		mode: 'create' | 'write' | 'edit';
		/** Required in `write` and `edit`. */
		slug?: string;
		/** Required in `edit`. */
		articleId?: string;
		/** `create` only: every branch this concept could be filed under. */
		branches?: Branch[];
		/** Prefill — the head, or the historical revision `?revision=` named. */
		initial?: ConceptRevision | null;
		/** `edit` only: continue this existing draft instead of starting a new revision. */
		draftId?: string;
		/** `edit` only: the head this revision is written against. */
		basedOnId?: string;
		audience?: Audience | '';
		locale?: string;
		/** Whether a submit here publishes outright. Changes what the button says, nothing else —
		 *  the server decides, and answers with the status it actually chose. */
		willPublish?: boolean;
		onsaved?: (outcome: ArticleEditorOutcome) => void;
		/** Somebody already has an unfinished revision of this article: here it is. */
		onopendraft?: (draft: ConceptRevisionSummary) => void;
		/** `h2` when this sits straight under the page's `h1` (axe `heading-order`: a level may
		 *  not be skipped). */
		headingLevel?: 2 | 3;
	} = $props();

	// Seeded once from the props, deliberately: this form is mounted fresh each time it opens, so
	// what is wanted is the value at that moment, not a live link back to the prop that would
	// overwrite whatever has been typed (the `CommentForm`/`VersionEditor` precedent).
	// svelte-ignore state_referenced_locally
	let title = $state(initial?.title ?? '');
	// svelte-ignore state_referenced_locally
	let summary = $state(initial?.summary ?? '');
	// svelte-ignore state_referenced_locally
	let audience = $state<Audience | ''>(initialAudience || initial?.audience || '');
	// svelte-ignore state_referenced_locally
	let locale = $state(initialLocale || initial?.locale || getLocale());
	// A deep copy, so editing a draft never mutates the revision object the page is also rendering.
	// svelte-ignore state_referenced_locally
	let blocks = $state<ConceptBlock[]>(structuredClone($state.snapshot(initial?.blocks ?? [])));
	let changeNote = $state('');

	// `create` only.
	let branchIds = $state<string[]>([]);
	let branchPick = $state('');
	let tagsInput = $state('');

	let saving = $state(false);
	let error = $state('');
	let notice = $state('');
	/** The head that landed while this was being written — see `StaleRevisionError`. */
	let staleHead = $state<ConceptRevisionSummary | null>(null);
	/** The unfinished revision this author already has here — see `DraftExistsError`. */
	let existingDraft = $state<ConceptRevisionSummary | null>(null);

	/** The article's language and band are its identity, not one revision's: an edit may not move
	 *  an article from `primary` to `university`, because that is a different article. */
	const fixedIdentity = $derived(mode === 'edit');

	/** `en`/`pl` plus whatever extra content languages this reader has opted into, plus the one
	 *  this article is already written in — which may be neither. */
	const localeOptions = $derived([
		...new Set(
			[...SUPPORTED_CONTENT_LOCALES, ...contentLocalesStore.extras, locale].filter(Boolean)
		)
	]);

	const hasContent = $derived(
		blocks.some((block) =>
			block.kind === 'markdown'
				? block.body.trim().length > 0
				: block.kind === 'latex'
					? block.source.trim().length > 0
					: block.kind === 'chem'
						? Boolean(block.drawingId)
						: Boolean(block.assetId)
		)
	);
	const canSubmit = $derived(
		Boolean(title.trim()) && Boolean(audience) && Boolean(locale) && hasContent && !saving
	);

	function addBranch() {
		if (branchPick && !branchIds.includes(branchPick)) branchIds = [...branchIds, branchPick];
		branchPick = '';
	}

	function draftPayload(submit: boolean): ConceptRevisionDraft {
		return {
			title: title.trim(),
			summary: summary.trim(),
			// Snapshotted out of the reactive proxy: what goes over the wire is a plain object.
			blocks: structuredClone($state.snapshot(blocks)) as ConceptBlock[],
			changeNote: changeNote.trim(),
			basedOnId: basedOnId || undefined,
			submit
		};
	}

	async function save(submit: boolean) {
		if (!canSubmit) return;
		saving = true;
		error = '';
		notice = '';
		staleHead = null;
		existingDraft = null;
		try {
			const payload = draftPayload(submit);
			let outcome: ArticleEditorOutcome;

			if (mode === 'create') {
				const concept = await createConcept({
					...payload,
					audience: audience as Audience,
					locale,
					branches: branchIds,
					tags: tagsInput
						.split(',')
						.map((t) => t.trim())
						.filter(Boolean)
				});
				const article = concept.page?.article ?? null;
				outcome = {
					slug: concept.slug,
					articleId: article?.id ?? null,
					status: !submit ? 'draft' : article?.head ? 'published' : 'pending'
				};
			} else if (mode === 'write') {
				const article = await createArticle(slug, {
					...payload,
					audience: audience as Audience,
					locale
				});
				outcome = {
					slug,
					articleId: article.id,
					status: !submit ? 'draft' : article.head ? 'published' : 'pending'
				};
			} else if (draftId) {
				// Continuing a draft started earlier: save it, then submit that same row — two calls
				// rather than one, because PATCHing a draft and deciding to send it are genuinely
				// two acts, and the second one is the one that can come back `stale`.
				let revision = await saveDraft(draftId, payload);
				if (submit) revision = await submitRevision(revision.id);
				outcome = { slug, articleId: articleId || revision.articleId, status: revision.status };
			} else {
				const revision = await createRevision(articleId, payload);
				outcome = { slug, articleId: articleId || revision.articleId, status: revision.status };
			}

			notice =
				outcome.status === 'published'
					? m.concept_editor_published() // "Published."
					: outcome.status === 'pending'
						? m.concept_editor_queued() // "Sent for review — somebody reads it before it goes live."
						: m.concept_editor_savedDraft(); // "Saved as a draft. Nobody else can see it yet."
			changeNote = '';
			onsaved?.(outcome);
		} catch (e) {
			if (e instanceof StaleRevisionError) staleHead = e.head;
			else if (e instanceof DraftExistsError) existingDraft = e.draft;
			else error = messageForError(e);
		} finally {
			saving = false;
		}
	}
</script>

<section class="editor">
	<svelte:element this={`h${headingLevel}`}>
		{mode === 'create'
			? m.concept_editor_heading_create() // "A new concept"
			: mode === 'write'
				? m.concept_editor_heading_write() // "Write your own article"
				: m.concept_editor_heading_edit()}
		<!-- "Improve this article" -->
	</svelte:element>

	<p class="public-notice">{m.concept_publicNotice()}</p>
	<!-- "What you write here is public, attributed to you, and may be improved by others." -->

	<label class="field">
		<span>{m.concept_field_title()}</span>
		<!-- "Title" -->
		<input type="text" bind:value={title} maxlength="300" required />
		{#if mode === 'create'}
			<span class="hint">{m.concept_field_titleHint()}</span>
			<!-- "The address of this concept is made from the first title and never changes afterwards." -->
		{/if}
	</label>

	<label class="field">
		<span>{m.concept_field_summary()} <em>({m.common_optional()})</em></span>
		<!-- "Summary" / "optional" -->
		<textarea rows="2" maxlength="500" bind:value={summary}></textarea>
		<span class="hint">{m.concept_field_summaryHint()}</span>
		<!-- "One or two plain sentences. This is what cards, search and the review queue show." -->
	</label>

	<div class="field-row">
		{#if fixedIdentity}
			<p class="fixed">
				{m.concept_editor_fixedIdentity()}
				<!-- "This article's audience and language are fixed — an article written for someone else is a different article." -->
			</p>
		{:else}
			<AudienceSelect bind:value={audience} />
			<label class="field">
				<span>{m.concept_field_language()}</span>
				<!-- "Language of this article" -->
				<select bind:value={locale}>
					{#each localeOptions as option (option)}
						<option value={option}>{option.toUpperCase()}</option>
					{/each}
				</select>
			</label>
		{/if}
	</div>

	{#if mode === 'create'}
		<div class="field">
			<span>{m.concept_field_branches()} <em>({m.common_optional()})</em></span>
			<!-- "Subjects this belongs to" / "optional" -->
			{#if branchIds.length > 0}
				<ul class="chip-list">
					{#each branchIds as id (id)}
						<li>
							<span>{branches.find((b) => b.id === id)?.name ?? id}</span>
							<button
								type="button"
								aria-label={m.common_remove()}
								onclick={() => (branchIds = branchIds.filter((b) => b !== id))}>&times;</button
							>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="picker">
				<select bind:value={branchPick} aria-label={m.concept_field_branches()}>
					<option value="">{m.concept_field_branchChoose()}</option>
					<!-- "Choose a subject…" -->
					<TaxonomyOptions nodes={branches} />
				</select>
				<button type="button" class="ghost" disabled={!branchPick} onclick={addBranch}>
					{m.common_add()}
					<!-- "Add" -->
				</button>
			</div>
			<span class="hint">{m.concept_field_branchesHint()}</span>
			<!-- "Subjects decide who can review articles here, and where the concept is browsable from." -->
		</div>

		<label class="field">
			<span>{m.submit_field_tags()}</span>
			<!-- "Tags" — the same comma-separated box /submit has. -->
			<input type="text" bind:value={tagsInput} />
		</label>
	{/if}

	<div class="field">
		<span>{m.concept_field_content()}</span>
		<!-- "The article" -->
		<BlockEditor bind:blocks />
	</div>

	{#if mode !== 'create'}
		<label class="field">
			<span>{m.concept_field_changeNote()} <em>({m.common_optional()})</em></span>
			<!-- "What changed" / "optional" -->
			<input type="text" bind:value={changeNote} maxlength="500" />
			<span class="hint">{m.concept_field_changeNoteHint()}</span>
			<!-- "One line. Whoever decides on this reads it first." -->
		</label>
	{/if}

	{#if staleHead}
		<div class="stale">
			<p>{m.concept_editor_stale({ number: staleHead.number })}</p>
			<!-- "Somebody published revision {number} while you were writing." -->
			<p>{m.concept_editor_staleHead({ title: staleHead.title })}</p>
			<!-- "The current one is “{title}”." -->
			<p>{m.concept_editor_staleReload()}</p>
			<!-- "Reload the page, read what changed, and make your change on top of it." -->
			<button type="button" class="ghost" onclick={() => location.reload()}>
				{m.concept_editor_reload()}
				<!-- "Reload" -->
			</button>
		</div>
	{/if}

	{#if existingDraft}
		<div class="stale">
			<p>{m.concept_editor_draftExists()}</p>
			<!-- "You already have an unfinished revision of this article." -->
			{#if onopendraft}
				{@const draft = existingDraft}
				<button type="button" class="ghost" onclick={() => onopendraft(draft)}>
					{m.concept_editor_openDraft()}
					<!-- "Open it" -->
				</button>
			{/if}
		</div>
	{/if}

	{#if error}<p class="error">{error}</p>{/if}
	{#if notice}<p class="notice">{notice}</p>{/if}

	<div class="actions">
		<button type="button" class="secondary" disabled={!canSubmit} onclick={() => save(false)}>
			{m.concept_editor_saveDraft()}
			<!-- "Save draft" -->
		</button>
		<button type="button" class="primary" disabled={!canSubmit} onclick={() => save(true)}>
			{willPublish
				? m.concept_editor_publish() // "Publish"
				: m.concept_editor_submit()}
			<!-- "Send for review" -->
		</button>
	</div>
	{#if !willPublish}
		<p class="hint">{m.concept_editor_reviewHint()}</p>
		<!-- "Somebody reads what you send before it goes live." -->
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

		h2,
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
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);

		input[type='text'],
		textarea,
		select {
			@include mix.focus-ring;
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.field-row {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		align-items: flex-end;
	}
	.fixed,
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.picker {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;

		select {
			@include mix.focus-ring;
			font: inherit;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.chip-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;

		li {
			display: inline-flex;
			align-items: center;
			gap: var(--space-1);
			padding: 2px var(--space-2);
			border-radius: 999px;
			background: var(--bg-surface-alt);
			font-size: var(--font-size-xs);
		}
		button {
			border: 0;
			background: none;
			color: var(--text-secondary);
			cursor: pointer;
			font: inherit;
		}
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
