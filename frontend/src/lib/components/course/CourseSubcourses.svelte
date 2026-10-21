<script lang="ts">
	// A course's SUBCOURSES (owner, 2026-10-21: "courses can have their own courses (subcourses) …
	// having parent-child relationship"): the parts of this course that are whole courses of their
	// own — "Analiza 1" and "Analiza 2" under "Analiza", a lab group under one university's course.
	// The list is `GET /api/courses/?parent=<id>`, the same visibility-filtered read every course
	// list is, which since this date also carries the university/faculty VERSIONS; each row says
	// which it is (`parentRelation`) and this panel keeps the subcourses. A subcourse's own
	// subcourses are on its page — one level per page, so the tree reads the way it nests.
	//
	// "Add a subcourse" is for the people who run THIS course only (`backend/courses/rules.py:
	// not_parent_staff`): a subcourse is the parent's own structure, unlike a version, which anybody
	// may open under a public course. A reader who cannot add one and finds nothing here is shown
	// nothing — a course without parts is the ordinary case, not an empty state.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getCourses } from '$lib/services/course';
	import { creationStore } from '$lib/state/creation.svelte';
	import { COURSE_KIND_BADGES } from '$lib/utils/labels';
	import type { Course } from '$lib/types/course';

	let { course }: { course: Course } = $props();

	let subcourses = $state<Course[]>([]);
	let loaded = $state(false);
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const id = course.id;
		if (id === loadedFor) return;
		loadedFor = id;
		loaded = false;
		getCourses({ parent: id })
			.then((rows) => {
				if (loadedFor === id)
					subcourses = rows
						.filter((row) => row.parentRelation === 'subcourse')
						.sort((a, b) => a.title.localeCompare(b.title));
			})
			.catch(() => (subcourses = []))
			.finally(() => (loaded = true));
	});

	let canAdd = $derived(course.canCurate && creationStore.allows('course'));
	let shown = $derived(canAdd || subcourses.length > 0);
</script>

{#if shown}
	<section class="subcourses" aria-labelledby="course-subcourses-heading" data-subcourses>
		<div class="head">
			<h2 id="course-subcourses-heading">
				{m.course_tree_heading({ count: subcourses.length })}
				<!-- "Subcourses ({count})" -->
			</h2>
			{#if canAdd}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() plus a query string -->
				<a class="add" href={`${resolve('/courses/new')}?parent=${course.id}&as=subcourse`}>
					{m.course_tree_add()}
					<!-- "Add a subcourse" -->
				</a>
			{/if}
		</div>
		{#if loaded && subcourses.length === 0}
			<p class="empty">{m.course_tree_empty()}</p>
			<!-- "No subcourses yet. Split this course into parts — each part is a course of its own, with its own weeks, people and board." -->
		{:else}
			<ul>
				{#each subcourses as sub (sub.id)}
					<li>
						<a href={resolve('/courses/[id]', { id: sub.id })}>{sub.title}</a>
						{#if sub.kind === 'university'}
							<!-- Only a university course says so; "general course" on every part would
							     read as a claim about the part rather than as its kind. -->
							<span class="badge">{COURSE_KIND_BADGES[sub.kind]()}</span>
						{/if}
						{#if sub.summary}<span class="summary">— {sub.summary}</span>{/if}
						<span class="count">· {m.course_participantCount({ count: sub.participantCount })}</span
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.subcourses {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
	}
	h2 {
		font-size: var(--font-size-base);
	}
	.add {
		@include mix.focus-ring;
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.empty,
	.summary,
	.count {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.badge {
		@include mix.neutral-pill;
		font-size: var(--font-size-xs);
		margin-left: var(--space-1);
	}
	ul {
		margin: 0;
		padding-left: var(--space-4);
		font-size: var(--font-size-sm);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
</style>
