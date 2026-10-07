<script lang="ts">
	import { themeStore } from '$lib/state/theme.svelte';
	import { m } from '$lib/paraglide/messages.js';

	// Three inline SVGs in currentColor rather than three emoji (2026-10-07 colour pass): the
	// orange sun was the loudest pixel in the light bar, and an emoji takes its colour from the
	// platform's font, not from the theme. The glyph still says which mode is on.
	const icon = $derived<'system' | 'dark' | 'light'>(
		themeStore.mode === 'system' ? 'system' : themeStore.resolved === 'dark' ? 'dark' : 'light'
	);
</script>

<button type="button" class="theme-toggle" onclick={() => themeStore.cycle()} title={m.nav_theme()}>
	{#if icon === 'system'}
		<svg
			class="theme-toggle__icon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<rect x="3" y="4" width="18" height="12" rx="2" />
			<path d="M8 20h8M12 16v4" />
		</svg>
	{:else if icon === 'dark'}
		<svg
			class="theme-toggle__icon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
		</svg>
	{:else}
		<svg
			class="theme-toggle__icon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="4" />
			<path
				d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"
			/>
		</svg>
	{/if}
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
		color: var(--text-primary);
		font-size: 16px;
		&:hover {
			background: var(--bg-surface-alt);
		}
	}
	.theme-toggle__icon {
		display: block;
		width: 18px;
		height: 18px;
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
</style>
