<script lang="ts">
	// The "⋯" next to something you own.
	//
	// The point of putting these on the public profile rather than behind a separate settings form is
	// that you edit what you are actually looking at: the page stays the page everybody else sees,
	// and the controls are additions to it rather than a different screen with a different layout
	// that you then have to imagine the public version of.
	//
	// Deliberately generic — it knows nothing about profiles. Callers pass items; this owns only the
	// opening, closing and keyboard behaviour, which is the part that is easy to get subtly wrong and
	// pointless to write more than once.
	import { m } from '$lib/paraglide/messages.js';

	export interface MenuItem {
		label: string;
		onselect: () => void;
		/** Rendered in the destructive tone. Nothing here confirms — callers that need it do it. */
		danger?: boolean;
		disabled?: boolean;
	}

	let { items, label }: { items: MenuItem[]; label: string } = $props();

	let open = $state(false);
	let root = $state<HTMLElement | null>(null);
	let trigger = $state<HTMLButtonElement | null>(null);

	function choose(item: MenuItem) {
		if (item.disabled) return;
		open = false;
		// Focus returns to the trigger, or a keyboard user is dropped at the top of the document
		// after every action.
		trigger?.focus();
		item.onselect();
	}

	function onWindowPointerDown(event: MouseEvent) {
		if (!open || !root) return;
		if (!root.contains(event.target as Node)) open = false;
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			open = false;
			trigger?.focus();
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<div class="meatballs" bind:this={root}>
	<button
		type="button"
		class="meatballs__trigger"
		bind:this={trigger}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label={label}
		onclick={() => (open = !open)}
	>
		⋯
	</button>

	{#if open}
		<div class="meatballs__menu" role="menu">
			{#each items as item (item.label)}
				<button
					type="button"
					role="menuitem"
					class="meatballs__item"
					class:meatballs__item--danger={item.danger}
					disabled={item.disabled}
					onclick={() => choose(item)}
				>
					{item.label}
				</button>
			{/each}
			{#if items.length === 0}
				<p class="meatballs__empty">{m.common_loading()}</p>
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.meatballs {
		position: relative;
		display: inline-flex;
	}
	.meatballs__trigger {
		@include mix.focus-ring;
		background: none;
		border: none;
		cursor: pointer;
		font-size: var(--font-size-lg);
		line-height: 1;
		padding: 0 var(--space-1);
		color: var(--text-secondary);
		border-radius: var(--radius-sm);
		&:hover {
			color: var(--text-primary);
			background: var(--bg-surface-alt);
		}
	}
	.meatballs__menu {
		position: absolute;
		top: 100%;
		right: 0;
		z-index: 20;
		min-width: 10rem;
		display: flex;
		flex-direction: column;
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
	}
	.meatballs__item {
		@include mix.focus-ring;
		text-align: left;
		background: none;
		border: none;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-size: var(--font-size-sm);
		color: var(--text-primary);
		cursor: pointer;
		&:hover:not(:disabled) {
			background: var(--bg-surface-alt);
		}
		&:disabled {
			opacity: 0.45;
			cursor: default;
		}
	}
	.meatballs__item--danger {
		color: var(--status-danger, #c0392b);
	}
	.meatballs__empty {
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
