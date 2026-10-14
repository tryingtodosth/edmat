<script lang="ts">
	/**
	 * A day-by-day chart drawn as inline SVG — stacked bars (traffic by audience) or lines. No chart
	 * library (house rule 11). One y-axis only, 2px lines, a gap between stacked segments, a legend
	 * whenever there are two or more series, a hover crosshair with a tooltip, and the same numbers
	 * as a real table under "Show as a table" so nothing is colour-only.
	 *
	 * Colours arrive as CSS custom properties (`var(--accent)`), so light, dark and high-contrast
	 * themes all work with no per-theme code here. A `hatch` series is drawn with a diagonal
	 * texture instead of a fill — used for bots, which are shown but visually de-emphasised.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { formatCount, longDate, niceMax, shortDate } from './format';

	export type Series = {
		key: string;
		label: string;
		values: number[];
		color: string;
		hatch?: boolean;
	};

	interface Props {
		dates: string[];
		series: Series[];
		stacked?: boolean;
		/** A one-sentence summary for assistive tech: what the chart shows. */
		title: string;
	}
	let { dates, series, stacked = false, title }: Props = $props();

	const W = 640;
	const H = 200;
	const L = 40;
	const R = 8;
	const T = 8;
	const B = 24;
	const uid = Math.random().toString(36).slice(2, 8);

	const n = $derived(dates.length);
	const step = $derived((W - L - R) / Math.max(n, 1));
	const totals = $derived(
		dates.map((_, i) =>
			stacked
				? series.reduce((s, x) => s + (x.values[i] ?? 0), 0)
				: Math.max(...series.map((x) => x.values[i] ?? 0), 0)
		)
	);
	const yMax = $derived(niceMax(Math.max(...totals, 0)));
	const y = (v: number) => T + (H - T - B) * (1 - v / yMax);
	const xCenter = (i: number) => L + (i + 0.5) * step;

	const bars = $derived(
		stacked
			? dates.flatMap((_, i) => {
					let acc = 0;
					return series.map((s, si) => {
						const v = s.values[i] ?? 0;
						const y0 = y(acc);
						acc += v;
						const y1 = y(acc);
						return { i, si, v, y: y1, h: Math.max(y0 - y1 - (n <= 120 ? 1 : 0), 0.5) };
					});
				})
			: []
	);
	const barW = $derived(Math.max(step * 0.78, 1));
	const lines = $derived(
		stacked
			? []
			: series.map((s) =>
					s.values.map((v, i) => `${xCenter(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
				)
	);
	const xTicks = $derived.by(() => {
		const count = Math.min(5, n);
		if (count <= 1) return n ? [0] : [];
		return Array.from({ length: count }, (_, k) => Math.round((k * (n - 1)) / (count - 1)));
	});
	// The midline only when it is a whole number: counts are integers, and a gridline at 2.5 labelled
	// "3" (the first screenshot, a 5xx chart topping out at 5) is a label that lies about its line.
	const yTicks = $derived(Number.isInteger(yMax / 2) ? [0, yMax / 2, yMax] : [0, yMax]);

	let hover = $state<number | null>(null);
	function onMove(e: PointerEvent) {
		const svg = e.currentTarget as SVGElement;
		const rect = svg.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * W;
		const i = Math.floor((x - L) / step);
		hover = i >= 0 && i < n ? i : null;
	}
</script>

<figure class="chart">
	<div class="plot">
		<svg
			viewBox={`0 0 ${W} ${H}`}
			role="img"
			aria-label={title}
			onpointermove={onMove}
			onpointerleave={() => (hover = null)}
		>
			<title>{title}</title>
			<defs>
				<pattern
					id={`hatch-${uid}`}
					width="5"
					height="5"
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<line x1="0" y1="0" x2="0" y2="5" stroke="var(--status-neutral)" stroke-width="2" />
				</pattern>
			</defs>
			{#each yTicks as t (t)}
				<line class="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
				<text class="tick" x={L - 6} y={y(t) + 3} text-anchor="end">{formatCount(Math.round(t))}</text>
			{/each}
			{#each xTicks as i (i)}
				<text class="tick" x={xCenter(i)} y={H - 6} text-anchor="middle">{shortDate(dates[i])}</text>
			{/each}
			{#if hover !== null}
				<rect class="cursor" x={L + hover * step} y={T} width={step} height={H - T - B} />
			{/if}
			{#if stacked}
				{#each bars as b (`${b.i}-${b.si}`)}
					{#if b.v > 0}
						<rect
							x={L + b.i * step + (step - barW) / 2}
							y={b.y}
							width={barW}
							height={b.h}
							fill={series[b.si].hatch ? `url(#hatch-${uid})` : series[b.si].color}
							stroke={series[b.si].hatch ? 'var(--status-neutral)' : 'none'}
							stroke-width="0.5"
						/>
					{/if}
				{/each}
			{:else}
				{#each series as s, si (s.key)}
					<polyline
						points={lines[si]}
						fill="none"
						stroke={s.color}
						stroke-width="2"
						stroke-linejoin="round"
					/>
					{#if hover !== null}
						<circle
							cx={xCenter(hover)}
							cy={y(s.values[hover] ?? 0)}
							r="4"
							fill={s.color}
							stroke="var(--bg-surface)"
							stroke-width="2"
						/>
					{/if}
				{/each}
			{/if}
		</svg>
		{#if hover !== null}
			<div class="tip" style:left={`${Math.min(Math.max((xCenter(hover) / W) * 100, 15), 85)}%`}>
				<strong>{longDate(dates[hover])}</strong>
				{#each series as s (s.key)}
					<div>{s.label}: {formatCount(s.values[hover] ?? 0)}</div>
				{/each}
			</div>
		{/if}
	</div>
	{#if series.length > 1}
		<ul class="legend">
			{#each series as s (s.key)}
				<li>
					<span class="swatch" class:hatched={s.hatch} style:background={s.hatch ? undefined : s.color}
					></span>{s.label}
				</li>
			{/each}
		</ul>
	{/if}
	<details class="as-table">
		<summary>{m.analytics_chart_showTable()}</summary><!-- "Show as a table" -->
		<div class="table-wrap">
			<table class="atable">
				<caption>{title}</caption>
				<thead>
					<tr>
						<th scope="col">{m.analytics_col_date()}</th><!-- "Date" -->
						{#each series as s (s.key)}<th scope="col" class="num">{s.label}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each dates as d, i (d)}
						<tr>
							<th scope="row">{shortDate(d)}</th>
							{#each series as s (s.key)}<td class="num">{formatCount(s.values[i] ?? 0)}</td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</figure>

<style lang="scss">
	.chart {
		margin: 0 0 var(--space-3);
		min-width: 0;
	}
	.plot {
		position: relative;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
		touch-action: pan-y;
	}
	.grid {
		stroke: var(--border-color);
		stroke-width: 1;
	}
	.tick {
		fill: var(--text-secondary);
		font-size: 10px;
	}
	.cursor {
		fill: var(--accent-soft);
	}
	.tip {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		pointer-events: none;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-popover);
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-xs);
		white-space: nowrap;
		z-index: 1;
	}
	.legend {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: var(--space-2) 0 0;
		padding: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.swatch {
		display: inline-block;
		width: 12px;
		height: 12px;
		margin-right: var(--space-1);
		border-radius: 2px;
		vertical-align: -1px;
	}
	.hatched {
		background: repeating-linear-gradient(45deg, var(--status-neutral) 0 2px, transparent 2px 5px);
		border: 1px solid var(--status-neutral);
	}
	.as-table {
		margin-top: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.as-table summary {
		cursor: pointer;
		color: var(--text-secondary);
	}
</style>
