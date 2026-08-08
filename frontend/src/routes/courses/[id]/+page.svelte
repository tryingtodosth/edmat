<script lang="ts">
	// One course: what it is, what is in it, and — depending entirely on who is looking — the way in,
	// the way out, or the controls for running it.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	import {
		addLesson,
		createChapter,
		decideEnrollment,
		deleteChapter,
		deleteCourse,
		deleteLesson,
		enrol,
		EnrolmentRefused,
		getCourse,
		getParticipants,
		leaveCourse,
		getAttachments,
		getMyCourseNotes,
		linkSetToLesson,
		moveCourseItem,
		refreshLinkedSet,
		reorderCourse,
		unlinkSetFromLesson,
		saveMyCourseNote,
		updateChapter,
		updateLesson,
		uploadAttachment,
		muteCourse,
		removeCourseItem,
		submitCourseItem
	} from '$lib/services/course';
	import type {
		Attachment,
		CourseNote,
		Enrollment,
		Course,
		CourseItemKind
	} from '$lib/types/course';
	import CourseContent from '$lib/components/course/CourseContent.svelte';
	import CourseReports from '$lib/components/course/CourseReports.svelte';
	import CourseSearch from '$lib/components/course/CourseSearch.svelte';
	import Tabs, { type TabDef } from '$lib/components/shared/Tabs.svelte';
	import CourseContribute from '$lib/components/course/CourseContribute.svelte';
	import type { Comment, User } from '$lib/types';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { authStore } from '$lib/state/auth.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';

	let course = $state<Course | null>(null);
	let participants = $state<Enrollment[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let busy = $state(false);
	let refusal = $state<string | null>(null);
	let requestNote = $state('');

	let staffError = $state('');
	let contributeError = $state('');
	let contributeNotice = $state('');

	// New-chapter form, kept here rather than in CourseContent: that component renders for everybody,
	// and creating a chapter is a curator's action, so the two have genuinely different audiences.
	let newChapterTitle = $state('');
	let newChapterUnlocksAt = $state('');

	/** Everything offered and not yet decided on. Derived from the course payload, which already
	 * contains only what this viewer may see — a participant's copy simply has none. */

	let comments = $state<Comment[]>([]);

	// The reader's own notes. Only ever their own — the API filters by author, so there is nothing
	// here that could be pointed at somebody else's.
	let attachments = $state<Attachment[]>([]);
	let attachmentFile = $state<File | null>(null);
	let attachmentTitle = $state('');
	let myNotes = $state<CourseNote[]>([]);
	let noteDraft = $state('');
	let noteSaved = $state(false);
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
		authentication_required: () => m.course_refusal_signIn(),
		instructor_cannot_enrol: () => m.course_refusal_yourOwnCourse(),
		not_open: () => m.course_refusal_notOpen(),
		already_enrolled: () => m.course_refusal_already(),
		removed: () => m.course_refusal_removed(),
		full: () => m.course_refusal_full()
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

		// The reader's own notes, if they have an account. Fails softly for the same reason the
		// roster below does: a refusal is the permission working, not a page error.
		if (authStore.user) {
			try {
				myNotes = await getMyCourseNotes(id);
				noteDraft = myNotes.find((n) => n.lessonId === null)?.body ?? '';
			} catch {
				myNotes = [];
				noteDraft = '';
			}
			// Members only, so a stranger's 404 here is the permission working rather than an error
			// the page should show — the same soft failure the roster already uses.
			try {
				attachments = await getAttachments(id);
			} catch {
				attachments = [];
			}
		} else {
			myNotes = [];
			noteDraft = '';
			attachments = [];
		}

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

		// The staff list and the invite links moved to /courses/[id]/manage along with everything
		// that acts on them. They were still being fetched here and then used by nothing, which is
		// two requests per course page view spent on data nobody reads.

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
		kind: CourseItemKind;
		id: string;
		chapterId: string | null;
		lessonId: string | null;
		note: string;
	}) {
		contributeNotice = '';
		busy = true;
		contributeError = '';
		try {
			await submitCourseItem(page.params.id!, {
				materialId: input.kind === 'material' ? input.id : undefined,
				exerciseId: input.kind === 'exercise' ? input.id : undefined,
				attachmentId: input.kind === 'attachment' ? input.id : undefined,
				eventId: input.kind === 'event' ? input.id : undefined,
				chapterId: input.chapterId,
				lessonId: input.lessonId,
				note: input.note
			});
			// Which message is right depends on whether it published or queued — telling somebody it
			// was added when it is actually waiting is how a review queue loses people's trust.
			contributeNotice = course?.contributionNeedsApproval
				? m.course_contribute_queued()
				: m.course_contribute_done();
			await load(page.params.id!);
		} catch (e) {
			const detail = (e as { body?: { detail?: string } })?.body?.detail;
			contributeError =
				detail === 'already_in_course'
					? m.course_contribute_duplicate()
					: detail === 'contributions_closed' || detail === 'not_a_participant'
						? m.course_contribute_closed()
						: m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	function addChapter(event: SubmitEvent) {
		event.preventDefault();
		staffError = '';
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

	// Which sections exist depends on who is looking: a stranger gets content only, and the API has
	// already decided the rest. A tab nobody can open would be a promise the page cannot keep.
	let courseTabs = $derived.by(() => {
		if (!course) return [];
		const tabs: TabDef[] = [{ id: 'content', label: m.course_tab_content() }];
		if (course.myEnrollmentStatus === 'active' || course.isInstructor || course.canCurate)
			tabs.push({ id: 'attachments', label: m.course_tab_attachments() });
		if (authStore.user) tabs.push({ id: 'notes', label: m.course_tab_notes() });
		if (course.canReadDiscussion) tabs.push({ id: 'discussion', label: m.course_tab_discussion() });
		if (course.isInstructor || course.myEnrollmentStatus === 'active')
			tabs.push({
				id: 'people',
				label: m.course_tab_people(),
				// The instructor's own waiting requests, on the tab that answers them.
				badge: course.isInstructor ? pendingRequests.length : undefined
			});
		return tabs;
	});

	// Read from the URL every render rather than latched at mount: `course` and `authStore` both
	// resolve asynchronously, so anything captured at mount answers with what was true before either
	// arrived. An unknown or now-hidden tab falls back to content, so a stale link still lands.
	let activeTab = $derived.by(() => {
		const asked = page.url.searchParams.get('tab');
		return asked && courseTabs.some((t) => t.id === asked) ? asked : 'content';
	});

	let isPending = $derived(course?.myEnrollmentStatus === 'pending');
	let isActive = $derived(course?.myEnrollmentStatus === 'active');
	let pendingRequests = $derived(participants.filter((p) => p.status === 'pending'));
	let activeParticipants = $derived(participants.filter((p) => p.status === 'active'));
</script>

<svelte:head>
	<title>{course?.title ?? m.course_browseHeading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if notFound || !course}
		<p class="status">{m.course_notFound()}</p>
	{:else}
		<!-- `id` so a search hit on the course's own summary or description has somewhere to land: this
		     block sits above the tabs, so there is no tab to switch to, only a place to scroll to. -->
		<header class="head" id="course-overview">
			<h1>{course.title}</h1>
			<p class="meta">
				<!-- The author's name links to their profile: who is running a course is the main thing
				     somebody weighs before joining, and their profile is where standing, portfolio and
				     other courses already live.

				     Split into a prefix plus the name rather than interpolating one message, because
				     only the name should be the link. Safe for both locales here — "Run by {name}" and
				     "Prowadzi {name}" both end in the placeholder — but a language that puts the name
				     first would need its own arrangement rather than this concatenation. -->
				{m.course_byInstructorPrefix()}
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
				<p class="note">{m.course_youRunThis()}</p>
				<div class="actions">
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- internal route with a dynamic id segment -->
					<a class="secondary" href={`${resolve('/courses')}/${course.id}/edit`}>
						{m.course_edit()}
					</a>
					<button
						type="button"
						class="danger"
						disabled={busy}
						onclick={() =>
							run(async () => {
								await deleteCourse(course!.id);
								await goto(resolve('/courses/mine'));
							})}
					>
						{m.course_delete()}
					</button>
				</div>
			{:else if isActive}
				<p class="note">{m.course_youArePartaking()}</p>
				<button type="button" disabled={busy} onclick={() => run(() => leaveCourse(course!.id))}>
					{m.course_leave()}
				</button>
			{:else if isPending}
				<p class="note">{m.course_yourRequestPending()}</p>
				<button type="button" disabled={busy} onclick={() => run(() => leaveCourse(course!.id))}>
					{m.course_withdrawRequest()}
				</button>
			{:else if course.canEnrol}
				{#if course.enrollmentPolicy === 'approval'}
					<label class="field">
						<span>{m.course_requestNoteLabel()}</span>
						<textarea bind:value={requestNote} maxlength="500" rows="3"></textarea>
					</label>
				{/if}
				<button
					type="button"
					class="primary"
					disabled={busy}
					onclick={() => run(() => enrol(course!.id, requestNote))}
				>
					{course.enrollmentPolicy === 'approval' ? m.course_requestToJoin() : m.course_join()}
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

		<!-- Outside the tabs on purpose. The manage link is navigation to another page and is
		     relevant whichever tab you are on; the notify checkbox governs notifications about both
		     lessons AND posts, so it belongs to no single tab, and one line is small enough to sit
		     here rather than be filed somewhere half-right. -->
		<div class="course-actions">
			{#if course.canCurate || course.canAdminister}
				<p class="manage-link">
					<a href={resolve('/courses/[id]/manage', { id: course.id })}>
						{m.course_manage_link()}
					</a>
					{#if course.pendingContributionCount > 0}
						<!-- Surfaced here rather than only on the manage page: a queue nobody is told about
						     is a queue that stalls. -->
						<span class="manage-link__badge">
							{m.course_review_count({ count: course.pendingContributionCount })}
						</span>
					{/if}
				</p>
				<!-- What has been reported inside this course. Here rather than on the manage page
				     because it is the one management job that is time-sensitive: an auto-hidden
				     comment is hidden from everybody right now, waiting on somebody to look. -->
				<CourseReports courseId={course.id} />
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
						<span>{m.course_notifyMe()}</span>
					</label>
				</section>
			{/if}
		</div>

		<!-- Above the tabs, deliberately: it finds things that live on four different ones, and
		     somebody who cannot remember which tab a thing was on will not think to pick it first. -->
		<CourseSearch {course} />

		<!-- Six stacked sections became five tabs. Everything past the first screenful was invisible:
		     a participant scrolled through content they cannot act on to reach the discussion, and
		     the roster was below all of it. -->
		<Tabs
			tabs={courseTabs}
			active={activeTab}
			defaultTab="content"
			idPrefix="coursetab"
			panelPrefix="coursetabpanel"
		/>

		<div
			role="tabpanel"
			id="coursetabpanel-{activeTab}"
			aria-labelledby="coursetab-{activeTab}"
			tabindex="-1"
			class="tab-panel"
		>
			{#if activeTab === 'content'}
				<!-- Content: chapters and the materials/exercises filed under them. Rendered for everybody,
		     including a stranger, because what a course contains is part of deciding to join — the
		     server has already decided which items and which locked chapters this viewer may see. -->
				<!-- Seven curator actions on this page write to `staffError` — reordering, moving an item,
		     renaming or deleting a chapter, creating one — and none of them showed it. A refusal
		     from the server was swallowed, so a drag that the server rejected looked exactly like a
		     drag that worked until the page was reloaded. Same bug the bookings page had. -->
				{#if staffError}
					<p class="error staff-error">{staffError}</p>
				{/if}

				<CourseContent
					{course}
					onmove={course.canCurate
						? (itemId, target) =>
								act(
									() => moveCourseItem(course!.id, itemId, target),
									(msg) => (staffError = msg)
								)
						: undefined}
					onreorder={course.canCurate
						? (payload) =>
								act(
									() => reorderCourse(course!.id, payload),
									(msg) => (staffError = msg)
								)
						: undefined}
					onremove={(itemId) =>
						act(
							() => removeCourseItem(course!.id, itemId),
							(msg) => (contributeError = msg)
						)}
					oneditchapter={course.canCurate
						? (chapterId, patch) =>
								act(
									() => updateChapter(course!.id, chapterId, patch),
									(msg) => (staffError = msg)
								)
						: undefined}
					oneditlesson={course.canCurate
						? (lessonId, patch) =>
								act(
									() => updateLesson(course!.id, lessonId, patch),
									(msg) => (staffError = msg)
								)
						: undefined}
					ondeletelesson={course.canCurate
						? (lessonId) =>
								act(
									() => deleteLesson(course!.id, lessonId),
									(msg) => (staffError = msg)
								)
						: undefined}
					onaddlesson={course.canCurate
						? (chapterId, draft) =>
								act(
									() =>
										addLesson(course!.id, {
											...draft,
											chapterId,
											// A new lesson goes to the end of its chapter, which is what
											// adding one means; dragging is how it moves from there.
											order: course!.chapters.find((c) => c.id === chapterId)?.lessons.length ?? 0,
											scheduledAt: null,
											durationMinutes: null
										}),
									(msg) => (staffError = msg)
								)
						: undefined}
					ondeletechapter={course.canCurate
						? (chapterId) =>
								act(
									() => deleteChapter(course!.id, chapterId),
									(msg) => (staffError = msg)
								)
						: undefined}
					onlinkset={course.canCurate
						? (lessonId, setSlug) =>
								act(
									() => linkSetToLesson(course!.id, lessonId, setSlug),
									(msg) => (staffError = msg)
								)
						: undefined}
					onrefreshset={course.canCurate
						? (lessonId, linkId) =>
								act(
									() => refreshLinkedSet(course!.id, lessonId, linkId),
									(msg) => (staffError = msg)
								)
						: undefined}
					onunlinkset={course.canCurate
						? (lessonId, linkId) =>
								act(
									() => unlinkSetFromLesson(course!.id, lessonId, linkId),
									(msg) => (staffError = msg)
								)
						: undefined}
				/>

				<!-- Creating a chapter. The handler for this was written and never rendered, so a curator
		     could rename and delete chapters through CourseContent but had no way to make one — a
		     course whose structure could only ever shrink. It sits directly under the content it
		     adds to, rather than on the manage page, because it is the one curator action whose
		     result appears right here. -->
				{#if course.canCurate}
					<form class="add-chapter" onsubmit={addChapter}>
						<div class="add-chapter__row">
							<label>
								<span>{m.course_chapters_title()}</span>
								<input type="text" bind:value={newChapterTitle} maxlength="200" required />
							</label>
							<label>
								<span>{m.course_chapters_unlocksAt()}</span>
								<!-- Optional, and empty means never gated — genuinely different from a date that
						     has already passed, which is why it is not defaulted to today. -->
								<input type="datetime-local" bind:value={newChapterUnlocksAt} />
							</label>
							<button type="submit" class="primary" disabled={busy || !newChapterTitle.trim()}>
								{m.course_chapters_add()}
							</button>
						</div>
						<small class="add-chapter__hint">{m.course_chapters_unlocksAtHint()}</small>
					</form>
				{/if}

				<!-- Lessons. Titles and blurbs are public so somebody can judge whether to join; the notes
		     are the part worth joining for, and the API blanks them for anyone who has not. -->
				<!-- Running the course lives on its own page now. It used to be four collapsed drawers here,
		     which meant a participant scrolled past sections they cannot act on, and an instructor
		     found the thing they came to do always shut. -->
				<!-- Shown to curators too, which it was not. The condition used to be
				     `canContribute && !canCurate`, so the one group of people whose job is filling a
				     course in had no way to add anything to it from this page — and the form's own
				     chapter picker, gated on `canCurate`, could therefore never render at all. That is
				     also why nobody noticed the picker did nothing: it was unreachable. Staff never
				     queue behind themselves, which the server already decides, so this stays one form
				     rather than two. -->
				{#if course.canContribute}
					<CourseContribute
						{course}
						{busy}
						error={contributeError}
						notice={contributeNotice}
						onsubmit={contribute}
					/>
				{/if}
			{/if}

			{#if activeTab === 'attachments'}
				<!-- The course's own files. Members only, and never listed for a stranger: an attachment is
		     not corpus, it is the pile of files this course keeps. -->
				{#if course.myEnrollmentStatus === 'active' || course.isInstructor || course.canCurate}
					<section class="attachments-section">
						<h2>{m.course_attachments_heading()}</h2>
						{#if attachments.length === 0}
							<p class="status">{m.course_attachments_empty()}</p>
						{:else}
							<ul class="attachments">
								{#each attachments as attachment (attachment.id)}
									<li>
										<a
											href={resolve('/courses/[id]/attachments/[attachmentId]', {
												id: course.id,
												attachmentId: attachment.id
											})}
										>
											{attachment.title}
										</a>
										{#if attachment.averageRating !== null}
											<span class="hint">{attachment.averageRating} ★</span>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						{#if course.canContribute}
							<form
								onsubmit={(e) => {
									e.preventDefault();
									const file = attachmentFile;
									const title = attachmentTitle.trim();
									if (!file || !title) return;
									run(async () => {
										await uploadAttachment(course!.id, file, title);
										attachments = await getAttachments(course!.id);
										attachmentFile = null;
										attachmentTitle = '';
									});
								}}
							>
								<label class="field">
									<span>{m.course_attachments_title()}</span>
									<input type="text" bind:value={attachmentTitle} maxlength="200" />
								</label>
								<label class="field">
									<span>{m.course_attachments_file()}</span>
									<input
										type="file"
										onchange={(e) =>
											(attachmentFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
									/>
								</label>
								<button type="submit" class="primary" disabled={busy}>
									{m.course_attachments_upload()}
								</button>
							</form>
						{/if}
					</section>
				{/if}
			{/if}

			{#if activeTab === 'notes'}
				<!-- Private notes. Shown to anybody signed in who can open the course, including staff:
		     running a course does not stop somebody wanting notes of their own on it. -->
				{#if authStore.user}
					<section class="notes-section">
						<h2>{m.course_notes_heading()}</h2>
						<p class="hint">{m.course_notes_privateHint()}</p>
						<form
							onsubmit={(e) => {
								e.preventDefault();
								run(async () => {
									await saveMyCourseNote(course!.id, noteDraft);
									myNotes = await getMyCourseNotes(course!.id);
									noteSaved = true;
								});
							}}
						>
							<textarea
								bind:value={noteDraft}
								rows="4"
								placeholder={m.course_notes_placeholder()}
								oninput={() => (noteSaved = false)}></textarea>
							<div class="notes-actions">
								<button type="submit" class="primary" disabled={busy}
									>{m.course_notes_save()}</button
								>
								{#if noteSaved}
									<span class="hint">{m.course_notes_saved()}</span>
								{/if}
							</div>
						</form>
					</section>
				{/if}
			{/if}

			{#if activeTab === 'discussion'}
				<!-- The discussion. `canReadDiscussion`/`canPostDiscussion` are resolved server-side, because
		     whether this viewer may read or post depends on the course's mode AND their membership. -->
				{#if course.canReadDiscussion}
					<section class="discussion-section">
						<h2>{m.course_discussionHeading()}</h2>
						{#if course.canPostDiscussion}
							<DiscussionThread {comments} {usersById} onSubmit={postComment} />
						{:else}
							<!-- A public thread: readable by anyone, writable only by the people in the course. -->
							<p class="status">{m.course_discussionReadOnly()}</p>
							<DiscussionThread {comments} {usersById} onSubmit={() => {}} />
						{/if}
					</section>
				{:else if course.discussionMode !== 'off'}
					<section class="discussion-section">
						<h2>{m.course_discussionHeading()}</h2>
						<p class="status">{m.course_discussionParticipantsOnly()}</p>
					</section>
				{/if}
			{/if}

			{#if activeTab === 'people'}
				<!-- The roster, and — for the instructor only — the requests waiting on a decision. -->
				{#if course.isInstructor || isActive}
					<section class="roster">
						<h2>{m.course_participantsHeading({ count: activeParticipants.length })}</h2>
						{#if activeParticipants.length === 0}
							<p class="status">{m.course_noParticipants()}</p>
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
												{m.course_remove()}
											</button>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}

						{#if course.isInstructor && pendingRequests.length > 0}
							<h2>{m.course_requestsHeading({ count: pendingRequests.length })}</h2>
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
												{m.course_approve()}
											</button>
											<button
												type="button"
												class="small"
												disabled={busy}
												onclick={() => run(() => decideEnrollment(course!.id, row.id, 'decline'))}
											>
												{m.course_decline()}
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
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	/* The panels inside a drawer were written as top-level sections and carry their own h2, which at
	   page size competed with the drawer label right above it. Demoted visually only — the heading
	   level itself is left alone, since that is what a screen reader navigates by. */

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
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.enrol,
	.roster,
	.discussion-section,
	.mute-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-color);
	}
	.add-chapter {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px dashed var(--border-color);
	}
	.add-chapter__row {
		display: flex;
		gap: var(--space-3);
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.add-chapter__row label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.add-chapter__hint {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	.manage-link {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.manage-link__badge {
		font-size: var(--font-size-sm);
		color: var(--status-danger);
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
</style>
