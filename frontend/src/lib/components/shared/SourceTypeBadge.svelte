<script lang="ts">
	import type { SourceType } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';

	let { sourceType }: { sourceType: SourceType } = $props();

	const labels: Record<SourceType, () => string> = {
		exercises: m.sourceType_exercises,
		midterm: m.sourceType_midterm,
		exam: m.sourceType_exam,
		other: m.sourceType_other
	};
</script>

<span class="badge">{labels[sourceType]()}</span>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	/* Neutral rather than coloured, on purpose. Three coloured pills in a row on every card —
	   difficulty, source type, verified — gave a grid the look of a string of fairy lights and made
	   none of them mean anything, because everything was shouting. Difficulty keeps its colour
	   because it is a scale somebody scans for, and "verified" keeps its green because it is a
	   quality claim. Where an exercise came from is a fact, not a warning. */
	.badge {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
</style>
