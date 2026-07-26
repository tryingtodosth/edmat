<script lang="ts">
	// Read-only display — "users can set multiple donation links that [a visitor] can choose from,"
	// rendered as a simple row of buttons a visitor picks between. Shared by the public profile page
	// and (as a live preview) the settings page's own donation-link editor.
	import type { DonationLink } from '$lib/types';
	import { DONATION_PLATFORM_ICONS } from '$lib/utils/labels';

	let { links }: { links: DonationLink[] } = $props();
</script>

{#if links.length > 0}
	<ul class="donation-links">
		{#each links as link (link.id)}
			<li>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external donation platform URL, not an app route resolve() can express -->
				<a href={link.url} target="_blank" rel="noopener noreferrer" class="donation-link">
					<span aria-hidden="true">{DONATION_PLATFORM_ICONS[link.platform]}</span>
					{link.displayLabel}
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.donation-links {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.donation-link {
		@include mix.button-secondary;
		text-decoration: none;
	}
</style>
