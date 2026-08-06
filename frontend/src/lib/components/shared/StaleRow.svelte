<script lang="ts">
	// One row of a merged list, dimmed by how long it has been since the server last confirmed it.
	//
	// The greyness is the whole point of `cachedList`'s per-row `confirmedAt`: a list refreshed a
	// minute ago whose bottom half has not been seen in a week should say so, rather than presenting
	// all of it as equally current. A gradient does that at a glance and costs nothing to look at
	// when everything is fresh, where a per-row "updated 3h ago" badge on forty rows would be
	// unreadable.
	//
	// `opacityFor` rather than a raw `1 - fadeFor(...)` — see its own note on why the dimmest step is
	// floored well above zero.
	import type { Snippet } from 'svelte';
	import { opacityFor } from '$lib/state/cachedList.svelte';

	let { confirmedAt, children }: { confirmedAt: number; children: Snippet } = $props();
</script>

<div class="stale-row" style="opacity: {opacityFor(confirmedAt)}">
	{@render children()}
</div>

<style lang="scss">
	// This wrapper becomes the grid item in place of the card it holds, so the card has to be told
	// to fill it — otherwise a short card stops painting its own background at the height its taller
	// neighbours set for the row.
	.stale-row {
		display: flex;
		> :global(*) {
			flex: 1;
		}
	}
</style>
