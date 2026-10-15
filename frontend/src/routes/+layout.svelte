<script lang="ts">
	import { a11yPrefsStore } from '$lib/state/a11yPrefs.svelte';
	import '$lib/styles/global.scss';
	import 'katex/dist/katex.min.css';
	import { onMount } from 'svelte';
	import { themeStore } from '$lib/state/theme.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import { messagesStore } from '$lib/state/messages.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { taxonomyStore } from '$lib/state/taxonomy.svelte';
	import { materialTypesStore } from '$lib/state/materialTypes.svelte';
	// Imported for its side effect, which is the whole feature: it makes Paraglide's locale a rune,
	// so switching language re-renders the text in place instead of reloading the page. Imported
	// here, in the one component every page is inside, so the override is installed before anything
	// calls a message function.
	import { localeStore } from '$lib/state/locale.svelte';
	import Header from '$lib/components/layout/Header.svelte';
	import Footer from '$lib/components/layout/Footer.svelte';
	import { issueReportStore } from '$lib/state/issueReport.svelte';
	import { welcomeStore } from '$lib/state/welcome.svelte';

	let { children } = $props();

	onMount(() => themeStore.init());
	// The interface language for somebody who has never chosen one. Polish is already what the page
	// painted in (`baseLocale`), so this costs one small request exactly once per browser and does
	// nothing at all unless the visitor turns out to be somewhere other than Poland — see
	// lib/state/locale.svelte.ts. Never awaited and never able to reject.
	onMount(() => {
		localeStore.initFirstVisit();
	});
	// AllowAny server-side and independent of auth — an anonymous visitor's nav/routes need to
	// reflect a killed feature just as much as a logged-in one's, so this doesn't wait on (or get
	// gated behind) authStore.init() the way notifications/messages below do.
	onMount(() => featureFlagsStore.refresh());
	// The discipline/branch tree is this app's navigation and is wanted by nearly every page — the
	// browse grids, and the pickers on every submit/filter/create form. Warming it here means the
	// first of those to open already has it, instead of each paying its own round trip. Public, like
	// the flags above, so it does not wait on a session; `preload` never rejects.
	onMount(() => taxonomyStore.preload());
	// The material-type vocabulary, for the same reason and at the same cost: it is small, it is
	// wanted by every material card's badge, and a proposed type has no message key to fall back on.
	onMount(() => materialTypesStore.preload());
	// The browser error reporter (lib/errors/reporter.ts): window `error` + `unhandledrejection`, sent
	// only when something breaks, with no cookie, no storage and no identifier, and never under
	// GPC/DNT. Imported here, lazily, so it is not part of the entry bundle.
	onMount(() => {
		import('$lib/errors/reporter').then((reporter) => reporter.install()).catch(() => {});
	});
	// Restores the session from a persisted token (token.svelte.ts) — Phase 3's real login now
	// survives a reload, unlike Phase 1's deliberately session-only mock auth. Notifications are
	// only worth fetching once a real session actually resolves — a fresh, momentarily-unauthenticated
	// page load never has anything to fetch anyway (the bell itself is hidden until authenticated).
	// The one-off welcome after registering (WelcomeCard): armed by /register, read here once in case
	// the landing page was reloaded before the card drew.
	onMount(() => welcomeStore.load());
	onMount(() => {
		a11yPrefsStore.applyStored();
		authStore.init().then(() => {
			if (authStore.isAuthenticated) {
				notificationStore.refresh();
				messagesStore.refresh();
			}
		});
	});
</script>

<div class="app-shell">
	<Header />
	<main class="app-main">
		<!-- Same on-demand shape as the issue modal below: a card one account in a thousand sees
		     once should not be in every page's entry bundle. -->
		{#if welcomeStore.pendingFor}
			{#await import('$lib/components/layout/WelcomeCard.svelte') then { default: WelcomeCard }}
				<WelcomeCard />
			{/await}
		{/if}
		{@render children()}
	</main>
	<Footer />
	<!-- Loaded on demand, not imported: mounted statically here, the modal's own chunk and
	     `ModalShell`'s stylesheet were pulled into the root layout and so inlined into EVERY page
	     (PageSpeed: ~15 KiB of unused CSS above the fold). The store stays a static import — it is a
	     few lines — so the three triggers can flip `isOpen` before the component ever exists; the
	     first open fetches it, after which it manages its own visibility. -->
	{#if issueReportStore.isOpen}
		{#await import('$lib/components/issues/ReportIssueModal.svelte') then { default: ReportIssueModal }}
			<ReportIssueModal />
		{/await}
	{/if}
</div>

<style lang="scss">
	// Sticky-footer flex used to force `.app-shell` to at least one full viewport height, which on a
	// content-light page (e.g. /services with only a handful of cards) left a large blank gap between
	// the results and the footer. Dropping the forced min-height lets the footer sit right after
	// whatever content actually rendered; on a page tall enough to fill the viewport on its own this
	// changes nothing, since normal document flow already puts the footer after it either way.
	.app-shell {
		display: flex;
		flex-direction: column;
	}
	.app-main {
		width: 100%;
		// The home hero's wash bleeds to both window edges with `calc(50% - 50vw)`, and `vw` counts
		// the scrollbar — so it overhangs the visible width by the scrollbar and would otherwise put
		// a horizontal scrollbar on the home page.
		// `clip`, never `hidden`: `hidden` would make this element a scroll container, and then every
		// `position: sticky` inside a page (the branch page's topic rail, the booking week's day
		// header) would stick to a box that never scrolls — which looks exactly like sticky having
		// been removed. `overflow-x: clip` leaves `overflow-y: visible` alone, where `overflow-x:
		// hidden` silently coerces it to `auto` and takes the same sticky away.
		overflow-x: clip;
	}
</style>
