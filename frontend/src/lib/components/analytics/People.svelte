<script lang="ts">
	/** A count of people. `null` is the server's small-group suppression (1 to k-1 people) — drawn
	 *  "<10" with the reason in a title and for assistive tech, never as 0 and never as a guess. */
	import { m } from '$lib/paraglide/messages.js';
	import { formatCount, PRIVACY_K } from './format';
	import type { PeopleCount } from '$lib/types/analytics';

	let { value }: { value: PeopleCount } = $props();
</script>

{#if value === null}
	<span
		class="hidden-count"
		title={m.analytics_people_hidden({ k: PRIVACY_K })}
		aria-label={m.analytics_people_hidden({ k: PRIVACY_K })}>&lt;{PRIVACY_K}</span
	><!-- "fewer than {k} — hidden to protect privacy" -->
{:else}
	{formatCount(value)}
{/if}

<style lang="scss">
	.hidden-count {
		color: var(--text-secondary);
		font-style: italic;
		cursor: help;
	}
</style>
