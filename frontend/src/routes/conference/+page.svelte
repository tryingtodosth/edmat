<script lang="ts">
	/* /conference — a stable address for the demonstration conference.
	 *
	 * The demo is seeded by `manage.py seed_conference_demo`, so its event id is whatever the
	 * database assigned on the machine it was seeded on. A link to `/events/130` is therefore right
	 * on exactly one installation and wrong everywhere else, which is no use for something meant to
	 * be sent to people. This route finds the event by the marker its title carries — the same
	 * `TEST=FAKE ` prefix the seeder guarantees (HISTORY.md §17BL) — and forwards to it.
	 *
	 * Deliberately NOT prerendered: the answer depends on the database it is asked about, and a
	 * build-time answer would bake one installation's id into the file.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getEvents } from '$lib/services/events';

	/** The marker the seeder puts on every event it creates. Mirrored from
	 *  `backend/testing/personas.py: FAKE_PREFIX` — flagged in both files, as house rule 13 asks. */
	const FAKE_PREFIX = 'TEST=FAKE ';

	let state = $state<'looking' | 'missing' | 'failed'>('looking');

	onMount(async () => {
		try {
			const events = await getEvents();
			/* The LAST marked event, not the first: the personas' small "Sandbox conference" is seeded
			   before the full demo conference, and the full one is what somebody following this link
			   wants to see. */
			const demo = events.filter((e) => e.title.startsWith(FAKE_PREFIX)).at(-1);
			if (!demo) {
				state = 'missing';
				return;
			}
			await goto(resolve('/events/[id]', { id: demo.id }), { replaceState: true });
		} catch {
			state = 'failed';
		}
	});
</script>

<PageHead title={m.conference_title()} description={m.conference_intro()} />

<section class="conference">
	<h1>{m.conference_title()}</h1>
	<!-- "Demonstration conference" -->
	{#if state === 'looking'}
		<p>{m.conference_looking()}</p>
		<!-- "Looking for the demonstration conference…" -->
	{:else if state === 'missing'}
		<p>{m.conference_missing()}</p>
		<!-- "There is no demonstration conference on this site yet." -->
		<p><a href={resolve('/events')}>{m.conference_browseEvents()}</a></p>
		<!-- "Browse all events" -->
	{:else}
		<p>{m.conference_failed()}</p>
		<!-- "The event list could not be loaded." -->
		<p><a href={resolve('/events')}>{m.conference_browseEvents()}</a></p>
	{/if}
</section>

<style lang="scss">
	.conference {
		max-width: 44rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
	}
</style>
