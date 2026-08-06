<script lang="ts">
	// A course's materials and exercises, grouped into chapters, with the lock state shown honestly.
	//
	// The rule this component exists to make visible: a locked chapter still RENDERS — its title, its
	// description and its unlock date — while its contents do not. Hiding the chapter entirely would
	// make a course look shorter than it is, and "week 3 exists and opens on the 14th" is exactly the
	// thing a participant wants to know. Staff see the contents early, and are told the chapter is
	// still shut, because they are the people who have to prepare it.
	//
	// Everything here is presentation over what the course payload already carried: the server
	// decided what this viewer may see (`CourseItem.is_visible_to`), so nothing is filtered again
	// here. A client that re-derived that would be a client that could get it wrong.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import type { Chapter, CourseItem, Course, Lesson } from '$lib/types/course';

	let {
		course,
		onmove,
		onremove,
		ondeletechapter,
		oneditchapter,
		oneditlesson,
		ondeletelesson,
		onreorder
	}: {
		course: Course;
		onmove?: (itemId: string, lessonId: string | null) => void;
		onremove?: (itemId: string) => void;
		ondeletechapter?: (chapterId: string) => void;
		/** Rename a chapter or retime its unlock. Staff only — the server checks again regardless. */
		oneditchapter?: (chapterId: string, patch: { title: string; unlocksAt: string | null }) => void;
		oneditlesson?: (lessonId: string, patch: { title: string; participantNotes: string }) => void;
		ondeletelesson?: (lessonId: string) => void;
		/** Whole groups, never a single move — a drag between two lessons changes both, and the
		 * server takes them together so there is no moment where an item is in both or neither. */
		onreorder?: (
			payload:
				| { kind: 'chapter'; order: string[] }
				| { kind: 'lesson' | 'item'; groups: Record<string, string[]> }
		) => void;
	} = $props();

	// --- drag and drop, staff only ---------------------------------------------------------------
	// Native HTML5 drag events rather than a library: three sortable lists is not enough to justify
	// a dependency, and the drop target is always a sibling in the same list or a named group, which
	// `dataTransfer` expresses directly.
	//
	// Guarded on `canCurate` at every entry point, not only by hiding the handle — a hidden control
	// is not a permission, and the server checks again regardless.
	type Dragged = { kind: 'chapter' | 'lesson' | 'item'; id: string; from: string };
	type ReorderPayload =
		| { kind: 'chapter'; order: string[] }
		| { kind: 'lesson' | 'item'; groups: Record<string, string[]> };

	let dragged = $state<Dragged | null>(null);

	// Which row is open for editing, and the draft being typed into it. One at a time: a course
	// with thirty lessons all in edit mode is a form nobody can find their way out of, and "save
	// what I am looking at" is the only action anybody wants here.
	let editingChapter = $state<string | null>(null);
	let editingLesson = $state<string | null>(null);
	let draftTitle = $state('');
	let draftUnlocksAt = $state('');
	let draftNotes = $state('');

	/** A datetime-local input wants `YYYY-MM-DDTHH:mm`, and an ISO string from the API carries
	 * seconds and a zone it will silently refuse. */
	function toLocalInput(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function beginChapterEdit(chapter: Chapter) {
		editingLesson = null;
		editingChapter = chapter.id;
		draftTitle = chapter.title;
		draftUnlocksAt = toLocalInput(chapter.unlocksAt);
	}

	function beginLessonEdit(lesson: Lesson) {
		editingChapter = null;
		editingLesson = lesson.id;
		draftTitle = lesson.title;
		draftNotes = lesson.participantNotes;
	}

	function saveChapter(chapterId: string) {
		const title = draftTitle.trim();
		if (!title) return;
		oneditchapter?.(chapterId, {
			title,
			unlocksAt: draftUnlocksAt ? new Date(draftUnlocksAt).toISOString() : null
		});
		editingChapter = null;
	}

	function saveLesson(lessonId: string) {
		const title = draftTitle.trim();
		if (!title) return;
		oneditlesson?.(lessonId, { title, participantNotes: draftNotes });
		editingLesson = null;
	}

	// The payload that puts everything back exactly as it was, kept from before the last drop.
	//
	// Undo is cheap here only because a reorder is expressed as COMPLETE groups rather than as a
	// move: the inverse of "these groups now read like this" is "these groups used to read like
	// that", which is just the same shape captured a moment earlier. A move-based API would have
	// needed a real inverse operation per kind.
	//
	// It exists because dragging is easy to do by accident — a slipped pointer silently rewrites a
	// course's running order, and without this the only way back is to remember what it was.
	let undo = $state<ReorderPayload | null>(null);

	function startDrag(event: DragEvent, kind: Dragged['kind'], id: string, from: string) {
		if (!course.canCurate) return;
		dragged = { kind, id, from };
		// Chrome refuses to begin a native HTML5 drag unless `dragstart` puts something on the
		// dataTransfer. Without this the whole feature is inert: the handlers are all correct, no
		// error is raised, and nothing moves — which is exactly how it behaved. The payload itself
		// is unused (`dragged` above carries the real state); it exists to arm the drag.
		event.dataTransfer?.setData('text/plain', `${kind}:${id}`);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	/** Reinsert `id` before `beforeId` in `list`, or at the end when `beforeId` is null. */
	function resequence(list: string[], id: string, beforeId: string | null): string[] {
		const without = list.filter((x) => x !== id);
		if (beforeId === null) return [...without, id];
		const at = without.indexOf(beforeId);
		return at === -1 ? [...without, id] : [...without.slice(0, at), id, ...without.slice(at)];
	}

	function dropOn(kind: Dragged['kind'], group: string, beforeId: string | null) {
		if (!course.canCurate || !dragged || dragged.kind !== kind) return;
		const { id, from } = dragged;
		dragged = null;

		if (kind === 'chapter') {
			const before = chapters.map((c) => c.id);
			const after = resequence(before, id, beforeId);
			if (after.join() === before.join()) return; // a drop that changed nothing is not a change
			undo = { kind: 'chapter', order: before };
			onreorder?.({ kind: 'chapter', order: after });
			return;
		}

		// Both the group it left and the group it joined go in one payload. Sending only the target
		// would leave the source's remaining rows numbered around a gap.
		const groupsOf = kind === 'lesson' ? lessonGroups() : itemGroups();
		const target = resequence(groupsOf[group] ?? [], id, beforeId);
		const groups: Record<string, string[]> = { [group]: target };
		if (from !== group) groups[from] = (groupsOf[from] ?? []).filter((x) => x !== id);

		const unchanged = Object.entries(groups).every(
			([key, ids]) => (groupsOf[key] ?? []).join() === ids.join()
		);
		if (unchanged) return;

		// Only the groups this drop touched, so undoing does not reassert an order somewhere else
		// that somebody may have changed in between.
		undo = {
			kind,
			groups: Object.fromEntries(Object.keys(groups).map((key) => [key, groupsOf[key] ?? []]))
		};
		onreorder?.({ kind, groups });
	}

	function lessonGroups(): Record<string, string[]> {
		return Object.fromEntries(chapters.map((c) => [c.id, c.lessons.map((l) => l.id)]));
	}

	function itemGroups(): Record<string, string[]> {
		const groups: Record<string, string[]> = { '': unfiled.map((i) => i.id) };
		for (const chapter of chapters) {
			for (const lesson of chapter.lessons) groups[lesson.id] = lesson.items.map((i) => i.id);
		}
		return groups;
	}

	let chapters = $derived(course.chapters);
	let unfiled = $derived(course.unfiledItems);
	let hasAnything = $derived(chapters.length > 0 || unfiled.length > 0);

	function itemHref(item: CourseItem): string {
		return item.kind === 'material'
			? resolve('/materials/[id]', { id: item.material ?? '' })
			: resolve('/exercises/[id]', { id: item.exercise ?? '' });
	}

	/** A date somebody can read, in their own locale rather than an ISO string. */
	function when(value: string | null): string {
		if (!value) return '';
		return new Date(value).toLocaleString();
	}

	function lockLabel(chapter: Chapter): string {
		return course.canCurate
			? m.course_chapter_lockedStaff({ when: when(chapter.unlocksAt) })
			: m.course_chapter_locked({ when: when(chapter.unlocksAt) });
	}
</script>

<section class="content">
	<h2>{m.course_items_heading()}</h2>

	{#if undo && course.canCurate}
		<!-- Stays until it is used or the next drag replaces it, rather than disappearing on a timer:
		     noticing that the order is wrong is the slow part, and a banner that has already gone is
		     no better than no banner. -->
		<div class="undo" role="status">
			<span>{m.course_reorder_done()}</span>
			<button
				type="button"
				class="link"
				onclick={() => {
					const payload = undo;
					undo = null;
					if (payload) onreorder?.(payload);
				}}
			>
				{m.course_reorder_undo()}
			</button>
		</div>
	{/if}

	{#if !hasAnything}
		<p class="empty">{m.course_items_empty()}</p>
	{/if}

	{#each chapters as chapter (chapter.id)}
		<!-- The chapter itself is draggable, which it was not: `dropOn('chapter', …)` existed in the
		     script from the start and nothing ever called it, so chapters alone could not be
		     reordered while their lessons and items could. `chapters` is the only group a chapter
		     can be in, hence the empty group id. -->
		<article
			class="chapter"
			class:chapter--locked={!chapter.isUnlocked}
			draggable={course.canCurate && editingChapter === null}
			ondragstart={(e) => {
				e.stopPropagation();
				startDrag(e, 'chapter', chapter.id, '');
			}}
			ondragover={(e) => {
								e.preventDefault();
								if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
							}}
			ondrop={(e) => {
				e.stopPropagation();
				dropOn('chapter', '', chapter.id);
			}}
		>
			<header>
				{#if editingChapter === chapter.id}
					<form
						class="edit-row"
						onsubmit={(e) => {
							e.preventDefault();
							saveChapter(chapter.id);
						}}
					>
						<input type="text" bind:value={draftTitle} maxlength="200" />
						<input type="datetime-local" bind:value={draftUnlocksAt} />
						<button type="submit" class="link">{m.course_edit_save()}</button>
						<button type="button" class="link" onclick={() => (editingChapter = null)}>
							{m.course_edit_cancel()}
						</button>
					</form>
				{:else}
					<h3>{chapter.title}</h3>
					{#if !chapter.isUnlocked}
						<span class="lock" title={when(chapter.unlocksAt)}>🔒 {lockLabel(chapter)}</span>
					{/if}
					{#if course.canCurate && oneditchapter}
						<button type="button" class="link" onclick={() => beginChapterEdit(chapter)}>
							{m.course_edit_edit()}
						</button>
					{/if}
				{/if}
			</header>
			{#if chapter.description}
				<p class="description">{chapter.description}</p>
			{/if}

			{#if chapter.lessons.length > 0}
				<!-- The <ol> is a drop target too, not just its children: dropping past the last
				     lesson has to mean "put it at the end", which a per-sibling handler cannot
				     express. -->
				<ol
					class="lessons"
					ondragover={(e) => {
								e.preventDefault();
								if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
							}}
					ondrop={(e) => {
						e.stopPropagation();
						dropOn('lesson', chapter.id, null);
					}}
				>
					{#each chapter.lessons as lesson (lesson.id)}
						<li
							class="lesson"
							draggable={course.canCurate}
							ondragstart={(e) => {
								// Must stop here. A lesson sits inside its chapter's own draggable
								// <article>, so without this the event bubbles up and the chapter's
								// handler overwrites `dragged` with kind:'chapter' — after which the
								// lesson drop bails on the kind mismatch and nothing moves, silently.
								e.stopPropagation();
								startDrag(e, 'lesson', lesson.id, chapter.id);
							}}
							ondragover={(e) => {
								e.preventDefault();
								if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
							}}
							ondrop={() => dropOn('lesson', chapter.id, lesson.id)}
						>
							<div class="lesson__head">
								{#if course.canCurate}
									<span class="grip" aria-hidden="true">⠿</span>
								{/if}
								{#if editingLesson === lesson.id}
									<form
										class="edit-row"
										onsubmit={(e) => {
											e.preventDefault();
											saveLesson(lesson.id);
										}}
									>
										<input type="text" bind:value={draftTitle} maxlength="200" />
										<input
											type="text"
											bind:value={draftNotes}
											placeholder={m.course_newLessonNotes()}
										/>
										<button type="submit" class="link">{m.course_edit_save()}</button>
										<button type="button" class="link" onclick={() => (editingLesson = null)}>
											{m.course_edit_cancel()}
										</button>
									</form>
								{:else}
									<h4>{lesson.title}</h4>
									{#if lesson.scheduledAt}
										<span class="when">{when(lesson.scheduledAt)}</span>
									{/if}
									{#if course.canCurate && oneditlesson}
										<button type="button" class="link" onclick={() => beginLessonEdit(lesson)}>
											{m.course_edit_edit()}
										</button>
									{/if}
									{#if course.canCurate && ondeletelesson}
										<button
											type="button"
											class="link danger"
											onclick={() => ondeletelesson?.(lesson.id)}
										>
											{m.course_deleteLesson()}
										</button>
									{/if}
								{/if}
							</div>
							{#if lesson.description}
								<p class="description">{lesson.description}</p>
							{/if}
							{#if lesson.participantNotes}
								<p class="notes">{lesson.participantNotes}</p>
							{/if}
							{#if lesson.items.length > 0}
								<ul class="items">
									{#each lesson.items as item (item.id)}
										<li
											draggable={course.canCurate}
											ondragstart={(e) => {
												e.stopPropagation();
												startDrag(e, 'item', item.id, lesson.id);
											}}
											ondragover={(e) => {
								e.preventDefault();
								if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
							}}
											ondrop={(e) => {
												e.stopPropagation();
												dropOn('item', lesson.id, item.id);
											}}
										>
											{@render itemRow(item)}
										</li>
									{/each}
								</ul>
							{:else}
								<p
									class="empty"
									ondragover={(e) => {
								e.preventDefault();
								if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
							}}
									ondrop={() => dropOn('item', lesson.id, null)}
									role="presentation"
								>
									{m.course_items_empty()}
								</p>
							{/if}
						</li>
					{/each}
				</ol>
			{:else if !chapter.isUnlocked}
				<!-- The honest empty state for a participant: not "nothing here", which would be a
				     different and wrong statement about a chapter that is merely shut. -->
				<p class="empty">{m.course_chapter_lockedEmpty()}</p>
			{:else}
				<!-- A drop target, not just a message. An empty chapter renders no lesson elements,
				     so without this there is literally nothing to drop a lesson onto and moving one
				     into a fresh chapter is impossible — which is precisely when you most want to. -->
				<p
					class="empty empty--droppable"
					role="presentation"
					ondragover={(e) => {
								e.preventDefault();
								if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
							}}
					ondrop={(e) => {
						e.stopPropagation();
						dropOn('lesson', chapter.id, null);
					}}
				>
					{m.course_chapter_dropHere()}
				</p>
			{/if}

			{#if course.canCurate && ondeletechapter}
				<div class="chapter-actions">
					<button type="button" class="link danger" onclick={() => ondeletechapter?.(chapter.id)}>
						{m.course_chapters_delete()}
					</button>
					<span class="hint">{m.course_chapters_deleteHint()}</span>
				</div>
			{/if}
		</article>
	{/each}

	{#if unfiled.length > 0}
		<article class="chapter">
			<header>
				<!-- Its own group rather than a nameless chapter: "not filed yet" is a real state, and a
				     course that uses no chapters at all quite legitimately keeps everything here. -->
				<h3>{chapters.length > 0 ? m.course_items_unfiled() : m.course_items_heading()}</h3>
			</header>
			<ul class="items">
				{#each unfiled as item (item.id)}
					{@render itemRow(item)}
				{/each}
			</ul>
		</article>
	{/if}
</section>

{#snippet itemRow(item: CourseItem)}
	<li class="item" class:item--pending={item.status !== 'approved'}>
		<span class="kind">
			{item.kind === 'material' ? m.course_items_material() : m.course_items_exercise()}
		</span>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the href is built by a helper that calls resolve() itself; the rule only sees the attribute -->
		<a class="label" href={itemHref(item)}>{item.label}</a>

		{#if item.status === 'pending'}
			<span class="pill pill--pending">{m.course_item_pending()}</span>
		{:else if item.status === 'rejected'}
			<span class="pill pill--rejected">{m.course_item_rejected()}</span>
		{/if}

		{#if item.note}
			<span class="note">{item.note}</span>
		{/if}

		{#if course.canCurate && onmove}
			<!-- Kept alongside drag-and-drop rather than replaced by it: a select works on a phone
			     and from a keyboard, and dragging does neither. The drag handles are the shortcut,
			     not the only way in. -->
			<label class="move">
				<span class="visually-hidden">{m.course_items_moveTo()}</span>
				<select
					value={item.lesson ?? ''}
					onchange={(event) =>
						onmove?.(item.id, (event.currentTarget as HTMLSelectElement).value || null)}
				>
					<option value="">{m.course_items_moveNone()}</option>
					{#each chapters as chapter (chapter.id)}
						{#each chapter.lessons as lesson (lesson.id)}
							<option value={lesson.id}>{chapter.title} — {lesson.title}</option>
						{/each}
					{/each}
				</select>
			</label>
		{/if}

		{#if onremove && (course.canCurate || item.status === 'pending')}
			<button type="button" class="link danger" onclick={() => onremove?.(item.id)}>
				{course.canCurate ? m.course_items_remove() : m.course_item_withdraw()}
			</button>
		{/if}
	</li>
{/snippet}

<style lang="scss">
	.content {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.chapter {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.chapter--locked {
		// Dimmed rather than hidden — the chapter is still information.
		background: var(--bg-surface-alt);
	}
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	h3 {
		font-size: var(--font-size-md);
	}
	.lock {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.description,
	.empty,
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--border-color);
		&:last-child {
			border-bottom: none;
		}
	}
	.item--pending {
		opacity: 0.75;
	}
	.kind {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		min-width: 5rem;
	}
	.label {
		font-weight: 500;
	}
	.note {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-style: italic;
	}
	.pill {
		font-size: var(--font-size-xs);
		padding: 1px var(--space-2);
		border-radius: var(--radius-sm);
	}
	.pill--pending {
		color: var(--status-info);
		background: var(--status-info-bg);
	}
	.pill--rejected {
		color: var(--text-secondary);
		background: var(--bg-surface-alt);
	}
	.chapter-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.move select {
		font-size: var(--font-size-xs);
		padding: 2px var(--space-1);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.empty--droppable {
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-md, 6px);
		padding: var(--space-3);
		text-align: center;
	}
	.edit-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		flex: 1;
	}
	.edit-row input[type='text'] {
		flex: 1;
		min-width: 12ch;
	}
	.undo {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md, 6px);
		background: var(--surface-raised, transparent);
		font-size: var(--font-size-sm);
	}
	.lessons {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.lesson__head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}
	.lesson__head h4 {
		font-weight: 600;
	}
	.lesson__head .when {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	/* Only shown to staff, and only decorative — the draggable attribute is what carries the
	   behaviour, and the select beside each item is the accessible route. */
	.grip {
		cursor: grab;
		color: var(--text-secondary);
	}
	.notes {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	.link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: var(--font-size-xs);
		cursor: pointer;
		text-decoration: underline;
		color: var(--text-secondary);
	}
	.danger:hover {
		color: var(--status-danger, #c0392b);
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
