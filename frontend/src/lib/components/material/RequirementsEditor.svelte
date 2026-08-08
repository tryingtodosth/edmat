<script lang="ts">
	// The governor-facing edit surface for a Material's own requirement list (backend:
	// materials/views.py's `requirements` action — global staff or a governor of the material's own
	// branch only, see that view's own doc comment for the full trust-boundary reasoning). A plain
	// add/remove list, same "controlled/dumb, parent owns the async save" shape AddCoverageForm
	// already establishes for this app's own add-flow modals — this component never calls the
	// service function itself, it only ever hands the caller a full, ordered `string[]` to submit.
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { isComposingKey } from '$lib/utils/textInput';

	let {
		initial,
		onSubmit,
		onCancel
	}: {
		initial: string[];
		onSubmit: (labels: string[]) => void;
		onCancel: () => void;
	} = $props();

	// A deliberate one-time seed, not a live mirror of `initial` — the same `untrack()`-wrapped
	// $state-initializer convention AddCoverageForm's own `topicId` already establishes for exactly
	// this "start from a prop, then let the user edit freely" shape.
	let labels = $state<string[]>(untrack(() => [...initial]));
	let draft = $state('');

	// Drag-and-drop reordering — plain native HTML5 DnD, the same "no drag library, just
	// dragstart/dragover/drop" simplicity this codebase's own sibling projects already establish for
	// an identical "reorder a small list" need (there's no existing DnD precedent in THIS app to
	// match, so this is a fresh, minimal implementation, not a port of one). `draggedIndex` is the
	// row being moved; reordering happens on `drop` by splicing it out and back in at the target
	// index — `order` (materials/views.py's own PUT body) is just this array's own index, so no
	// separate `order` field needs tracking here at all.
	let draggedIndex = $state<number | null>(null);

	function addLabel() {
		const trimmed = draft.trim();
		if (!trimmed) return;
		labels = [...labels, trimmed];
		draft = '';
	}

	function removeLabel(index: number) {
		labels = labels.filter((_, i) => i !== index);
	}

	function moveLabel(from: number, to: number) {
		if (to < 0 || to >= labels.length || from === to) return;
		const next = [...labels];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		labels = next;
	}

	function handleDragStart(index: number) {
		draggedIndex = index;
	}

	function handleDragOver(event: DragEvent) {
		// Required for `drop` to ever fire at all — a plain dragover with no handler means the
		// browser's own default (reject the drop) wins.
		event.preventDefault();
	}

	function handleDrop(index: number) {
		if (draggedIndex !== null) moveLabel(draggedIndex, index);
		draggedIndex = null;
	}

	function handleDragEnd() {
		draggedIndex = null;
	}

	function submit() {
		onSubmit(labels);
	}
</script>

<form class="requirements-editor" onsubmit={(e) => (e.preventDefault(), submit())}>
	<p class="requirements-editor__hint">{m.material_requirementsHint()}</p>

	{#if labels.length > 0}
		<ul class="requirements-editor__list">
			{#each labels as label, index (index)}
				<li
					class="requirements-editor__item"
					class:requirements-editor__item--dragging={draggedIndex === index}
					draggable="true"
					ondragstart={() => handleDragStart(index)}
					ondragover={handleDragOver}
					ondrop={() => handleDrop(index)}
					ondragend={handleDragEnd}
				>
					<span class="requirements-editor__drag-handle" aria-hidden="true">⠿</span>
					<span class="requirements-editor__label">{label}</span>
					<span class="requirements-editor__reorder-buttons">
						<button
							type="button"
							class="requirements-editor__move"
							aria-label={m.material_requirementsMoveUp({ label })}
							disabled={index === 0}
							onclick={() => moveLabel(index, index - 1)}
						>
							&uarr;
						</button>
						<button
							type="button"
							class="requirements-editor__move"
							aria-label={m.material_requirementsMoveDown({ label })}
							disabled={index === labels.length - 1}
							onclick={() => moveLabel(index, index + 1)}
						>
							&darr;
						</button>
					</span>
					<button
						type="button"
						class="requirements-editor__remove"
						aria-label={m.material_requirementsRemove({ label })}
						onclick={() => removeLabel(index)}
					>
						&times;
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="requirements-editor__add-row">
		<input
			type="text"
			placeholder={m.material_requirementsAddPlaceholder()}
			bind:value={draft}
			onkeydown={(e) => {
				// Enter accepts an IME candidate while a composition is open, so it must not add a
				// label here — and this input sits inside a form, so acting on it would also carry
				// the preventDefault that keeps Enter from saving the whole list early.
				if (isComposingKey(e)) return;
				if (e.key === 'Enter') {
					e.preventDefault();
					addLabel();
				}
			}}
		/>
		<button type="button" class="add-btn" onclick={addLabel} disabled={!draft.trim()}>
			{m.material_requirementsAdd()}
		</button>
	</div>

	<div class="requirements-editor__actions">
		<button type="button" class="cancel" onclick={onCancel}>{m.common_cancel()}</button>
		<button type="submit" class="submit">{m.common_save()}</button>
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.requirements-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.requirements-editor__hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.requirements-editor__list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.requirements-editor__item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		cursor: grab;
		&:active {
			cursor: grabbing;
		}
	}
	.requirements-editor__item--dragging {
		opacity: 0.5;
		border-style: dashed;
	}
	.requirements-editor__drag-handle {
		color: var(--text-secondary);
		flex-shrink: 0;
	}
	.requirements-editor__label {
		flex: 1;
		min-width: 0;
	}
	.requirements-editor__reorder-buttons {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}
	.requirements-editor__move {
		@include mix.focus-ring;
		background: none;
		border: none;
		font-size: var(--font-size-sm);
		line-height: 1;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 0 2px;
		&:hover:not(:disabled) {
			color: var(--accent);
		}
		&:disabled {
			opacity: 0.3;
			cursor: not-allowed;
		}
	}
	.requirements-editor__remove {
		@include mix.focus-ring;
		background: none;
		border: none;
		font-size: var(--font-size-base);
		line-height: 1;
		color: var(--text-secondary);
		cursor: pointer;
		flex-shrink: 0;
		&:hover {
			color: var(--status-danger);
		}
	}
	.requirements-editor__add-row {
		display: flex;
		gap: var(--space-2);
	}
	.requirements-editor__add-row input {
		@include mix.focus-ring;
		flex: 1;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
	}
	.add-btn {
		@include mix.button-secondary;
		&:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
	}
	.requirements-editor__actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.submit {
		@include mix.button-primary;
	}
	.cancel {
		@include mix.button-secondary;
	}
</style>
