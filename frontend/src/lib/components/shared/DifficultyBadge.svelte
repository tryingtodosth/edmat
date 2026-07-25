<script lang="ts">
	import type { Difficulty } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';

	let { difficulty }: { difficulty: Difficulty } = $props();

	const labels: Record<Difficulty, () => string> = {
		easy: m.difficulty_easy,
		medium: m.difficulty_medium,
		hard: m.difficulty_hard
	};
</script>

<span class="badge badge--{difficulty}">{labels[difficulty]()}</span>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.badge--easy {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.badge--medium {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.badge--hard {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
</style>
