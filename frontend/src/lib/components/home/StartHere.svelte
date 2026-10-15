<script lang="ts">
	// "Where do I start?" — three doors for a first-time visitor, under the homepage hero (WP2 of
	// the 2026-10-14 loop: "make it more intuitive"). The hero already answers "find a thing I know
	// I want"; this answers the visitor who does not know yet what the site is: read the five-minute
	// chapter, look at what it can do, or just go in.
	//
	// **The homepage is prerendered**, so this band is in the static HTML and must stay a pure
	// function of nothing: no service call, no store that resolves later, no flag. All three
	// destinations are standing pages that no kill switch removes — the "Getting started" chapter is
	// `flag: null` in `GUIDE_CHAPTERS`, `/about` and `/disciplines` are always there — so there is
	// nothing to gate.
	//
	// **Dismissal can only take the band AWAY, never put it in.** It is drawn by default, in the
	// HTML, and `onMount` collapses it if this browser said "hide" before. The reverse (hidden until
	// storage says otherwise) would insert ~60px above the tabs after first paint for every visitor
	// who never dismissed it, which is a layout shift for the majority to save one for the minority.
	// localStorage, not an account setting: it is a per-browser convenience, and it must work for a
	// visitor with no account — which is exactly who it is for. Every access is in try/catch,
	// because storage throws in some private windows and the band must still render then.
	//
	// **Two places, one band (WP7, 2026-10-15).** `/about` opens with the same three doors, above the
	// organisation's page (owner: "yes, put the strip above the organisation page"). It is this
	// component with `variant="about"`, not a second copy: the doors, their copy and their targets
	// are identical, and only the spacing differs (on `/` the band tucks into the hero's gap; on
	// `/about` it stands at the top of the page on its own). **The dismissal is shared too** — one
	// storage key, so "hide" on either page hides it on both. The choice a visitor made was "I do not
	// need to be told where to start", which is a fact about the visitor, not about the page; asking
	// again on the next page would treat a considered answer as an accident. Both pages are
	// prerendered and both draw the band in their HTML, so the rule above holds on each.
	//
	// On `/about` the middle door is an in-page jump: its href is `/about#showcase` either way, and
	// SvelteKit treats a same-path hash link as a scroll, not a navigation. The target is the
	// Explore section, which carries the id and its own `scroll-margin-top` for the sticky header.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';

	interface Props {
		/** `home` (the default) under the hero on `/`; `about` at the very top of `/about`. */
		variant?: 'home' | 'about';
	}
	let { variant = 'home' }: Props = $props();

	const STORAGE_KEY = 'edmat.startHere.hidden';

	let hidden = $state(false);

	onMount(() => {
		try {
			hidden = window.localStorage.getItem(STORAGE_KEY) === '1';
		} catch {
			// Storage unavailable: keep showing it. A band that cannot be remembered as hidden is
			// better than one that can never be seen.
		}
	});

	function hide() {
		hidden = true;
		try {
			window.localStorage.setItem(STORAGE_KEY, '1');
		} catch {
			// Hidden for this page view only; nothing else to do.
		}
	}

	const DOORS = [
		{
			key: 'guide',
			kicker: () => m.startHere_guideKicker(), // "New here?"
			label: () => m.startHere_guideLink(), // "Read the 5-minute guide"
			href: resolve('/about/guide/[chapter]', { chapter: 'start' })
		},
		{
			key: 'showcase',
			kicker: () => m.startHere_showcaseKicker(), // "Curious first?"
			label: () => m.startHere_showcaseLink(), // "See what EdMat can do"
			// The showcase index, not the top of /about — which opens on the organisation's page.
			href: `${resolve('/about')}#showcase`
		},
		{
			key: 'try',
			kicker: () => m.startHere_tryKicker(), // "Rather dive in?"
			label: () => m.startHere_tryLink(), // "Just try it: pick a discipline"
			href: resolve('/disciplines')
		}
	] as const;
</script>

{#if !hidden}
	<section
		class="start-here"
		class:start-here--about={variant === 'about'}
		aria-label={m.startHere_label()}
		data-start-here={variant}
	>
		<!-- "Where to start" -->
		<ul class="start-here__doors">
			{#each DOORS as door (door.key)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- each href is built by resolve() in DOORS above -->
					<a class="start-here__door" href={door.href} data-start-door={door.key}>
						<span class="start-here__kicker">{door.kicker()}</span>
						<span class="start-here__link"
							>{door.label()}&nbsp;<span aria-hidden="true">→</span></span
						>
					</a>
				</li>
			{/each}
		</ul>
		<button
			type="button"
			class="start-here__hide"
			onclick={hide}
			aria-label={m.startHere_hide()}
			title={m.startHere_hide()}
			data-start-hide
		>
			<!-- "Hide these suggestions" -->
			<!-- A drawn cross rather than "×": the glyph sits on the text baseline, visibly below the
			     centre of a 34px row in every font this was looked at in. -->
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
				<path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.75" fill="none" />
			</svg>
		</button>
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	// Quiet on purpose: the exercises are what the homepage is for, and on a 1280×800 screen their
	// first row is already near the fold. One line per door on a desktop, a hairline border, no
	// fill colour and no accent background — the accent is spent only on the link text, which is
	// what it means here (interactive), never on the band itself.
	.start-here {
		position: relative;
		display: flex;
		align-items: stretch;
		gap: var(--space-2);
		// Pulls the band up into the gap the page's own flex `gap` leaves under the hero, so adding
		// it costs the fold its own height and little more.
		margin-top: calc(-1 * var(--space-3));
	}
	// On `/about` nothing sits above it to tuck into: it is the first thing under the header.
	.start-here--about {
		margin-top: 0;
	}
	.start-here__doors {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	// Kicker above link, always: letting them share a line where they fit made one door one line
	// and its neighbours two, which reads as three different kinds of thing.
	.start-here__door {
		@include mix.focus-ring;
		display: flex;
		flex-direction: column;
		gap: 2px;
		height: 100%;
		box-sizing: border-box;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		text-decoration: none;
		font-size: var(--font-size-sm);
		&:hover {
			border-color: var(--accent);
		}
	}
	.start-here__kicker {
		color: var(--text-secondary);
	}
	.start-here__link {
		color: var(--accent);
		font-weight: 600;
	}
	.start-here__door:hover .start-here__link {
		text-decoration: underline;
	}
	.start-here__hide {
		@include mix.focus-ring;
		flex: none;
		align-self: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-secondary);
		font: inherit;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		&:hover {
			color: var(--text-primary);
			background: var(--bg-surface-alt);
		}
	}

	// A phone: three one-line rows. The kickers go — each link already says what it is, and with
	// them the band was ~200px of a 844px screen standing between the reader and the tabs. The
	// close button sits in the first row's right-hand corner rather than taking a column of its
	// own, so the doors keep the full width of a 390px screen.
	@media (max-width: 720px) {
		.start-here {
			margin-top: calc(-1 * var(--space-2));
		}
		.start-here--about {
			margin-top: 0;
		}
		.start-here__doors {
			grid-template-columns: 1fr;
			gap: var(--space-1);
		}
		.start-here__kicker {
			display: none;
		}
		.start-here__doors li:first-child .start-here__door {
			padding-right: 2.75rem;
		}
		// Centred on the first row (34px tall), not on the whole stack. The global phone rule gives
		// every button a 44px touch target, so the box is 44px and hangs 5px above and below the row
		// rather than being squeezed to fit it.
		.start-here__hide {
			position: absolute;
			top: -5px;
			right: 0;
			height: 44px;
			width: 44px;
			align-self: auto;
		}
	}
</style>
