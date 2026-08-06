<script lang="ts">
	// Running a course, on its own page.
	//
	// All of this used to sit on the course page itself, inside collapsed `<details>` drawers, which
	// had two costs. A participant scrolled past "Invite links" and "Who runs it" to reach the
	// discussion — sections they can neither see into nor act on. And an instructor got a page that
	// was the course *and* its administration at once, fourteen sections deep, where the thing they
	// came to do was always shut inside a drawer.
	//
	// Split, each page can be what it is: the course page is what a participant sees, and this is the
	// desk you run it from. Staff-only, and scoped the same way the API scopes it — a non-curator is
	// sent back rather than shown an empty shell.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages.js';
	import type { Course, CourseInvite, CourseItem, CourseStaffMember } from '$lib/types/course';
	import type { InviteRole, StaffRole } from '$lib/types/course';
	import {
		createChapter,
		createInvite,
		decideCourseItem,
		getCourse,
		getInvites,
		getCourseStaff,
		addCourseStaff,
		removeCourseStaff,
		revokeInvite,
		setCourseStaffRole
	} from '$lib/services/course';
	import CourseInvites from '$lib/components/course/CourseInvites.svelte';
	import CourseReviewQueue from '$lib/components/course/CourseReviewQueue.svelte';
	import CourseStaffPanel from '$lib/components/course/CourseStaffPanel.svelte';

	let course = $state<Course | undefined>(undefined);
	let staff = $state<CourseStaffMember[]>([]);
	let invites = $state<CourseInvite[]>([]);
	let loading = $state(true);
	let refused = $state(false);
	let busy = $state(false);
	let staffError = $state('');
	let inviteError = $state('');
	let reviewError = $state('');

	let newChapterTitle = $state('');
	let newChapterUnlocksAt = $state('');

	const courseId = $derived(page.params.id!);

	let pending = $derived<CourseItem[]>(
		(course?.chapters ?? [])
			.flatMap((chapter) => chapter.lessons.flatMap((lesson) => lesson.items))
			.concat(course?.unfiledItems ?? [])
			.filter((item) => item.status === 'pending')
	);

	async function load() {
		loading = true;
		refused = false;
		const found = await getCourse(courseId);
		// Not a redirect to an error page: somebody who cannot manage this course may perfectly well
		// be *in* it, so the useful place to send them is the course itself.
		if (!found || !(found.canCurate || found.canAdminister)) {
			refused = true;
			loading = false;
			return;
		}
		course = found;
		try {
			staff = await getCourseStaff(courseId);
		} catch {
			staff = [];
		}
		if (found.canAdminister) {
			try {
				invites = await getInvites(courseId);
			} catch {
				invites = [];
			}
		}
		loading = false;
	}

	$effect(() => {
		if (courseId) load();
	});

	/** Run one write, surface its message where the reader is looking, and reload. */
	async function act(fn: () => Promise<unknown>, onError: (msg: string) => void) {
		busy = true;
		onError('');
		try {
			await fn();
			await load();
		} catch (e) {
			onError(e instanceof Error ? e.message : String(e));
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>{course?.title ?? m.common_appName()} — {m.course_manageHeading()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if refused}
		<p class="status">{m.course_manage_refused()}</p>
		<a class="back" href={resolve('/courses/[id]', { id: courseId })}>{m.course_backToCourse()}</a>
	{:else if course}
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/courses/[id]', { id: course.id })}>{course.title}</a>
		</nav>
		<h1>{m.course_manageHeading()}</h1>

		<!-- Review first, and never behind a disclosure: somebody is waiting on a decision, and a
		     queue nobody is told about is a queue that stalls. -->
		<section>
			<h2>{m.course_manage_review()}</h2>
			{#if pending.length === 0}
				<p class="status">{m.course_review_empty()}</p>
			{:else}
				<CourseReviewQueue
					{pending}
					{busy}
					ondecide={(itemId, decision, note) =>
						act(
							() => decideCourseItem(course!.id, itemId, decision, note),
							(msg) => (reviewError = msg)
						)}
				/>
			{/if}
			{#if reviewError}<p class="error">{reviewError}</p>{/if}
		</section>

		<section>
			<h2>{m.course_chapters_heading()}</h2>
			<form
				class="chapter-form"
				onsubmit={(e) => {
					e.preventDefault();
					const title = newChapterTitle.trim();
					if (!title) return;
					act(
						() =>
							createChapter(course!.id, {
								title,
								description: '',
								order: (course!.chapters?.length ?? 0) + 1,
								unlocksAt: newChapterUnlocksAt
									? new Date(newChapterUnlocksAt).toISOString()
									: null
							}),
						(msg) => (staffError = msg)
					).then(() => {
						newChapterTitle = '';
						newChapterUnlocksAt = '';
					});
				}}
			>
				<label class="field">
					<span>{m.course_chapters_title()}</span>
					<input type="text" bind:value={newChapterTitle} maxlength="200" required />
				</label>
				<label class="field">
					<span>{m.course_chapters_unlocksAt()}</span>
					<input type="datetime-local" bind:value={newChapterUnlocksAt} />
					<!-- Empty means open immediately, which is genuinely different from a date in the
					     past: the first was never gated at all. -->
					<span class="hint">{m.course_chapters_unlocksAtHint()}</span>
				</label>
				<button type="submit" class="primary" disabled={busy}>{m.course_chapters_add()}</button>
			</form>
		</section>

		<section>
			<!-- No <h2> here: CourseStaffPanel renders its own, and two headings for one panel is
			     exactly the duplication this page was made to remove. -->
			<CourseStaffPanel
				{course}
				{staff}
				error={staffError}
				onadd={(userId, role) =>
					act(
						() => addCourseStaff(course!.id, userId, role as Exclude<StaffRole, 'owner'>),
						(msg) => (staffError = msg)
					)}
				onrole={(staffId, role) =>
					act(
						() =>
							setCourseStaffRole(course!.id, staffId, role as Exclude<StaffRole, 'owner'>),
						(msg) => (staffError = msg)
					)}
				onremove={(staffId) =>
					act(
						() => removeCourseStaff(course!.id, staffId),
						(msg) => (staffError = msg)
					)}
			/>
		</section>

		{#if course.canAdminister}
			<section>
				<!-- Same: CourseInvites brings its own heading. -->
				<CourseInvites
					{invites}
					error={inviteError}
					oncreate={(draft) =>
						act(
							() => createInvite(course!.id, draft as { role: InviteRole } & typeof draft),
							(msg) => (inviteError = msg)
						)}
					onrevoke={(inviteId) =>
						act(
							() => revokeInvite(course!.id, inviteId),
							(msg) => (inviteError = msg)
						)}
				/>
			</section>

			<section>
				<h2>{m.course_settings_heading()}</h2>
				<button
					type="button"
					class="secondary"
					onclick={() => goto(resolve('/courses/[id]', { id: course!.id }) + '?edit=1')}
				>
					{m.course_edit()}
				</button>
			</section>
		{/if}
	{/if}
</div>

<style lang="scss">
	.page {
		max-width: 860px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
		}
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	h2 {
		font-size: var(--font-size-lg);
		margin-bottom: var(--space-2);
	}
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-color);
	}
	.status,
	.hint {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.chapter-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 32rem;
	}
	.back {
		color: var(--accent);
	}
</style>
