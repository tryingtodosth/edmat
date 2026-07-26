<script lang="ts">
	// Phase 4: the material detail page — the one real gap CLAUDE.md's own 17C writeup already
	// flagged explicitly ("this app has no standalone material page to link to at all... a real fix
	// would need a material detail page first"). Every piece this page needs already existed before
	// it did: the backend's GET /api/materials/{id}/ (materials/views.py's MaterialViewSet is
	// already a real ReadOnlyModelViewSet), the frontend's own getMaterialById service
	// (lib/services/materials.ts), and — the reason this page's own body is so thin — MaterialCard
	// itself, which already renders everything a material has (title, description, coverage
	// claims + votes + per-claim discussion via CoveragePopover, tags, download link). This route
	// reuses that same real component directly rather than re-implementing any of it, the same
	// "one card component, reused at a different weight/context" economy this app's own
	// ExerciseCard/exercise-detail-page pairing already follows.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Course, Field, Material, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getMaterialById } from '$lib/services/materials';
	import { getCourseById, getFieldById, getTopicsForCourse } from '$lib/services/taxonomy';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';

	let material = $state<Material | undefined>(undefined);
	let course = $state<Course | undefined>(undefined);
	let field = $state<Field | undefined>(undefined);
	let topics = $state<Topic[]>([]);
	let loading = $state(true);
	let notFound = $state(false);

	async function loadAll(id: string) {
		loading = true;
		notFound = false;

		const mat = await getMaterialById(id);
		if (!mat) {
			notFound = true;
			loading = false;
			return;
		}
		material = mat;

		const c = await getCourseById(mat.courseId);
		course = c;
		const [f, t] = await Promise.all([
			c ? getFieldById(c.fieldId) : Promise.resolve(undefined),
			c ? getTopicsForCourse(c.id) : Promise.resolve([])
		]);
		field = f;
		topics = t;
		loading = false;
	}

	// Same id-changed idempotency guard the exercise detail page already established (a real,
	// found-and-fixed Phase 1 bug: a plain `$effect(() => loadAll(page.params.id!))` re-fires
	// spuriously even with no navigation at all) — applied here too since this page's own `$effect`
	// keys off `page.params` the identical way.
	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		loadAll(id);
	});
</script>

<svelte:head>
	<title>{material ? material.title : m.material_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else if notFound}
		<p class="empty">{m.material_notFound()}</p>
	{:else if material}
		<!-- "Breadcrumb" -->
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/fields')}>{m.common_home()}</a> ›
			{#if field}
				<a href={resolve('/fields/[field]', { field: field.id })}>{field.name}</a> ›
			{/if}
			{#if course}
				<a href={resolve('/courses/[course]', { course: course.id })}>{course.name}</a>
			{/if}
		</nav>

		<MaterialCard {material} {topics} linkTitle={false} />
	{/if}
</div>

<style lang="scss">
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.loading,
	.empty {
		color: var(--text-secondary);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
</style>
