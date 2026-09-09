<script lang="ts">
	/** The band chip row (AUDIENCE-BRIEF.md §1): narrows every list to the ticked bands. A guest's
	 * choice lives in localStorage; a signed-in person's is saved on their profile too, so it
	 * follows them to another device. */
	import type { Audience } from '$lib/types';
	import { AUDIENCES, AUDIENCE_LABELS } from '$lib/utils/labels';
	import { audienceFilterStore } from '$lib/state/audienceFilter.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { m } from '$lib/paraglide/messages.js';

	const choosable = AUDIENCES.filter((a) => a !== 'all');

	function toggle(band: Audience) {
		const current = audienceFilterStore.bands;
		const next = current.includes(band) ? current.filter((b) => b !== band) : [...current, band];
		apply(next);
	}
	function clear() {
		apply([]);
	}
	function apply(next: Audience[]) {
		audienceFilterStore.set(next);
		if (authStore.isAuthenticated) void authStore.updateProfile({ audienceFilter: next });
	}
</script>

<div class="chips" role="group" aria-label={m.audience_chips_label()}>
	<span class="chips__label">{m.audience_chips_label()}</span>
	<button
		type="button"
		class="chip"
		class:chip--on={audienceFilterStore.bands.length === 0}
		aria-pressed={audienceFilterStore.bands.length === 0}
		onclick={clear}>{m.audience_filter_all()}</button
	>
	{#each choosable as band (band)}
		<button
			type="button"
			class="chip"
			class:chip--on={audienceFilterStore.bands.includes(band)}
			aria-pressed={audienceFilterStore.bands.includes(band)}
			onclick={() => toggle(band)}>{AUDIENCE_LABELS[band]()}</button
		>
	{/each}
</div>

<style lang="scss">
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.chips__label {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin-right: 0.25rem;
	}
	.chip {
		min-height: 44px;
		padding: 0.35rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
		font: inherit;
		font-size: 0.9rem;
	}
	.chip--on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.chip:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
