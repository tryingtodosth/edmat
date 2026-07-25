<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Course } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';

	let { course, exerciseCount }: { course: Course; exerciseCount: number } = $props();
</script>

<a class="course-card" href={resolve('/courses/[course]', { course: course.id })}>
	<h3>{course.name}</h3>
	<p class="course-card__university">{course.university}</p>
	<p class="course-card__description">{course.description}</p>
	<span class="course-card__count">{m.course_exerciseCount({ count: exerciseCount })}</span>
</a>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.course-card {
		@include mix.card-surface;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4);
		color: var(--text-primary);
		&:hover {
			border-color: var(--accent);
		}
	}
	.course-card__university {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.course-card__description {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		flex: 1;
	}
	.course-card__count {
		font-size: var(--font-size-xs);
		color: var(--accent);
		font-weight: 600;
	}
</style>
