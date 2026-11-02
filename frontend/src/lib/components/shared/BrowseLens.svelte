<script lang="ts">
	/**
	 * The audience lens at the top of every browse page (owner, 2026-11-02: "we want the audience to
	 * be the primary way of serving materials"): the band chips, asked as a question, and one line
	 * that says what the lens is doing — "showing what there is for X · other groups: N more ·
	 * show everything", or "nothing here for X yet · most is for Y".
	 *
	 * **Why it is a lens and not a page you click through** (and not a URL segment): the choice is
	 * made once and follows the reader (localStorage, `Profile.audience_filter`), every slug link
	 * stays valid for every reader, and a detail page never narrows. The first-visitor audit
	 * (2026-10-15, finding 1) found the chips silently emptying the whole site because the filter
	 * was set on the home page and invisible everywhere else; this line is what makes a sticky
	 * filter honest.
	 *
	 * **The URL.** `?audience=primary` on a browse page sets the lens on arrival, so a link someone
	 * shares opens on the view they were looking at; changing a chip here writes it back. Built from
	 * `window.location`, not `page.url`: SvelteKit keeps `page.url` at the page's own URL across a
	 * shallow `replaceState` (frontend/CLAUDE.md), so it would drop a sibling param written since.
	 *
	 * `nodes` is whatever this page lists — their counts carry every band (taxonomy/counts.py), so
	 * the "other groups" number is arithmetic here, not another request.
	 */
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import type { Audience, NodeCounts } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { AUDIENCES, AUDIENCE_LABELS } from '$lib/utils/labels';
	import { audienceFilterStore } from '$lib/state/audienceFilter.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { allCount, bandTotals, lensCount, sumCounts } from '$lib/utils/audienceCounts';
	import AudienceChips from './AudienceChips.svelte';

	let { nodes }: { nodes: { counts?: NodeCounts }[] } = $props();

	let bands = $derived(audienceFilterStore.bands);
	let total = $derived(sumCounts(nodes));
	let inLens = $derived(lensCount(total, bands));
	let others = $derived(allCount(total) - inLens);
	let bandNames = $derived(bands.map((b) => AUDIENCE_LABELS[b]()).join(', '));
	/** The band with the most outside the lens — what "most is for Y" names. */
	let biggestOther = $derived(bandTotals(total).find(([band]) => !bands.includes(band) && band !== 'all'));

	function showEverything() {
		audienceFilterStore.set([]);
		if (authStore.isAuthenticated) void authStore.updateProfile({ audienceFilter: [] });
	}

	// Arrival: an explicit `?audience=` wins over the stored lens, for this device. Not written to
	// the profile — opening somebody's link is not the same act as choosing a preference.
	onMount(() => {
		const raw = page.url.searchParams.get('audience');
		if (raw === null) return;
		const wanted = raw
			.split(',')
			.filter((v): v is Audience => (AUDIENCES as string[]).includes(v) && v !== 'all');
		audienceFilterStore.set(wanted);
	});

	// And back: the address bar always says which lens the page is drawn through.
	$effect(() => {
		const param = audienceFilterStore.param;
		const url = new URL(window.location.href);
		if (param) url.searchParams.set('audience', param);
		else url.searchParams.delete('audience');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the current page's own URL with its query updated, not a route
		if (url.href !== window.location.href) void replaceState(url, page.state);
	});
</script>

<section class="lens" data-testid="browse-lens">
	<AudienceChips label={m.browse_lensPrompt} />
	<!-- "Who are you looking for?" -->
	{#if bands.length > 0 && inLens === 0 && biggestOther}
		<p class="lens__line" role="status" data-testid="browse-lens-nothing">
			{m.browse_lensNothing({ bands: bandNames, band: AUDIENCE_LABELS[biggestOther[0]](), count: biggestOther[1] })}
			<!-- "Nothing here for “{bands}” yet. Most is for “{band}”: {count}." -->
			<button type="button" onclick={showEverything}>{m.browse_showEverything()}</button>
			<!-- "Show everything" -->
		</p>
	{:else if bands.length > 0 && others > 0}
		<p class="lens__line" role="status" data-testid="browse-lens-showing">
			{m.browse_lensShowing({ bands: bandNames, others })}
			<!-- "Showing what there is for “{bands}”. Other groups: {others} more." -->
			<button type="button" onclick={showEverything}>{m.browse_showEverything()}</button>
		</p>
	{/if}
</section>

<style lang="scss">
	.lens {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	// A sentence with a choice in it — the same passive shape as HiddenLanguagesNotice, which is
	// its language-axis twin: neither a warning nor a request, grey on the alt surface, the one
	// button in the accent because it is the one interactive thing here.
	.lens__line {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		margin: 0;
		padding: 0.5rem 0.8rem;
		border-radius: 8px;
		background: var(--bg-surface-alt);
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
	button {
		min-height: 44px;
		padding: 0 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--accent);
		background: transparent;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
	}
</style>
