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
	import FoldSection from '$lib/components/shared/FoldSection.svelte';
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
	<FoldSection key="cloakroom" title={m.cloakroom_heading()} count={desks.length}>
		<div class="cloakroom" data-cloakroom-panel>
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
		</div>
	</FoldSection>
{/if}

<style lang="scss">
	// Card chrome, the heading and the spacing around are `FoldSection`'s since 2026-10-08.
	.cloakroom {
		display: grid;
		gap: var(--space-2);
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
