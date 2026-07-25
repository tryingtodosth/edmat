<script lang="ts">
	import { themeStore } from '$lib/state/theme.svelte';
	import { m } from '$lib/paraglide/messages.js';

	const icon = $derived(
		themeStore.mode === 'system' ? '🖥️' : themeStore.resolved === 'dark' ? '🌙' : '☀️'
	);
</script>

<button type="button" class="theme-toggle" onclick={() => themeStore.cycle()} title={m.nav_theme()}>
	<span aria-hidden="true">{icon}</span>
	<span class="visually-hidden">{m.nav_theme()}</span>
</button>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.theme-toggle {
		@include mix.focus-ring;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		font-size: 16px;
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
</style>
