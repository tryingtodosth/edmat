<script lang="ts">
	/** The band chip row (AUDIENCE-BRIEF.md §1): narrows every list to ONE band. A guest's choice
	 * lives in localStorage; a signed-in person's is saved on their profile too, so it follows them
	 * to another device.
	 *
	 * **Single-select, with real radio semantics** (Piotr, 2026-09-23: "selecting one audience on
	 * the home page should display content only for the selected audience and work as radio button
	 * not as checkbox as it is rn"). Picking "Primary school" writes a one-element list, so
	 * `?audience=primary` narrows every list to that band plus the rows marked `all` — which is what
	 * "content only for the selected audience" means on a site where `all` is the deliberate
	 * age-agnostic escape hatch. Clicking the selected chip again does NOT clear it, exactly as a
	 * radio does not untick itself; the "Everything" chip is the one way back to an unnarrowed site,
	 * and it is the first chip in the row so it is always there to click.
	 *
	 * The store still holds a LIST, because Settings keeps its multi-select — a parent pinning
	 * `early_years`+`primary` is a real §1 decision and is not being taken away. When the profile
	 * holds two or more bands this row says so (no chip checked, plus a hint naming Settings) rather
	 * than pretending one of them is the chosen one; clicking any chip from that state collapses the
	 * selection to the single band clicked, which is the honest reading of the click.
	 */
	import type { Audience } from '$lib/types';
	import { AUDIENCES, AUDIENCE_LABELS } from '$lib/utils/labels';
	import { audienceFilterStore } from '$lib/state/audienceFilter.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { m } from '$lib/paraglide/messages.js';

	/** `'all'` is the clear-the-filter option, not the `all` band a submitter marks content with —
	 * the backend reads an empty `?audience=` as "no narrowing" either way. */
	type Option = { value: Audience | 'none'; label: () => string };
	const options: Option[] = [
		{ value: 'none', label: m.audience_filter_all }, // "Everything"
		...AUDIENCES.filter((a) => a !== 'all').map((band) => ({
			value: band,
			label: AUDIENCE_LABELS[band]
		}))
	];

	/** `null` when the profile pins two or more bands — no radio is checked, and the hint says why. */
	let selected = $derived.by((): Audience | 'none' | null => {
		const bands = audienceFilterStore.bands;
		if (bands.length === 0) return 'none';
		if (bands.length === 1) return bands[0];
		return null;
	});
	let multiple = $derived(audienceFilterStore.bands.length > 1);
	/** Roving tabindex: the checked radio is the group's single tab stop, and the first chip stands
	 * in for it while nothing is checked (an all-(-1) group would be unreachable by keyboard). */
	let focusIndex = $derived(
		Math.max(
			0,
			options.findIndex((o) => o.value === selected)
		)
	);

	// `$state`, not a plain array: `bind:this` into a non-reactive array element warns at runtime
	// ("binding_property_non_reactive") — a console warning svelte-check never sees, which is exactly
	// the class of thing frontend/CLAUDE.md says only a browser run finds.
	let chipEls = $state<HTMLButtonElement[]>([]);

	function choose(value: Audience | 'none') {
		const next: Audience[] = value === 'none' ? [] : [value];
		audienceFilterStore.set(next);
		if (authStore.isAuthenticated) void authStore.updateProfile({ audienceFilter: next });
	}

	/** Arrow-key movement, which is what makes `role="radiogroup"` an honest claim rather than three
	 * attributes sprinkled on some buttons — the same reason the homepage's tab strip has its own
	 * handler. In a radio group the arrow key SELECTS as it moves, so focus and selection stay
	 * together. */
	function onKeydown(event: KeyboardEvent) {
		const at = focusIndex;
		let next: number | null = null;
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (at + 1) % options.length;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
			next = (at - 1 + options.length) % options.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = options.length - 1;
		if (next === null) return;
		event.preventDefault();
		choose(options[next].value);
		chipEls[next]?.focus();
	}
</script>

<div class="chips">
	<span class="chips__label">{m.audience_chips_label()}</span>
	<!-- `tabindex="-1"` on the group itself, with the roving tabindex living on the chips: the
	     container must be focusable for the keydown handler to be a legitimate place to put one, but
	     focus should land on a CHIP, never on the strip around them — the same shape as the tab
	     strip in `routes/+page.svelte`. -->
	<div
		class="chips__row"
		role="radiogroup"
		tabindex="-1"
		aria-label={m.audience_chips_label()}
		onkeydown={onKeydown}
	>
		{#each options as option, i (option.value)}
			<button
				type="button"
				role="radio"
				class="chip"
				class:chip--on={selected === option.value}
				aria-checked={selected === option.value}
				tabindex={focusIndex === i ? 0 : -1}
				bind:this={chipEls[i]}
				onclick={() => choose(option.value)}>{option.label()}</button
			>
		{/each}
	</div>
	{#if multiple}
		<span class="chips__hint"
			>{m.audience_chips_multi_hint({ count: audienceFilterStore.bands.length })}</span
		>
	{/if}
</div>

<style lang="scss">
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.chips__row {
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
	.chips__hint {
		font-size: 0.8rem;
		color: var(--text-secondary);
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
