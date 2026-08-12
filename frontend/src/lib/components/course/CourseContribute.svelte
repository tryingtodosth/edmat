<script lang="ts">
	// Offering a material or an exercise to a course.
	//
	// It says up front whether the thing will appear immediately or wait for review, because that is
	// the single most useful sentence here: somebody who submits and then cannot find their material
	// assumes it failed. `contributionNeedsApproval` is resolved per viewer server-side, so staff —
	// who never queue behind themselves — correctly see the other message.
	//
	// Content is REFERENCED by id, never uploaded here: a course points at materials and exercises
	// that already exist in the corpus, so a corrected exercise stays corrected everywhere and a
	// course never becomes a silently diverging fork. Uploading something new is the existing
	// /submit-material flow, which is a different job.
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import type { Course, CourseItemKind } from '$lib/types/course';

	let {
		course,
		busy = false,
		error = '',
		notice = '',
		onsubmit
	}: {
		course: Course;
		busy?: boolean;
		error?: string;
		notice?: string;
		onsubmit?: (input: {
			kind: CourseItemKind;
			id: string;
			chapterId: string | null;
			lessonId: string | null;
			note: string;
		}) => void;
	} = $props();

	let kind = $state<CourseItemKind>('material');
	let itemId = $state('');
	/** `kind:id`, because a chapter and a lesson can share a number and the value has to say which
	 * one it names. Empty means unfiled. */
	let target = $state('');
	let note = $state('');

	/** What to call the id field, and where "find one" should point. Kept as one lookup rather than
	 * four ternaries at three separate call sites in the markup. */
	let idLabel = $derived(
		kind === 'material'
			? m.course_contribute_materialId()
			: kind === 'exercise'
				? m.course_contribute_exerciseId()
				: kind === 'attachment'
					? m.course_contribute_attachmentId()
					: m.course_contribute_eventId()
	);

	/** A course file is only ever found inside its own course, so the browse link for that kind
	 * points back at this course rather than at a site-wide list that deliberately excludes it. */
	let browseHref = $derived(
		kind === 'material'
			? resolve('/materials')
			: kind === 'exercise'
				? resolve('/disciplines')
				: kind === 'event'
					? resolve('/events')
					: resolve('/courses/[id]', { id: course.id })
	);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = itemId.trim();
		if (!trimmed) return;
		const [targetKind, targetId] = target ? target.split(':') : ['', ''];
		onsubmit?.({
			kind,
			id: trimmed,
			chapterId: targetKind === 'chapter' ? targetId : null,
			lessonId: targetKind === 'lesson' ? targetId : null,
			note: note.trim()
		});
		itemId = '';
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
		<div class="add-panel__grid">
			<label class="field">
				<span>{m.course_contribute_kind()}</span>
				<select bind:value={kind}>
					<option value="material">{m.course_items_material()}</option>
					<option value="exercise">{m.course_items_exercise()}</option>
					<option value="attachment">{m.course_items_attachment()}</option>
					<option value="event">{m.course_items_event()}</option>
				</select>
			</label>

			<label class="field">
				<span>{idLabel}</span>
				<input type="text" bind:value={itemId} inputmode="numeric" required />
			</label>
		</div>
		<!-- Its own line rather than nested inside the id field's label: a hint under one field but
		     not its neighbour made that field taller than the other, and the row's own
		     bottom-alignment then read the two labels as sitting at different heights — which is
		     exactly what happened. Honest about the gap either way: there is no picker yet, so the
		     id from the item's own page is the real way to name it. Browsing links are right there
		     for finding one. -->
		<p class="add-panel__hint">
			{m.course_contribute_idHint()}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built by a $derived that calls resolve() itself; the rule only sees the attribute -->
			<a href={browseHref}>{m.course_items_openLink()}</a>
		</p>

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

		<button type="submit" class="primary" disabled={busy}>
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
	.add-panel__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: var(--space-3);
		width: 100%;
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
</style>
