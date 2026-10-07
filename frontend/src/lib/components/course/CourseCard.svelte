<script lang="ts">
	import AudienceBadge from '$lib/components/shared/AudienceBadge.svelte';
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

<!-- eslint-disable svelte/no-navigation-without-resolve -- an internal route with a dynamic id segment the rule cannot statically see through; a block, not next-line, because the tag spans several lines -->
<a
	class="course-card"
	class:course-card--over={course.status === 'finished'}
	href={`${resolve('/courses')}/${course.id}`}
>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
	<div class="head">
		<h2 class="title">{course.title}</h2>
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
	{#if course.language || course.price || course.fieldSlug || course.subjectSlugs.length > 0}
		<div class="pills">
			<AudienceBadge audience={course.audience} />
			{#if course.language}
				<span class="meta-pill">{course.language}</span>
			{/if}
			{#if course.price}
				<span class="meta-pill price"
					>{m.courses_price({ amount: course.price, currency: course.currency })}</span
				>
			{/if}
			{#if course.fieldSlug}
				<span class="meta-pill">{course.fieldSlug}</span>
			{/if}
			{#each course.subjectSlugs as slug (slug)}
				<span class="meta-pill">{slug}</span>
			{/each}
		</div>
	{/if}
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
	.title {
		font-size: var(--font-size-base);
	}
	// One shape for every status (2026-10-07 colour pass, after review: the uppercase caption left
	// beside the new pills looked unfinished): running and finished are the neutral pill, open the
	// info pill, unlisted the pending pill.
	.status {
		@include mix.neutral-pill;
		font-weight: 600;
		white-space: nowrap;
	}
	.course-card--over .title {
		color: var(--text-secondary);
	}
	// Open is a question the reader is expected to answer (join?), so it takes the info pair.
	.status--open {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
		text-transform: none;
		letter-spacing: normal;
	}
	/* Not findable is not settled, not wrong: an unlisted course is a state its owner chose, so it
	   takes the pending voice (dashed neutral), not warning. It only ever renders for somebody who
	   can already see the course, so it reveals nothing. */
	.status--unlisted {
		@include mix.pending-pill;
		text-transform: none;
		letter-spacing: normal;
	}
	.summary,
	.meta {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.meta-pill {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		font-weight: 600;
	}
	.mine {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-primary);
	}
</style>
