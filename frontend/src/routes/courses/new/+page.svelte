<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { addCourseStaff, createCourse, getCourse, sendEmailInvites } from '$lib/services/course';
	import { ApiError } from '$lib/api/client';
	import type { CollaboratorsDraft } from '$lib/components/course/CourseCollaboratorsDraft.svelte';
	import type { Course } from '$lib/types/course';
	import {
		courseWriteErrorMessage,
		emailInviteReasonLabel,
		SUBCOURSE_REFUSAL_LABELS
	} from '$lib/utils/labels';
	import { authStore } from '$lib/state/auth.svelte';
	// The creation gate (learning step F): somebody can still reach this address by typing it or
	// following an old link, so the page says WHY rather than showing a form the server would
	// refuse — the `REFUSAL[reason]()` idiom, in a component because eight surfaces need it.
	import { creationStore } from '$lib/state/creation.svelte';
	import CreationGateNote from '$lib/components/shared/CreationGateNote.svelte';
	import type { TaughtCourseDraft } from '$lib/types/course';
	import CourseForm from '$lib/components/course/CourseForm.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	let submitting = $state(false);
	let error = $state('');

	// `?parent=<id>` — adding a university/faculty version of that general course (its page's
	// "Add a university/faculty version" link). Loaded in an effect, never at the top level (an
	// SSR-time service call is trap 5 in frontend/CLAUDE.md), with the id guard trap 2 asks for.
	// Who may: anybody the creation gate lets found a course and who can see the general course —
	// `backend/courses/rules.py` decides, and its refusal words come back as sentences.
	let parentId = $derived(page.url.searchParams.get('parent'));
	// `&as=subcourse` — a part of that course rather than a university's version of it (2026-10-21).
	// The server tells the two apart by the kinds and refuses a subcourse from anybody who does not
	// run the parent (`not_parent_staff`); the page only picks the words.
	let asSubcourse = $derived(page.url.searchParams.get('as') === 'subcourse');
	let parent = $state<Course | null>(null);
	let parentMissing = $state(false);
	let parentLoadedFor = $state<string | null>(null);
	$effect(() => {
		const id = parentId;
		if (id === parentLoadedFor) return;
		parentLoadedFor = id;
		parent = null;
		parentMissing = false;
		if (!id) return;
		getCourse(id)
			.then((found) => {
				if (parentLoadedFor !== id) return;
				parent = found ?? null;
				parentMissing = !found;
			})
			.catch(() => (parentMissing = true));
	});
	let heading = $derived(
		parentId ? (asSubcourse ? m.course_tree_add() : m.course_version_add()) : m.course_runACourse()
	);

	// What happened to the collaborators once the course existed (2026-11-02). The course is made
	// first — nothing can be added to a course that does not exist — and then each person and each
	// address goes through the course page's own endpoints. Partial success is the normal answer:
	// when everything went through the page moves on; when anything did not, it stays here and says
	// what, with the course already made and one link to it.
	interface CollabOutcome {
		courseId: string;
		added: number;
		sent: number;
		problems: { who: string; why: string }[];
	}
	let outcome = $state<CollabOutcome | null>(null);

	async function addCollaborators(
		courseId: string,
		collab: CollaboratorsDraft
	): Promise<CollabOutcome> {
		const result: CollabOutcome = { courseId, added: 0, sent: 0, problems: [] };
		for (const person of collab.people) {
			try {
				await addCourseStaff(courseId, person.userId, person.role);
				result.added += 1;
			} catch {
				result.problems.push({ who: person.displayName, why: m.courseCollab_addFailed() }); // "Could not be added — try again from the course’s staff panel."
			}
		}
		if (collab.emails.length > 0) {
			try {
				const sent = await sendEmailInvites(courseId, collab.emails, collab.emailRole);
				for (const row of sent.results) {
					if (row.ok) result.sent += 1;
					else result.problems.push({ who: row.email, why: emailInviteReasonLabel(row.reason) });
				}
			} catch (e) {
				const word =
					e instanceof ApiError && e.body && typeof e.body === 'object'
						? String((e.body as Record<string, unknown>).detail ?? '')
						: '';
				result.problems.push({ who: collab.emails.join(', '), why: emailInviteReasonLabel(word) });
			}
		}
		return result;
	}

	async function submit(draft: TaughtCourseDraft, collab: CollaboratorsDraft) {
		submitting = true;
		error = '';
		try {
			const created = await createCourse(draft);
			const result = await addCollaborators(created.id, collab);
			if (result.problems.length > 0) {
				outcome = result;
				return;
			}
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- internal route with a dynamic id segment
			await goto(`${resolve('/courses')}/${created.id}`);
		} catch (e) {
			error = courseWriteErrorMessage(e, m.common_error_generic());
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(heading)}</title>
</svelte:head>

<div class="page">
	<h1>{heading}</h1>
	<!-- "Add a university/faculty version" / "Start a course or community" -->
	{#if authStore.restoring}
		<p class="session-restoring">{m.common_loading()}</p>
	{:else if !authStore.isAuthenticated}
		<p data-session-hidden class="status">{m.course_refusal_signIn()}</p>
		<a href={resolve('/login')}>{m.nav_login()}</a>
	{:else if creationStore.reasonFor('course') !== null}
		<CreationGateNote kind="course" />
	{:else if !creationStore.allows('course')}
		<p class="status">{m.common_loading()}</p>
	{:else if parent?.school}
		<!-- Asked before the form rather than after a refused submit: a school class takes no
		     versions and no subcourses (`backend/courses/rules.py: parent_is_class`), and an old link
		     must not lead to a form the server will turn down. -->
		<p class="status">{SUBCOURSE_REFUSAL_LABELS.parent_is_class()}</p>
		<!-- "A school class has no university or faculty versions." -->
	{:else if parent && asSubcourse && !parent.canCurate}
		<p class="status">{SUBCOURSE_REFUSAL_LABELS.not_parent_staff()}</p>
		<!-- "Only the people who run a course can add subcourses to it." -->
	{:else if parent && !asSubcourse && parent.kind !== 'topic'}
		<!-- A version hangs under a GENERAL course; under one university's course the only thing to
		     add is a subcourse, so say so rather than draw a form the server will refuse. -->
		<p class="status">{m.course_tree_versionNeedsGeneral()}</p>
		<!-- "Versions are added under a general course. Under one university's course you can add a subcourse instead." -->
	{:else if parentId && parentMissing}
		<p class="status">{m.course_version_refusal_parentNotFound()}</p>
		<!-- "That general course is not visible to you." -->
	{:else if parentId && !parent}
		<p class="status">{m.common_loading()}</p>
	{:else if outcome}
		<section class="outcome" data-testid="collab-outcome" aria-live="polite">
			<p>
				{m.courseCollab_outcome({ added: outcome.added, sent: outcome.sent })}
				<!-- "The course is made. People added: {added}. Invitations sent: {sent}." -->
			</p>
			<p>{m.courseCollab_outcomeProblems()}</p>
			<!-- "These did not go through:" -->
			<ul>
				{#each outcome.problems as problem (problem.who)}
					<li><strong>{problem.who}</strong> — {problem.why}</li>
				{/each}
			</ul>
			<a class="primary" href={resolve('/courses/[id]', { id: outcome.courseId })}
				>{m.courseCollab_goToCourse()}</a
			>
			<!-- "Go to the course" -->
		</section>
	{:else}
		<p class="lead">
			{parent ? (asSubcourse ? m.course_tree_lead() : m.course_version_lead()) : m.course_newLead()}
		</p>
		<!-- "A part of this course that is a course of its own: …" / "One university's (and faculty's) version of this course: …" -->
		{#key parent?.id}
			<CourseForm
				{parent}
				as={asSubcourse ? 'subcourse' : 'version'}
				submitLabel={m.course_create()}
				{submitting}
				{error}
				onsubmit={submit}
			/>
		{/key}
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.outcome {
		@include mix.status-message(warning);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		ul {
			margin: 0;
			padding-left: var(--space-4);
		}
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
	}
	.lead,
	.status {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
</style>
