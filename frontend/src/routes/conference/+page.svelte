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
			/* `when: 'all'`, and this is the whole bug this route shipped with. The list defaults to
			   `upcoming`, meaning `starts_at >= now` — and the demo conference is seeded with day one
			   set to TODAY, deliberately, so that it looks lived-in. It has therefore always already
			   started, is in neither `upcoming` nor `past`, and never appeared in the default list at
			   all. The route then forwarded to the personas' near-empty "Sandbox conference", which
			   starts in a fortnight and so does show up — the wrong event, convincingly. */
			const events = await getEvents({ when: 'all' });
			const marked = events.filter((e) => e.title.startsWith(FAKE_PREFIX));
			/* Prefer the one running RIGHT NOW. Two events carry the marker — the full demo conference
			   and the small sandbox the personas live on — and "in progress" is exactly what
			   distinguishes the one somebody followed this link to see. Falling back to the most
			   recently started keeps the link working on an installation seeded with `--day-one` in
			   the past, where nothing is in progress any more. */
			const now = Date.now();
			const started = marked
				.filter((e) => e.startsAt && Date.parse(e.startsAt) <= now)
				.sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
			const running = started.find((e) => !e.isPast);
			const demo = running ?? started.at(-1) ?? marked.at(-1);
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
