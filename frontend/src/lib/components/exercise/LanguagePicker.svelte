<script lang="ts">
	// The exercise's CONTENT language picker — deliberately independent of the interface locale
	// switcher (LocaleSwitcher.svelte). CLAUDE.md Section 10's "two axes": a reader might use the
	// English interface but want to read an exercise's original Polish statement, or vice versa.
	import { m } from '$lib/paraglide/messages.js';

	// Controlled, not bindable — picking a language needs to trigger an async re-fetch of the
	// resolved exercise (lib/services/exercises.ts's getExerciseById, ?lang=), not just update a
	// local value, so the caller owns the value and reacts to onchange itself.
	let {
		availableLocales,
		value,
		onchange
	}: { availableLocales: string[]; value: string; onchange: (next: string) => void } = $props();
</script>

<label class="language-picker">
	<span class="visually-hidden">{m.exercise_language()}</span>
	<select {value} onchange={(e) => onchange((e.target as HTMLSelectElement).value)}>
		{#each availableLocales as locale (locale)}
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
