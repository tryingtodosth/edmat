<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { page } from '$app/state';
	import { createCourse, getCourse } from '$lib/services/course';
	import type { Course } from '$lib/types/course';
	import { courseWriteErrorMessage, SUBCOURSE_REFUSAL_LABELS } from '$lib/utils/labels';
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
				parentMissing = !found || Boolean(found.parent);
			})
			.catch(() => (parentMissing = true));
	});
	let heading = $derived(parentId ? m.course_version_add() : m.course_runACourse());

	async function submit(draft: TaughtCourseDraft) {
		submitting = true;
		error = '';
		try {
			const created = await createCourse(draft);
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
		     versions (`backend/courses/rules.py: parent_is_class`), and an old link must not lead to a
		     form the server will turn down. -->
		<p class="status">{SUBCOURSE_REFUSAL_LABELS.parent_is_class()}</p>
		<!-- "A school class has no university or faculty versions." -->
	{:else if parentId && parentMissing}
		<p class="status">{m.course_version_refusal_parentNotFound()}</p>
		<!-- "That general course is not visible to you." -->
	{:else if parentId && !parent}
		<p class="status">{m.common_loading()}</p>
	{:else}
		<p class="lead">{parent ? m.course_version_lead() : m.course_newLead()}</p>
		<!-- "One university's (and faculty's) version of this course: …" -->
		{#key parent?.id}
			<CourseForm {parent} submitLabel={m.course_create()} {submitting} {error} onsubmit={submit} />
		{/key}
	{/if}
</div>

<style lang="scss">
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
	.lead,
	.status {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
</style>
