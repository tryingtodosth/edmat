<script lang="ts">
	// "This thread answers Tuesday's question" — filing a discussion into a course, from the thread
	// rather than from the course.
	//
	// Which way round matters. The course's own linking form takes a pasted address, which is fine
	// when you are already editing the week; but a thread is something you come across while reading,
	// and going away to find the course, open the right week and paste a link is how a good answer
	// ends up not filed at all. So the act starts where the thing is.
	//
	// Offered only for courses this person can curate — the list IS the permission check as far as
	// the UI goes, and the server checks again on the write. A course somebody merely takes is not
	// offered, because filing content into it is not theirs to do.
	import { m } from '$lib/paraglide/messages.js';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import { getMyTeaching, getCourse, submitCourseItem } from '$lib/services/course';
	import type { Chapter, Course } from '$lib/types/course';

	let { commentId, onClose }: { commentId: string; onClose: () => void } = $props();

	let courses = $state<Course[]>([]);
	let loading = $state(true);
	let courseId = $state('');
	/** Loaded only once a course is picked: the chapters and lessons of a course nobody has chosen
	 * are a request for nothing. */
	let chapters = $state<Chapter[]>([]);
	let placement = $state('');
	let note = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let done = $state(false);

	$effect(() => {
		// Runs once — nothing it reads is reactive. `getMyTeaching` is already scoped to courses this
		// account runs, so no filtering happens here.
		getMyTeaching()
			.then((rows) => (courses = rows))
			.catch(() => (error = m.common_error_generic()))
			.finally(() => (loading = false));
	});

	async function pickCourse(id: string) {
		courseId = id;
		placement = '';
		chapters = [];
		if (!id) return;
		const course = await getCourse(id);
		chapters = course?.chapters ?? [];
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!courseId || busy) return;
		busy = true;
		error = null;
		try {
			// Prefixed values for the same reason the course page's own "move to" select uses them:
			// chapter 7 and lesson 7 are different destinations that share a number. An empty value
			// means unfiled, which is a real answer — "this belongs in the course, I will place it
			// later" — and is where a contribution sits anyway until somebody files it.
			const [kind, id] = placement ? placement.split(':') : ['', ''];
			await submitCourseItem(courseId, {
				discussionId: commentId,
				chapterId: kind === 'chapter' ? id : null,
				lessonId: kind === 'lesson' ? id : null,
				note: note.trim()
			});
			done = true;
		} catch {
			// The server's refusals here are real and specific — a reply rather than the start of a
			// thread, a thread private to another course, the same thread twice — but they arrive as
			// field errors this dialog has no per-field UI for, so it says the one true general thing
			// rather than inventing a translation of whichever one came back.
			error = m.comment_linkToCourse_failed();
		} finally {
			busy = false;
		}
	}
</script>

<ModalShell title={m.comment_linkToCourse_title()} {onClose}>
	{#if done}
		<p class="done">{m.comment_linkToCourse_done()}</p>
		<div class="modal-actions">
			<button type="button" class="primary" onclick={onClose}>{m.common_close()}</button>
		</div>
	{:else if loading}
		<p class="hint">{m.common_loading()}</p>
	{:else if courses.length === 0}
		<!-- Not an error: most people run no courses at all, and this is the honest answer rather
		     than an empty select that looks broken. -->
		<p class="hint">{m.comment_linkToCourse_noCourses()}</p>
		<div class="modal-actions">
			<button type="button" class="link" onclick={onClose}>{m.common_close()}</button>
		</div>
	{:else}
		<form class="modal-form" onsubmit={submit}>
			<p class="hint">{m.comment_linkToCourse_hint()}</p>
			<label class="field">
				<span>{m.comment_linkToCourse_course()}</span>
				<select value={courseId} onchange={(e) => pickCourse(e.currentTarget.value)}>
					<option value="">{m.comment_linkToCourse_coursePick()}</option>
					{#each courses as course (course.id)}
						<option value={course.id}>{course.title}</option>
					{/each}
				</select>
			</label>

			{#if courseId}
				<label class="field">
					<span>{m.comment_linkToCourse_where()}</span>
					<select bind:value={placement}>
						<option value="">{m.comment_linkToCourse_whereUnfiled()}</option>
						{#each chapters as chapter (chapter.id)}
							<optgroup label={chapter.title}>
								<option value="chapter:{chapter.id}">
									{m.comment_linkToCourse_wholeChapter()}
								</option>
								{#each chapter.lessons as lesson (lesson.id)}
									<option value="lesson:{lesson.id}">{lesson.title}</option>
								{/each}
							</optgroup>
						{/each}
					</select>
				</label>
			{/if}

			<label class="field">
				<span>{m.comment_linkToCourse_note()}</span>
				<input type="text" bind:value={note} maxlength="500" />
			</label>

			{#if error}<p class="error">{error}</p>{/if}

			<div class="modal-actions">
				<button type="submit" class="primary" disabled={!courseId || busy}>
					{m.comment_linkToCourse_submit()}
				</button>
				<button type="button" class="link" onclick={onClose}>{m.common_cancel()}</button>
			</div>
		</form>
	{/if}
</ModalShell>

<style lang="scss">
	.hint,
	.done {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
