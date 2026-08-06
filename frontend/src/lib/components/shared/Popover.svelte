<script lang="ts">
	// A trigger button and a panel that hangs off it. Nothing more.
	//
	// **Why this exists rather than a third and fourth hand-rolled dropdown.** `MeatballsMenu` already
	// owned exactly this behaviour — open, close on Escape, close on a click outside, and put focus
	// back on the trigger so a keyboard user is not dropped at the top of the document — but it owned
	// it *for a "⋯" button holding a list of actions*. The navbar needs two panels that are neither:
	// one holds links rather than callbacks, and the other is opened by a person's own name rather
	// than by three dots. Widening MeatballsMenu to cover both would have meant a component taking
	// either items or children, either a label or a trigger snippet — a component that is really two
	// components sharing a file.
	//
	// So the *behaviour* moved here and the two callers stay small. `MeatballsMenu` keeps its own
	// implementation deliberately: it is used in a dozen places, it works, and rewriting a tested
	// component to sit on a new primitive is a change with real risk and no user-visible payoff. The
	// duplication is about twenty lines and is named here so nobody has to rediscover that it was a
	// choice.
	//
	// The panel's contents are the caller's business. This owns only the parts that are easy to get
	// subtly wrong and pointless to write more than once.
	import type { Snippet } from 'svelte';

	let {
		label,
		align = 'right',
		trigger,
		children,
		open = $bindable(false)
	}: {
		/** The trigger's accessible name. Required even when the trigger snippet renders visible text,
		 * because an icon-only trigger renders none — and this component cannot tell which it got. */
		label: string;
		align?: 'left' | 'right';
		/** The trigger's own contents — text, an icon, an avatar. Receives whether it is open, so a
		 * caller can rotate a chevron without tracking the state twice. */
		trigger: Snippet<[boolean]>;
		/** The panel. Receives a `close` callback, because most items in a menu should dismiss it:
		 * a link that navigates and leaves the popover hanging over the new page is a real bug, and
		 * SvelteKit's client-side routing means the component is not torn down by the navigation. */
		children: Snippet<[() => void]>;
		open?: boolean;
	} = $props();

	let root = $state<HTMLElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let panelEl = $state<HTMLElement | null>(null);
	/** How far to slide the panel back inside the viewport, in px. */
	let shift = $state(0);

	// The panel hangs off its trigger (`right: 0` by default), which is correct right up until the
	// trigger is not where the CSS assumed. The navbar wraps: when "Add…" lands near the LEFT of a
	// second row, a panel anchored to the trigger's right edge extends leftward and runs off the
	// page — reported, and reproducible by narrowing the window until the row wraps.
	//
	// CSS alone cannot fix this, because an absolutely-positioned box has no way to know it has left
	// the viewport. So: measure once on open, and slide it back by exactly the overflow. Both
	// directions, because the same panel overflows right when its trigger sits near the right edge
	// on a narrow screen.
	function clampIntoViewport() {
		if (!panelEl) return;
		shift = 0;
		// Measured after the shift is cleared, so reopening does not compound the previous nudge.
		requestAnimationFrame(() => {
			if (!panelEl) return;
			const margin = 8;
			const box = panelEl.getBoundingClientRect();
			if (box.right > window.innerWidth - margin) {
				shift = -(box.right - window.innerWidth + margin);
			} else if (box.left < margin) {
				shift = margin - box.left;
			}
		});
	}

	$effect(() => {
		if (open) clampIntoViewport();
		else shift = 0;
	});

	function close() {
		open = false;
	}

	function closeAndReturnFocus() {
		open = false;
		triggerEl?.focus();
	}

	function onWindowPointerDown(event: MouseEvent) {
		if (!open || !root) return;
		if (!root.contains(event.target as Node)) open = false;
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (!open) return;
		// Focus goes back to the trigger only on Escape, never on an ordinary click-away: somebody who
		// clicked elsewhere on the page has already said where they want to be, and yanking focus back
		// would fight them.
		if (event.key === 'Escape') closeAndReturnFocus();
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<div class="popover" bind:this={root}>
	<button
		type="button"
		class="popover__trigger"
		bind:this={triggerEl}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label={label}
		onclick={() => (open = !open)}
	>
		{@render trigger(open)}
	</button>

	{#if open}
		<div
			class="popover__panel popover__panel--{align}"
			role="menu"
			bind:this={panelEl}
			style="transform: translateX({shift}px)"
		>
			{@render children(close)}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.popover {
		position: relative;
		display: inline-flex;
	}
	.popover__trigger {
		@include mix.focus-ring;
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		background: none;
		border: none;
		cursor: pointer;
		font: inherit;
		font-size: var(--font-size-sm);
		padding: var(--space-1) var(--space-2);
		color: var(--text-secondary);
		border-radius: var(--radius-sm);
		&:hover {
			color: var(--text-primary);
			background: var(--bg-surface-alt);
		}
	}
	.popover__panel {
		position: absolute;
		top: calc(100% + 4px);
		z-index: var(--z-modal, 60);
		min-width: 12rem;
		display: flex;
		flex-direction: column;
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
		padding: var(--space-1) 0;
	}
	.popover__panel--right {
		right: 0;
	}
	.popover__panel--left {
		left: 0;
	}

	// On a narrow screen the panel is measured against the viewport rather than the trigger, because
	// a menu hanging off a button near the right edge would otherwise run off the page.
	@media (max-width: 720px) {
		.popover__panel {
			max-width: calc(100vw - var(--space-4) * 2);
		}
	}
</style>
