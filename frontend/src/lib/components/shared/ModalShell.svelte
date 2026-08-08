<script lang="ts">
	// This app's first modal — a real, centered dialog+backdrop, not the anchored-popover pattern
	// RandomExerciseButton.svelte already uses for its own filter menu (that one never needs to
	// dim the rest of the page, this one always does). The --shadow-modal/--backdrop/--z-modal*
	// tokens it uses were already defined in _tokens.scss/_theme.scss (carried over from the
	// personalizacja_edukacji theming port, CLAUDE.md Section 13) but genuinely unused until now —
	// nothing in this app needed a real modal before the materials-coverage feature.
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';

	let {
		title,
		onClose,
		children
	}: {
		title: string;
		onClose: () => void;
		children: import('svelte').Snippet;
	} = $props();

	let panel: HTMLElement | undefined = $state();

	/** Focus management, added when the profile editor made this shell the *only* way to reach a form.
	 *
	 * It was safe to leave out while every modal here was a short read-mostly panel opened from a
	 * button that stayed on screen behind it. It stops being safe once the content is a form somebody
	 * has to fill in: with focus left on the trigger, Tab walks the page BEHIND the dialog, so a
	 * keyboard user's first keystroke lands somewhere they cannot see — and `aria-modal="true"` has
	 * been telling a screen reader that could not happen since the day this component was written.
	 */
	onMount(() => {
		const restoreTo = document.activeElement as HTMLElement | null;
		// The panel itself rather than the first field. Autofocusing a field skips the title, which is
		// the one thing that says what just opened, and on a phone it summons the keyboard over most of
		// the dialog before the reader has seen any of it.
		panel?.focus();
		return () => restoreTo?.focus?.();
	});

	function focusable(): HTMLElement[] {
		if (!panel) return [];
		return [
			...panel.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		].filter((el) => el.offsetParent !== null);
	}

	function handleBackdropClick(event: MouseEvent) {
		// Only a direct click on the backdrop itself closes it — a click anywhere inside the panel
		// (including on something that happens to bubble up) must not.
		if (event.target === event.currentTarget) onClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			onClose();
			return;
		}
		if (event.key !== 'Tab') return;

		// A cycle rather than `inert` on everything else: `inert` is the tidier idea and would also
		// take the background out of the accessibility tree, but from in here "the rest of the
		// document" means iterating the body's children and skipping our own — a DOM-wide side effect
		// to undo on every exit path including teardown. This needs no cleanup.
		const items = focusable();
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (event.shiftKey && (active === first || active === panel)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={handleBackdropClick} role="presentation">
	<!-- `tabindex="-1"` so the panel can hold focus on open without joining the tab order itself. -->
	<div
		class="modal-panel"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		bind:this={panel}
	>
		<header class="modal-panel__header">
			<h2>{title}</h2>
			<button type="button" class="close" onclick={onClose} aria-label={m.common_close()}>
				&times;
			</button>
		</header>
		<div class="modal-panel__body">
			{@render children()}
		</div>
	</div>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		z-index: var(--z-modal-scrim);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}
	.modal-panel {
		@include mix.card-surface;
		z-index: var(--z-modal);
		box-shadow: var(--shadow-modal);
		width: min(560px, 100%);
		max-height: calc(100vh - var(--space-6) * 2);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		// The panel takes focus on open, so it would otherwise draw a focus ring around the whole
		// dialog — which says nothing useful and looks like an error.
		&:focus {
			outline: none;
		}
	}
	.modal-panel__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border-color);
		flex-shrink: 0;
		h2 {
			font-size: var(--font-size-lg);
		}
	}
	.close {
		@include mix.focus-ring;
		background: none;
		border: none;
		font-size: 22px;
		line-height: 1;
		color: var(--text-secondary);
		padding: 0 var(--space-1);
		cursor: pointer;
		&:hover {
			color: var(--text-primary);
		}
	}
	.modal-panel__body {
		padding: var(--space-4);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
