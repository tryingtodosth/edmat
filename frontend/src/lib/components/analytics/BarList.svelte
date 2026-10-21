<script lang="ts">
	/**
	 * A ranked list of horizontal bars — the form for "how much of each", where the labels are long
	 * and the bars are only there to be compared. Every row prints its own number, so the bars are
	 * never the only carrier. A `null` value is a suppressed people-count: no bar, "<10".
	 */
	import { formatCount } from './format';
	import People from './People.svelte';

	export type BarItem = {
		key: string;
		label: string;
		value: number | null;
		/** What to print instead of the bare number (e.g. "57 %"). */
		display?: string;
		href?: string;
		/** Secondary text under the label. */
		note?: string;
	};
	interface Props {
		items: BarItem[];
		/** Whether `null` means a suppressed count of people. */
		people?: boolean;
		/** The scale's maximum; defaults to the largest value. */
		max?: number;
	}
	let { items, people = false, max }: Props = $props();
	const top = $derived(max ?? Math.max(...items.map((i) => i.value ?? 0), 1));
</script>

<ul class="bars">
	{#each items as item (item.key)}
		<li>
			<div class="row">
				{#if item.href}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes a resolve()d (and for /materials, localized) path -->
					<a class="label" href={item.href}>{item.label}</a>
				{:else}
					<span class="label">{item.label}</span>
				{/if}
				<span class="value">
					{#if item.display}{item.display}{:else if people}<People
							value={item.value}
						/>{:else}{formatCount(item.value ?? 0)}{/if}
				</span>
			</div>
			<div class="track" aria-hidden="true">
				<div
					class="fill"
					style:width={`${item.value ? Math.max((item.value / top) * 100, 1.5) : 0}%`}
				></div>
			</div>
			{#if item.note}<div class="itemnote">{item.note}</div>{/if}
		</li>
	{/each}
</ul>

<style lang="scss">
	.bars {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--font-size-sm);
	}
	.label {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.value {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.track {
		height: 6px;
		margin-top: 2px;
		background: var(--bg-surface-alt);
		border-radius: 0 3px 3px 0;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		border-radius: 0 3px 3px 0;
	}
	.itemnote {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
