<script lang="ts">
	/**
	 * A concept article's blocks. Since 2026-11-04 the editor itself is the shared
	 * `blocks/NotebookEditor.svelte` (comments, solutions and posts have one too); this wrapper
	 * keeps the concept call sites and names the concept profile — its PDF and asset-picture kinds
	 * and its 200-block cap (`concepts/blocks.py: MAX_BLOCKS`).
	 */
	import NotebookEditor from '$lib/components/blocks/NotebookEditor.svelte';
	import type { ConceptBlock } from '$lib/types/concept';

	let { blocks = $bindable([]) }: { blocks: ConceptBlock[] } = $props();
</script>

<NotebookEditor bind:blocks profile="concept" maxBlocks={200} />
