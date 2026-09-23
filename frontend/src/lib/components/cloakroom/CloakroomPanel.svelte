<script lang="ts">
	// What the event page says about the cloakroom (CONFERENCE-BRIEF.md §3.F's mount point).
	//
	// Two readers, two sentences:
	// - somebody coming gets "there is a cloakroom at the north entrance, open from 17:00" and
	//   nothing else — how full it is, and what is on which hook, is the desk's business;
	// - somebody working the event gets the link to the desk itself.
	//
	// Behind the `cloakroom` kill switch, and house rule 3 is why this component (not just the
	// route) checks it: a killed feature that still shows its link has not been hidden, only made
	// to fail somewhere less useful. The whole section disappears — heading included — when the
	// event has no desk and the reader could not open one.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { getEventCloakroomDesks } from '$lib/services/cloakroom';
	import type { CloakroomDesk } from '$lib/types/cloakroom';
	import type { EdmatEvent } from '$lib/types/event';

	let { event }: { event: EdmatEvent } = $props();

	let desks = $state<CloakroomDesk[]>([]);
	let loadedForId = '';

	// `isModerator` mirrors the backend's own `is_staff` bypass in `feature_gate`, exactly as
	// `FeatureGate.svelte` does.
	let enabled = $derived(featureFlagsStore.isEnabled('cloakroom') || authStore.isModerator);
	let canWorkDesk = $derived(desks.some((desk) => desk.canOperate) || event.canOrganise);

	// A list load, guarded on the id (frontend/CLAUDE.md trap 2) and never at component top level
	// (trap 5 — this runs inside an effect, not during SSR with no token).
	$effect(() => {
		if (!enabled) return;
		const id = event.id;
		if (!id || id === loadedForId) return;
		loadedForId = id;
		(async () => {
			try {
				desks = await getEventCloakroomDesks(id);
			} catch {
				desks = [];
			}
		})();
	});
</script>

{#if enabled && (desks.length > 0 || event.canOrganise)}
	<section class="cloakroom" data-cloakroom-panel>
		<h2>{m.cloakroom_heading()}</h2>
		{#each desks as desk (desk.id)}
			<p class="line">
				{desk.status === 'open'
					? m.cloakroom_attendeeLine({ name: desk.name }) // "There is a cloakroom at {name}."
					: m.cloakroom_attendeeClosed({ name: desk.name })}
				{#if desk.opensNote}<span class="note">{desk.opensNote}</span>{/if}
			</p>
		{/each}
		{#if canWorkDesk}
			<p class="staff">
				<a href={resolve('/events/[id]/cloakroom', { id: event.id })}>
					{desks.length > 0 ? m.cloakroom_deskLink() : m.cloakroom_openFirstDesk()}
				</a>
			</p>
		{/if}
	</section>
{/if}

<style lang="scss">
	.cloakroom {
		margin: var(--space-4) 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-lg);
		background: var(--bg-surface);
	}
	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-lg);
	}
	.line {
		margin: 0 0 var(--space-1);
	}
	.note {
		color: var(--text-secondary);
	}
	.staff {
		margin: var(--space-2) 0 0;
	}
</style>
