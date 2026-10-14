<script lang="ts">
	// "All the materials in one place" (owner, 2026-10-14) — every material this course links to, in
	// one flat list, whichever chapter or lesson it is filed under; and, on a GENERAL course, every
	// material its university/faculty versions link to, each saying which version it came from.
	//
	// Two sources, on purpose:
	//   - this course's own materials come from the course response already on the page
	//     (`chapters[].items`, `chapters[].lessons[].items`, `unfiledItems`). The server has already
	//     decided what this viewer may see there — including their OWN pending offers, which is why
	//     those are not re-fetched from the aggregate endpoint, which lists approved items only;
	//   - the versions' materials come from `GET /api/courses/{id}/materials/` (one request, only
	//     versions this viewer can see, only approved items, nothing from an unopened week). A
	//     version's own page shows only its own — it has no versions.
	// No new relation: a material gets into a course through `CourseItem`, as it always did.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { localizedPath } from '$lib/utils/localizedPath';
	import { getCourseMaterials, type CourseMaterialRow } from '$lib/services/course';
	import type { Course, CourseItem } from '$lib/types/course';

	let { course }: { course: Course } = $props();

	// One row per material, in the order the course presents them (chapters in order, a chapter's
	// own items before its lessons'), unfiled last — a material filed twice is listed once.
	let materials = $derived.by(() => {
		const all: CourseItem[] = [];
		for (const chapter of course.chapters) {
			all.push(...chapter.items);
			for (const lesson of chapter.lessons) all.push(...lesson.items);
		}
		all.push(...course.unfiledItems);
		const seen: Record<string, true> = {};
		return all.filter((item) => {
			if (item.kind !== 'material' || !item.material || seen[item.material]) return false;
			seen[item.material] = true;
			return true;
		});
	});

	let fromVersions = $state<CourseMaterialRow[]>([]);
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		const id = course.parent ? null : course.id;
		if (id === loadedFor) return;
		loadedFor = id;
		fromVersions = [];
		if (!id) return;
		getCourseMaterials(id)
			.then((rows) => {
				if (loadedFor === id) fromVersions = rows.filter((row) => !row.course.isThisCourse);
			})
			.catch(() => (fromVersions = []));
	});
	// Not listed twice: a material this course already holds is not repeated under a version.
	let versionRows = $derived(
		fromVersions.filter((row) => !materials.some((item) => item.material === row.materialId))
	);

	function where(row: CourseMaterialRow): string {
		return (
			[row.course.university, row.course.faculty].filter(Boolean).join(' · ') || row.course.title
		);
	}
</script>

<section class="materials-index" aria-labelledby="course-materials-heading">
	<h2 id="course-materials-heading">
		{m.course_materialsIndex_heading({ count: materials.length + versionRows.length })}
		<!-- "Materials in this course ({count})" -->
	</h2>
	{#if materials.length === 0 && versionRows.length === 0}
		<p class="empty">
			{course.canContribute || course.canCurate
				? m.course_materialsIndex_emptyCanAdd()
				: m.course_materialsIndex_empty()}
			<!-- "No materials yet — add the first one under “Add something” below." / "No materials have been added to this course yet." -->
		</p>
	{/if}
	{#if materials.length > 0}
		<ul>
			{#each materials as item (item.id)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `localizedPath()` wraps the `resolve()` call so the Polish reader gets /materialy; see lib/utils/localizedPath.ts. -->
					<a href={localizedPath(resolve('/materials/[id]', { id: item.material ?? '' }))}>
						{item.label}
					</a>
					{#if item.status === 'pending'}
						<span class="pending">{m.course_materialsIndex_pending()}</span>
						<!-- "waiting for review" -->
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if versionRows.length > 0}
		<h3>{m.course_materialsIndex_fromVersions()}</h3>
		<!-- "From the university versions" -->
		<ul>
			{#each versionRows as row (row.itemId)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `localizedPath()` wraps the `resolve()` call; see lib/utils/localizedPath.ts. -->
					<a href={localizedPath(resolve('/materials/[id]', { id: row.materialId }))}>
						{row.label}
					</a>
					<span class="source">
						— <a href={resolve('/courses/[id]', { id: row.course.id })}>{where(row)}</a>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.materials-index {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}
	h2 {
		font-size: var(--font-size-base);
	}
	h3 {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.empty {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	ul {
		margin: 0;
		padding-left: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.source {
		color: var(--text-secondary);
	}
	.pending {
		@include mix.pending-pill;
		margin-left: var(--space-2);
	}
</style>
