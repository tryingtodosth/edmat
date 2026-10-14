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
	import { tick, type Snippet } from 'svelte';

	let {
		label,
		align = 'right',
		trigger,
		children,
		open = $bindable(false),
		closeOnFocusOut = false
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
		/** Close when keyboard focus leaves the popover (Tab past its last item). Opt-in, because a
		 * panel that opens a dialog of its own (the save menu's "new set") moves focus outside on
		 * purpose and must not close under it. */
		closeOnFocusOut?: boolean;
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

	// ---- the keyboard, inside a `role="menu"` panel (WP8, 2026-10-14) ---------------------------
	// The panel has always said `role="menu"`, and a screen reader that hears "menu" tells its user
	// to press the arrow keys — which did nothing here; only Tab moved. So the arrows now walk the
	// `menuitem`s (Home/End jump to the ends), and ArrowDown on the closed trigger opens the panel
	// on its first item. Tab still works exactly as before: the items stay in the tab order, so
	// nobody who learned this menu by tabbing loses anything. Only `[role="menuitem"]` is walked —
	// a group heading is not one and is never a stop — and a control that owns its own arrows (the
	// language `<select>` at narrow widths) keeps them.
	function menuItems(): HTMLElement[] {
		if (!panelEl) return [];
		return Array.from(panelEl.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
			// Hidden by a stage rule (the Home entry above 850px) means not a stop.
			(el) => el.getClientRects().length > 0
		);
	}

	function onPanelKeydown(event: KeyboardEvent) {
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('select, input, textarea')) return;
		const items = menuItems();
		if (items.length === 0) return;
		event.preventDefault();
		const at = target ? items.indexOf(target) : -1;
		let next: number;
		if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = items.length - 1;
		else if (event.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length;
		else next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
		items[next].focus();
	}

	async function onTriggerKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		open = true;
		await tick();
		const items = menuItems();
		(event.key === 'ArrowDown' ? items[0] : items[items.length - 1])?.focus();
	}

	// Only when focus demonstrably went somewhere ELSE: `relatedTarget` is the element receiving
	// focus. A pointer click on a button inside the panel can report `null` there (Safari does not
	// focus buttons on click), and closing on that would unmount the item before its click lands.
	function onFocusOut(event: FocusEvent) {
		if (!closeOnFocusOut || !open || !root) return;
		const to = event.relatedTarget as Node | null;
		if (to && !root.contains(to)) open = false;
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

<div class="popover" bind:this={root} onfocusout={onFocusOut}>
	<button
		type="button"
		class="popover__trigger"
		bind:this={triggerEl}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label={label}
		onclick={() => (open = !open)}
		onkeydown={onTriggerKeydown}
	>
		{@render trigger(open)}
	</button>

	{#if open}
		<div
			class="popover__panel popover__panel--{align}"
			role="menu"
			tabindex="-1"
			bind:this={panelEl}
			style="transform: translateX({shift}px)"
			onkeydown={onPanelKeydown}
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
		z-index: var(--z-modal);
		min-width: 12rem;
		display: flex;
		flex-direction: column;
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-modal);
		// Scrolls rather than running off the bottom of a short window: the account menu grew group
		// headings in WP8 (2026-10-14) and is ~600px tall for an account with every switch on, which
		// is more than a 1366×768 laptop has under the bar once the browser's own chrome is counted.
		overflow-x: hidden;
		overflow-y: auto;
		max-height: calc(100vh - 72px);
		padding: var(--space-1) 0;
		// `tabindex="-1"` (a `role="menu"` with a key handler must be focusable) is never a Tab stop;
		// a click on a group heading lands focus here, and that is not worth drawing a ring for.
		&:focus {
			outline: none;
		}
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
