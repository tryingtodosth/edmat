<script lang="ts">
	// **Rebuilt from a flat row of ten links into three groups, and again for phones.**
	//
	// The bar had grown one link per feature — browse, materials, my set, submit exercise, submit
	// material, branches, tutoring, watchlist, schedule, messages, moderation — every one competing for
	// the same attention and wrapping onto a second line before a laptop was even narrow. The rebuild
	// removes nothing; it sorts what was there by what each link is FOR:
	//
	//  - **Browsing** stays in the nav, because that is what a nav is: places to go and look at things.
	//  - **Making** collapses into one "Add…" popover. Five of the old links were create flows sharing
	//    one question ("I want to make something") that the bar was asking five times.
	//  - **You** collapses into the account button, which already carried the person's name and did
	//    nothing except link to Settings, while Log out sat beside it and My Set sat over in the nav.
	//
	// Messages moved into the action area as an icon, alongside the bell it is a sibling of: both are
	// inboxes, both carry an unread count, and one being a word in the nav while the other was an icon
	// on the right was an accident of the order they were built in rather than a distinction.
	//
	// **On a phone the same content becomes one row and a drawer.** Three rules drove that, and each
	// one shows up in the markup rather than only in the styles:
	//
	//  1. **One row.** The bar is the brand and nothing else; everything that lives across the top on a
	//     desktop lives in the drawer instead. Previously the nav collapsed behind a toggle while the
	//     action row stayed and wrapped, which meant the "one row" was frequently three.
	//  2. **It gets out of the way.** Scrolling down tucks the bar away; scrolling up brings it back at
	//     once. A sticky bar on a 390px-tall reading surface is a real cost, and the thing people do to
	//     get it back is exactly the gesture that returns it.
	//  3. **The menu button never goes anywhere.** It is rendered OUTSIDE `<header>` on purpose — the
	//     header is what slides away, so a button inside it would slide away too, and the one control
	//     that must survive the bar hiding is the one that brings everything back.
	//
	// **Every entry stays gated by the same feature flag its own route and API are gated by**, on both
	// surfaces — the item lists are snippets rendered in both the popovers and the drawer, so a flag
	// can never hide an entry in one place and leave it in the other. A kill switch that leaves its
	// buttons on the page does not hide a feature, it only moves where the error appears.
	import { onMount, tick, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { authStore } from '$lib/state/auth.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import { messagesStore } from '$lib/state/messages.svelte';
	import { moderationQueueStore } from '$lib/state/moderationQueue.svelte';
	import { saveTargetsStore } from '$lib/state/saveTargets.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { issueReportStore } from '$lib/state/issueReport.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import Popover from '$lib/components/shared/Popover.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import LocaleSwitcher from './LocaleSwitcher.svelte';
	import RandomExerciseButton from './RandomExerciseButton.svelte';
	import NotificationBell from './NotificationBell.svelte';

	// `|| authStore.isModerator` everywhere, mirroring `FeatureGate` and the backend's own
	// `feature_gate`: a moderator can still reach a killed feature, both to check what is live and to
	// decide when to turn it back on.
	const can = (key: Parameters<typeof featureFlagsStore.isEnabled>[0]) =>
		featureFlagsStore.isEnabled(key) || authStore.isModerator;

	// Derived rather than computed once, because `featureFlagsStore` fetches on boot and `authStore`
	// resolves asynchronously — anything read once at mount here would bake in the pre-fetch defaults
	// and never correct itself.
	let canSubmitExercise = $derived(can('exercise_submissions'));
	let canSubmitMaterial = $derived(can('material_submissions'));
	let canClassroom = $derived(can('classroom'));
	let canTutoring = $derived(can('tutoring'));
	let canIssues = $derived(can('issues'));
	let canEvents = $derived(can('events'));
	let canMessaging = $derived(can('messaging'));

	// An empty menu is worse than no menu: it invites a click and then explains nothing. So the
	// trigger itself disappears when a moderator has switched off everything under it.
	// The waiting-decisions count, loaded whenever a moderator's navigation is drawn. An effect
	// rather than `onMount`, because signing in later in the same session never re-runs mount — the
	// same trap the notification badge already hit once and fixed the same way.
	$effect(() => {
		moderationQueueStore.ensureLoaded(authStore.canModerate ? (authStore.user?.id ?? null) : null);
	});

	let hasAnythingToAdd = $derived(
		canSubmitExercise || canSubmitMaterial || canClassroom || canTutoring || canEvents
	);

	function logout() {
		authStore.logout();
		notificationStore.clear();
		messagesStore.clear();
		// The save menu's cached sets and courses belong to whoever was signed in. `saveTargets`
		// keys its cache by owner and so would refetch anyway, but leaving one person's set names
		// in memory after they sign out is not something to rely on a later check to undo.
		saveTargetsStore.clear();
		moderationQueueStore.clear();
	}

	// ---- the drawer -----------------------------------------------------------------------------
	let drawerOpen = $state(false);
	let drawerEl = $state<HTMLElement | null>(null);
	let toggleEl = $state<HTMLButtonElement | null>(null);

	async function openDrawer() {
		drawerOpen = true;
		// The background must not scroll under an open drawer: on a phone the drawer is most of the
		// screen, and a page scrolling behind it is how somebody loses their place in an article by
		// opening a menu.
		document.body.style.overflow = 'hidden';
		await tick();
		drawerEl?.focus();
	}

	function closeDrawer(returnFocus = true) {
		if (!drawerOpen) return;
		drawerOpen = false;
		document.body.style.overflow = '';
		if (returnFocus) toggleEl?.focus();
	}

	// Every link inside the drawer closes it. Under client-side routing the component is not torn down
	// by the navigation, so a drawer left open would sit over whatever page it just went to.
	const closeOnNavigate = () => closeDrawer(false);

	// A route change from anywhere — including the browser's own back button, which no click handler
	// sees — leaves nothing hanging over the new page.
	//
	// **`untrack` is load-bearing, and its absence was a real bug** caught by looking at a screenshot
	// rather than by any assertion: the drawer opened and shut again in the same frame, so the page
	// looked as though the menu button did nothing at all. Reading `drawerOpen` inside an effect makes
	// the effect depend on it, so setting it to `true` re-ran the very effect whose job is to close it.
	// The dependency this effect is supposed to have is the pathname and nothing else.
	$effect(() => {
		// Read so the effect depends on it; the value itself is not needed.
		const _here = page.url.pathname;
		void _here;
		untrack(() => {
			if (drawerOpen) closeDrawer(false);
		});
	});

	// ---- the focus trap --------------------------------------------------------------------------
	// Without this, tabbing past the last item in an open drawer walks into the page behind it: the
	// links there are still focusable, so a keyboard user ends up driving a page they cannot see while
	// a full-screen panel sits over it.
	//
	// A keydown cycle rather than `inert` on the rest of the document. `inert` is the tidier idea and
	// would also take the background out of the accessibility tree, but from inside this component
	// "the rest of the document" means iterating the body's children and skipping our own three
	// elements — a DOM-wide side effect to undo correctly on every exit path, including teardown.
	// This stays inside the component and needs nothing cleaned up.
	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	function drawerFocusables(): HTMLElement[] {
		if (!drawerEl) return [];
		return Array.from(drawerEl.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
			// Anything genuinely not rendered — a section behind an `{#if}`, or the whole drawer on a
			// desktop, where it is `display: none` — has no boxes and must not be a stop on the way round.
			(el) => el.getClientRects().length > 0
		);
	}

	function trapFocus(event: KeyboardEvent) {
		// The toggle button leads the loop deliberately. It is the drawer's ✕ while the drawer is open,
		// and it lives OUTSIDE the drawer element (it has to — see the comment at its markup), so a trap
		// scoped to the drawer alone would put the close button out of a keyboard's reach, which is a
		// worse bug than the one being fixed.
		const items = [toggleEl, ...drawerFocusables()].filter((el): el is HTMLElement => el !== null);
		if (items.length === 0) return;

		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement as HTMLElement | null;

		// Focus sitting outside the loop is the normal state immediately after opening: `openDrawer`
		// puts it on the drawer container itself, which is `tabindex="-1"` and so is not a stop. Send it
		// to whichever end the direction implies instead of letting the browser carry on into the page.
		if (!active || !items.includes(active)) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
			return;
		}
		if (event.shiftKey && active === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (!drawerOpen) return;
		if (event.key === 'Escape') {
			closeDrawer();
			return;
		}
		if (event.key === 'Tab') trapFocus(event);
	}

	// ---- hide on scroll down, reveal on scroll up -------------------------------------------------
	// Only ever acts on a phone: the CSS transform lives inside the same breakpoint the drawer does, so
	// this flag is inert on a desktop rather than needing a second source of truth about the viewport.
	let tucked = $state(false);

	onMount(() => {
		let lastY = window.scrollY;
		let frame = 0;

		function measure() {
			frame = 0;
			const y = window.scrollY;
			// Near the top the bar is always out — otherwise a page that starts scrolled (a reload
			// half-way down an article) can open with no bar and no obvious reason.
			if (y < 72 || drawerOpen) {
				tucked = false;
			} else if (y > lastY + 6) {
				tucked = true;
			} else if (y < lastY - 6) {
				tucked = false;
			}
			// The 6px deadband is not decoration: without it, the sub-pixel scroll jitter a phone
			// produces while a finger rests on the screen flickers the bar in and out.
			lastY = y;
		}

		function onScroll() {
			// One measurement per frame. `scroll` fires far more often than the screen redraws, and
			// reading `scrollY` in the handler itself is a layout read on every one of them.
			if (!frame) frame = requestAnimationFrame(measure);
		}

		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			window.removeEventListener('scroll', onScroll);
			if (frame) cancelAnimationFrame(frame);
			// A drawer open at teardown would otherwise leave the page permanently unscrollable.
			document.body.style.overflow = '';
		};
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- Item lists as snippets, rendered by BOTH the desktop popovers and the mobile drawer, so a
     feature flag cannot hide an entry in one surface and leave it in the other. -->
{#snippet browseLinks(onclick: () => void)}
	<!-- The per-link classes are the staged collapse's handles: each names the width stage at which
	     the link swaps its text for its icon — IN PLACE, keeping its nav position and order, rather
	     than moving into the action row (that rearranging scheme was dropped by owner decision).
	     Every anchor carries an aria-label so the accessible name survives the text hiding. The
	     stage rules are all scoped under `.site-nav`, so in the drawer these render as plain text
	     links (the icon spans are hidden by their base rule). -->
	<a
		class="nav-link nav-link--disciplines"
		href={resolve('/disciplines')}
		aria-label={m.nav_browse()}
		title={m.nav_browse()}
		{onclick}
	>
		<span class="nav-link__icon" aria-hidden="true">{@render exerciseIcon()}</span>
		<span class="nav-link__text">{m.nav_browse()}</span>
	</a>
	<a
		class="nav-link nav-link--materials"
		href={resolve('/materials')}
		aria-label={m.nav_materials()}
		title={m.nav_materials()}
		{onclick}
	>
		<span class="nav-link__icon" aria-hidden="true">{@render bookIcon()}</span>
		<span class="nav-link__text">{m.nav_materials()}</span>
	</a>
	{#if canClassroom}
		<a
			class="nav-link nav-link--classroom"
			href={resolve('/courses')}
			aria-label={m.nav_classroom()}
			title={m.nav_classroom()}
			{onclick}
		>
			<span class="nav-link__icon" aria-hidden="true">{@render capIcon()}</span>
			<span class="nav-link__text">{m.nav_classroom()}</span>
		</a>
	{/if}
	{#if canEvents}
		<a
			class="nav-link nav-link--events"
			href={resolve('/events')}
			aria-label={m.nav_events()}
			title={m.nav_events()}
			{onclick}
		>
			<span class="nav-link__icon" aria-hidden="true">{@render calendarIcon()}</span>
			<span class="nav-link__text">{m.nav_events()}</span>
		</a>
	{/if}
	{#if canTutoring}
		<a
			class="nav-link nav-link--services"
			href={resolve('/services')}
			aria-label={m.nav_services()}
			title={m.nav_services()}
			{onclick}
		>
			<span class="nav-link__icon" aria-hidden="true">{@render moneyIcon()}</span>
			<span class="nav-link__text">{m.nav_services()}</span>
		</a>
	{/if}
{/snippet}

{#snippet createItems(itemClass: string, onclick: () => void)}
	{#if canSubmitExercise}
		<a role="menuitem" class={itemClass} href={resolve('/submit')} {onclick}>{m.nav_submit()}</a>
	{/if}
	{#if canSubmitMaterial}
		<a role="menuitem" class={itemClass} href={resolve('/submit-material')} {onclick}>
			{m.nav_submitMaterial()}
		</a>
	{/if}
	{#if canClassroom}
		<a role="menuitem" class={itemClass} href={resolve('/courses/new')} {onclick}>
			{m.nav_add_course()}
		</a>
	{/if}
	{#if canEvents}
		<a role="menuitem" class={itemClass} href={resolve('/events/new')} {onclick}>
			{m.nav_add_event()}
		</a>
	{/if}
	{#if canTutoring}
		<a role="menuitem" class={itemClass} href={resolve('/services/new')} {onclick}>
			{m.nav_add_service()}
		</a>
	{/if}
{/snippet}

{#snippet accountItems(itemClass: string, onclick: () => void)}
	{#if authStore.user?.id}
		<a
			role="menuitem"
			class={itemClass}
			href={resolve('/users/[id]', { id: authStore.user.id })}
			{onclick}
		>
			{m.nav_profile()}
		</a>
	{/if}
	{#if canTutoring}
		<a role="menuitem" class={itemClass} href={resolve('/bookings')} {onclick}>
			{m.nav_bookings()}
		</a>
	{/if}
	<a role="menuitem" class={itemClass} href={resolve('/settings')} {onclick}>{m.nav_settings()}</a>
	{#if canIssues}
		<button
			type="button"
			role="menuitem"
			class="{itemClass} menu-item--button"
			onclick={() => {
				onclick();
				issueReportStore.open();
			}}
		>
			{m.nav_reportIssue()}
		</button>
	{/if}
	<button
		type="button"
		role="menuitem"
		class="{itemClass} menu-item--button"
		onclick={() => {
			onclick();
			logout();
		}}
	>
		{m.nav_logout()}
	</button>
{/snippet}

{#snippet mySetIcon()}
	<!-- The same bookmark the save button on every exercise card uses. That is the whole point of
	     picking it: what you press to save and where saved things live should look like each other. -->
	<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
	</svg>
{/snippet}

{#snippet shieldIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6z" />
	</svg>
{/snippet}

{#snippet messagesIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
		<path d="m3 6.5 8.2 6.1a1.4 1.4 0 0 0 1.6 0L21 6.5" />
	</svg>
{/snippet}

<!-- The staged-collapse icons (NAVBAR-BRIEF stages 1–6): inline SVG rather than emoji, decided
     with the owner — SVG inherits the theme's text colour and sits on a line the way the messages
     envelope above already does. Every icon-only control they end up on carries a real aria-label. -->
{#snippet calendarIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="3" y="5" width="18" height="16" rx="2" />
		<path d="M3 9.5h18M8 3v4M16 3v4" />
	</svg>
{/snippet}

{#snippet bookIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5H6.5A2.5 2.5 0 0 0 4 22z" />
		<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
	</svg>
{/snippet}

{#snippet moneyIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="2.5" y="6" width="19" height="12" rx="2" />
		<circle cx="12" cy="12" r="2.5" />
		<path d="M6.5 12h.01M17.5 12h.01" />
	</svg>
{/snippet}

{#snippet exerciseIcon()}
	<!-- Exercises: a worksheet with a tick — a task to do, and done. The link was "Disciplines" and
	     drew a compass ("explore the catalogue"); once the word became Exercises/Zadania the compass
	     stood for nothing a reader could name, so the picture changed with the word. Distinct from
	     Materials' book (a thing to read) and Courses' mortarboard (a thing to attend). -->
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M7 3h7l5 5v13H7z" />
		<path d="M14 3v5h5" />
		<path d="M9.5 15.5l2 2 3.5-4" />
		<path d="M10 11h2" />
	</svg>
{/snippet}

{#snippet capIcon()}
	<!-- Courses: a mortarboard — the thing a person runs and others join. -->
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="m12 4 10 4.5-10 4.5L2 8.5z" />
		<path d="M6.5 11v4.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V11" />
	</svg>
{/snippet}

{#snippet personIcon()}
	<svg
		class="icon"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<circle cx="12" cy="8" r="3.5" />
		<path d="M5 20c1.2-3.4 3.9-5 7-5s5.8 1.6 7 5" />
	</svg>
{/snippet}

<header class="site-header" class:site-header--tucked={tucked}>
	<div class="site-header__row">
		<a class="brand" href={resolve('/')}>
			<span class="brand__mark" aria-hidden="true">∫</span>
			<span class="brand__name">{m.common_appName()}</span>
		</a>
		{#if canIssues}
			<!-- Drawn OVER the bar, under the wordmark, rather than in the flow: the bar must not grow
			     for it. Absolutely positioned against the row, with padding around the text so the hit
			     area is comfortably larger than the 11px label itself. -->
			<button type="button" class="brand__report no-print" onclick={() => issueReportStore.open()}>
				{m.nav_reportIssue()}
				<!-- "Report issue" -->
			</button>
		{/if}

		<!-- Places to go and look at things. Create flows are deliberately not in here any more, and
		     neither is moderation — see the shield in the icon cluster for where that went. -->
		<nav class="site-nav no-print" aria-label={m.nav_mainNavigation()}>
			{@render browseLinks(() => {})}
		</nav>

		<div class="site-header__actions no-print">
			<RandomExerciseButton />

			<ThemeToggle />
			<!-- Stage 8: once somebody HAS an account, the language picker moves into the account
			     menu at narrow widths — a signed-out visitor keeps it here at every width, since the
			     one control a person may need before they can read anything else must not be behind
			     a menu labelled in a language they cannot read. -->
			<span class="row-locale" class:row-locale--signed-in={authStore.isAuthenticated}>
				<LocaleSwitcher />
			</span>

			<!-- Everything addressed to YOU, together at the right-hand end: work waiting for you,
			     what somebody sent, what the site is telling you, what you saved, what you can make,
			     and who you are signed in as.

			     Icon-only, with real accessible names: an envelope and a bell are universally read,
			     and the words were costing nav slots to say what the icons already say. -->
			<div class="site-header__you">
				<!-- Moderation is not a place to browse, it is work waiting for you — which is why it
				     left the nav, and why it is a count rather than a word. It was drawn with its
				     label first and a breakpoint to drop it; the screenshot settled that: this row is
				     capped at 1100px, so with the word present the browse links were already being
				     scrolled out of reach at 1280px, and no wider viewport gives the row more room to
				     earn it back. So the word is gone at every width. Nothing is lost by it — the
				     accessible name carries the same text, and the number is the part a moderator
				     actually reads. -->
				{#if authStore.canModerate}
					<a
						class="icon-button mod-link"
						href={resolve('/moderation')}
						aria-label={m.nav_moderation()}
						title={m.nav_moderation()}
					>
						{@render shieldIcon()}
						{#if moderationQueueStore.total > 0}
							<span class="badge badge--floating">{moderationQueueStore.total}</span>
						{/if}
					</a>
				{/if}

				{#if authStore.isAuthenticated && canMessaging}
					<a class="icon-button" href={resolve('/messages')} aria-label={m.nav_messages()}>
						{@render messagesIcon()}
						{#if messagesStore.unreadCount > 0}
							<span class="badge badge--floating">{messagesStore.unreadCount}</span>
						{/if}
					</a>
				{/if}

				{#if authStore.isAuthenticated}
					<NotificationBell />
				{/if}

				<!-- My Set, for everybody including guests: a guest's set is the more fragile of the
				     two, since it lives only in this browser until they make an account, so it should
				     not be the one hidden behind a menu. Kept immediately right of the bell, where it
				     was asked for. -->
				<a class="icon-button" href={resolve('/my-set')} aria-label={m.nav_mySet()}>
					{@render mySetIcon()}
					{#if guestSetStore.count > 0}
						<span class="badge badge--floating">{guestSetStore.count}</span>
					{/if}
				</a>

				<!-- Add… sits with the personal group rather than beside the nav, now that the row no
				     longer wraps — the reason it was over there was that it used to wrap down with the
				     icons, stranding the one create affordance on a second line. -->
				{#if authStore.isAuthenticated && hasAnythingToAdd}
					<Popover label={m.nav_add()}>
						{#snippet trigger(open: boolean)}
							<span class="add-trigger" class:add-trigger--open={open}>
								<span aria-hidden="true">+</span>
								<span class="add-trigger__text">{m.nav_add()}</span>
							</span>
						{/snippet}
						{#snippet children(close: () => void)}
							{@render createItems('menu-item', close)}
						{/snippet}
					</Popover>
				{/if}

				{#if authStore.isAuthenticated}
					<Popover label={m.nav_account()}>
						{#snippet trigger(open: boolean)}
							<!-- A chevron, because looking at a screenshot of this is what showed the problem: a
						     person's own name sitting in a row of icons reads as a label, not as something
						     to press. It rotates on open so the control says which way it will go.

						     Stage 2 swaps the name for their avatar (or a plain person icon — there is
						     deliberately no identicon, §17Q "Left open"). The Popover's own `label` keeps
						     the accessible name either way. -->
							<span class="account-trigger">
								<span class="account-trigger__name">{authStore.user?.displayName}</span>
								<span class="account-trigger__avatar" aria-hidden="true">
									{#if authStore.user?.avatarUrl}
										<!-- Explicit dimensions because this one is in the ROOT LAYOUT, so it is on
										     every page, and it appears late — only once authStore.init() has
										     answered. An unsized image arriving after first paint is the textbook
										     way to shift a header that had already settled. Avatars are stored
										     square (accounts/avatar.py centre-crops to 512x512), so the ratio
										     these reserve is always the right one. -->
										<img
											class="account-trigger__img"
											src={authStore.user.avatarUrl}
											alt=""
											width="28"
											height="28"
										/>
									{:else}
										{@render personIcon()}
									{/if}
								</span>
								<span class="chevron" class:chevron--open={open} aria-hidden="true">▾</span>
							</span>
						{/snippet}
						{#snippet children(close: () => void)}
							<!-- Stage 7 removes the logo — the bar's only link home — so a Home entry appears
							     in this menu at exactly the widths where that happens. Page breadcrumbs keep
							     home reachable for guests in the same band. -->
							<a role="menuitem" class="menu-item menu-home" href={resolve('/')} onclick={close}>
								{m.nav_home()}
							</a>
							{@render accountItems('menu-item', close)}
							<!-- Stage 8: the language picker's narrow-width home once somebody has an
							     account. The row keeps it for guests — see `.row-locale` above. -->
							<div class="menu-locale">
								<LocaleSwitcher />
							</div>
						{/snippet}
					</Popover>
				{:else}
					<!-- `data-session-hidden` rather than an {#if} on `authStore.restoring` alone: the
					     server-rendered HTML cannot know about a session, so these two links are in the
					     first paint no matter what this component does, and the bundle that could
					     remove them is the slow part. app.html's marker plus the CSS in global.scss
					     covers that window; the store's own flag covers the tail after hydration. -->
					<div class="signed-out-actions" data-session-hidden class:hidden={authStore.restoring}>
						<a href={resolve('/login')}>{m.nav_login()}</a>
						<a href={resolve('/register')} class="primary-link">{m.nav_register()}</a>
					</div>
				{/if}
			</div>
		</div>
	</div>
</header>

<!-- OUTSIDE the header, and that placement is the requirement rather than a layout preference: the
     header is what slides away on scroll, so a button inside it would slide away with it. This is the
     one control that has to survive the bar hiding, because it is what brings the bar's contents back. -->
<button
	class="drawer-toggle no-print"
	type="button"
	bind:this={toggleEl}
	aria-expanded={drawerOpen}
	aria-controls="site-drawer"
	aria-label={drawerOpen ? m.nav_closeMenu() : m.nav_openMenu()}
	onclick={() => (drawerOpen ? closeDrawer() : openDrawer())}
>
	<span aria-hidden="true">{drawerOpen ? '✕' : '☰'}</span>
</button>

{#if drawerOpen}
	<!-- A real <button> rather than a <div> with a click handler: it makes the scrim an interactive
	     element by construction instead of by assertion, so no a11y suppression is needed. It is kept
	     OUT of the tab order and hidden from the accessibility tree on purpose — it is a convenience
	     for a pointer, and a keyboard user already has Escape and the ✕, so announcing a third,
	     unlabelled way to do the same thing would be noise. -->
	<button
		class="drawer-scrim no-print"
		type="button"
		tabindex="-1"
		aria-hidden="true"
		onclick={() => closeDrawer()}
	></button>
{/if}

<div
	id="site-drawer"
	class="drawer no-print"
	class:drawer--open={drawerOpen}
	bind:this={drawerEl}
	tabindex="-1"
	aria-label={m.nav_mainNavigation()}
	aria-hidden={!drawerOpen}
>
	<!-- The language sits on the close button's own line. It is the one control somebody may need
	     BEFORE they can read anything else in here, so it should not be below a list of words they
	     cannot read; and the top-right corner already belongs to the drawer's chrome rather than to
	     its contents. The padding keeps it clear of the ✕, which floats over the drawer. -->
	<div class="drawer__top">
		<LocaleSwitcher />
	</div>

	{#if authStore.isAuthenticated}
		<div class="drawer__identity">
			<span class="drawer__name">{authStore.user?.displayName}</span>
		</div>
	{/if}

	<!-- Everything that is YOURS, directly under your name: what is waiting for you, what you were
	     sent, what you saved, and what you have to decide on. This used to be scattered — the saved
	     set in one section, the two inboxes in another below the browse list, and moderation filed
	     among the browse links as though it were a place to go and look at things. -->
	<div class="drawer__section drawer__section--you">
		{#if authStore.isAuthenticated}
			<a class="drawer__link" href={resolve('/notifications')} onclick={closeOnNavigate}>
				<span aria-hidden="true">🔔</span>
				<span>{m.notification_inboxHeading()}</span>
				{#if notificationStore.unreadCount > 0}
					<span class="badge">{notificationStore.unreadCount}</span>
				{/if}
			</a>
			{#if canMessaging}
				<!-- A link to the page rather than the desktop bell/icon pair. Both of those open their
				     own popover, and a popover inside a drawer is a worse interaction than simply going
				     to the inbox — the unread counts, which are the reason they are worth surfacing at
				     all, come along as text. -->
				<a class="drawer__link" href={resolve('/messages')} onclick={closeOnNavigate}>
					{@render messagesIcon()}
					<span>{m.nav_messages()}</span>
					{#if messagesStore.unreadCount > 0}
						<span class="badge">{messagesStore.unreadCount}</span>
					{/if}
				</a>
			{/if}
		{/if}

		<!-- Offered signed out as well: the icon row this mirrors is not rendered at this width, and a
		     guest's set lives only in this browser, so it is the one that would go missing. -->
		<a class="drawer__link" href={resolve('/my-set')} onclick={closeOnNavigate}>
			{@render mySetIcon()}
			<span>{m.nav_mySet()}</span>
			{#if guestSetStore.count > 0}
				<span class="badge">{guestSetStore.count}</span>
			{/if}
		</a>

		{#if authStore.canModerate}
			<a class="drawer__link" href={resolve('/moderation')} onclick={closeOnNavigate}>
				<span aria-hidden="true">⚖</span>
				<span>{m.nav_moderation()}</span>
				{#if moderationQueueStore.total > 0}
					<!-- How many decisions are actually waiting. A moderation link with no number says
					     "there is a queue somewhere"; with one it says whether opening it is worth
					     doing now, which is the only reason to surface it in navigation at all. -->
					<span class="badge">{moderationQueueStore.total}</span>
				{/if}
			</a>
		{/if}
	</div>

	<!-- The remaining utilities, below the personal block: a random exercise and the theme are things
	     somebody reaches for without reading, but neither is about them. -->
	<div class="drawer__utilities">
		<RandomExerciseButton />
		<ThemeToggle />
	</div>

	<nav class="drawer__section" aria-label={m.nav_mainNavigation()}>
		{@render browseLinks(closeOnNavigate)}
	</nav>

	{#if authStore.isAuthenticated}
		{#if hasAnythingToAdd}
			<div class="drawer__section">
				<p class="drawer__heading">{m.nav_add()}</p>
				{@render createItems('drawer__item', closeOnNavigate)}
			</div>
		{/if}

		<div class="drawer__section">
			<p class="drawer__heading">{m.nav_account()}</p>
			{@render accountItems('drawer__item', closeOnNavigate)}
		</div>
	{:else}
		<div class="drawer__section">
			<a class="drawer__item" href={resolve('/login')} onclick={closeOnNavigate}>
				{m.nav_login()}
			</a>
			{#if canIssues}
				<button
					type="button"
					class="drawer__item menu-item--button"
					onclick={() => {
						closeOnNavigate();
						issueReportStore.open();
					}}
				>
					{m.nav_reportIssue()}
				</button>
			{/if}
			<a
				class="drawer__item drawer__item--primary"
				href={resolve('/register')}
				onclick={closeOnNavigate}
			>
				{m.nav_register()}
			</a>
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.site-header {
		@include mix.card-surface;
		border-left: none;
		border-right: none;
		border-top: none;
		border-radius: 0;
		position: sticky;
		top: 0;
		z-index: var(--z-dropdown);

		// The bar's dimensions as a LINEAR function of window width, not stepped at breakpoints
		// (NAVBAR-BRIEF §2): each clamp()'s vw middle term is a straight line between the two
		// endpoints — full size at ≥1200px, minimum at ≤720px (where the phone drawer takes over).
		// Defined once here so everything reads the same endpoints and the bar cannot end up with a
		// linear height and stepped padding. The height itself is content + 2×padding, so it shrinks
		// on the same line the padding does.
		--hdr-pad-y: clamp(6px, 1.25vw - 3px, 12px); // 12px @1200 → 6px @720
		--hdr-pad-x: clamp(8px, 1.667vw - 4px, 16px); // 16px → 8px
		--hdr-gap: clamp(6px, 1.25vw - 3px, 12px); // 12px → 6px
		--hdr-gap-sm: clamp(4px, 0.833vw - 2px, 8px); // 8px → 4px
		--hdr-border: clamp(0.5px, 0.10417vw - 0.25px, 1px); // 1px → 0.5px

		border-bottom-width: var(--hdr-border);
	}
	.site-header__row {
		max-width: 1100px;
		margin: 0 auto;
		position: relative; // the anchor for .brand__report
		display: flex;
		align-items: center;
		gap: var(--hdr-gap);
		padding: var(--hdr-pad-y) var(--hdr-pad-x);
		// One row, which is the whole point: the brand and the browse links on the left, the controls
		// on the right, nothing on a second line. The nav is what gives when the width does not add
		// up — it is the only part here that can shed something (the moderation label goes first,
		// then the browse links scroll) without a control disappearing.
		flex-wrap: nowrap;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 700;
		font-size: var(--font-size-lg);
		color: var(--text-primary);
	}
	.brand__mark {
		color: var(--accent);
	}
	// Under the wordmark, over the bar's bottom padding — the row never grows for it. The padding
	// is the hit area: the label is 11px, the target is ~19px tall and wider than the text by 12px.
	.brand__report {
		@include mix.focus-ring;
		position: absolute;
		left: calc(var(--hdr-pad-x) - 6px);
		top: calc(50% + 0.65em);
		z-index: 1;
		padding: 4px 6px;
		font-size: 11px;
		line-height: 1;
		white-space: nowrap;
		color: var(--text-secondary);
		background: none;
		border: 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
		&:hover {
			color: var(--accent);
		}
	}
	.site-nav {
		display: flex;
		// Down from --space-4. The row is capped at 1100px and, measured, was 21px short of holding
		// five browse links and the controls at that width — so the last link was clipped on a full
		// desktop. Four gaps at 4px less each buys 16px, and the row's own gap below buys the rest.
		// Now the linear token, whose wide endpoint is the same 12px this was.
		gap: var(--hdr-gap);
		// `min-width: 0` is what actually lets the row stay one row: a flex item will not shrink
		// below its content by default, so without this the nav holds the line at its natural width
		// and pushes the controls off the right-hand end instead of giving way. It is the item that
		// should give — a browse link scrolled out of reach is recoverable, a missing account menu
		// is not — hence the scroll rather than a wrap.
		flex: 0 1 auto;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
		&::-webkit-scrollbar {
			display: none;
		}
		> :global(a) {
			white-space: nowrap;
		}
		a {
			color: var(--text-secondary);
			font-size: var(--font-size-sm);
			font-weight: 500;
			display: inline-flex;
			align-items: center;
			gap: var(--space-1);
			&:hover {
				color: var(--text-primary);
			}
		}
	}
	// Each browse link carries both forms; the stage rules below swap text for icon IN PLACE, so a
	// collapsed link keeps its position and order in the nav (Materials stays between Disciplines
	// and Courses). The base rule hides every icon, which is also what keeps the drawer — where the
	// same snippet renders and none of the `.site-nav`-scoped stage rules apply — text-only.
	.nav-link__icon {
		display: none;
		align-items: center;
	}
	.badge {
		@include mix.status-pill(var(--accent-contrast), var(--accent));
		padding: 0 6px;
		font-size: 10px;
	}
	.badge--floating {
		position: absolute;
		top: -2px;
		right: -4px;
		line-height: 1.3;
	}
	/* The personal group — messages, notifications, who you are. The whole actions block is pushed
	   to the right-hand end by its own `margin-left: auto`; inside it, plain gaps and nothing else
	   (the divider that used to mark this boundary is gone — one auto margin is the separation). */
	.site-header__you {
		display: flex;
		align-items: center;
		gap: var(--hdr-gap-sm);
	}

	// Moderation: a word while there is room for one, a shield with a count when there is not. One
	// element either way rather than a wide version and a narrow version — two of them is how the
	// two drift, and how a feature flag eventually hides one and leaves the other.
	.mod-link {
		color: var(--text-secondary);
		&:hover {
			color: var(--text-primary);
		}
	}

	// A wrapper purely so the pair can be hidden as one thing while a session is being restored;
	// it reproduces the gap they used to get from being direct children of .site-header__you.
	.signed-out-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.signed-out-actions.hidden {
		display: none;
	}

	.site-header__actions {
		display: flex;
		align-items: center;
		gap: var(--hdr-gap-sm);
		font-size: var(--font-size-sm);
		/* One row. This used to be `flex: 1 1 100%` — its own full-width line — which was an honest
		   description of what the row did rather than what it should do: the header wrapped, so the
		   controls sat under the nav instead of beside it. Now it takes only the width it needs and
		   the auto margin pushes it to the right-hand end of the same line. */
		flex: 0 0 auto;
		margin-left: auto;
		a {
			color: var(--text-secondary);
			&:hover {
				color: var(--text-primary);
			}
		}
		.primary-link {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.icon-button {
		@include mix.focus-ring;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.icon {
		width: 20px;
		height: 20px;
		flex: none;
	}
	.add-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-weight: 600;
		color: var(--accent);
	}
	.add-trigger--open {
		opacity: 0.75;
	}
	.account-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-weight: 600;
		color: var(--text-primary);
	}
	.chevron {
		font-size: 10px;
		color: var(--text-secondary);
		transition: transform 120ms ease;
	}
	.chevron--open {
		transform: rotate(180deg);
	}
	.menu-item {
		@include mix.focus-ring;
		display: block;
		width: 100%;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--text-primary) !important;
		white-space: nowrap;
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.menu-item--button {
		background: none;
		border: none;
		font: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	// ---- the staged collapse (NAVBAR-BRIEF §2, simplified 2026-08-10) ----------------------------
	// As the window narrows the bar gives up the cheapest thing first, one stage at a time, instead
	// of falling off a cliff at one breakpoint. Each stage is a media query; the *sizes* between
	// stages shrink linearly via the --hdr-* tokens above. Media queries rather than a container
	// query on the header: the bar spans the full viewport, so the two are equivalent here, and
	// media queries are the tool this app already uses. The order of stages IS the specification.
	//
	// Each browse link swaps its text for its own icon IN PLACE, at the same widths as before —
	// the earlier scheme (collapsed icons migrating to the action row beside the dice, Disciplines
	// merging into a search icon by Add, Courses vanishing outright) was dropped by owner decision:
	// a link that collapses should stay where it was. Every rule here is scoped under `.site-nav`,
	// so the drawer's copies of the same links stay text-only at every width.

	.account-trigger__avatar {
		display: none;
		align-items: center;
		justify-content: center;
	}
	.account-trigger__img {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		object-fit: cover;
		display: block;
	}
	.menu-home,
	.menu-locale {
		display: none;
	}
	.menu-locale {
		padding: var(--space-2) var(--space-3);
	}

	// Stage 1 — Events loses its label and becomes a calendar icon, in place.
	@media (max-width: 1180px) {
		.site-nav .nav-link--events .nav-link__text {
			display: none;
		}
		.site-nav .nav-link--events .nav-link__icon {
			display: inline-flex;
		}
	}

	// Stage 2 — the account trigger becomes an icon: their avatar if they have one.
	@media (max-width: 1120px) {
		.account-trigger__name {
			display: none;
		}
		.account-trigger__avatar {
			display: inline-flex;
		}
	}

	// (Stage 3, Watchlists → eye icon, is deliberately absent: Watchlists was already removed from
	// the navbar — it lives on the Tutoring page — and the owner confirmed the spec line was written
	// from an older memory of the bar, not as a request to re-add it.)

	// Stage 4 — Materials becomes a book icon, in place (still between Disciplines and Courses).
	@media (max-width: 1060px) {
		.site-nav .nav-link--materials .nav-link__text {
			display: none;
		}
		.site-nav .nav-link--materials .nav-link__icon {
			display: inline-flex;
		}
	}

	// Stage 4½ — Tutoring becomes a money icon, in place.
	@media (max-width: 1000px) {
		.site-nav .nav-link--services .nav-link__text {
			display: none;
		}
		.site-nav .nav-link--services .nav-link__icon {
			display: inline-flex;
		}
	}

	// Stage 5 — the Add trigger keeps only its plus.
	@media (max-width: 950px) {
		.add-trigger__text {
			display: none;
		}
	}

	// Stage 6 — Exercises (formerly Disciplines) becomes a worksheet icon, in place (previously it merged into a search
	// icon over by the Add trigger — dropped with the rest of the rearranging scheme).
	@media (max-width: 900px) {
		.site-nav .nav-link--disciplines .nav-link__text {
			display: none;
		}
		.site-nav .nav-link--disciplines .nav-link__icon {
			display: inline-flex;
		}
	}

	// Stage 7 — the logo disappears. The lower bound matters: at ≤720px the phone bar is exactly
	// the brand plus the drawer button, so the brand must come back there. In the 721–850px band a
	// Home entry appears in the account menu, and page breadcrumbs keep home reachable for guests.
	@media (max-width: 850px) and (min-width: 721px) {
		.brand,
		.brand__report {
			display: none;
		}
	}
	@media (max-width: 850px) {
		.menu-home {
			display: block;
		}
	}

	// Stage 8 — once somebody has an account, the language picker moves into the account menu.
	// `.row-locale--signed-in` is only ever set for an authenticated session, so a guest's picker
	// stays in the row at every width.
	@media (max-width: 800px) {
		.row-locale--signed-in {
			display: none;
		}
		.menu-locale {
			display: block;
		}
	}

	// Stage 9 — Courses becomes a mortarboard icon, in place (previously it disappeared outright;
	// keeping an icon costs almost nothing at this width now that every neighbour is one too).
	@media (max-width: 760px) {
		.site-nav .nav-link--classroom .nav-link__text {
			display: none;
		}
		.site-nav .nav-link--classroom .nav-link__icon {
			display: inline-flex;
		}
	}

	// Stage 10 is the existing phone drawer, below — everything collapses into it at ≤720px.

	// ---- the drawer, and the button that opens it ------------------------------------------------
	// Both are desktop-hidden rather than mobile-added, so the desktop bar is exactly what it was.
	.drawer-toggle,
	.drawer,
	.drawer-scrim {
		display: none;
	}

	@media (max-width: 720px) {
		// One row: the bar is the brand, and everything else has moved into the drawer.
		.site-nav,
		.site-header__actions {
			display: none;
		}
		.site-header__row {
			flex-wrap: nowrap;
			// Room for the toggle, which floats over the bar rather than sitting in its flow — it has
			// to outlive the bar, so it cannot be laid out by it.
			padding-right: calc(var(--space-4) + 44px);
		}
		.site-header {
			transition: transform 180ms ease;
			will-change: transform;
		}
		.site-header--tucked {
			transform: translateY(-100%);
		}

		.drawer-toggle {
			@include mix.focus-ring;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			position: fixed;
			// Deliberately not `top: 0`: the button sits level with the bar while the bar is there, and
			// stays exactly where it is once the bar has gone, so it never appears to move.
			top: 8px;
			right: 12px;
			width: 40px;
			height: 40px;
			// Above the scrim as well as the drawer, since it doubles as the close control.
			z-index: calc(var(--z-modal) + 1);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
			font-size: var(--font-size-md);
			line-height: 1;
			cursor: pointer;
			// A button that can end up over page content rather than over the bar needs to stay legible
			// against whatever is behind it.
			box-shadow: var(--shadow-modal);
		}

		.drawer-scrim {
			display: block;
			border: none;
			padding: 0;
			position: fixed;
			inset: 0;
			z-index: var(--z-modal-scrim);
			background: rgb(0 0 0 / 45%);
		}

		.drawer {
			display: flex;
			flex-direction: column;
			gap: var(--space-3);
			position: fixed;
			top: 0;
			right: 0;
			bottom: 0;
			width: min(20rem, 86vw);
			z-index: var(--z-modal);
			// The top padding used to be `space-4 + 40px`, reserving a whole empty band for the ✕ that
			// floats over the drawer. The language selector now lives IN that band, level with the
			// close button, so the reservation moved from here onto `.drawer__top`'s own height —
			// which also reclaims 40px of dead space at the top of every drawer.
			padding: var(--space-2) var(--space-4) var(--space-4);
			background: var(--bg-surface);
			border-left: 1px solid var(--border-color);
			overflow-y: auto;
			// Off-canvas rather than unmounted, so it slides rather than appears. `visibility` is what
			// keeps it out of the tab order while it is off-screen — a translated element is still
			// focusable, and a hidden drawer full of reachable links is a real keyboard trap.
			transform: translateX(100%);
			visibility: hidden;
			transition:
				transform 200ms ease,
				visibility 200ms;
		}
		.drawer--open {
			transform: translateX(0);
			visibility: visible;
		}
		.drawer:focus {
			outline: none;
		}

		.drawer__identity {
			padding-bottom: var(--space-2);
			border-bottom: 1px solid var(--border-color);
		}
		.drawer__name {
			font-weight: 700;
		}
		/* Level with the ✕, which floats over the drawer at top: 8px / right: 12px — so the padding
		   here keeps the selector clear of it rather than under it. */
		.drawer__top {
			display: flex;
			align-items: center;
			// Exactly the band the ✕ occupies (it is fixed at top: 8px and about 40px tall), so the
			// selector sits level with it rather than below it. The right padding is what keeps the
			// two from overlapping: the button floats over this row rather than being laid out in it.
			min-height: 40px;
			padding-right: 3.25rem;
		}

		.drawer__section--you {
			border-bottom: 1px solid var(--border-color);
			padding-bottom: var(--space-2);
		}

		.drawer__utilities {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			flex-wrap: wrap;
		}
		.drawer__section {
			display: flex;
			flex-direction: column;
			padding-top: var(--space-2);
			border-top: 1px solid var(--border-color);
			// The browse links are `<a>`s styled by `.site-nav` on a desktop; in here they need their
			// own size, since that rule is scoped to a container this drawer is not inside.
			a {
				color: var(--text-primary);
			}
		}
		.drawer__heading {
			font-size: var(--font-size-xs);
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: var(--text-secondary);
			padding: var(--space-1) 0;
		}
		.drawer__item,
		.drawer__link,
		.drawer__section > :global(a) {
			@include mix.focus-ring;
			display: flex;
			align-items: center;
			gap: var(--space-2);
			// 44px of target, which is the size a thumb actually hits.
			min-height: 44px;
			padding: var(--space-2) 0;
			font-size: var(--font-size-md);
			text-align: left;
			background: none;
			border: none;
			font-family: inherit;
			color: var(--text-primary);
			cursor: pointer;
		}
		.drawer__item--primary {
			color: var(--accent);
			font-weight: 600;
		}
	}

	// Somebody who has asked for less motion gets the same behaviour with none of it: the bar still
	// tucks away and the drawer still opens, they simply do so at once.
	@media (prefers-reduced-motion: reduce) {
		.site-header,
		.drawer,
		.chevron {
			transition: none;
		}
	}
</style>
