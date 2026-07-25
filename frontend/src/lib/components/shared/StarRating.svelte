<script lang="ts">
	// Dual-purpose: a readonly display (no onChange, used on cards/summaries) or an interactive
	// 1-5 picker (ReviewForm). value is a plain value-in/value-out control — it never persists
	// anything itself.
	let {
		value,
		max = 5,
		interactive = false,
		onChange
	}: {
		value: number;
		max?: number;
		interactive?: boolean;
		onChange?: (next: number) => void;
	} = $props();

	let hovered = $state<number | null>(null);
</script>

<div
	class="stars"
	class:stars--interactive={interactive}
	role={interactive ? 'radiogroup' : undefined}
>
	{#each Array.from({ length: max }) as _, i (i)}
		{@const n = i + 1}
		{#if interactive}
			<button
				type="button"
				class="star"
				class:filled={(hovered ?? value) >= n}
				onmouseenter={() => (hovered = n)}
				onmouseleave={() => (hovered = null)}
				onclick={() => onChange?.(n)}
				aria-pressed={value >= n}
				aria-label={String(n)}
			>
				★
			</button>
		{:else}
			<span class="star" class:filled={value >= n} aria-hidden="true">★</span>
		{/if}
	{/each}
</div>

<style lang="scss">
	.stars {
		display: inline-flex;
		gap: 2px;
	}
	.star {
		font-size: 16px;
		line-height: 1;
		color: var(--border-color);
		background: none;
		border: none;
		padding: 0;
	}
	.star.filled {
		color: var(--accent);
	}
	.stars--interactive .star {
		cursor: pointer;
		font-size: 22px;
	}
</style>
