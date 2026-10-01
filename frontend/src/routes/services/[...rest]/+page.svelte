<script lang="ts">
	// Never rendered: the `load` beside this file always redirects. SvelteKit needs a component
	// for the route to exist at all, so this is the smallest honest one — a line for the case
	// where a redirect somehow does not happen, rather than a blank screen.
	import { m } from '$lib/paraglide/messages.js';
</script>

<p class="moved">{m.common_loading()}</p>

<style lang="scss">
	.moved {
		padding: var(--space-4);
		color: var(--text-secondary);
	}
</style>
