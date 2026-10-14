<script lang="ts">
	// A general course's university/faculty versions (owner, 2026-10-14: "a default/general course,
	// and subcourses for specific universities and faculties"), grouped by university, then faculty.
	// The list is `GET /api/courses/?parent=<id>`, which applies the same visibility filter as every
	// other course read (`backend/courses/rules.py: visible_courses`), so a version this reader may
	// not see is simply not in it.
	//
	// "Add a university/faculty version" is offered to anybody the creation gate lets found a course
	// — not only to this course's managers, by decision: a faculty's students should not need a
	// stranger's permission to gather their own course (`rules.py` says why at length).
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getCourses } from '$lib/services/course';
	import { authStore } from '$lib/state/auth.svelte';
	import { creationStore } from '$lib/state/creation.svelte';
	import type { Course } from '$lib/types/course';

	let { course }: { course: Course } = $props();

	let versions = $state<Course[]>([]);
	let loaded = $state(false);
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const id = course.id;
		if (id === loadedFor) return;
		loadedFor = id;
		loaded = false;
		getCourses({ parent: id })
			.then((rows) => {
				if (loadedFor === id) versions = rows;
			})
			.catch(() => (versions = []))
			.finally(() => (loaded = true));
	});

	// university → faculty → versions, both levels in alphabetical order; an empty faculty sorts
	// first under its university and is drawn without a sub-heading.
	let groups = $derived.by(() => {
		const byUni: Record<string, { name: string; faculties: Record<string, Course[]> }> = {};
		for (const v of versions) {
			const key = v.university.trim().toLowerCase();
			byUni[key] ??= { name: v.university.trim(), faculties: {} };
			(byUni[key].faculties[v.faculty.trim()] ??= []).push(v);
		}
		return Object.values(byUni)
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((uni) => ({
				name: uni.name,
				faculties: Object.entries(uni.faculties)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([name, rows]) => ({ name, rows }))
			}));
	});

	let canAdd = $derived(
		authStore.isAuthenticated && creationStore.allows('course') && course.visibility !== 'only_you'
	);
</script>

<section class="versions" aria-labelledby="course-versions-heading">
	<div class="head">
		<h2 id="course-versions-heading">
			{m.course_versions_heading({ count: versions.length })}
			<!-- "University and faculty versions ({count})" -->
		</h2>
		{#if canAdd}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() plus a query string -->
			<a class="add" href={`${resolve('/courses/new')}?parent=${course.id}`}>
				{m.course_version_add()}
				<!-- "Add a university/faculty version" -->
			</a>
		{/if}
	</div>
	{#if loaded && versions.length === 0}
		<p class="empty">{m.course_versions_empty()}</p>
		<!-- "No university has its own version of this course yet. Studying it somewhere? Add yours — its materials will show up here too." -->
	{/if}
	{#each groups as uni (uni.name)}
		<div class="uni">
			<h3>{uni.name}</h3>
			{#each uni.faculties as fac (fac.name)}
				{#if fac.name}<p class="faculty">{fac.name}</p>{/if}
				<ul>
					{#each fac.rows as v (v.id)}
						<li>
							<a href={resolve('/courses/[id]', { id: v.id })}>{v.title}</a>
							{#if v.courseCode}<code>{v.courseCode}</code>{/if}
							{#if v.currentTerm}<span class="term">· {v.currentTerm}</span>{/if}
							<span class="count">· {m.course_participantCount({ count: v.participantCount })}</span
							>
						</li>
					{/each}
				</ul>
			{/each}
		</div>
	{/each}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.versions {
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
	h3 {
		font-size: var(--font-size-sm);
	}
	.add {
		@include mix.focus-ring;
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.empty,
	.faculty,
	.term,
	.count {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.uni {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	ul {
		margin: 0;
		padding-left: var(--space-4);
		font-size: var(--font-size-sm);
	}
	code {
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		margin-left: var(--space-1);
	}
</style>
