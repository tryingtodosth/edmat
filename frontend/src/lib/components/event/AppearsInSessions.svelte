<script lang="ts">
	/** "This appears in…" — the reverse half of a session link (AUDIENCE-BRIEF.md §3.2): every
	 * visible session that points at this material / exercise / set. Renders nothing at all when
	 * there are none, since most content is never on a programme. */
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { Session } from '$lib/types/event';
	import { getSessionsLinking } from '$lib/services/events';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { formatDateTime } from '$lib/utils/datetime';
	import { SESSION_LINK_ROLE_LABELS } from '$lib/utils/labels';

	let {
		materialId,
		exerciseId,
		setSlug
	}: { materialId?: string; exerciseId?: string; setSlug?: string } = $props();
	let sessions = $state<Session[]>([]);

	onMount(async () => {
		if (!featureFlagsStore.isEnabled('events')) return;
		try {
			sessions = await getSessionsLinking({ materialId, exerciseId, setSlug });
		} catch {
			sessions = [];
		}
	});
	function roleOf(s: Session): string {
		const link = s.links.find(
			(l) =>
				(materialId && l.materialId === materialId) ||
				(exerciseId && l.exerciseId === exerciseId) ||
				(setSlug && l.setSlug === setSlug)
		);
		return link ? SESSION_LINK_ROLE_LABELS[link.role]() : '';
	}
</script>

{#if sessions.length > 0}
	<section class="appears-in">
		<h2>{m.events_appearsIn()}</h2>
		<ul>
			{#each sessions as s (s.id)}
				<li>
					<a href={resolve('/events/[id]', { id: s.eventId })}>{s.title}</a>
					<span class="when">{formatDateTime(s.startsAt)}</span>
					{#if roleOf(s)}<span class="role">{roleOf(s)}</span>{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style lang="scss">
	.appears-in {
		margin-top: 1.25rem;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.35rem;
	}
	li {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: baseline;
	}
	.when,
	.role {
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
</style>
