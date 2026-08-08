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
	import { saveTargetsStore } from '$lib/state/saveTargets.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
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
	let canEvents = $derived(can('events'));
	let canMessaging = $derived(can('messaging'));

	// An empty menu is worse than no menu: it invites a click and then explains nothing. So the
	// trigger itself disappears when a moderator has switched off everything under it.
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
	<a href={resolve('/disciplines')} {onclick}>{m.nav_browse()}</a>
	<a href={resolve('/materials')} {onclick}>{m.nav_materials()}</a>
	{#if canClassroom}
		<a href={resolve('/courses')} {onclick}>{m.nav_classroom()}</a>
	{/if}
	{#if canEvents}
		<a href={resolve('/events')} {onclick}>{m.nav_events()}</a>
	{/if}
	{#if canTutoring}
		<a href={resolve('/services')} {onclick}>{m.nav_services()}</a>
	{/if}
	<!-- canModerate, not isModerator — a scoped node governor should reach the moderation page too,
	     just seeing a narrower queue once there (CLAUDE.md's own "node governor" feature) -->
	{#if authStore.canModerate}
		<a href={resolve('/moderation')} {onclick}>{m.nav_moderation()}</a>
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

<header class="site-header" class:site-header--tucked={tucked}>
	<div class="site-header__row">
		<a class="brand" href={resolve('/')}>
			<span class="brand__mark" aria-hidden="true">∫</span>
			<span class="brand__name">{m.common_appName()}</span>
		</a>

		<!-- Places to go and look at things. Create flows are deliberately not in here any more. -->
		<nav class="site-nav no-print" aria-label={m.nav_mainNavigation()}>
			{@render browseLinks(() => {})}
		</nav>

		<!-- Add… rides on the top row next to the nav rather than in the icon cluster. The row wraps,
		     and while this sat at the head of the actions group it wrapped down with them — putting the
		     one create affordance on a second line, below the things it creates against. -->
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

		<div class="site-header__actions no-print">
			<RandomExerciseButton />

			{#if authStore.isAuthenticated && canMessaging}
				<!-- Icon-only, with a real accessible name: an envelope is universally read, and the word
				     "Messages" was costing a nav slot to say what the icon already says. The unread count
				     rides on it exactly as it did on the old text link. -->
				<a class="icon-button" href={resolve('/messages')} aria-label={m.nav_messages()}>
					{@render messagesIcon()}
					{#if messagesStore.unreadCount > 0}
						<span class="badge badge--floating">{messagesStore.unreadCount}</span>
					{/if}
				</a>
			{/if}

			<LocaleSwitcher />
			<ThemeToggle />

			{#if authStore.isAuthenticated}
				<NotificationBell />
			{/if}

			<!-- My Set, for everybody: a guest's set is the more fragile of the two, since it lives only
			     in this browser until they make an account, so it should not be the one hidden behind a
			     menu. To the right of the bell, so the count-carrying icons sit together. -->
			<a class="icon-button" href={resolve('/my-set')} aria-label={m.nav_mySet()}>
				{@render mySetIcon()}
				{#if guestSetStore.count > 0}
					<span class="badge badge--floating">{guestSetStore.count}</span>
				{/if}
			</a>

			{#if authStore.isAuthenticated}
				<Popover label={m.nav_account()}>
					{#snippet trigger(open: boolean)}
						<!-- A chevron, because looking at a screenshot of this is what showed the problem: a
						     person's own name sitting in a row of icons reads as a label, not as something
						     to press. It rotates on open so the control says which way it will go. -->
						<span class="account-trigger">
							{authStore.user?.displayName}
							<span class="chevron" class:chevron--open={open} aria-hidden="true">▾</span>
						</span>
					{/snippet}
					{#snippet children(close: () => void)}
						{@render accountItems('menu-item', close)}
					{/snippet}
				</Popover>
			{:else}
				<a href={resolve('/login')}>{m.nav_login()}</a>
				<a href={resolve('/register')} class="primary-link">{m.nav_register()}</a>
			{/if}
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
	{#if authStore.isAuthenticated}
		<div class="drawer__identity">
			<span class="drawer__name">{authStore.user?.displayName}</span>
		</div>
	{/if}

	<!-- The utilities first and as a row: they are the ones somebody reaches for without reading, and
	     a phone's thumb reaches the top of a right-hand drawer least comfortably of anywhere in it. -->
	<div class="drawer__utilities">
		<RandomExerciseButton />
		<LocaleSwitcher />
		<ThemeToggle />
	</div>

	<nav class="drawer__section" aria-label={m.nav_mainNavigation()}>
		{@render browseLinks(closeOnNavigate)}
	</nav>

	<!-- Outside the signed-in block, and before it: the icon row it mirrors is not rendered at this
	     width, so without this a phone would have no way to reach a saved set at all — and a guest's
	     set, which lives only in this browser, is the one that would go missing. -->
	<div class="drawer__section">
		<a class="drawer__link" href={resolve('/my-set')} onclick={closeOnNavigate}>
			{@render mySetIcon()}
			<span>{m.nav_mySet()}</span>
			{#if guestSetStore.count > 0}
				<span class="badge">{guestSetStore.count}</span>
			{/if}
		</a>
	</div>

	{#if authStore.isAuthenticated}
		{#if canMessaging}
			<div class="drawer__section">
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
				<a class="drawer__link" href={resolve('/notifications')} onclick={closeOnNavigate}>
					<span aria-hidden="true">🔔</span>
					<span>{m.notification_inboxHeading()}</span>
					{#if notificationStore.unreadCount > 0}
						<span class="badge">{notificationStore.unreadCount}</span>
					{/if}
				</a>
			</div>
		{/if}

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
	}
	.site-header__row {
		max-width: 1100px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		flex-wrap: wrap;
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
	.site-nav {
		display: flex;
		gap: var(--space-4);
		flex: 1;
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
	.site-header__actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
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
			padding: calc(var(--space-4) + 40px) var(--space-4) var(--space-4);
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
