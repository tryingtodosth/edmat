<script lang="ts">
	// The course's claim groups: the shared `ClaimGroups`, given the topics of every subject branch
	// the course was filed under — that is what a claim on a course can be about.
	import { onMount } from 'svelte';
	import type { Course, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getTopicsForBranch } from '$lib/services/taxonomy';
	import ClaimGroups from '$lib/components/material/ClaimGroups.svelte';

	let { course }: { course: Course } = $props();
	let topics = $state<Topic[]>([]);

	onMount(async () => {
		const perSubject = await Promise.all(
			course.subjectSlugs.map((slug) => getTopicsForBranch(slug))
		);
		topics = perSubject.flat();
	});
</script>

<ClaimGroups
	ownerKind="course"
	ownerId={course.id}
	{topics}
	coversHint={m.course_coversHint()}
	requiresHint={m.course_requiresHint()}
/>
