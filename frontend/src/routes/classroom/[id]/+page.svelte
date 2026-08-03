<script lang="ts">
	// One course: what it is, what is in it, and — depending entirely on who is looking — the way in,
	// the way out, or the controls for running it.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	import {
		addCourseStaff,
		addLesson,
		createChapter,
		createInvite,
		decideCourseItem,
		decideEnrollment,
		deleteChapter,
		deleteCourse,
		deleteLesson,
		enrol,
		EnrolmentRefused,
		getCourse,
		getCourseStaff,
		getInvites,
		getParticipants,
		leaveCourse,
		moveCourseItem,
		muteCourse,
		removeCourseItem,
		removeCourseStaff,
		revokeInvite,
		setCourseStaffRole,
		submitCourseItem
	} from '$lib/services/classroom';
	import type {
		CourseInvite,
		CourseStaffMember,
		Enrollment,
		TaughtCourse
	} from '$lib/types/classroom';
	import CourseContent from '$lib/components/classroom/CourseContent.svelte';
	import CourseContribute from '$lib/components/classroom/CourseContribute.svelte';
	import CourseInvites from '$lib/components/classroom/CourseInvites.svelte';
	import CourseReviewQueue from '$lib/components/classroom/CourseReviewQueue.svelte';
	import CourseStaffPanel from '$lib/components/classroom/CourseStaffPanel.svelte';
	import type { Comment, User } from '$lib/types';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { authStore } from '$lib/state/auth.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';

	let course = $state<TaughtCourse | null>(null);
	let participants = $state<Enrollment[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let busy = $state(false);
	let refusal = $state<string | null>(null);
	let requestNote = $state('');

	let staff = $state<CourseStaffMember[]>([]);
	let invites = $state<CourseInvite[]>([]);
	let staffError = $state('');
	let inviteError = $state('');
	let contributeError = $state('');
	let contributeNotice = $state('');

	// New-chapter form, kept here rather than in CourseContent: that component renders for everybody,
	// and creating a chapter is a curator's action, so the two have genuinely different audiences.
	let newChapterTitle = $state('');
	let newChapterUnlocksAt = $state('');

	/** Everything offered and not yet decided on. Derived from the course payload, which already
	 * contains only what this viewer may see — a participant's copy simply has none. */
	let pendingItems = $derived(
		[
			...(course?.unfiledItems ?? []),
			...(course?.chapters ?? []).flatMap((chapter) => chapter.items)
		].filter((item) => item.status === 'pending')
	);

	let newLessonTitle = $state('');
	let newLessonNotes = $state('');

	let comments = $state<Comment[]>([]);
	let usersById = $state<Record<string, User>>({});

	/** Author names for the thread, resolved once per unseen id — the same shape the tutoring
	 * listing page already uses, rather than a second way of doing it. */
	async function loadCommentAuthors(rows: Comment[]) {
		const unique = [...new Set(rows.map((c) => c.authorId))].filter((id) => id && !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const u of found) if (u) next[u.id] = u;
		usersById = next;
	}

	async function loadDiscussion(id: string, allowed: boolean) {
		if (!allowed) {
			comments = [];
			return;
		}
		try {
			comments = await getCommentsForTarget('taughtCourse', id);
			await loadCommentAuthors(comments);
		} catch {
			// A 403 here is the feature working, not an error worth showing: the course simply does
			// not let this person read the thread.
			comments = [];
		}
	}

	async function postComment(body: string, parentId?: string) {
		await submitComment('taughtCourse', page.params.id!, authStore.user?.id ?? '', body, parentId);
		await loadDiscussion(page.params.id!, true);
	}

	// Every refusal the API can give, each said in its own words. Collapsing them into one "you
	// cannot join" would throw away precisely the information the person needs to act on: being
	// full is a matter of waiting, being removed is not.
	const REFUSAL = {
		authentication_required: () => m.classroom_refusal_signIn(),
		instructor_cannot_enrol: () => m.classroom_refusal_yourOwnCourse(),
		not_open: () => m.classroom_refusal_notOpen(),
		already_enrolled: () => m.classroom_refusal_already(),
		removed: () => m.classroom_refusal_removed(),
		full: () => m.classroom_refusal_full()
	} as Record<string, () => string>;

	async function load(id: string) {
		loading = true;
		notFound = false;
		const found = await getCourse(id);
		if (!found) {
			notFound = true;
			loading = false;
			return;
		}
		course = found;
		// The roster is not public, so this is expected to fail for a stranger — an empty list is the
		// right outcome, not an error the page should show.
		if (found.isInstructor || found.myEnrollmentStatus === 'active') {
			try {
				participants = await getParticipants(id);
			} catch {
				participants = [];
			}
		} else {
			participants = [];
		}

		// Who runs it is readable by anybody in the room; the links are an administrator's alone, so
		// they are only fetched when the viewer actually has them. Both fail softly for the same
		// reason the roster does — a refusal here is the permission working, not a page error.
		if (found.isInstructor || found.myEnrollmentStatus === 'active') {
			try {
				staff = await getCourseStaff(id);
			} catch {
				staff = [];
			}
		} else {
			staff = [];
		}
		if (found.canAdminister) {
			try {
				invites = await getInvites(id);
			} catch {
				invites = [];
			}
		} else {
			invites = [];
		}

		await loadDiscussion(id, found.canReadDiscussion);
		loading = false;
	}

	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		load(id);
	});

	async function run(fn: () => Promise<unknown>) {
		busy = true;
		refusal = null;
		try {
			await fn();
			await load(page.params.id!);
		} catch (e) {
			refusal = e instanceof EnrolmentRefused ? e.reason : 'generic';
		} finally {
			busy = false;
		}
	}

	/** The same shape as `run`, but reporting into a named error slot rather than the enrolment
	 * refusal banner — these failures belong beside the control that caused them. */
	async function act(fn: () => Promise<unknown>, onError: (message: string) => void) {
		busy = true;
		onError('');
		try {
			await fn();
			await load(page.params.id!);
		} catch (e) {
			const detail = (e as { body?: { detail?: string } })?.body?.detail;
			onError(detail ?? m.common_error_generic());
		} finally {
			busy = false;
		}
	}

	async function contribute(input: {
		kind: 'material' | 'exercise';
		id: string;
		chapterId: string | null;
		note: string;
	}) {
		contributeNotice = '';
		busy = true;
		contributeError = '';
		try {
			await submitCourseItem(page.params.id!, {
				materialId: input.kind === 'material' ? input.id : undefined,
				exerciseId: input.kind === 'exercise' ? input.id : undefined,
				chapterId: input.chapterId,
				note: input.note
			});
			// Which message is right depends on whether it published or queued — telling somebody it
			// was added when it is actually waiting is how a review queue loses people's trust.
			contributeNotice = course?.contributionNeedsApproval
				? m.classroom_contribute_queued()
				: m.classroom_contribute_done();
			await load(page.params.id!);
		} catch (e) {
			const detail = (e as { body?: { detail?: string } })?.body?.detail;
			contributeError =
				detail === 'already_in_course'
					? m.classroom_contribute_duplicate()
					: detail === 'contributions_closed' || detail === 'not_a_participant'
						? m.classroom_contribute_closed()
						: m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	function addChapter(event: SubmitEvent) {
		event.preventDefault();
		const title = newChapterTitle.trim();
		if (!title) return;
		const unlocksAt = newChapterUnlocksAt || null;
		newChapterTitle = '';
		newChapterUnlocksAt = '';
		act(
			() =>
				createChapter(page.params.id!, {
					title,
					description: '',
					order: (course?.chapters.length ?? 0) + 1,
					unlocksAt
				}),
			(msg) => (staffError = msg)
		);
	}

	let isPending = $derived(course?.myEnrollmentStatus === 'pending');
	let isActive = $derived(course?.myEnrollmentStatus === 'active');
	let pendingRequests = $derived(participants.filter((p) => p.status === 'pending'));
	let activeParticipants = $derived(participants.filter((p) => p.status === 'active'));
</script>

<svelte:head>
	<title>{course?.title ?? m.classroom_browseHeading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if notFound || !course}
		<p class="status">{m.classroom_notFound()}</p>
	{:else}
		<header class="head">
			<h1>{course.title}</h1>
			<p class="meta">
				<!-- The author's name links to their profile: who is running a course is the main thing
				     somebody weighs before joining, and their profile is where standing, portfolio and
				     other courses already live.

				     Split into a prefix plus the name rather than interpolating one message, because
				     only the name should be the link. Safe for both locales here — "Run by {name}" and
				     "Prowadzi {name}" both end in the placeholder — but a language that puts the name
				     first would need its own arrangement rather than this concatenation. -->
				{m.classroom_byInstructorPrefix()}
				<a class="author" href={resolve('/users/[id]', { id: course.instructor.id })}>
					{course.instructor.displayName}
				</a>
				{#if course.startsOn}· {course.startsOn}{/if}
				{#if course.price}· {course.price} {course.currency}{/if}
			</p>
			{#if course.summary}<p class="summary">{course.summary}</p>{/if}
		</header>

		{#if course.description}
			<p class="description">{course.description}</p>
		{/if}

		<!-- Joining, leaving, or the reason neither is on offer. -->
		<section class="enrol">
			{#if course.isInstructor}
				<p class="note">{m.classroom_youRunThis()}</p>
				<div class="actions">
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- internal route with a dynamic id segment -->
					<a class="secondary" href={`${resolve('/classroom')}/${course.id}/edit`}>
						{m.classroom_edit()}
					</a>
					<button
						type="button"
						class="danger"
						disabled={busy}
						onclick={() =>
							run(async () => {
								await deleteCourse(course!.id);
								await goto(resolve('/classroom/mine'));
							})}
					>
						{m.classroom_delete()}
					</button>
				</div>
			{:else if isActive}
				<p class="note">{m.classroom_youArePartaking()}</p>
				<button type="button" disabled={busy} onclick={() => run(() => leaveCourse(course!.id))}>
					{m.classroom_leave()}
				</button>
			{:else if isPending}
				<p class="note">{m.classroom_yourRequestPending()}</p>
				<button type="button" disabled={busy} onclick={() => run(() => leaveCourse(course!.id))}>
					{m.classroom_withdrawRequest()}
				</button>
			{:else if course.canEnrol}
				{#if course.enrollmentPolicy === 'approval'}
					<label class="field">
						<span>{m.classroom_requestNoteLabel()}</span>
						<textarea bind:value={requestNote} maxlength="500" rows="3"></textarea>
					</label>
				{/if}
				<button
					type="button"
					class="primary"
					disabled={busy}
					onclick={() => run(() => enrol(course!.id, requestNote))}
				>
					{course.enrollmentPolicy === 'approval'
						? m.classroom_requestToJoin()
						: m.classroom_join()}
				</button>
			{:else if course.enrollmentBlockReason}
				<p class="note">{REFUSAL[course.enrollmentBlockReason]?.() ?? m.common_error_generic()}</p>
				{#if course.enrollmentBlockReason === 'authentication_required'}
					<a class="secondary" href={resolve('/login')}>{m.nav_login()}</a>
				{/if}
			{/if}

			{#if refusal}
				<p class="error">{REFUSAL[refusal]?.() ?? m.common_error_generic()}</p>
			{/if}
		</section>

		<!-- Content: chapters and the materials/exercises filed under them. Rendered for everybody,
		     including a stranger, because what a course contains is part of deciding to join — the
		     server has already decided which items and which locked chapters this viewer may see. -->
		<CourseContent
			{course}
			onmove={course.canCurate
				? (itemId, chapterId) =>
						act(
							() => moveCourseItem(course!.id, itemId, chapterId),
							(msg) => (staffError = msg)
						)
				: undefined}
			onremove={(itemId) =>
				act(
					() => removeCourseItem(course!.id, itemId),
					(msg) => (contributeError = msg)
				)}
			ondeletechapter={course.canCurate
				? (chapterId) =>
						act(
							() => deleteChapter(course!.id, chapterId),
							(msg) => (staffError = msg)
						)
				: undefined}
		/>

		{#if course.canCurate}
			<section class="chapter-new">
				<h2>{m.classroom_chapters_heading()}</h2>
				<form onsubmit={addChapter}>
					<label class="field">
						<span>{m.classroom_chapters_title()}</span>
						<input type="text" bind:value={newChapterTitle} maxlength="200" required />
					</label>
					<label class="field">
						<span>{m.classroom_chapters_unlocksAt()}</span>
						<input type="datetime-local" bind:value={newChapterUnlocksAt} />
						<!-- Empty means open immediately, which is genuinely different from a date in the
						     past: the first was never gated at all. -->
						<span class="hint">{m.classroom_chapters_unlocksAtHint()}</span>
					</label>
					<button type="submit" class="small" disabled={busy}>
						{m.classroom_chapters_add()}
					</button>
				</form>
			</section>
		{/if}

		{#if course.canContribute}
			<CourseContribute
				{course}
				{busy}
				error={contributeError}
				notice={contributeNotice}
				onsubmit={contribute}
			/>
		{/if}

		{#if course.canCurate && pendingItems.length > 0}
			<CourseReviewQueue
				pending={pendingItems}
				{busy}
				ondecide={(itemId, decision, note) =>
					act(
						() => decideCourseItem(course!.id, itemId, decision, note),
						(msg) => (contributeError = msg)
					)}
			/>
		{/if}

		{#if staff.length > 0}
			<CourseStaffPanel
				{course}
				{staff}
				error={staffError}
				onadd={(userId, role) =>
					act(
						() => addCourseStaff(course!.id, userId, role),
						(msg) => (staffError = msg)
					)}
				onrole={(staffId, role) =>
					act(
						() => setCourseStaffRole(course!.id, staffId, role),
						(msg) => (staffError = msg)
					)}
				onremove={(staffId) =>
					act(
						() => removeCourseStaff(course!.id, staffId),
						(msg) => (staffError = msg)
					)}
			/>
		{/if}

		{#if course.canAdminister}
			<CourseInvites
				{invites}
				error={inviteError}
				oncreate={(draft) =>
					act(
						() => createInvite(course!.id, draft),
						(msg) => (inviteError = msg)
					)}
				onrevoke={(inviteId) =>
					act(
						() => revokeInvite(course!.id, inviteId),
						(msg) => (inviteError = msg)
					)}
			/>
		{/if}

		<!-- Lessons. Titles and blurbs are public so somebody can judge whether to join; the notes
		     are the part worth joining for, and the API blanks them for anyone who has not. -->
		<section class="lessons">
			<h2>{m.classroom_lessonsHeading()}</h2>
			{#if course.lessons.length === 0}
				<p class="status">{m.classroom_noLessons()}</p>
			{:else}
				<ol>
					{#each course.lessons as lesson (lesson.id)}
						<li>
							<div class="lesson-head">
								<strong>{lesson.title}</strong>
								{#if lesson.scheduledAt}
									<span class="meta">{new Date(lesson.scheduledAt).toLocaleString()}</span>
								{/if}
							</div>
							{#if lesson.description}<p class="meta">{lesson.description}</p>{/if}
							{#if lesson.participantNotes}
								<p class="notes">{lesson.participantNotes}</p>
							{:else if !isActive && !course.isInstructor}
								<p class="meta locked">{m.classroom_notesForParticipants()}</p>
							{/if}
							{#if course.isInstructor}
								<button
									type="button"
									class="danger small"
									disabled={busy}
									onclick={() => run(() => deleteLesson(course!.id, lesson.id))}
								>
									{m.classroom_deleteLesson()}
								</button>
							{/if}
						</li>
					{/each}
				</ol>
			{/if}

			{#if course.isInstructor}
				<form
					class="add-lesson"
					onsubmit={(e) => {
						e.preventDefault();
						const title = newLessonTitle.trim();
						if (!title) return;
						run(async () => {
							await addLesson(course!.id, {
								title,
								description: '',
								order: course!.lessons.length + 1,
								scheduledAt: null,
								durationMinutes: null,
								participantNotes: newLessonNotes
							});
							newLessonTitle = '';
							newLessonNotes = '';
						});
					}}
				>
					<label class="field">
						<span>{m.classroom_newLessonTitle()}</span>
						<input type="text" bind:value={newLessonTitle} maxlength="200" />
					</label>
					<label class="field">
						<span>{m.classroom_newLessonNotes()}</span>
						<textarea bind:value={newLessonNotes} rows="2"></textarea>
					</label>
					<button type="submit" class="primary" disabled={busy}>{m.classroom_addLesson()}</button>
				</form>
			{/if}
		</section>

		<!-- The discussion. `canReadDiscussion`/`canPostDiscussion` are resolved server-side, because
		     whether this viewer may read or post depends on the course's mode AND their membership. -->
		{#if course.canReadDiscussion}
			<section class="discussion-section">
				<h2>{m.classroom_discussionHeading()}</h2>
				{#if course.canPostDiscussion}
					<DiscussionThread {comments} {usersById} onSubmit={postComment} />
				{:else}
					<!-- A public thread: readable by anyone, writable only by the people in the course. -->
					<p class="status">{m.classroom_discussionReadOnly()}</p>
					<DiscussionThread {comments} {usersById} onSubmit={() => {}} />
				{/if}
			</section>
		{:else if course.discussionMode !== 'off'}
			<section class="discussion-section">
				<h2>{m.classroom_discussionHeading()}</h2>
				<p class="status">{m.classroom_discussionParticipantsOnly()}</p>
			</section>
		{/if}

		<!-- Per-course mute: stay in, stop hearing about it. Only ever offered to somebody who is
		     actually in the course, since there is nothing to mute otherwise. -->
		{#if isActive}
			<section class="mute-section">
				<label class="mute">
					<input
						type="checkbox"
						checked={course.notifyMe ?? true}
						disabled={busy}
						onchange={(e) => run(() => muteCourse(course!.id, e.currentTarget.checked))}
					/>
					<span>{m.classroom_notifyMe()}</span>
				</label>
			</section>
		{/if}

		<!-- The roster, and — for the instructor only — the requests waiting on a decision. -->
		{#if course.isInstructor || isActive}
			<section class="roster">
				<h2>{m.classroom_participantsHeading({ count: activeParticipants.length })}</h2>
				{#if activeParticipants.length === 0}
					<p class="status">{m.classroom_noParticipants()}</p>
				{:else}
					<ul>
						{#each activeParticipants as row (row.id)}
							<li>
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- internal route with a dynamic id segment -->
								<a href={`${resolve('/users')}/${row.participant.id}`}
									>{row.participant.displayName}</a
								>
								{#if course.isInstructor}
									<button
										type="button"
										class="danger small"
										disabled={busy}
										onclick={() => run(() => decideEnrollment(course!.id, row.id, 'remove'))}
									>
										{m.classroom_remove()}
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				{#if course.isInstructor && pendingRequests.length > 0}
					<h2>{m.classroom_requestsHeading({ count: pendingRequests.length })}</h2>
					<ul>
						{#each pendingRequests as row (row.id)}
							<li class="request">
								<div>
									<strong>{row.participant.displayName}</strong>
									{#if row.requestNote}<p class="meta">{row.requestNote}</p>{/if}
								</div>
								<div class="actions">
									<button
										type="button"
										class="primary small"
										disabled={busy}
										onclick={() => run(() => decideEnrollment(course!.id, row.id, 'approve'))}
									>
										{m.classroom_approve()}
									</button>
									<button
										type="button"
										class="small"
										disabled={busy}
										onclick={() => run(() => decideEnrollment(course!.id, row.id, 'decline'))}
									>
										{m.classroom_decline()}
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.chapter-new form {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.chapter-new .field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.chapter-new .hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.chapter-new input {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}

	.page {
		max-width: 800px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	h2 {
		font-size: var(--font-size-md);
	}
	.meta,
	.status,
	.summary {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.description {
		white-space: pre-wrap;
	}
	.mute {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.locked {
		font-style: italic;
	}
	.notes {
		border-left: 3px solid var(--accent);
		padding-left: var(--space-3);
		white-space: pre-wrap;
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.enrol,
	.lessons,
	.roster,
	.discussion-section,
	.mute-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-color);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	button,
	.secondary {
		@include mix.focus-ring;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: inherit;
		align-self: flex-start;
		&:disabled {
			opacity: 0.55;
			cursor: not-allowed;
		}
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
	}
	.danger {
		color: var(--status-danger);
	}
	.small {
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-xs);
	}
	ol,
	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
	}
	li {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.request {
		flex-direction: row;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.lesson-head {
		display: flex;
		gap: var(--space-2);
		align-items: baseline;
		justify-content: space-between;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
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
	.add-lesson {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-2);
	}
</style>
