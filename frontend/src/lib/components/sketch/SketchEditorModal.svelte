<script lang="ts">
	/**
	 * The whiteboard: Excalidraw filling the whole viewport. On save the drawing is POSTed (or PUT
	 * over the existing one) and the caller receives the row, whose `embedHtml` is the `<img>` to
	 * put into the text.
	 *
	 * **Fullscreen rather than `ModalShell`**, which is the one place this departs from
	 * `ChemEditorModal.svelte`. A structure is drawn in a box a couple of hundred pixels across; a
	 * sketch is a board you move around on, and the ask was explicitly "a button opening a
	 * fullscreen where one can draw" — a canvas inside a `max-height: calc(100vh - …)` panel gives
	 * back most of the room that makes drawing with a mouse bearable. It keeps every behaviour of
	 * the shell that matters (a backdrop, `role="dialog"` + `aria-modal`, Escape, the Tab cycle,
	 * focus restored on close) rather than reimplementing half of them: the parts copied are copied
	 * because the shell cannot be a full-bleed surface and a centred card at once, and both files
	 * say so.
	 *
	 * Escape closes the board — but only when the editor is not holding it. Excalidraw uses Escape
	 * itself to drop a selection and to leave text editing, so this listener checks that the event
	 * did not come from inside the canvas subtree before treating it as "close the dialog".
	 */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import SketchHost from './SketchHost.svelte';
	import { createSketch, updateSketch } from '$lib/services/sketches';
	import { ApiError } from '$lib/api/client';
	import { isComposingKey } from '$lib/utils/textInput';
	import type { Sketch } from '$lib/types/sketch';

	let {
		existing = null,
		onSaved,
		onClose
	}: {
		existing?: Sketch | null;
		onSaved: (sketch: Sketch) => void;
		onClose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let caption = $state(existing?.label ?? '');
	let saving = $state(false);
	let error = $state('');
	let ready = $state(false);
	let board = $state<SketchHost | null>(null);
	let panel = $state<HTMLElement | null>(null);

	const title = m.sketch_title(); // "Draw a sketch"

	onMount(() => {
		const restoreTo = document.activeElement as HTMLElement | null;
		panel?.focus();
		// The board is the whole screen; letting the page behind it scroll under the canvas is how
		// a two-finger gesture that missed ends up somewhere else entirely when the board closes.
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previousOverflow;
			restoreTo?.focus?.();
		};
	});

	function focusable(): HTMLElement[] {
		if (!panel) return [];
		return [
			...panel.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		].filter((el) => el.offsetParent !== null);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (isComposingKey(event)) return;
		if (event.key === 'Escape') {
			// Excalidraw owns Escape while the pointer is on the canvas (it clears a selection and
			// leaves text editing). Closing the whole board on it would throw the drawing away on a
			// keystroke that meant "deselect".
			const target = event.target as HTMLElement | null;
			if (target?.closest?.('.sketch-fullscreen__stage')) return;
			onClose();
			return;
		}
		if (event.key !== 'Tab') return;
		// Excalidraw's own toolbar is a long tab ring of its own; trapping inside it would make the
		// Save button unreachable by keyboard, so the cycle is anchored on the chrome only.
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('.sketch-fullscreen__stage')) return;
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

	async function save() {
		error = '';
		saving = true;
		try {
			const result = await board!.getResult();
			if (result.empty) {
				error = m.sketch_empty(); // "Draw something first."
				return;
			}
			const draft = {
				source: result.source,
				label: caption.trim(),
				image: result.image
			};
			const sketch = existing ? await updateSketch(existing.id, draft) : await createSketch(draft);
			onSaved(sketch);
		} catch (e) {
			const detail =
				e instanceof ApiError
					? Object.values((e.body as Record<string, unknown>) ?? {})
							.flat()
							.join(' ') || e.message
					: e instanceof Error
						? e.message
						: String(e);
			error = m.sketch_saveFailed({ error: detail }); // "Could not save the drawing: {error}"
		} finally {
			saving = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="sketch-fullscreen" role="presentation">
	<div
		class="sketch-fullscreen__panel"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		bind:this={panel}
	>
		<header class="sketch-fullscreen__bar">
			<h2>{title}</h2>
			<p class="sketch-fullscreen__hint">{m.sketch_hint()}</p>
			<!-- "Draw with the mouse. Scroll to zoom, hold space or the middle button to move around the board." -->
			<label class="sketch-fullscreen__caption">
				<span>{m.sketch_caption()}</span>
				<!-- "Description" -->
				<input type="text" bind:value={caption} maxlength="300" title={m.sketch_captionHint()} />
			</label>
			<button type="button" class="cancel" onclick={onClose} aria-label={m.sketch_close()}
				>{m.common_cancel()}</button
			>
			<button type="button" class="submit" disabled={!ready || saving} onclick={save}>
				{#if saving}{m.sketch_saving()}{:else}{existing
						? m.sketch_update()
						: m.sketch_insert()}{/if}
			</button>
			<!-- "Saving…" / "Update drawing" / "Insert drawing" -->
		</header>
		{#if error}<p class="sketch-fullscreen__error" role="alert">{error}</p>{/if}
		<div class="sketch-fullscreen__stage">
			<SketchHost
				bind:this={board}
				initialSource={existing?.source ?? ''}
				onReady={() => (ready = true)}
				onError={(msg) => (error = msg)}
			/>
		</div>
		<footer class="sketch-fullscreen__footer">
			<small>{m.sketch_licence_excalidraw()}</small>
			<!-- "Excalidraw, MIT licence." -->
			<small>{m.sketch_editHint()}</small>
			<!-- "Click a drawing in the editor to change it." -->
		</footer>
	</div>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.sketch-fullscreen {
		position: fixed;
		inset: 0;
		background: var(--backdrop);
		z-index: var(--z-modal-scrim);
	}
	.sketch-fullscreen__panel {
		position: absolute;
		inset: 0;
		z-index: var(--z-modal);
		background: var(--bg-surface);
		display: flex;
		flex-direction: column;
		&:focus {
			outline: none;
		}
	}
	.sketch-fullscreen__bar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--border-color);
		flex-shrink: 0;
		h2 {
			font-size: var(--font-size-lg);
			margin: 0;
		}
	}
	.sketch-fullscreen__hint {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		flex: 1 1 14rem;
	}
	.sketch-fullscreen__caption {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--font-size-sm);
		span {
			color: var(--text-secondary);
		}
		input {
			font: inherit;
			font-size: var(--font-size-sm);
			padding: 0.4rem 0.6rem;
			border: 1px solid var(--border);
			border-radius: 6px;
			background: var(--bg-surface);
			color: var(--text-primary);
			min-width: 12rem;
		}
	}
	.sketch-fullscreen__error {
		margin: 0;
		padding: var(--space-1) var(--space-4);
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	// The whole point: the canvas takes every pixel the chrome does not.
	.sketch-fullscreen__stage {
		flex: 1 1 auto;
		min-height: 0;
		position: relative;
	}
	.sketch-fullscreen__footer {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-1) var(--space-4) var(--space-2);
		border-top: 1px solid var(--border-color);
		flex-shrink: 0;
		small {
			color: var(--text-secondary);
		}
	}
	.submit {
		@include mix.button-primary;
		padding: var(--space-1) var(--space-3);
	}
	.cancel {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
	}
</style>
