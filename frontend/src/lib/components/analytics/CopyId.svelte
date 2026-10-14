<script lang="ts">
	/** A request id in monospace with a copy button — the thing a developer pastes into a log grep. */
	import { m } from '$lib/paraglide/messages.js';
	let { value }: { value: string } = $props();
	let copied = $state(false);
	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard blocked (insecure origin, permission): the id is selectable text anyway.
		}
	}
</script>

<span class="id">
	<code class="mono">{value}</code>
	<button type="button" onclick={copy} aria-label={m.analytics_copyId({ id: value })}>
		<!-- "Copy request id {id}" -->
		{copied ? m.analytics_copied() : m.analytics_copy()}<!-- "Copied" / "Copy" -->
	</button>
</span>

<style lang="scss">
	.id {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	code {
		overflow-wrap: anywhere;
	}
	button {
		font-size: var(--font-size-xs);
		padding: 0 var(--space-2);
		min-height: 0;
		line-height: 1.6;
	}
</style>
