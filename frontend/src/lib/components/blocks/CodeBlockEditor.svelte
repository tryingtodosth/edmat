<script lang="ts">
	/**
	 * A code block: a language label and a plain monospace textarea. Nothing here highlights, runs
	 * or interprets the code — `config/blocks.py` stores it raw and `BlockContent` draws it as a
	 * text node, which is what makes a `<script>` in a listing a listing and not a script.
	 *
	 * Tab inserts a tab rather than leaving the field: code is the one place a reader writing in
	 * this app expects that. Escape then Tab still leaves (the textarea gives up the key after
	 * Escape), so a keyboard user is never trapped.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { CodeBlock } from '$lib/types/blocks';

	let { block }: { block: CodeBlock } = $props();

	let escaped = false;

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			escaped = true;
			return;
		}
		if (event.key === 'Tab' && !event.shiftKey && !escaped) {
			event.preventDefault();
			const area = event.currentTarget as HTMLTextAreaElement;
			const { selectionStart: start, selectionEnd: end } = area;
			block.source = block.source.slice(0, start) + '\t' + block.source.slice(end);
			requestAnimationFrame(() => area.setSelectionRange(start + 1, start + 1));
		}
		escaped = false;
	}
</script>

<div class="code-block">
	<label class="language">
		<span>{m.notebook_codeLanguage()}</span>
		<!-- "Language" -->
		<input
			type="text"
			maxlength="20"
			placeholder="python"
			autocomplete="off"
			spellcheck="false"
			bind:value={() => block.language, (v) => (block.language = v.toLowerCase())}
		/>
	</label>
	<textarea
		rows="6"
		spellcheck="false"
		aria-label={m.notebook_codeSource()}
		placeholder={m.notebook_codePlaceholder()}
		bind:value={() => block.source, (v) => (block.source = v)}
		onkeydown={keydown}></textarea>
	<!-- "Code" / "Paste or type the code. It is shown exactly as written and never run." -->
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.code-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.language {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);

		input {
			@include mix.focus-ring;
			width: 10rem;
			font: inherit;
			font-family: var(--font-mono);
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	textarea {
		@include mix.focus-ring;
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		tab-size: 4;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		color: var(--text-primary);
		resize: vertical;
		white-space: pre;
		overflow-x: auto;
	}
</style>
