<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import type { TaughtCourse } from '$lib/types/classroom';

	let { course }: { course: TaughtCourse } = $props();

	const STATUS_LABEL = {
		draft: () => m.classroom_status_draft(),
		open: () => m.classroom_status_open(),
		running: () => m.classroom_status_running(),
		finished: () => m.classroom_status_finished()
	};

	// "3 of 12 places left" only means something when there is a cap; an uncapped course should say
	// how many people are in it, not invent a limit to count down from.
	let seatsLine = $derived(
		course.seatsLeft === null
			? m.classroom_participantCount({ count: course.participantCount })
			: m.classroom_seatsLeft({ count: course.seatsLeft, capacity: course.capacity })
	);
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an internal route with a dynamic id segment the rule cannot statically see through -->
<a class="course-card" href={`${resolve('/classroom')}/${course.id}`}>
	<div class="head">
		<h3>{course.title}</h3>
		<span class="status status--{course.status}">{STATUS_LABEL[course.status]()}</span>
	</div>
	{#if course.summary}
		<p class="summary">{course.summary}</p>
	{/if}
	<p class="meta">
		{m.classroom_byInstructor({ name: course.instructor.displayName })}
		· {seatsLine}
		{#if course.enrollmentPolicy === 'approval'}
			· {m.classroom_policy_approval()}
		{/if}
	</p>
	{#if course.myEnrollmentStatus === 'pending'}
		<span class="mine">{m.classroom_yourRequestPending()}</span>
	{:else if course.myEnrollmentStatus === 'active'}
		<span class="mine">{m.classroom_youArePartaking()}</span>
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
