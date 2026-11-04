<script lang="ts">
	// One course: what it is, what is in it, and — depending entirely on who is looking — the way in,
	// the way out, or the controls for running it.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	import {
		courseKindLabel,
		COURSE_ATTACHMENT_VISIBILITY_LABELS,
		COURSE_ITEM_VISIBILITY_CHIPS,
		COURSE_RELATION_LABELS,
		licenceShort
	} from '$lib/utils/labels';
	import CourseMaterialsIndex from '$lib/components/course/CourseMaterialsIndex.svelte';
	import CourseVersions from '$lib/components/course/CourseVersions.svelte';
	import CourseSubcourses from '$lib/components/course/CourseSubcourses.svelte';
	import CourseBoard from '$lib/components/course/CourseBoard.svelte';
	import FoldSection from '$lib/components/shared/FoldSection.svelte';
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
		linkSet,
		moveCourseItem,
		setCourseItemVisibility,
		setLinkedSetVisibility,
		refreshLinkedSet,
		reorderCourse,
		unlinkSet,
		saveMyCourseNote,
		updateChapter,
		updateLesson,
		uploadAttachment,
		setAttachmentVisibility,
		muteCourse,
		removeCourseItem,
		submitCourseItem
	} from '$lib/services/course';
	import type {
		Attachment,
		Chapter,
		CourseItem,
		CourseNote,
		Enrollment,
		Course,
		CourseItemKind,
		Lesson,
		LessonExerciseSet
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

	import CourseClaims from '$lib/components/course/CourseClaims.svelte';
	import CourseCompletions from '$lib/components/course/CourseCompletions.svelte';
	import ManagementPanels from '$lib/components/management/ManagementPanels.svelte';
	import { getNodeOrganizations } from '$lib/services/organizations';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import type { OrganizationLink } from '$lib/types/organization';

	import DeckPlacementsPanel from '$lib/components/flashcards/DeckPlacementsPanel.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';
	import LicencePicker from '$lib/components/shared/LicencePicker.svelte';
	import LicenceNotice from '$lib/components/shared/LicenceNotice.svelte';
	import type { Licence } from '$lib/types/licence';
	import { provideAiAssistance } from '$lib/components/provenance/aiAssistance.svelte';

	// The "AI-assisted" mark's page-level holder (provenance/, 2026-10-08). One line, because this
	// page renders a comment thread and `community.Comment` is a target: without it
	// `ContentActionsMenu` hides the item rather than opening a dialog nothing would answer. The
	// holder batches every chip's reading into one request; `setContext` may only run during init.
	provideAiAssistance();

	let course = $state<Course | null>(null);
	let participants = $state<Enrollment[]>([]);
	// Who stands behind this course — ANY organisation with a `runs` or `supports` link, of any kind
	// (`prompts/04-courses-school-mode.md`: "the line that is missing today"). `getNodeOrganizations`
	// has existed since the management layer and was wired nowhere; the panel below it draws the
	// management surfaces, and this one line is what a reader actually wants above the fold.
	let runBy = $state<OrganizationLink[]>([]);
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
	// The file's own licence, starting from the course's (`LicencePicker reason="course"`).
	let attachmentLicence = $state<Licence>('edmat-only');
	let attachmentVisibility = $state<Attachment['visibility']>('participants');
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

		// Who runs it. Behind `organizations` — the flag is asked BEFORE the request rather than
		// after a 403, because house rule 6 read from the other side says do not fire a call the API
		// is going to refuse; and `isLoaded` is waited for because `isEnabled` fails open before the
		// first flag fetch resolves, which is right for drawing a link and wrong for making a call.
		if (featureFlagsStore.isLoaded && !featureFlagsStore.isEnabled('organizations')) {
			runBy = [];
		} else {
			try {
				runBy = await getNodeOrganizations('course', id);
			} catch {
				// The flag off for a non-staff reader, or the node unreadable — either way the line
				// simply does not appear. Not an error worth a banner on somebody's course page.
				runBy = [];
			}
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

	type ReorderPayload =
		| { kind: 'chapter'; order: string[] }
		| { kind: 'lesson' | 'item' | 'lesson_set'; groups: Record<string, string[]> };

	/** Rewrites `course`'s own chapter/lesson/item/set arrays to match a reorder BEFORE the server
	 * has even seen the request, let alone answered it.
	 *
	 * The browser is the one that dragged this — `CourseContent.svelte`'s own `dropOn` already
	 * computed the exact final order, which is precisely what this payload carries — so there is
	 * nothing left for a round trip to teach it. Reloading the whole course after every successful
	 * drop (the previous behaviour) threw that computation away and replaced the entire `course`
	 * object with a freshly-fetched one, which is what actually reads as "the page reloads": every
	 * `<details>` a reader had open, and their scroll position, reset along with it, even though the
	 * one thing that changed was three integers in a database row.
	 *
	 * `course` is a `$state` object owned by this page and passed to `CourseContent` by reference —
	 * mutating it here is the same mutation a reload would have produced, just without asking the
	 * server to hand back data this component already had. */
	function applyReorderLocally(payload: ReorderPayload) {
		if (!course) return;
		if (payload.kind === 'chapter') {
			const byId = new Map(course.chapters.map((c) => [c.id, c]));
			course.chapters = payload.order.map((id) => byId.get(id)).filter((c): c is Chapter => !!c);
			return;
		}
		if (payload.kind === 'lesson') {
			const byId = new Map<string, Lesson>(
				course.chapters.flatMap((chapter) =>
					chapter.lessons.map((lesson) => [lesson.id, lesson] as const)
				)
			);
			for (const chapter of course.chapters) {
				const ids = payload.groups[chapter.id];
				if (ids === undefined) continue;
				chapter.lessons = ids.map((id) => byId.get(id)).filter((l): l is Lesson => !!l);
			}
			return;
		}
		if (payload.kind === 'item') {
			// An item's own group is always a lesson id or '' (unfiled) — chapter-level items are
			// not drag-reorderable at all, so a chapter id never appears as a group key here. See
			// `CourseContent.svelte`'s own `itemGroups()`, which builds the identical shape.
			const byId = new Map<string, CourseItem>([
				...course.unfiledItems.map((item) => [item.id, item] as const),
				...course.chapters.flatMap((chapter) =>
					chapter.lessons.flatMap((lesson) => lesson.items.map((item) => [item.id, item] as const))
				)
			]);
			for (const [group, ids] of Object.entries(payload.groups)) {
				const items = ids.map((id) => byId.get(id)).filter((i): i is CourseItem => !!i);
				if (group === '') {
					course.unfiledItems = items;
					continue;
				}
				for (const chapter of course.chapters) {
					const lesson = chapter.lessons.find((l) => l.id === group);
					if (lesson) lesson.items = items;
				}
			}
			return;
		}
		// 'lesson_set' — a linked set only ever lives in a lesson, same as above.
		const byId = new Map<string, LessonExerciseSet>(
			course.chapters.flatMap((chapter) =>
				chapter.lessons.flatMap((lesson) =>
					lesson.exerciseSets.map((set) => [set.id, set] as const)
				)
			)
		);
		for (const chapter of course.chapters) {
			for (const lesson of chapter.lessons) {
				const ids = payload.groups[lesson.id];
				if (ids === undefined) continue;
				lesson.exerciseSets = ids
					.map((id) => byId.get(id))
					.filter((s): s is LessonExerciseSet => !!s);
			}
		}
	}

	/** Reorder is deliberately NOT routed through `act()`: that helper reloads the whole course on
	 * success, which is exactly the round trip `applyReorderLocally` exists to skip, and it flips
	 * `busy` for the duration — locking the rest of the page's controls for a drag that is meant to
	 * feel instant. A real reload still happens, but only on failure: the optimistic order might not
	 * be what the server actually kept (a validation error, a permission lost mid-session), and a
	 * full reload is the only honest way back to the truth in that case. */
	async function reorder(payload: ReorderPayload) {
		if (!course) return;
		staffError = '';
		applyReorderLocally(payload);
		try {
			await reorderCourse(course.id, payload);
		} catch (e) {
			const detail = (e as { body?: { detail?: string } })?.body?.detail;
			staffError = detail ?? m.common_error_generic();
			await load(page.params.id!);
		}
	}

	async function contribute(input: {
		kind: CourseItemKind;
		id: string;
		/** Set only when the form's own "upload a new file" mode was used — the id above is empty
		 * in that case, since there is no Attachment yet to name. Uploading and filing it in are one
		 * `act()` so a failed upload can never half-add an item, and a successful one refreshes
		 * `attachments` too, so the Files tab shows it without a separate reload. */
		upload?: { file: File; title: string; licence: Licence };
		chapterId: string | null;
		lessonId: string | null;
		note: string;
	}) {
		contributeNotice = '';
		busy = true;
		contributeError = '';
		try {
			let attachmentId = input.id;
			if (input.upload) {
				const created = await uploadAttachment(
					page.params.id!,
					input.upload.file,
					input.upload.title,
					'',
					input.upload.licence
				);
				attachmentId = created.id;
				attachments = [...attachments, created];
			}
			await submitCourseItem(page.params.id!, {
				materialId: input.kind === 'material' ? input.id : undefined,
				exerciseId: input.kind === 'exercise' ? input.id : undefined,
				attachmentId: input.kind === 'attachment' ? attachmentId : undefined,
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
		// The board (2026-10-21): the posts about this course, readable by whoever can open the
		// course. Behind the `posts` switch — a killed feature takes its tab with it (house rule 3).
		if (featureFlagsStore.isEnabled('posts') || authStore.isModerator)
			tabs.push({ id: 'board', label: m.course_tab_board() });
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
	<title>{pageTitle(course?.title ?? m.course_browseHeading())}</title>
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
			<!-- The kind, and for a university course which one: answered above the title's byline
			     because it is the first thing a newcomer needs to know about what they have opened. -->
			{#if course.ancestors.length > 0}
				<!-- The trail above this course, root first (2026-10-21 — a course can be part of a
				     course, any depth): a version links back to its general course, where the other
				     universities' versions and everything they gathered are; a subcourse back to the
				     course it is a part of, and on up. The server cut the trail at the first course
				     this reader may not open. -->
				<nav class="parent-link" aria-label={m.course_tree_trailLabel()} data-course-trail>
					<!-- "Part of" -->
					{#each course.ancestors as ancestor, i (ancestor.id)}
						{#if i > 0}<span class="sep">›</span>{/if}
						<a href={resolve('/courses/[id]', { id: ancestor.id })}>{ancestor.title}</a>
					{/each}
					<span class="sep">›</span>
					<span class="here">{course.title}</span>
				</nav>
			{:else if course.parentSummary}
				<p class="parent-link">
					<a href={resolve('/courses/[id]', { id: course.parentSummary.id })}>
						← {m.course_version_partOf({ title: course.parentSummary.title })}
					</a>
					<!-- "Part of the course “{title}”" -->
				</p>
			{/if}
			<p class="kind-line">
				<span class="kind-pill">
					{course.parentRelation
						? COURSE_RELATION_LABELS[course.parentRelation]()
						: courseKindLabel(course)}
					<!-- "University/faculty version" / "Subcourse" / "A general course" / "A school class" -->
				</span>
				{#if course.kind === 'university'}
					<span>
						{[course.university, course.faculty]
							.filter(Boolean)
							.join(' · ')}{#if course.courseCode}&nbsp;·
							<code>{course.courseCode}</code>{/if}{#if course.currentTerm}&nbsp;· {course.currentTerm}{/if}
					</span>
				{/if}
			</p>
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
			{#if runBy.length > 0}
				<!-- "Run by <organisation>". The body behind the course, which until now appeared
				     nowhere on this page although `organizations` has recorded it since the management
				     layer. Each link resolves its own `kind`, because `runs` ("this is ours") and
				     `supports` ("we are behind it") are two different claims and a line that could not
				     tell them apart would be read as the stronger one every time. Behind the
				     `organizations` switch, which is enforced by `runBy` being empty — the flag is
				     asked in `load`. -->
				<p class="meta run-by">
					{#each runBy as link (link.id)}
						<span>
							{link.kind === 'runs' ? m.school_runByPrefix() : m.school_runBySupports()}
							<!-- "Organised by" / "Supported by" — deliberately NOT "Run by", which is
							     `course_byInstructorPrefix` one line above and names the PERSON. The two
							     read identically in both catalogues until a screenshot showed them
							     stacked: "Run by Barbara Nowakowska / Run by TEST=FAKE Szkoła…". -->
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- internal route with a dynamic slug segment -->
							<a href={`${resolve('/organizations')}/${link.organization.slug}`}>
								{link.organization.name}
							</a>
						</span>
					{/each}
				</p>
			{/if}
			{#if course.school}
				<!-- A class, and it says so to EVERYBODY rather than only to staff. That is the point:
				     the people who run it see every participant's statements and the guardians on the
				     roster (`backend/courses/rules.py`), and the participants are entitled to know
				     that before they look at the progress buttons. -->
				<p class="meta class-notice">
					{m.school_classNotice({ name: course.school.name })}
					<!-- "This is a class run by {name}. The people running it see every participant's
					     progress statements and the guardians on the roster." -->
				</p>
			{/if}
			{#if course.summary}<p class="summary">{course.summary}</p>{/if}
		</header>

		{#if course.description}
			<p class="description">{course.description}</p>
		{/if}
		<!-- The course's own licence (2026-11-02): what is written in it. Linked materials carry
		     their own, and each says so where it differs. -->
		<div class="course-licence">
			<LicenceNotice kind="course" id={course.id} licence={course.licence} />
			<p class="course-licence__scope">{m.courseLicence_scope()}</p>
			<!-- "This covers what is written in the course. Linked materials and exercises keep their own licence." -->
		</div>

		<!-- What the course teaches and what it expects you to know first — the same claims a
		     material carries, rendered by the same components. Above the enrol block: it is what
		     somebody weighs before deciding to join.

		     Folded from the OUTSIDE, which is the one place that is allowed: `ClaimGroups` always
		     draws its two groups, so there is no "it decided to draw nothing" case for a fold header
		     to lie about (house rule 3), and it is shared with `/exercises/[id]` and
		     `/materials/[id]`, which the owner did not ask to change. -->
		<FoldSection key="courseCoverage" title={m.course_coverageHeading()}>
			<!-- "What it covers and expects" -->
			<CourseClaims {course} />
		</FoldSection>

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

		<!-- A general course's university/faculty versions, above the tabs: they are the first thing
		     somebody studying this subject at one university is looking for (owner, 2026-10-14). Any
		     `topic` course may have them since the tree of 2026-10-21 (a subcourse that is a general
		     course of its part may have its universities' versions); a university course has none,
		     and neither does a school class, whose `kind` is still `topic` because school mode is a
		     link, not a kind (`rules.py: parent_is_class`, WP11). Below them, the course's own
		     SUBCOURSES — the parts of it that are courses of their own — on every course but a class. -->
		{#if course.kind === 'topic' && !course.school}
			<CourseVersions {course} />
		{/if}
		{#if !course.school}
			<CourseSubcourses {course} />
		{/if}

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

				<!-- Every material in the course, flat, above the week-by-week structure — the "all
				     the materials in one place" view (owner, 2026-10-14). -->
				<CourseMaterialsIndex {course} />

				<CourseContent
					{course}
					onmove={course.canCurate
						? (itemId, target) =>
								act(
									() => moveCourseItem(course!.id, itemId, target),
									(msg) => (staffError = msg)
								)
						: undefined}
					onreorder={course.canCurate ? reorder : undefined}
					onvisibility={course.canCurate
						? (itemId, visibility) =>
								act(
									() => setCourseItemVisibility(course!.id, itemId, visibility),
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
					onlinkcontent={course.canCurate
						? (parentKind, parentId, ref, note, visibility) =>
								act(
									() =>
										submitCourseItem(course!.id, {
											// One of these six; the editor never produces more, and the
											// server refuses anything that names two.
											exerciseId: ref.kind === 'exercise' ? ref.id : undefined,
											materialId: ref.kind === 'material' ? ref.id : undefined,
											discussionId: ref.kind === 'discussion' ? ref.id : undefined,
											linkedCourseId: ref.kind === 'course' ? ref.id : undefined,
											postId: ref.kind === 'post' ? ref.id : undefined,
											linkUrl: ref.kind === 'link' ? ref.url : undefined,
											linkTitle: ref.kind === 'link' ? ref.title : undefined,
											chapterId: parentKind === 'chapter' ? parentId : null,
											lessonId: parentKind === 'lesson' ? parentId : null,
											note,
											visibility
										}),
									(msg) => (staffError = msg)
								)
						: undefined}
					onlinkset={course.canCurate
						? (parentKind, parentId, setSlug, visibility) =>
								act(
									() => linkSet(course!.id, parentKind, parentId, setSlug, '', visibility),
									(msg) => (staffError = msg)
								)
						: undefined}
					onsetvisibility={course.canCurate
						? (parentKind, parentId, linkId, visibility) =>
								act(
									() =>
										setLinkedSetVisibility(course!.id, parentKind, parentId, linkId, visibility),
									(msg) => (staffError = msg)
								)
						: undefined}
					onrefreshset={course.canCurate
						? (parentKind, parentId, linkId) =>
								act(
									() => refreshLinkedSet(course!.id, parentKind, parentId, linkId),
									(msg) => (staffError = msg)
								)
						: undefined}
					onunlinkset={course.canCurate
						? (parentKind, parentId, linkId) =>
								act(
									() => unlinkSet(course!.id, parentKind, parentId, linkId),
									(msg) => (staffError = msg)
								)
						: undefined}
				/>

				<!-- Creating a chapter. The handler for this was written and never rendered, so a curator
		     could rename and delete chapters through CourseContent but had no way to make one — a
		     course whose structure could only ever shrink. It sits directly under the content it
		     adds to, rather than on the manage page, because it is the one curator action whose
		     result appears right here.
		     A real card with its own heading, not a dashed rule under the last chapter — that read
		     as a continuation of whatever was above it, and "Add a chapter" only ever appeared as
		     the button's own label, so nothing said what the fields below it were for until you'd
		     already read the button past them. -->
				{#if course.canCurate}
					<FoldSection key="courseAddChapter" title={m.course_chapters_add()} level={3}>
						<div class="add-panel">
							<form class="add-panel__form" onsubmit={addChapter}>
								<div class="add-panel__grid">
									<label class="field">
										<span>{m.course_chapters_title()}</span>
										<input type="text" bind:value={newChapterTitle} maxlength="200" required />
									</label>
									<label class="field">
										<span>{m.course_chapters_unlocksAt()}</span>
										<!-- Optional, and empty means never gated — genuinely different from a date
									     that has already passed, which is why it is not defaulted to today. -->
										<input type="datetime-local" bind:value={newChapterUnlocksAt} />
									</label>
								</div>
								<p class="add-panel__hint">{m.course_chapters_unlocksAtHint()}</p>
								<button type="submit" class="primary" disabled={busy || !newChapterTitle.trim()}>
									{m.course_chapters_add()}
								</button>
							</form>
						</div>
					</FoldSection>
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
						{attachments}
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
										{#if attachment.licence !== course.licence}
											<span class="hint" data-testid="attachment-own-licence"
												>{m.courseLicence_ownTag({
													licence: licenceShort(attachment.licence)
												})}</span
											>
											<!-- "own licence: {licence}" -->
										{/if}
										{#if attachment.averageRating !== null}
											<span class="hint">{attachment.averageRating} ★</span>
										{/if}
										{#if attachment.canChangeVisibility}
											<select
												class="attachment-visibility"
												value={attachment.visibility}
												aria-label={m.courseFileVis_label()}
												data-testid="attachment-visibility"
												onchange={(e) => {
													const value = (e.currentTarget as HTMLSelectElement)
														.value as Attachment['visibility'];
													run(async () => {
														await setAttachmentVisibility(course!.id, attachment.id, value);
														attachments = await getAttachments(course!.id);
													});
												}}
											>
												<option value="participants"
													>{COURSE_ATTACHMENT_VISIBILITY_LABELS.participants()}</option
												>
												<option value="staff">{COURSE_ITEM_VISIBILITY_CHIPS.staff()}</option>
											</select>
										{:else if attachment.visibility === 'staff'}
											<span class="audience-pill" data-testid="attachment-audience"
												>{COURSE_ITEM_VISIBILITY_CHIPS.staff()}</span
											>
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
										await uploadAttachment(
											course!.id,
											file,
											title,
											'',
											attachmentLicence,
											attachmentVisibility
										);
										attachments = await getAttachments(course!.id);
										attachmentFile = null;
										attachmentTitle = '';
										attachmentVisibility = 'participants';
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
								<label class="field">
									<span>{m.courseFileVis_label()}</span>
									<!-- "Who sees this file" -->
									<select bind:value={attachmentVisibility} data-testid="attachment-visibility-new">
										<option value="participants"
											>{COURSE_ATTACHMENT_VISIBILITY_LABELS.participants()}</option
										>
										<option value="staff">{COURSE_ATTACHMENT_VISIBILITY_LABELS.staff()}</option>
									</select>
									<span class="hint">{m.courseFileVis_hint()}</span>
									<!-- "“Only the people running the course” is how you hand something to the teacher alone. You always see your own files." -->
								</label>
								<LicencePicker
									bind:value={attachmentLicence}
									name="attachment-licence"
									compact
									suggested={course.licence}
									reason="course"
								/>
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
							<DiscussionThread {comments} {usersById} canPost={false} onSubmit={() => {}} />
						{/if}
					</section>
				{:else if course.discussionMode !== 'off'}
					<section class="discussion-section">
						<h2>{m.course_discussionHeading()}</h2>
						<p class="status">{m.course_discussionParticipantsOnly()}</p>
					</section>
				{/if}
			{/if}

			{#if activeTab === 'board'}
				<CourseBoard {course} />
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
										<!-- The name and its badge share one line: the row is a flex COLUMN, so a
										     badge left as its own child was stretched across the full width (WP11). -->
										<span class="who">
											<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- internal route with a dynamic id segment -->
											<a href={`${resolve('/users')}/${row.participant.id}`}
												>{row.participant.displayName}</a
											>
											{#if row.isMinor}
												<span class="badge">{m.school_minorBadge()}</span>
												<!-- "under 16" -->
											{/if}
										</span>
										{#if row.isMinor || row.guardians.length > 0}
											<!-- School mode's guardian column. Drawn off the ROW rather than off
											     `course.school`, because the server is the only thing that knows
											     whether this viewer was answered these fields — a client deciding
											     for itself would draw an empty column for a pupil's classmate.
											     `guardians: []` with `isMinor: true` is a real and important state:
											     a child with nobody on file, which is the row a teacher chases. -->
											<span class="guardians">
												{m.school_guardiansHeading()}:
												<!-- "Guardian" -->
												{#if row.guardians.length === 0}
													<em>{m.school_guardianNone()}</em>
													<!-- "nobody on file" -->
												{:else}
													{#each row.guardians as guardian, i (guardian.id)}
														{#if i > 0},{/if}
														<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- internal route with a dynamic id segment -->
														<a href={`${resolve('/users')}/${guardian.id}`}>
															{guardian.displayName}
														</a>
													{/each}
												{/if}
											</span>
										{/if}
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

			<!-- The management layer (MANAGEMENT-BRIEF.md §2): organisations, tasks, needs, plans and
			     polls hung on this course, each behind its own switch. Below every tab, because it is
			     about running the course rather than any one part of it. -->
			<!-- Completion certificates. Below the tabs like the management panels, because a
			     certificate is about the course as a whole rather than about any one part of it — and
			     above them, because it is the one of these that a participant has a reason to look
			     for. It renders nothing at all when there is nothing to say. -->
			<CourseCompletions courseId={course.id} canCurate={course.canCurate} {participants} />

			<ManagementPanels nodeKind="course" nodeId={course.id} />
			<!-- learning: deck placements (A) — the decks placed on this course (flashcards.DeckPlacement),
			     mounted directly below this comment behind `flashcards`. -->
			<DeckPlacementsPanel nodeKind="course" nodeId={course.id} canManage={course.canCurate} />
			<!-- learning: completion (C) — the completion-certificate controls and the "run by" line are
			     C's, in C's own sections above; this marker records that nothing of C's mounts here. -->
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
	.kind-line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.parent-link {
		font-size: var(--font-size-sm);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		.sep {
			color: var(--text-secondary);
		}
		.here {
			color: var(--text-secondary);
		}
	}
	.kind-line code {
		font-family: var(--font-mono);
	}
	.kind-pill {
		@include mix.neutral-pill;
		font-weight: 600;
	}
	h2 {
		font-size: var(--font-size-base);
	}
	.meta,
	.status,
	.summary {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.course-licence {
		font-size: var(--font-size-sm);
	}
	.audience-pill {
		@include mix.neutral-pill;
		white-space: nowrap;
		font-size: var(--font-size-xs);
	}
	/* One row per file: title, its facts, and — for whoever may change it — a small audience select
	   at the end of the line rather than a full-width control under it. */
	.attachments {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		li {
			display: flex;
			/* The page's generic `li` rule is a column; a file row is a line. */
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2);
			padding: var(--space-1) 0;
			border-bottom: 1px solid var(--border-color);
		}
	}
	.attachment-visibility {
		width: auto;
		margin-left: auto;
		font-size: var(--font-size-xs);
		padding: 2px var(--space-1);
	}
	.course-licence__scope {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.description {
		white-space: pre-wrap;
	}
	.run-by {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.class-notice {
		max-width: 60ch;
	}
	.who {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
	}
	.badge {
		font-size: var(--font-size-xs);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		padding: 0 0.5em;
		white-space: nowrap;
	}
	.guardians {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
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
	// A real card, and the shape both "add" panels in this tab now share — see the identical
	// .add-panel* block in CourseContribute.svelte. Not pulled into a shared mixin: two occurrences
	// is the threshold this codebase leaves alone, per its own "three strikes" convention.
	// The card and the heading are `FoldSection`'s since 2026-10-08; this is its body.
	.add-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
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
	.add-panel__hint {
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
