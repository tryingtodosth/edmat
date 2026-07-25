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

	.badge {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
	}
</style>
