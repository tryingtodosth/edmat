<script lang="ts">
	// List / Week / Month, and the arrows that move whichever one is showing.
	//
	// One component rather than the same three buttons written twice, mostly for the accessibility:
	// the group is a real `role="tablist"` with `aria-selected` on each option, and the period arrows
	// carry names that say what they step by. Getting that right once is worth more than the handful
	// of lines it saves.
	import { m } from '$lib/paraglide/messages.js';

	let {
		value,
		options,
		onchange,
		onprevious,
		onnext,
		periodLabel,
		previousDisabled = false,
		nextDisabled = false,
		ontoday
	}: {
		value: string;
		options: { value: string; label: string }[];
		onchange: (value: string) => void;
		onprevious?: () => void;
		onnext?: () => void;
		/** What is currently on screen — "August 2026", or a week's date range. Rendered between the
		 * arrows, because a calendar with no visible statement of which period it is showing is a
		 * calendar you can get lost in. */
		periodLabel?: string;
		previousDisabled?: boolean;
		nextDisabled?: boolean;
		ontoday?: () => void;
	} = $props();
</script>

<div class="switcher">
	<div class="switcher__views" role="tablist" aria-label={m.booking_calendar_viewLabel()}>
		{#each options as option (option.value)}
			<button
				type="button"
				role="tab"
				aria-selected={value === option.value}
				class:active={value === option.value}
				onclick={() => onchange(option.value)}
			>
				{option.label}
			</button>
		{/each}
	</div>

	{#if onprevious || onnext}
		<div class="switcher__period">
			<button
				type="button"
				class="arrow"
				aria-label={m.booking_previousPeriod()}
				disabled={previousDisabled}
				onclick={() => onprevious?.()}>←</button
			>
			{#if periodLabel}
				<span class="switcher__label">{periodLabel}</span>
			{/if}
			<button
				type="button"
				class="arrow"
				aria-label={m.booking_nextPeriod()}
				disabled={nextDisabled}
				onclick={() => onnext?.()}>→</button
			>
			{#if ontoday}
				<button type="button" class="today" onclick={() => ontoday()}>
					{m.booking_today()}
				</button>
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.switcher {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		justify-content: space-between;
	}
	.switcher__views,
	.switcher__period {
		display: flex;
		gap: var(--space-1);
		align-items: center;
	}
	button {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-sm);
	}
	button.active {
		background: var(--accent);
		color: var(--accent-contrast);
		border-color: var(--accent);
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.arrow {
		min-width: 2rem;
	}
	.switcher__label {
		font-size: var(--font-size-sm);
		font-weight: 600;
		min-width: 9rem;
		text-align: center;
		text-transform: capitalize;
	}
</style>
