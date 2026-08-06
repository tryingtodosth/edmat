<script lang="ts">
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
	import Header from '$lib/components/layout/Header.svelte';
	import Footer from '$lib/components/layout/Footer.svelte';

	let { children } = $props();

	onMount(() => themeStore.init());
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
	// Restores the session from a persisted token (token.svelte.ts) — Phase 3's real login now
	// survives a reload, unlike Phase 1's deliberately session-only mock auth. Notifications are
	// only worth fetching once a real session actually resolves — a fresh, momentarily-unauthenticated
	// page load never has anything to fetch anyway (the bell itself is hidden until authenticated).
	onMount(() => {
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
		{@render children()}
	</main>
	<Footer />
</div>

<style lang="scss">
	.app-shell {
		display: flex;
		flex-direction: column;
		min-height: 100%;
	}
	.app-main {
		flex: 1;
		width: 100%;
	}
</style>
