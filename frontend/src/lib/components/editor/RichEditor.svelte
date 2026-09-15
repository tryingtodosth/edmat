<script lang="ts">
	/**
	 * One content input, two modes (AUDIENCE-BRIEF.md §7). Storage does not change: the field is
	 * still Markdown-with-HTML plus `\( \)` / `\[ \]` maths. The rich mode is Tiptap emitting HTML
	 * the sanitizer already allows; the source mode is the plain box everybody had before. The mode
	 * is remembered per account (or per browser for a guest). Tiptap (and the table/maths
	 * extensions below) are imported lazily, on the first rich mount — a reader never downloads
	 * them, the KaTeX/Leaflet discipline.
	 *
	 * Maths for people who will not type LaTeX: a small palette that inserts real KaTeX-rendered
	 * nodes (`mathNode.ts`) at the cursor — live inside the editor, not just in a preview below the
	 * field, and existing `\( \)`/`\[ \]` text already in the document typesets the same way the
	 * instant rich mode opens (`convertMathText`). Click a rendered equation to edit its LaTeX.
	 *
	 * Tables: Tiptap's own official `@tiptap/extension-table` family — already the raw HTML this
	 * app's storage/read pipeline (`config/sanitize.py`, `renderContent.ts`) has allowed all along
	 * (`<table>`/`<tr>`/`<td>`/…), just with no way to insert or edit one before this.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { onDestroy, untrack } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import { editorPrefsStore, type EditorMode } from '$lib/state/editorPrefs.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	// `typeof import(...)` is a type-only query — erased at build time, so this does NOT pull
	// katex/@tiptap/core into the eager bundle. The module itself is only ever reached through the
	// dynamic `import('./mathNode')` inside `mountRich()` below, same discipline as every other
	// Tiptap piece here.
	type MathNodeModule = typeof import('./mathNode');

	let {
		value = $bindable(''),
		placeholder = '',
		rows = 4,
		required = false,
		id = undefined
	}: {
		value: string;
		placeholder?: string;
		rows?: number;
		required?: boolean;
		id?: string;
	} = $props();

	let mode = $state<EditorMode>(untrack(() => editorPrefsStore.mode));
	let host = $state<HTMLDivElement | null>(null);
	let editor: Editor | null = null;
	let loading = $state(false);
	let failed = $state(false);
	let mathNodeModule: MathNodeModule | null = null;

	const PALETTE: { label: string; insert: string }[] = [
		{ label: 'a/b', insert: '\\(\\frac{a}{b}\\)' },
		{ label: 'xⁿ', insert: '\\(x^{n}\\)' },
		{ label: '√', insert: '\\(\\sqrt{x}\\)' },
		{ label: '∑', insert: '\\(\\sum_{i=1}^{n} a_i\\)' },
		{ label: '∫', insert: '\\(\\int_{a}^{b} f(x)\\,dx\\)' },
		{ label: '±', insert: '±' },
		{ label: '×', insert: '×' },
		{ label: '÷', insert: '÷' },
		{ label: '≤', insert: '≤' },
		{ label: 'α', insert: 'α' },
		{ label: 'π', insert: 'π' },
		{ label: 'θ', insert: 'θ' }
	];

	async function mountRich() {
		if (editor || !host) return;
		loading = true;
		try {
			const [
				{ Editor },
				{ default: StarterKit },
				{ default: Link },
				{ Table },
				{ default: TableRow },
				{ default: TableHeader },
				{ default: TableCell },
				mathModule
			] = await Promise.all([
				import('@tiptap/core'),
				import('@tiptap/starter-kit'),
				import('@tiptap/extension-link'),
				import('@tiptap/extension-table'),
				import('@tiptap/extension-table-row'),
				import('@tiptap/extension-table-header'),
				import('@tiptap/extension-table-cell'),
				import('./mathNode')
			]);
			mathNodeModule = mathModule;
			editor = new Editor({
				element: host,
				extensions: [
					StarterKit,
					Link.configure({ openOnClick: false }),
					Table.configure({ resizable: false }),
					TableRow,
					TableHeader,
					TableCell,
					mathModule.MathNode
				],
				content: value,
				onUpdate: ({ editor: e }) => {
					value = e.isEmpty ? '' : e.getHTML();
				},
				onTransaction: () => {
					tick = tick + 1;
				}
			});
			// Existing `\( \)`/`\[ \]` text in `value` (the common case — a document written in
			// source mode, or one this editor already saved) typesets immediately, not only maths
			// typed from this point on: input rules (inside mathNode.ts) only fire on a live
			// keystroke, never on text that arrived through `content:` above.
			mathModule.convertMathText(editor);
		} catch {
			failed = true;
			mode = 'source';
		} finally {
			loading = false;
		}
	}
	let tick = $state(0);
	$effect(() => {
		if (mode === 'rich' && host) void mountRich();
	});
	onDestroy(() => editor?.destroy());

	function switchMode(next: EditorMode) {
		if (next === mode) return;
		if (next === 'rich') {
			// Source → rich: `mountRich`'s own `content: value` (plus the `convertMathText` call
			// right after it) is what builds the document — `editor` is always null here (rich →
			// source always destroys it below), so there is nothing for this branch to set up
			// itself beyond flipping the mode the `$effect` above reacts to.
			mode = 'rich';
		} else {
			// Rich → source: the document's HTML is the source.
			if (editor) value = editor.isEmpty ? '' : editor.getHTML();
			editor?.destroy();
			editor = null;
			mode = 'source';
		}
		editorPrefsStore.set(next);
		if (authStore.isAuthenticated) void authStore.updateProfile({ editorMode: next });
	}
	function insert(text: string) {
		if (mode === 'rich' && editor) {
			// A palette entry that spells out `\( \)`/`\[ \]` becomes a live, rendered node (the
			// same shape typing it out and finishing the closing delimiter would produce) instead
			// of inert text sitting in the document until the next `convertMathText` pass; a plain
			// symbol (±, α, …) is just text either way.
			const mathAttrs = mathNodeModule?.paletteMathAttrs(text);
			if (mathAttrs) {
				editor.chain().focus().insertContent({ type: 'math', attrs: mathAttrs }).run();
			} else {
				editor.chain().focus().insertContent(text).run();
			}
		} else {
			const el = sourceEl;
			if (!el) {
				value = value + text;
				return;
			}
			const start = el.selectionStart ?? value.length;
			const end = el.selectionEnd ?? start;
			value = value.slice(0, start) + text + value.slice(end);
			queueMicrotask(() => {
				el.focus();
				el.setSelectionRange(start + text.length, start + text.length);
			});
		}
	}
	function insertTable() {
		cmd((e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run());
	}
	let sourceEl = $state<HTMLTextAreaElement | null>(null);
	const active = (name: string, attrs?: Record<string, unknown>) =>
		tick >= 0 && editor ? editor.isActive(name, attrs) : false;
	/** A toolbar press must not take focus from the document, or the command lands nowhere. */
	const keepFocus = (e: MouseEvent) => e.preventDefault();
	function cmd(run: (e: Editor) => void) {
		if (editor) run(editor);
	}
