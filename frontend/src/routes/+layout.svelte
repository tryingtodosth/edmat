<script lang="ts">
	import '$lib/styles/global.scss';
	import 'katex/dist/katex.min.css';
	import { onMount } from 'svelte';
	import { themeStore } from '$lib/state/theme.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import Header from '$lib/components/layout/Header.svelte';
	import Footer from '$lib/components/layout/Footer.svelte';

	let { children } = $props();

	onMount(() => themeStore.init());
	// Restores the session from a persisted token (token.svelte.ts) — Phase 3's real login now
	// survives a reload, unlike Phase 1's deliberately session-only mock auth.
	onMount(() => {
		authStore.init();
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
