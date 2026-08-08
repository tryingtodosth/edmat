<script lang="ts">
	// This app's first modal — a real, centered dialog+backdrop, not the anchored-popover pattern
	// RandomExerciseButton.svelte already uses for its own filter menu (that one never needs to
	// dim the rest of the page, this one always does). The --shadow-modal/--backdrop/--z-modal*
	// tokens it uses were already defined in _tokens.scss/_theme.scss (carried over from the
	// personalizacja_edukacji theming port, CLAUDE.md Section 13) but genuinely unused until now —
	// nothing in this app needed a real modal before the materials-coverage feature.
	import { m } from '$lib/paraglide/messages.js';
	import { isComposingKey } from '$lib/utils/textInput';

	let {
		title,
		onClose,
		children
	}: {
		title: string;
		onClose: () => void;
		children: import('svelte').Snippet;
	} = $props();

	function handleBackdropClick(event: MouseEvent) {
		// Only a direct click on the backdrop itself closes it — a click anywhere inside the panel
		// (including on something that happens to bubble up) must not.
		if (event.target === event.currentTarget) onClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		// Escape dismisses an input method's candidate list before it means anything to this dialog.
		// Every modal built on this shell holds a text field of some kind, so without this guard an
		// IME user rejecting a suggestion would close the dialog and lose whatever they had typed —
		// which is the same class of bug as Enter submitting mid-composition, on the other key.
		if (isComposingKey(event)) return;
		if (event.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={handleBackdropClick} role="presentation">
	<div class="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
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
