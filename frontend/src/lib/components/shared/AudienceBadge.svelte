<script lang="ts">
	import type { Audience } from '$lib/types';
	import { AUDIENCE_LABELS } from '$lib/utils/labels';

	let { audience }: { audience: Audience } = $props();
</script>

<span class="badge badge--{audience}">{AUDIENCE_LABELS[audience]()}</span>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.badge {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
	.badge--all {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
</style>
