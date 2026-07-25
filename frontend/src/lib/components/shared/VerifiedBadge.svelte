<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';

	let { verified }: { verified: boolean } = $props();
</script>

{#if verified}
	<span class="badge badge--verified" title={m.exercise_verified()}>
		<span aria-hidden="true">✓</span>
		{m.exercise_verified()}
	</span>
{:else}
	<span class="badge badge--unverified" title={m.exercise_unverified()}
		>{m.exercise_unverified()}</span
	>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.badge--verified {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.badge--unverified {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
	}
</style>
