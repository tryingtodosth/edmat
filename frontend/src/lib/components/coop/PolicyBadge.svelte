<script lang="ts">
	// The policy as a pill: the one word a reader needs before deciding whether to propose, ask
	// or leave it. Colour says the same thing as the word (open = go, request = ask, closed = no).
	import type { CoopPolicy } from '$lib/types/materialsCoop';
	import { POLICY_HINTS, POLICY_LABELS } from './labels';

	let { policy }: { policy: CoopPolicy } = $props();
</script>

<span class="policy policy--{policy}" title={POLICY_HINTS[policy]()}>{POLICY_LABELS[policy]()}</span
>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.policy--open {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.policy--request {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
	}
	.policy--closed {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
	}
</style>
