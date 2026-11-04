<script lang="ts">
	/**
	 * A concept article's blocks. Since 2026-11-04 the drawing itself is the shared
	 * `blocks/BlockContent.svelte` — the same renderer comments, solutions and posts use — and this
	 * wrapper only names the scope a comment on one of the article's blocks points at
	 * (`conceptArticle-<id>`). Without an `annotate` it draws exactly what it always drew.
	 */
	import BlockContent from '$lib/components/blocks/BlockContent.svelte';
	import type { Annotate } from '$lib/components/blocks/anchoring';
	import type { ConceptBlock } from '$lib/types/concept';

	let {
		blocks,
		articleId = '',
		annotate = undefined
	}: { blocks: ConceptBlock[]; articleId?: string; annotate?: Annotate } = $props();
</script>

<BlockContent {blocks} scope={`conceptArticle-${articleId}`} {annotate} />
