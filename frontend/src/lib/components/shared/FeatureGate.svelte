<script lang="ts">
	// Wraps a whole route's content and shows a friendly, localized "unavailable" notice instead of
	// the real page when a moderator has flipped the matching kill switch off (featureFlags.svelte.ts)
	// — a client-side courtesy on top of the real, authoritative server-side block
	// (moderation/permissions.py's feature_gate), not a substitute for it: without this, a visitor
	// hitting a killed feature's route would still reach the real form/listing and only find out via
	// a raw 403 from the first API call it makes.
	//
	// `|| authStore.isModerator` mirrors the backend's own is_staff bypass exactly (feature_gate's
	// own doc comment) — a moderator can still see and use a "killed" feature themselves, both to
	// verify what's live and to decide when to turn it back on.
	import type { Snippet } from 'svelte';
	import type { FeatureFlagKey } from '$lib/types';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { m } from '$lib/paraglide/messages.js';

	let { feature, children }: { feature: FeatureFlagKey; children: Snippet } = $props();
</script>

{#if featureFlagsStore.isEnabled(feature) || authStore.isModerator}
	{@render children()}
{:else}
	<div class="page feature-disabled">
		<p>{m.featureFlags_disabledNotice()}</p>
	</div>
{/if}

<style lang="scss">
	.feature-disabled {
		max-width: 640px;
		margin: var(--space-6) auto;
		text-align: center;
		color: var(--text-secondary);
	}
</style>
