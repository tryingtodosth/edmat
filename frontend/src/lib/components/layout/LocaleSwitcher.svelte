<script lang="ts">
	// Interface-language switcher — the FIRST of CLAUDE.md Section 10's two deliberately separate
	// axes (interface i18n via Paraglide). Not to be confused with a resolved exercise's own
	// content-language picker (lib/components/exercise/LanguagePicker.svelte), which is unrelated
	// and independent.
	import { locales } from '$lib/paraglide/runtime';
	import { localeStore } from '$lib/state/locale.svelte';
	import { m } from '$lib/paraglide/messages.js';

	// Through the store rather than `setLocale` directly, so the switch re-renders instead of
	// reloading — see lib/state/locale.svelte.ts for what a reload was actually costing.
	function onChange(e: Event) {
		const next = (e.target as HTMLSelectElement).value;
		if (next === 'en' || next === 'pl') localeStore.set(next);
	}
</script>

<label class="locale-switcher">
	<span class="visually-hidden">{m.nav_language()}</span>
	<select value={localeStore.value} onchange={onChange} aria-label={m.nav_language()}>
		{#each locales as locale (locale)}
			<option value={locale}>{locale.toUpperCase()}</option>
		{/each}
	</select>
</label>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	select {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		font-size: var(--font-size-sm);
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
</style>
