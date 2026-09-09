<script lang="ts">
	/**
	 * One content input, two modes (AUDIENCE-BRIEF.md §7). Storage does not change: the field is
	 * still Markdown-with-HTML plus `\( \)` / `\[ \]` maths. The rich mode is Tiptap emitting HTML
	 * the sanitizer already allows; the source mode is the plain box everybody had before. The mode
	 * is remembered per account (or per browser for a guest). Tiptap is imported lazily, on the
	 * first rich mount — a reader never downloads it, the KaTeX/Leaflet discipline.
	 *
	 * Maths for people who will not type LaTeX: a small palette that inserts KaTeX under the hood
	 * (`\(\frac{a}{b}\)` …) as text at the cursor. It renders in the preview below the field, not
	 * live inside the editor — deliberately, this is not an equation editor.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { onDestroy, untrack } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import { editorPrefsStore, type EditorMode } from '$lib/state/editorPrefs.svelte';
	import { authStore } from '$lib/state/auth.svelte';

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
			const [{ Editor }, { default: StarterKit }, { default: Link }] = await Promise.all([
				import('@tiptap/core'),
				import('@tiptap/starter-kit'),
				import('@tiptap/extension-link')
			]);
			editor = new Editor({
				element: host,
				extensions: [StarterKit, Link.configure({ openOnClick: false })],
				content: value,
				onUpdate: ({ editor: e }) => {
					value = e.isEmpty ? '' : e.getHTML();
				},
				onTransaction: () => {
					tick = tick + 1;
				}
			});
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
			// Source → rich: the HTML in the box becomes the document.
			mode = 'rich';
			queueMicrotask(() => editor?.commands.setContent(value));
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
		if (mode === 'rich' && editor) editor.chain().focus().insertContent(text).run();
		else {
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
					onclick={() => cmd((e) => e.chain().focus().toggleCodeBlock().run())}>{'</>'}</button
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
