<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import type { Course } from '$lib/types/course';

	let { course }: { course: Course } = $props();

	const STATUS_LABEL = {
		open: () => m.course_status_open(),
		running: () => m.course_status_running(),
		finished: () => m.course_status_finished()
	};

	// Only shown when the course is NOT public. On a listing everything is public by definition, so a
	// "Public" badge on every card would be noise; the useful signal is the opposite — an owner
	// glancing at their own courses needs to see at once which ones nobody else can find yet.
	const VISIBILITY_LABEL = {
		only_you: () => m.course_visibility_onlyYou(),
		private: () => m.course_visibility_private(),
		public: () => ''
	};
	let visibilityLabel = $derived(VISIBILITY_LABEL[course.visibility]?.() ?? '');

	// "3 of 12 places left" only means something when there is a cap; an uncapped course should say
	// how many people are in it, not invent a limit to count down from.
	let seatsLine = $derived(
		course.seatsLeft === null
			? m.course_participantCount({ count: course.participantCount })
			: m.course_seatsLeft({ count: course.seatsLeft, capacity: course.capacity })
	);
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an internal route with a dynamic id segment the rule cannot statically see through -->
<a class="course-card" href={`${resolve('/courses')}/${course.id}`}>
	<div class="head">
		<h3>{course.title}</h3>
		{#if visibilityLabel}
			<span class="status status--unlisted">{visibilityLabel}</span>
		{/if}
		<span class="status status--{course.status}">{STATUS_LABEL[course.status]()}</span>
	</div>
	{#if course.summary}
		<p class="summary">{course.summary}</p>
	{/if}
	<p class="meta">
		{m.course_byInstructor({ name: course.instructor.displayName })}
		· {seatsLine}
		{#if course.enrollmentPolicy === 'approval'}
			· {m.course_policy_approval()}
		{/if}
	</p>
	{#if course.myEnrollmentStatus === 'pending'}
		<span class="mine">{m.course_yourRequestPending()}</span>
	{:else if course.myEnrollmentStatus === 'active'}
		<span class="mine">{m.course_youArePartaking()}</span>
	{/if}
</a>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.course-card {
		@include mix.card-surface;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		color: inherit;
		&:hover {
			border-color: var(--accent);
		}
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		align-items: baseline;
	}
	h3 {
		font-size: var(--font-size-md);
	}
	.status {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.status--open {
		color: var(--accent);
	}
	/* Warning-toned, not danger: an unlisted course is a state its owner chose, not a fault. It only
	   ever renders for somebody who can already see the course, so it reveals nothing. */
	.status--unlisted {
		color: var(--status-warning);
	}
	.summary,
	.meta {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.mine {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--accent);
	}
</style>