</script>

<div class="rich-editor" class:rich-editor--rich={mode === 'rich'}>
	<div class="rich-editor__bar" role="toolbar" aria-label={m.editor_toolbar()}>
		<div class="rich-editor__modes" role="group" aria-label={m.editor_mode()}>
			<button
				type="button"
				onmousedown={keepFocus}
				class:on={mode === 'rich'}
				aria-pressed={mode === 'rich'}
				onclick={() => switchMode('rich')}>{m.editor_modeRich()}</button
			>
			<button
				type="button"
				onmousedown={keepFocus}
				class:on={mode === 'source'}
				aria-pressed={mode === 'source'}
				onclick={() => switchMode('source')}>{m.editor_modeSource()}</button
			>
		</div>
		{#if mode === 'rich'}
			<div class="rich-editor__fmt" role="group" aria-label={m.editor_formatting()}>
				<button
					type="button"
					onmousedown={keepFocus}
					class:on={active('bold')}
					aria-label={m.editor_bold()}
					onclick={() => cmd((e) => e.chain().focus().toggleBold().run())}><b>B</b></button
				>
				<button
					type="button"
					onmousedown={keepFocus}
					class:on={active('italic')}
					aria-label={m.editor_italic()}
					onclick={() => cmd((e) => e.chain().focus().toggleItalic().run())}><i>I</i></button
				>
				<button
					type="button"
					onmousedown={keepFocus}
					class:on={active('heading', { level: 2 })}
					aria-label={m.editor_heading()}
					onclick={() => cmd((e) => e.chain().focus().toggleHeading({ level: 2 }).run())}>H</button
				>
				<button
					type="button"
					onmousedown={keepFocus}
					class:on={active('bulletList')}
					aria-label={m.editor_bulletList()}
					onclick={() => cmd((e) => e.chain().focus().toggleBulletList().run())}>•</button
				>
				<button
					type="button"
					onmousedown={keepFocus}
					class:on={active('orderedList')}
					aria-label={m.editor_orderedList()}
					onclick={() => cmd((e) => e.chain().focus().toggleOrderedList().run())}>1.</button
				>
				<button
					type="button"
					onmousedown={keepFocus}
					class:on={active('codeBlock')}
					aria-label={m.editor_code()}
					onclick={() => cmd((e) => e.chain().focus().toggleCodeBlock().run())}>&lt;/&gt;</button
				>
				<button
					type="button"
					onmousedown={keepFocus}
					aria-label={m.editor_link()}
					onclick={() => {
						const href = prompt(m.editor_linkPrompt());
						if (href) cmd((e) => e.chain().focus().setLink({ href }).run());
					}}>🔗</button
				>
			</div>
			<div class="rich-editor__fmt" role="group" aria-label={m.editor_table()}>
				<button
					type="button"
					onmousedown={keepFocus}
					aria-label={m.editor_tableInsert()}
					title={m.editor_tableInsert()}
					onclick={insertTable}>▦</button
				>
				{#if active('table')}
					<button
						type="button"
						onmousedown={keepFocus}
						aria-label={m.editor_tableAddRow()}
						title={m.editor_tableAddRow()}
						onclick={() => cmd((e) => e.chain().focus().addRowAfter().run())}>+↓</button
					>
					<button
						type="button"
						onmousedown={keepFocus}
						aria-label={m.editor_tableAddColumn()}
						title={m.editor_tableAddColumn()}
						onclick={() => cmd((e) => e.chain().focus().addColumnAfter().run())}>+→</button
					>
					<button
						type="button"
						onmousedown={keepFocus}
						aria-label={m.editor_tableDelete()}
						title={m.editor_tableDelete()}
						onclick={() => cmd((e) => e.chain().focus().deleteTable().run())}>🗑</button
					>
				{/if}
			</div>
		{/if}
		<div class="rich-editor__math" role="group" aria-label={m.editor_math()}>
			<span class="rich-editor__math-label">{m.editor_math()}</span>
			{#each PALETTE as p (p.label)}
				<button
					type="button"
					onmousedown={keepFocus}
					title={p.insert}
					onclick={() => insert(p.insert)}>{p.label}</button
				>
			{/each}
		</div>
	</div>
	{#if mode === 'rich'}
		<div class="rich-editor__host" bind:this={host} data-placeholder={placeholder}></div>
		{#if loading}<p class="rich-editor__status">{m.common_loading()}</p>{/if}
		{#if failed}<p class="rich-editor__status">{m.editor_failed()}</p>{/if}
		<!-- The form's own required-ness still holds: an empty document is an empty field. -->
		{#if required}<input
				type="text"
				class="rich-editor__required"
				tabindex="-1"
				aria-hidden="true"
				{value}
				required
			/>{/if}
	{:else}
		<textarea {id} {rows} {placeholder} {required} bind:value bind:this={sourceEl}></textarea>
	{/if}
</div>

<style lang="scss">
	.rich-editor {
		display: grid;
		gap: 0.3rem;
	}
	.rich-editor__bar {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: center;
		font-size: 0.85rem;
	}
	.rich-editor__modes,
	.rich-editor__fmt,
	.rich-editor__math {
		display: inline-flex;
		gap: 0.2rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.rich-editor__math-label {
		color: var(--text-secondary);
		margin-right: 0.2rem;
	}
	.rich-editor__bar button {
		min-height: 32px;
		min-width: 32px;
		padding: 0 0.5rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.rich-editor__bar button.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent, #fff);
	}
	.rich-editor__host {
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		min-height: 6rem;
		padding: 0.3rem 0.6rem;
	}
	.rich-editor__host :global(.ProseMirror) {
		outline: none;
		min-height: 5rem;
	}
	.rich-editor__host :global(.ProseMirror p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		color: var(--text-secondary);
	}
	// The live maths node (mathNode.ts) — a clickable, KaTeX-rendered span; `is-selected` is
	// ProseMirror's own atom-selection state (clicking once selects the node before the click
	// handler re-opens the prompt, so a visible ring here is what tells a keyboard/arrow-key
	// selection apart from an ordinary click).
	.rich-editor__host :global(.rich-editor-math) {
		display: inline-block;
		cursor: pointer;
		border-radius: 4px;
		padding: 0 0.15rem;
	}
	.rich-editor__host :global(.rich-editor-math:hover) {
		background: var(--bg-hover, rgba(127, 127, 127, 0.12));
	}
	.rich-editor__host :global(.rich-editor-math.is-selected) {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	// An empty/unrenderable equation (e.g. mid-edit, or a malformed paste) shows its own delimited
	// source rather than nothing — the same honesty `plainText()` (mathRender.ts) already applies
	// to a MathContent/MathTitle waiting for the typesetter.
	.rich-editor__host :global(.rich-editor-math--broken) {
		font-family: monospace;
		color: var(--text-secondary);
	}
	// Editing chrome for a table — deliberately plain: this is about making cells legible while
	// typing, not a second styling system for the rendered read view (`renderContent.ts`'s own
	// output already carries whatever the reader-facing table styling is).
	.rich-editor__host :global(.ProseMirror table) {
		border-collapse: collapse;
		table-layout: fixed;
		width: 100%;
		margin: 0.4rem 0;
	}
	.rich-editor__host :global(.ProseMirror td),
	.rich-editor__host :global(.ProseMirror th) {
		border: 1px solid var(--border);
		padding: 0.3rem 0.5rem;
		vertical-align: top;
		position: relative;
	}
	.rich-editor__host :global(.ProseMirror th) {
		background: var(--bg-surface-alt, rgba(127, 127, 127, 0.08));
		font-weight: 600;
		text-align: left;
	}
	.rich-editor__host :global(.ProseMirror .selectedCell) {
		background: var(--bg-hover, rgba(127, 127, 127, 0.15));
	}
	textarea {
		font: inherit;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-surface);
		color: var(--text-primary);
		box-sizing: border-box;
	}
	.rich-editor__required {
		position: absolute;
		opacity: 0;
		height: 1px;
		width: 1px;
		pointer-events: none;
	}
	.rich-editor__status {
		font-size: 0.85rem;
		color: var(--text-secondary);
		margin: 0;
	}
</style>
