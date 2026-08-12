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
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import LessonFeedback from '$lib/components/course/LessonFeedback.svelte';
	import LessonProgressPanel from '$lib/components/course/LessonProgressPanel.svelte';
	import { getSetsForUser } from '$lib/services/exerciseSets';
	import type { ExerciseSet } from '$lib/types';
	import type { Chapter, CourseItem, Course, Lesson, LessonExerciseSet } from '$lib/types/course';

	let {
		course,
		onmove,
		onremove,
		ondeletechapter,
		oneditchapter,
		oneditlesson,
		ondeletelesson,
		onaddlesson,
		onlinkset,
		onunlinkset,
		onrefreshset,
		onreorder
	}: {
		course: Course;
		/** Both ids, because an item files into a lesson OR a chapter and the caller must be able to
		 * say which — and to clear the other, or the row would hold both and the database refuses. */
		onmove?: (
			itemId: string,
			target: { lessonId: string | null; chapterId: string | null }
		) => void;
		onremove?: (itemId: string) => void;
		ondeletechapter?: (chapterId: string) => void;
		/** Rename a chapter, rewrite its description or retime its unlock. Staff only — the server
		 * checks again regardless. */
		oneditchapter?: (
			chapterId: string,
			patch: { title: string; description: string; unlocksAt: string | null }
		) => void;
		oneditlesson?: (
			lessonId: string,
			patch: { title: string; description: string; participantNotes: string }
		) => void;
		ondeletelesson?: (lessonId: string) => void;
		/** Create a lesson inside a chapter. A lesson has nowhere else to live — `Lesson.chapter` is
		 * NOT NULL — so this is offered per chapter rather than once for the whole course. */
		onaddlesson?: (
			chapterId: string,
			draft: { title: string; description: string; participantNotes: string }
		) => void;
		/** Pin a whole saved set into a lesson, by the set's own share slug. */
		onlinkset?: (lessonId: string, setSlug: string) => void;
		onunlinkset?: (lessonId: string, linkId: string) => void;
		/** Re-copy the source set's current list. Only meaningful while the source still exists and
		 * is still readable — the server refuses with a 409 otherwise, and says which. */
		onrefreshset?: (lessonId: string, linkId: string) => void;
		/** Whole groups, never a single move — a drag between two lessons changes both, and the
		 * server takes them together so there is no moment where an item is in both or neither. */
		onreorder?: (
			payload:
				| { kind: 'chapter'; order: string[] }
				| { kind: 'lesson' | 'item' | 'lesson_set'; groups: Record<string, string[]> }
		) => void;
	} = $props();

	// --- linking a saved set into a lesson ---------------------------------------------------------
	// Which lesson's "link a set" dialog is open, keyed by lesson for the same reason `addingLessonIn`
	// is keyed by chapter: the button appears once per lesson and a shared boolean would open all of
	// them at once.
	let linkingIn = $state<string | null>(null);
	let mySets = $state<ExerciseSet[]>([]);
	let mySetsLoaded = $state(false);
	let pickedSlug = $state('');

	async function beginLinkSet(lessonId: string) {
		linkingIn = lessonId;
		pickedSlug = '';
		if (mySetsLoaded) return;
		// Only the curator's OWN sets are offered as a list — there is no way to enumerate somebody
		// else's, by design. A set a colleague shared is linked by pasting the slug from its link,
		// which is the same thing that link already is.
		mySets = await getSetsForUser('');
		mySetsLoaded = true;
	}

	function saveLinkSet() {
		const slug = pickedSlug.trim();
		if (!slug || !linkingIn) return;
		onlinkset?.(linkingIn, slug);
		linkingIn = null;
	}

	// --- drag and drop, staff only ---------------------------------------------------------------
	// Native HTML5 drag events rather than a library: three sortable lists is not enough to justify
	// a dependency, and the drop target is always a sibling in the same list or a named group, which
	// `dataTransfer` expresses directly.
	//
	// Guarded on `canCurate` at every entry point, not only by hiding the handle — a hidden control
	// is not a permission, and the server checks again regardless.
	type Dragged = { kind: 'chapter' | 'lesson' | 'item' | 'lesson_set'; id: string; from: string };
	type ReorderPayload =
		| { kind: 'chapter'; order: string[] }
		| { kind: 'lesson' | 'item' | 'lesson_set'; groups: Record<string, string[]> };

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
		draftDescription = chapter.description;
	}

	function beginLessonEdit(lesson: Lesson) {
		editingChapter = null;
		editingLesson = lesson.id;
		draftTitle = lesson.title;
		draftDescription = lesson.description;
		draftNotes = lesson.participantNotes;
	}

	function saveChapter(chapterId: string) {
		const title = draftTitle.trim();
		if (!title) return;
		oneditchapter?.(chapterId, {
			title,
			description: draftDescription.trim(),
			unlocksAt: draftUnlocksAt ? new Date(draftUnlocksAt).toISOString() : null
		});
		editingChapter = null;
	}

	// --- adding a lesson ---------------------------------------------------------------------------
	// Which chapter's "add a lesson" dialog is open, or null for none. Keyed by chapter rather than a
	// bare boolean because the button appears once per chapter and the dialog has to know which one
	// it is filling — a shared boolean would open every chapter's dialog at once.
	let addingLessonIn = $state<string | null>(null);
	let newLessonTitle = $state('');
	let newLessonDescription = $state('');
	let newLessonNotes = $state('');
	let draftDescription = $state('');

	function beginAddLesson(chapterId: string) {
		addingLessonIn = chapterId;
		newLessonTitle = '';
		newLessonDescription = '';
		newLessonNotes = '';
	}

	function saveNewLesson() {
		const title = newLessonTitle.trim();
		if (!title || !addingLessonIn) return;
		onaddlesson?.(addingLessonIn, {
			title,
			description: newLessonDescription.trim(),
			participantNotes: newLessonNotes.trim()
		});
		addingLessonIn = null;
	}

	function saveLesson(lessonId: string) {
		const title = draftTitle.trim();
		if (!title) return;
		oneditlesson?.(lessonId, {
			title,
			description: draftDescription.trim(),
			participantNotes: draftNotes
		});
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
		const groupsOf =
			kind === 'lesson' ? lessonGroups() : kind === 'lesson_set' ? setGroups() : itemGroups();
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

	/** A linked set only ever lives in a lesson — `LessonExerciseSet.lesson` is NOT NULL — so unlike
	 * `itemGroups` there is no `''` unfiled group here for one to be dropped into. */
	function setGroups(): Record<string, string[]> {
		const groups: Record<string, string[]> = {};
		for (const chapter of chapters) {
			for (const lesson of chapter.lessons) {
				groups[lesson.id] = lesson.exerciseSets.map((link) => link.id);
			}
		}
		return groups;
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
		if (item.kind === 'material') return resolve('/materials/[id]', { id: item.material ?? '' });
		if (item.kind === 'exercise') return resolve('/exercises/[id]', { id: item.exercise ?? '' });
		if (item.kind === 'attachment') {
			// A course file has no page of its own outside the course — that is the whole point of an
			// attachment rather than a Material — so it is addressed through the course holding it.
			return resolve('/courses/[id]/attachments/[attachmentId]', {
				id: course.id,
				attachmentId: item.attachment ?? ''
			});
		}
		return resolve('/events/[id]', { id: item.event ?? '' });
	}

	/** The `kind:id` the move select should currently show. Prefixed for the same reason the options
	 * are: chapter 7 and lesson 7 are different destinations that share a number. */
	function moveValue(item: CourseItem): string {
		if (item.lesson) return `lesson:${item.lesson}`;
		if (item.chapter) return `chapter:${item.chapter}`;
		return '';
	}

	function onMoveChange(item: CourseItem, event: Event) {
		const raw = (event.currentTarget as HTMLSelectElement).value;
		if (!raw) {
			onmove?.(item.id, { lessonId: null, chapterId: null });
			return;
		}
		const [kind, id] = raw.split(':');
		onmove?.(
			item.id,
			kind === 'lesson' ? { lessonId: id, chapterId: null } : { lessonId: null, chapterId: id }
		);
	}

	/** What kind of thing this is, in words. A reader needs it before clicking: a corpus exercise and
	 * a one-off event behave nothing alike once you follow the link. */
	function kindLabel(item: CourseItem): string {
		if (item.kind === 'material') return m.course_items_material();
		if (item.kind === 'exercise') return m.course_items_exercise();
		if (item.kind === 'attachment') return m.course_items_attachment();
		return m.course_items_event();
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
		<!-- The id is what a search hit links to. Prefixed rather than a bare `chapter-{id}` because a
		     chapter, a lesson and an item can share a number and these all land in one document. -->
		<article
			id="course-chapter-{chapter.id}"
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
				<h3>{chapter.title}</h3>
				{#if !chapter.isUnlocked}
					<span class="lock" title={when(chapter.unlocksAt)}>🔒 {lockLabel(chapter)}</span>
				{/if}
				{#if course.canCurate && oneditchapter}
					<button type="button" class="link" onclick={() => beginChapterEdit(chapter)}>
						{m.course_edit_edit()}
					</button>
				{/if}
				{#if course.canCurate && onaddlesson}
					<button type="button" class="link" onclick={() => beginAddLesson(chapter.id)}>
						{m.course_addLesson()}
					</button>
				{/if}
			</header>
			{#if chapter.description}
				<!-- Markdown + LaTeX, the same renderer an exercise uses. This printed as literal
				     text before, so a link somebody wrote showed as brackets and parentheses.
				     Sanitized server-side on save too (Chapter.save) — the rendering pass here is
				     not the only thing between a description and a reader's browser. -->
				<div class="description"><MathContent source={chapter.description} /></div>
			{/if}

			{#if chapter.items.length > 0}
				<!-- Content filed against the week itself rather than any one session in it. Drawn
				     above the lessons because that is what it is: the thing to read before Tuesday,
				     not something that comes after it. -->
				<ul class="items items--chapter">
					{#each chapter.items as item (item.id)}
						{@render itemRow(item)}
					{/each}
				</ul>
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
							id="course-lesson-{lesson.id}"
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
								<!-- Editing is a dialog, matching the chapter dialog below — this row used to
								     be a plain inline form with no description field at all, so a lesson's
								     description could be set on creation and never touched again. -->
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
							</div>
							{#if lesson.description}
								<div class="description"><MathContent source={lesson.description} /></div>
							{/if}
							{#if lesson.participantNotes}
								<div class="notes"><MathContent source={lesson.participantNotes} /></div>
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

							{#if lesson.exerciseSets.length > 0 || (course.canCurate && onlinkset)}
								<div class="sets">
									{#if lesson.exerciseSets.length > 0}
										<h5>{m.course_sets_heading()}</h5>
									{/if}
									{#each lesson.exerciseSets as link (link.id)}
										{@render linkedSet(lesson, link)}
									{/each}
									{#if course.canCurate && onlinkset}
										<button type="button" class="link" onclick={() => beginLinkSet(lesson.id)}>
											{m.course_sets_link()}
										</button>
									{/if}
								</div>
							{/if}

							<!-- Above the conversation, not inside it: "have I done this?" is a glance,
								     and it needs no click to answer, while the thread is something you go
								     into. It renders nothing at all when the course has tracking off. -->
							<LessonProgressPanel
								courseId={course.id}
								lessonId={lesson.id}
								progress={lesson.progress}
							/>

							<!-- The session's own conversation and ratings, at the end of it: you read
								     Tuesday, then you ask about Tuesday. Collapsed, and it loads nothing until
								     opened — a twelve-week course draws a dozen of these. -->
							<LessonFeedback
								courseId={course.id}
								target="lesson"
								targetId={lesson.id}
								summary={lesson.reviews}
								canWrite={course.canPostDiscussion}
								canReadDiscussion={course.canReadDiscussion}
							/>
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

			<!-- The week's own conversation and ratings, below everything in it. A different
			     question from any one session's: "how should we approach week 3" belongs here,
			     "is task 3 a typo" belongs to Tuesday. Shown on a locked week too — the chapter
			     itself renders when locked, and its thread refuses on its own terms. -->
			<LessonFeedback
				courseId={course.id}
				target="chapter"
				targetId={chapter.id}
				summary={chapter.reviews}
				canWrite={course.canPostDiscussion}
				canReadDiscussion={course.canReadDiscussion}
			/>

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

{#if editingChapter !== null}
	<!-- A dialog rather than the inline row this used to be. Editing a chapter means a title, a
	     description and an unlock date — three fields that never fitted on the header line, so the
	     inline form dropped the description entirely and a chapter's description could not be
	     changed at all once it existed. -->
	<ModalShell title={m.course_chapters_editTitle()} onClose={() => (editingChapter = null)}>
		<form
			class="modal-form"
			onsubmit={(e) => {
				e.preventDefault();
				saveChapter(editingChapter!);
			}}
		>
			<label class="field">
				<span>{m.course_chapters_title()}</span>
				<!-- Focused on open: a dialog opened by a deliberate click should put the cursor where
				     the person is about to type, and it also moves focus INTO the dialog, which is what
				     makes Escape and the tab order behave. The blanket warning is about autofocus on an
				     ordinary page, where it steals focus nobody asked it to move.
				     A textarea rather than a single-line input — two rows is enough for a title that
				     wraps, and it matches the description field below rather than sitting oddly beside
				     it as the one plain input in an otherwise multi-line form. -->
				<!-- svelte-ignore a11y_autofocus -->
				<textarea bind:value={draftTitle} rows="2" maxlength="200" required autofocus></textarea>
			</label>
			<label class="field field--grow">
				<span>{m.course_chapters_description()}</span>
				<!-- As tall as the dialog can reasonably give it: a chapter's description is the one
				     field here somebody is actually likely to write more than a sentence into. -->
				<textarea bind:value={draftDescription} rows="8"></textarea>
			</label>
			<label class="field">
				<span>{m.course_chapters_unlocksAt()}</span>
				<input type="datetime-local" bind:value={draftUnlocksAt} />
				<span class="hint">{m.course_chapters_unlocksAtHint()}</span>
			</label>
			<div class="modal-actions">
				<button type="submit" class="primary">{m.course_edit_save()}</button>
				<button type="button" class="link" onclick={() => (editingChapter = null)}>
					{m.course_edit_cancel()}
				</button>
			</div>
		</form>
	</ModalShell>
{/if}

{#if editingLesson !== null}
	<!-- The same dialog shape as the chapter one above, and for the same reason: the inline row this
	     replaced had room for a title and nothing else, so a lesson's description — set once on
	     creation — could never be corrected afterward. -->
	<ModalShell title={m.course_lessons_editTitle()} onClose={() => (editingLesson = null)}>
		<form
			class="modal-form"
			onsubmit={(e) => {
				e.preventDefault();
				saveLesson(editingLesson!);
			}}
		>
			<label class="field">
				<span>{m.course_newLessonTitle()}</span>
				<!-- svelte-ignore a11y_autofocus -->
				<textarea bind:value={draftTitle} rows="2" maxlength="200" required autofocus></textarea>
			</label>
			<label class="field field--grow">
				<span>{m.course_newLessonDescription()}</span>
				<textarea bind:value={draftDescription} rows="8"></textarea>
				<span class="hint">{m.course_newLessonDescriptionHint()}</span>
			</label>
			<label class="field">
				<span>{m.course_newLessonNotes()}</span>
				<textarea bind:value={draftNotes} rows="3"></textarea>
				<span class="hint">{m.course_newLessonNotesHint()}</span>
			</label>
			<div class="modal-actions">
				<button type="submit" class="primary">{m.course_edit_save()}</button>
				<button type="button" class="link" onclick={() => (editingLesson = null)}>
					{m.course_edit_cancel()}
				</button>
			</div>
		</form>
	</ModalShell>
{/if}

{#if addingLessonIn !== null}
	<ModalShell title={m.course_addLesson()} onClose={() => (addingLessonIn = null)}>
		<form
			class="modal-form"
			onsubmit={(e) => {
				e.preventDefault();
				saveNewLesson();
			}}
		>
			<label class="field">
				<span>{m.course_newLessonTitle()}</span>
				<!-- Focused on open, same as the chapter dialog above. -->
				<!-- svelte-ignore a11y_autofocus -->
				<input type="text" bind:value={newLessonTitle} maxlength="200" required autofocus />
			</label>
			<label class="field">
				<span>{m.course_newLessonDescription()}</span>
				<textarea bind:value={newLessonDescription} rows="2"></textarea>
				<span class="hint">{m.course_newLessonDescriptionHint()}</span>
			</label>
			<label class="field">
				<span>{m.course_newLessonNotes()}</span>
				<textarea bind:value={newLessonNotes} rows="2"></textarea>
				<span class="hint">{m.course_newLessonNotesHint()}</span>
			</label>
			<div class="modal-actions">
				<button type="submit" class="primary">{m.course_addLesson()}</button>
				<button type="button" class="link" onclick={() => (addingLessonIn = null)}>
					{m.course_edit_cancel()}
				</button>
			</div>
		</form>
	</ModalShell>
{/if}

{#snippet itemRow(item: CourseItem)}
	<li class="item" class:item--pending={item.status !== 'approved'}>
		<span class="kind">{kindLabel(item)}</span>
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
			     not the only way in.
			     Values are prefixed because the two target kinds have their own id sequences, so a
			     bare "7" cannot say whether it means chapter 7 or lesson 7. -->
			<label class="move">
				<span class="visually-hidden">{m.course_items_moveTo()}</span>
				<select value={moveValue(item)} onchange={(event) => onMoveChange(item, event)}>
					<option value="">{m.course_items_moveNone()}</option>
					{#each chapters as chapter (chapter.id)}
						<optgroup label={chapter.title}>
							<!-- The chapter itself is a real destination, not just a heading: a reading
							     for the whole week belongs to the week, not to any one session in it. -->
							<option value="chapter:{chapter.id}">{m.course_items_moveWholeChapter()}</option>
							{#each chapter.lessons as lesson (lesson.id)}
								<option value="lesson:{lesson.id}">{lesson.title}</option>
							{/each}
						</optgroup>
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

{#snippet linkedSet(lesson: Lesson, link: LessonExerciseSet)}
	<!-- The provenance line is not decoration. A linked set is a COPY of what the source held when
	     it was linked, and the one thing a reader must never have to guess is whether the block in
	     front of them tracks somebody else's list or does not. So it says so, every time. -->
	<article
		class="set"
		draggable={course.canCurate}
		ondragstart={(e) => {
			e.stopPropagation();
			startDrag(e, 'lesson_set', link.id, lesson.id);
		}}
		ondragover={(e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		}}
		ondrop={(e) => {
			e.stopPropagation();
			dropOn('lesson_set', lesson.id, link.id);
		}}
	>
		<header class="set__head">
			{#if course.canCurate}
				<span class="grip" aria-hidden="true">⠿</span>
			{/if}
			<h6>{link.title}</h6>
			{#if course.canCurate && link.hasDrifted && onrefreshset}
				<span class="pill pill--pending">{m.course_sets_drifted()}</span>
				<button type="button" class="link" onclick={() => onrefreshset?.(lesson.id, link.id)}>
					{m.course_sets_refresh()}
				</button>
			{/if}
			{#if course.canCurate && onunlinkset}
				<button type="button" class="link danger" onclick={() => onunlinkset?.(lesson.id, link.id)}>
					{m.course_sets_unlink()}
				</button>
			{/if}
		</header>

		<p class="set__provenance">
			{m.course_sets_copiedOn({ when: when(link.refreshedAt ?? link.linkedAt) })}
			{#if !link.sourceExists}
				<span class="set__gone">{m.course_sets_sourceGone()}</span>
			{/if}
		</p>

		{#if link.note}
			<p class="note">{link.note}</p>
		{/if}

		<ul class="set__exercises">
			{#each link.exercises as row (row.id)}
				<li>
					<a href={resolve('/exercises/[id]', { id: row.exercise })}>{row.label}</a>
					{#if !row.published}
						<!-- Only a curator ever sees one of these; everybody else has it filtered out
						     server-side and is told the count instead. -->
						<span class="pill pill--rejected">{m.course_sets_withdrawn()}</span>
					{/if}
				</li>
			{/each}
		</ul>

		{#if link.hiddenExerciseCount > 0}
			<p class="set__hidden">
				{m.course_sets_hidden({ count: link.hiddenExerciseCount })}
			</p>
		{/if}
	</article>
{/snippet}

{#if linkingIn}
	<ModalShell title={m.course_sets_dialogTitle()} onClose={() => (linkingIn = null)}>
		<form
			class="modal-form"
			onsubmit={(e) => {
				e.preventDefault();
				saveLinkSet();
			}}
		>
			<p class="hint">{m.course_sets_dialogHint()}</p>
			<label class="field">
				<span>{m.course_sets_pick()}</span>
				<select bind:value={pickedSlug}>
					<option value="">{m.course_sets_pickNone()}</option>
					{#each mySets as saved (saved.id)}
						<option value={saved.id}>{saved.name}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>{m.course_sets_slug()}</span>
				<input type="text" bind:value={pickedSlug} maxlength="16" />
				<span class="hint">{m.course_sets_slugHint()}</span>
			</label>
			<div class="modal-actions">
				<button type="submit" class="primary">{m.course_sets_confirm()}</button>
				<button type="button" class="link" onclick={() => (linkingIn = null)}>
					{m.course_edit_cancel()}
				</button>
			</div>
		</form>
	</ModalShell>
{/if}

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
	/* Content filed against the chapter itself. Indented like a lesson so the nesting reads, but
	   without a lesson's own heading — it belongs to the week, not to a session. */
	.items--chapter {
		margin: var(--space-2) 0;
		padding-left: var(--space-3);
		border-left: 2px solid var(--border-color);
	}
	.modal-form {
		display: flex;
		flex-direction: column;
		// A touch tighter than before: the description field below wants as much of the dialog's
		// own height as it can get, and shaving the space between fields is cheaper than shrinking
		// the field itself.
		gap: var(--space-2);
	}
	.modal-form .field {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.modal-form .field > span:first-child {
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.modal-form input,
	.modal-form textarea {
		width: 100%;
		font: inherit;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text-primary);
	}
	.modal-form textarea {
		resize: vertical;
	}
	/* The one field in each of these dialogs somebody is actually likely to write more than a
	   sentence into — a chapter's own description, a lesson's own. Bounded by the viewport rather
	   than a fixed height, so it grows on a tall screen and still leaves room for the fields below
	   it and the dialog's own chrome on a short one; ModalShell's own panel already scrolls past
	   that, so nothing here can push the buttons off screen. */
	.modal-form .field--grow textarea {
		min-height: 30vh;
		max-height: 50vh;
	}
	.modal-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
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

	/* A linked set is a block, not another row in the item list: it is one decision holding many
	   exercises, and flattening it would make ten pinned exercises indistinguishable from ten
	   separately-added items — which is exactly the thing the reader needs to be able to tell. */
	.sets {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.sets h5 {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.set {
		width: 100%;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.set__head {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.set__head h6 {
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.set__provenance {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.set__gone {
		display: block;
	}
	.set__exercises {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--font-size-sm);
	}
	.set__hidden {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
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
