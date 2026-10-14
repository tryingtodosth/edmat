<script lang="ts">
	/** A tiny trend line. Decorative: the numbers it draws are in the cells beside it, so it is
	 *  hidden from assistive tech. */
	interface Props {
		values: number[];
		width?: number;
		height?: number;
	}
	let { values, width = 80, height = 20 }: Props = $props();
	const max = $derived(Math.max(...values, 1));
	const points = $derived(
		values
			.map((v, i) => {
				const x = values.length > 1 ? (i / (values.length - 1)) * (width - 4) + 2 : width / 2;
				const y = height - 2 - (v / max) * (height - 4);
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ')
	);
</script>

<svg viewBox={`0 0 ${width} ${height}`} {width} {height} aria-hidden="true" focusable="false">
	<polyline
		{points}
		fill="none"
		stroke="var(--accent)"
		stroke-width="2"
		stroke-linejoin="round"
		stroke-linecap="round"
	/>
</svg>

<style>
	svg {
		display: block;
		max-width: 100%;
	}
</style>
