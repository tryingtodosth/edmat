<script lang="ts">
	/**
	 * One revision, read — and, when there is a head to compare it against, what it changed.
	 *
	 * The comparison is per BLOCK and of the STORED source (Markdown, LaTeX exactly as saved),
	 * never of the rendered page: two renderings can differ where the text does not (a KaTeX
	 * upgrade) and agree where it does (a whitespace change inside a formula), and the reviewer is
	 * deciding on the text. Blocks are paired by position, which is the honest reading of "an
	 * ordered list": a paragraph inserted at the top shows as one addition and everything after it
	 * as unchanged only if the words really did stay the same.
	 *
	 * A block that is not text gets a marker rather than a word diff — "this picture was replaced"
	 * is the whole of what there is to say about a picture, and rendering two of them side by side
	 * would be a review UI nobody asked for.
	 *
	 * `utils/textDiff.ts` is imported dynamically, at the moment there are two revisions to compare
	 * (root CLAUDE.md house rule 11). The type import is erased at build time.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { ConceptBlock, ConceptRevision } from '$lib/types/concept';
	import type { DiffPart } from '$lib/utils/textDiff';
	import BlockRenderer from './BlockRenderer.svelte';
	import { BLOCK_KIND_LABELS } from './labels';

	let {
		revision,
		before = null
	}: {
		revision: ConceptRevision;
		/** The revision this one was written against — usually the head. Null hides the changes. */
		before?: ConceptRevision | null;
	} = $props();

	type Mark = 'added' | 'removed' | 'changed' | 'same';
	interface BlockChange {
		position: number;
		kind: ConceptBlock['kind'];
		mark: Mark;
		/** Text blocks only. `null` means "too long to compare here". */
		parts?: DiffPart[] | null;
	}

	let changes = $state<BlockChange[] | null>(null);
	let failed = $state(false);

	/** The stored text of a block, or '' for a block that has none. */
	function textOf(block: ConceptBlock): string {
		if (block.kind === 'markdown') return block.body;
		if (block.kind === 'latex') return block.source;
		return '';
	}

	/** Two non-text blocks are the same when they point at the same row and say the same words
	 *  about it. */
	function sameAsset(a: ConceptBlock, b: ConceptBlock): boolean {
		if (a.kind !== b.kind) return false;
		if (a.kind === 'chem' && b.kind === 'chem') {
			return a.drawingId === b.drawingId && a.caption === b.caption;
		}
		if (a.kind === 'pdf' && b.kind === 'pdf') {
			return a.assetId === b.assetId && a.caption === b.caption;
		}
		if (a.kind === 'image' && b.kind === 'image') {
			return a.assetId === b.assetId && a.alt === b.alt && a.caption === b.caption;
		}
		return false;
	}

	// Keyed on the pair: the page replaces `revision` with the server's answer after a decision,
	// and that changes no word of it, so the comparison is not redone for that. A plain variable
	// rather than state, so this effect does not re-run itself by writing it (trap 4).
	let comparedFor = '';
	$effect(() => {
		const older = before;
		if (!older) {
			changes = null;
			comparedFor = '';
			return;
		}
		const key = `${older.id}:${revision.id}`;
		if (key === comparedFor) return;
		comparedFor = key;
		changes = null;
		failed = false;
		import('$lib/utils/textDiff')
			.then(({ diffWords }) => {
				// A move to another revision while the chunk was on its way: not ours to draw.
				if (comparedFor !== key) return;
				const count = Math.max(older.blocks.length, revision.blocks.length);
				const out: BlockChange[] = [];
				for (let i = 0; i < count; i++) {
					const a = older.blocks[i];
					const b = revision.blocks[i];
					if (!a && b) {
						out.push({ position: i, kind: b.kind, mark: 'added' });
					} else if (a && !b) {
						out.push({ position: i, kind: a.kind, mark: 'removed' });
					} else if (a && b && a.kind !== b.kind) {
						out.push({ position: i, kind: b.kind, mark: 'changed' });
					} else if (a && b && (b.kind === 'markdown' || b.kind === 'latex')) {
						const parts = diffWords(textOf(a), textOf(b));
						const changed = parts === null || parts.some((part) => part.type !== 'same');
						out.push({ position: i, kind: b.kind, mark: changed ? 'changed' : 'same', parts });
					} else if (a && b) {
						out.push({ position: i, kind: b.kind, mark: sameAsset(a, b) ? 'same' : 'changed' });
					}
				}
				changes = out;
			})
			.catch(() => {
				if (comparedFor === key) failed = true;
			});
	});

	const realChanges = $derived((changes ?? []).filter((change) => change.mark !== 'same'));

	const MARK_LABELS: Record<Mark, () => string> = {
		added: m.concept_diff_added, // "Added"
		removed: m.concept_diff_removed, // "Removed"
		changed: m.concept_diff_changed, // "Changed"
		same: m.concept_diff_unchanged // "Unchanged"
	};
</script>

<article class="revision">
	{#if revision.summary}
		<p class="summary">{revision.summary}</p>
	{/if}
	<BlockRenderer blocks={revision.blocks} />
</article>

{#if before}
	<section class="changes">
		<h2>{m.concept_diff_heading({ number: before.number })}</h2>
		<!-- "Changes against revision {number}" -->
		<!-- The key to the two marks, in the marks themselves: struck through and underlined as well
		     as coloured, so neither a colour-blind reader nor a forced-colours display loses it. -->
		<p class="legend">
			<del>{m.concept_diff_removed()}</del>
			<ins>{m.concept_diff_added()}</ins>
		</p>

		{#if failed}
			<p class="hint">{m.common_error_generic()}</p>
			<!-- "Something went wrong." -->
		{:else if !changes}
			<p class="hint">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if realChanges.length === 0}
			<p class="hint">{m.concept_diff_nothing()}</p>
			<!-- "Nothing in the text changed." -->
		{:else}
			<ul>
				{#each realChanges as change (change.position)}
					<li>
						<p class="block-head">
							<span class="badge">{BLOCK_KIND_LABELS[change.kind]()}</span>
							<span class="position">{m.concept_blocks_position({ n: change.position + 1 })}</span>
							<!-- "Block {n}" -->
							<span class="mark mark--{change.mark}">{MARK_LABELS[change.mark]()}</span>
						</p>
						{#if change.parts === null}
							<p class="hint">{m.concept_diff_tooLong()}</p>
							<!-- "Too long to compare word by word here." -->
						{:else if change.parts}
							<!-- Every run is its own element with no template whitespace between them: the
							     container keeps whitespace exactly (`pre-wrap`), so a stray space here
							     would be a space the text never had. -->
							<p class="diff">
								{#each change.parts as part, index (index)}{#if part.type === 'added'}<ins
											>{part.text}</ins
										>{:else if part.type === 'removed'}<del>{part.text}</del>{:else}<span
											>{part.text}</span
										>{/if}{/each}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.revision {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.summary {
		margin: 0;
		color: var(--text-secondary);
	}
	.changes {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	.legend {
		margin: 0;
		display: flex;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.block-head {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-xs);
	}
	.badge,
	.mark {
		border-radius: 999px;
		padding: 1px var(--space-2);
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
	}
	.mark--added {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.mark--removed {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.position,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.hint {
		margin: 0;
	}
	.diff {
		margin: 0;
		white-space: pre-wrap;
		font-size: var(--font-size-sm);
	}
	ins {
		background: var(--status-success-bg);
		color: var(--status-success);
		text-decoration: underline;
	}
	del {
		background: var(--status-danger-bg);
		color: var(--status-danger);
		text-decoration: line-through;
	}
</style>
