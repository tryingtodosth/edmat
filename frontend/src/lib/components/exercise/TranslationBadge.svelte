<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	let { isOriginal, translatorName }: { isOriginal: boolean; translatorName?: string } = $props();
</script>

{#if isOriginal}
	<span class="badge" title={m.exercise_originalExplanation()}>{m.exercise_original()}</span>
{:else}
	<span class="badge badge--translated"
		>{m.exercise_translatedBy({ name: translatorName ?? '—' })}</span
	>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.badge {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
	.badge--translated {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
</style>
