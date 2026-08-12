<script lang="ts">
	// Offering a material, an exercise, an event, or a course file to a course.
	//
	// It says up front whether the thing will appear immediately or wait for review, because that is
	// the single most useful sentence here: somebody who submits and then cannot find their material
	// assumes it failed. `contributionNeedsApproval` is resolved per viewer server-side, so staff —
	// who never queue behind themselves — correctly see the other message.
	//
	// Corpus content (materials/exercises/events) is REFERENCED by id, never authored here: a course
	// points at content that already exists, so a corrected exercise stays corrected everywhere and a
	// course never becomes a silently diverging fork. Search replaces what used to be a bare numeric
	// id field — there was no picker at all before this, only "copy the id from the item's own page
	// URL" — and a "can't find it? create one" link covers the genuinely-new case without this form
	// growing a second copy of `/submit`'s or `/submit-material`'s own large forms.
	//
	// A course FILE (kind 'attachment') is the one exception: it belongs to this course alone, not
	// the wider corpus, so there is nothing to search — either pick one already uploaded here, or
	// upload a new one right in this form via the same `uploadAttachment` the Files tab already uses.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime';
	import type { Attachment, Course, CourseItemKind } from '$lib/types/course';
	import { searchExercises } from '$lib/services/exercises';
	import { searchMaterials } from '$lib/services/materials';
	import { getEvents } from '$lib/services/events';
	import { createSearchCommitter } from '$lib/utils/textInput';

	// Matches `/submit-material`'s own accept list — a UX hint only, the backend re-validates by
	// sniffed content regardless (`courses/attachmentfile.py`).
	const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.tex,.doc,.docx,.odt';

	let {
		course,
		attachments = [],
		busy = false,
		error = '',
		notice = '',
		onsubmit
	}: {
		course: Course;
		/** This course's own already-uploaded files — already loaded by the page for the Files tab,
		 * passed through rather than fetched a second time here. */
		attachments?: Attachment[];
		busy?: boolean;
		error?: string;
		notice?: string;
		onsubmit?: (input: {
			kind: CourseItemKind;
			id: string;
			/** Set only for a brand-new course file: the caller uploads it first (via
			 * `uploadAttachment`, which is what actually needs `course.id`) and then adds the
			 * resulting id as an ordinary attachment item — that whole sequence has to be one
			 * `act()` on the caller's side so a failed upload never half-adds an item. */
			upload?: { file: File; title: string };
			chapterId: string | null;
			lessonId: string | null;
			note: string;
		}) => void;
	} = $props();

	let kind = $state<CourseItemKind>('material');
	/** `kind:id`, because a chapter and a lesson can share a number and the value has to say which
	 * one it names. Empty means unfiled. */
	let target = $state('');
	let note = $state('');

	// --- picking existing corpus content, by search ------------------------------------------------
	let pickedId = $state('');
	let pickedLabel = $state('');
	let query = $state('');
	let results = $state<{ id: string; label: string }[]>([]);
	let searching = $state(false);
	let committedQuery = $state('');
	const search = createSearchCommitter((q) => (committedQuery = q));

	// --- a course file: pick an existing one, or upload a new one -----------------------------------
	// The initial tab only, read once (`untrack`) rather than kept in step with `attachments` — a
	// curator who has switched to "upload a new file" should not be flipped back to "pick" just
	// because their own upload a moment ago grew that list past zero.
	let attachmentMode = $state<'pick' | 'upload'>(
		untrack(() => (attachments.length > 0 ? 'pick' : 'upload'))
	);
	let pickedAttachmentId = $state('');
	let uploadFile = $state<File | null>(null);
	let uploadTitle = $state('');

	/** What kind of search this is, and where "create a new one instead" should send somebody —
	 * kept as one lookup rather than repeating the same three-way branch at each call site. */
	let searchable = $derived(kind === 'material' || kind === 'exercise' || kind === 'event');
	let createHref = $derived(
		kind === 'material'
			? resolve('/submit-material')
			: kind === 'exercise'
				? resolve('/submit')
				: resolve('/events/new')
	);
	let createLabel = $derived(
		kind === 'material'
			? m.course_contribute_createMaterial()
			: kind === 'exercise'
				? m.course_contribute_createExercise()
				: m.course_contribute_createEvent()
	);

	function switchKind(next: CourseItemKind) {
		kind = next;
		pickedId = '';
		pickedLabel = '';
		query = '';
		results = [];
		committedQuery = '';
		search.adopt('');
		pickedAttachmentId = '';
		uploadFile = null;
		uploadTitle = '';
	}

	function pick(result: { id: string; label: string }) {
		pickedId = result.id;
		pickedLabel = result.label;
		query = '';
		results = [];
		committedQuery = '';
		search.adopt('');
	}

	function clearPick() {
		pickedId = '';
		pickedLabel = '';
	}

	// Runs the actual search whenever the committed query (or which kind it's against) changes. The
	// cancellation flag is what stops a slow, earlier request from overwriting a faster, later one —
	// nothing about the network otherwise orders two in-flight lookups, and `createSearchCommitter`'s
	// own doc comment leaves exactly this to the caller.
	$effect(() => {
		const q = committedQuery;
		const forKind = kind;
		if (!q || !searchable) {
			results = [];
			searching = false;
			return;
		}
		let cancelled = false;
		searching = true;
		(async () => {
			try {
				const raw =
					forKind === 'material'
						? (await searchMaterials(q)).map((x) => ({ id: x.id, label: x.title }))
						: forKind === 'exercise'
							? (await searchExercises(q, getLocale())).map((x) => ({ id: x.id, label: x.title }))
							: (await getEvents({ q })).map((x) => ({ id: x.id, label: x.title }));
				if (cancelled) return;
				results = raw;
			} catch {
				if (!cancelled) results = [];
			} finally {
				if (!cancelled) searching = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	let canSubmit = $derived(
		kind === 'attachment'
			? attachmentMode === 'upload'
				? uploadFile !== null && uploadTitle.trim().length > 0
				: pickedAttachmentId !== ''
			: pickedId !== ''
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		const [targetKind, targetId] = target ? target.split(':') : ['', ''];
		const chapterId = targetKind === 'chapter' ? targetId : null;
		const lessonId = targetKind === 'lesson' ? targetId : null;
		const trimmedNote = note.trim();

		if (kind === 'attachment' && attachmentMode === 'upload') {
			onsubmit?.({
				kind,
				id: '',
				upload: { file: uploadFile as File, title: uploadTitle.trim() },
				chapterId,
				lessonId,
				note: trimmedNote
			});
			uploadFile = null;
			uploadTitle = '';
		} else {
			const id = kind === 'attachment' ? pickedAttachmentId : pickedId;
			onsubmit?.({ kind, id, chapterId, lessonId, note: trimmedNote });
			pickedAttachmentId = '';
			pickedId = '';
			pickedLabel = '';
		}
		note = '';
	}
</script>

<!-- A card, matching the "add a chapter" panel above it — the two used to run straight into each
     other with no more than a paragraph of whitespace between them, so it read as one form rather
     than two. -->
<section class="contribute add-panel">
	<h2>{m.course_contribute_heading()}</h2>

	<p class="add-panel__hint">
		{course.contributionNeedsApproval
			? m.course_contribute_willWait()
			: m.course_contribute_willPublish()}
	</p>

	<form class="add-panel__form" onsubmit={submit}>
		<label class="field">
			<span>{m.course_contribute_kind()}</span>
			<select value={kind} onchange={(e) => switchKind(e.currentTarget.value as CourseItemKind)}>
				<option value="material">{m.course_items_material()}</option>
				<option value="exercise">{m.course_items_exercise()}</option>
				<option value="attachment">{m.course_items_attachment()}</option>
				<option value="event">{m.course_items_event()}</option>
			</select>
		</label>

		{#if kind === 'attachment'}
			<!-- A course file is never something to search for — it either already lives in this
			     course, or it doesn't exist yet anywhere. -->
			{#if attachments.length > 0}
				<div class="kind-toggle" role="tablist">
					<button
						type="button"
						class:active={attachmentMode === 'pick'}
						role="tab"
						aria-selected={attachmentMode === 'pick'}
						onclick={() => (attachmentMode = 'pick')}
					>
						{m.course_contribute_pickExisting()}
					</button>
					<button
						type="button"
						class:active={attachmentMode === 'upload'}
						role="tab"
						aria-selected={attachmentMode === 'upload'}
						onclick={() => (attachmentMode = 'upload')}
					>
						{m.course_contribute_uploadNew()}
					</button>
				</div>
			{/if}

			{#if attachmentMode === 'pick' && attachments.length > 0}
				<label class="field">
					<span>{m.course_contribute_attachmentId()}</span>
					<select bind:value={pickedAttachmentId}>
						<option value="">{m.course_contribute_pickFileNone()}</option>
						{#each attachments as a (a.id)}
							<option value={a.id}>{a.title}</option>
						{/each}
					</select>
				</label>
			{:else}
				<label class="field">
					<span>{m.course_contribute_uploadFileLabel()}</span>
					<input
						type="file"
						accept={ACCEPTED_EXTENSIONS}
						onchange={(e) => (uploadFile = e.currentTarget.files?.[0] ?? null)}
					/>
				</label>
				<label class="field">
					<span>{m.course_contribute_uploadTitleLabel()}</span>
					<input type="text" bind:value={uploadTitle} maxlength="200" />
				</label>
				<p class="add-panel__hint">{m.course_contribute_uploadHint()}</p>
			{/if}
		{:else}
			<label class="field">
				<span>{m.course_contribute_search()}</span>
				{#if pickedId}
					<div class="picked">
						<span class="picked__label">{pickedLabel}</span>
						<button type="button" class="link" onclick={clearPick}>
							{m.course_contribute_change()}
						</button>
					</div>
				{:else}
					<input
						type="text"
						bind:value={query}
						oninput={(e) => search.typed(e.currentTarget.value)}
						oncompositionstart={search.compositionStart}
						oncompositionend={(e) => search.compositionEnd(e.currentTarget.value)}
						placeholder={m.course_contribute_searchPlaceholder()}
					/>
					{#if searching}
						<p class="add-panel__hint">{m.common_loading()}</p>
					{:else if committedQuery && results.length === 0}
						<p class="add-panel__hint">{m.course_contribute_noResults()}</p>
					{:else if results.length > 0}
						<ul class="results">
							{#each results as result (result.id)}
								<li>
									<button type="button" onclick={() => pick(result)}>{result.label}</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</label>
			<p class="add-panel__hint">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built by a $derived that calls resolve() itself; the rule only sees the attribute -->
				<a href={createHref}>{createLabel}</a>
			</p>
		{/if}

		{#if course.canCurate && course.chapters.length > 0}
			<label class="field">
				<span>{m.course_items_moveTo()}</span>
				<select bind:value={target}>
					<option value="">{m.course_items_moveNone()}</option>
					{#each course.chapters as chapter (chapter.id)}
						<optgroup label={chapter.title}>
							<option value="chapter:{chapter.id}">{m.course_items_moveWholeChapter()}</option>
							{#each chapter.lessons as lesson (lesson.id)}
								<option value="lesson:{lesson.id}">{lesson.title}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</label>
		{/if}

		<label class="field">
			<span>{m.course_contribute_note()}</span>
			<input type="text" bind:value={note} maxlength="500" />
		</label>

		<button type="submit" class="primary" disabled={busy || !canSubmit}>
			{m.course_contribute_submit()}
		</button>
	</form>

	{#if notice}
		<p class="notice">{notice}</p>
	{/if}
	{#if error}
		<p class="error">{error}</p>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	// A real card, and the shape both "add" panels in this tab now share — the +page.svelte chapter
	// panel carries the identical .add-panel* block. Not pulled into a shared mixin: two occurrences
	// is the threshold this codebase leaves alone, per its own "three strikes" convention.
	.contribute {
		@include mix.card-surface;
		padding: var(--space-4);
		margin-top: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.contribute h2 {
		font-size: var(--font-size-md);
	}
	.add-panel__form {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		width: 100%;
	}
	.add-panel__hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.notice {
		font-size: var(--font-size-sm);
		color: var(--status-info);
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger, #c0392b);
	}
	input,
	select {
		@include mix.focus-ring;
		width: 100%;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.primary {
		@include mix.button-primary;
	}
	.kind-toggle {
		display: flex;
		gap: var(--space-2);
		button {
			@include mix.button-secondary;
			padding: var(--space-1) var(--space-3);
			font-size: var(--font-size-xs);
			&.active {
				background: var(--accent);
				color: var(--accent-contrast);
				border-color: var(--accent);
			}
		}
	}
	// The chosen result, shown in place of the search box — "Change" is the only way back to it,
	// so a picked item can't be quietly overwritten by a stray keystroke the way an editable text
	// field next to a live search would allow.
	.picked {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
	}
	.picked__label {
		font-size: var(--font-size-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.results {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 12rem;
		overflow-y: auto;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-1);
	}
	.results button {
		width: 100%;
		text-align: left;
		padding: var(--space-1) var(--space-2);
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-primary);
		font: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: var(--font-size-xs);
		text-decoration: underline;
		color: var(--text-secondary);
		cursor: pointer;
		flex-shrink: 0;
	}
</style>
