<script lang="ts">
	// What one version changed against the version it was written against: the title and the
	// description word by word, the text word by word when both are written here, and a sentence for
	// a file or a link — a reviewer deciding on a proposal should not have to open two tabs and
	// compare them by eye.
	//
	// The comparison is of the STORED source (Markdown, LaTeX, HTML exactly as saved), never of the
	// rendered page: two renderings can differ where the text does not (a KaTeX upgrade) and agree
	// where it does (a whitespace change inside a formula), and the reviewer is deciding on the text.
	//
	// `utils/textDiff.ts` is imported dynamically, at the moment there are two versions to compare
	// (root CLAUDE.md house rule 11). The type import below is erased at build time, so it pulls
	// nothing into this component's chunk.
	import { m } from '$lib/paraglide/messages.js';
	import type { MaterialVersion } from '$lib/types/materialProject';
	import type { DiffPart } from '$lib/utils/textDiff';
	import { VERSION_KIND_LABELS } from './labels';

	let {
		before,
		after
	}: {
		/** The basis — the version `after` was written against, and one this reader may see. */
		before: MaterialVersion;
		after: MaterialVersion;
	} = $props();

	interface Changes {
		title: DiffPart[] | null;
		description: DiffPart[] | null;
		/** Only when both versions are written here; a file or a link gets a sentence instead. */
		body: DiffPart[] | null;
	}

	let changes = $state<Changes | null>(null);
	let failed = $state(false);

	// Keyed on the pair: the page replaces `after` with the server's answer after a publish or a
	// decision, and neither changes a word of it, so the comparison is not redone for that. A plain
	// variable rather than state, so this effect does not re-run itself by writing it (trap 4).
	let comparedFor = '';
	$effect(() => {
		const key = `${before.id}:${after.id}`;
		if (key === comparedFor) return;
		comparedFor = key;
		changes = null;
		failed = false;
		const [older, newer] = [before, after];
		import('$lib/utils/textDiff')
			.then(({ diffWords }) => {
				// A navigation to another version while the chunk was on its way: not ours to draw.
				if (comparedFor !== key) return;
				changes = {
					title: diffWords(older.title, newer.title),
					description: diffWords(older.description, newer.description),
					body:
						older.kind === 'body' && newer.kind === 'body'
							? diffWords(older.body, newer.body)
							: null
				};
			})
			.catch(() => {
				if (comparedFor === key) failed = true;
			});
	});

	const changed = (parts: DiffPart[]) => parts.some((part) => part.type !== 'same');
</script>

<!-- Every run is its own element with no template whitespace between them: the container keeps
     whitespace exactly (`pre-wrap`), so a stray space here would be a space the text never had. -->
{#snippet diffText(parts: DiffPart[] | null, source: boolean)}
	{#if parts === null}
		<p class="hint">{m.coauth_diff_tooLong()}</p>
		<!-- "Too long to compare word by word here." -->
	{:else if !changed(parts)}
		<p class="hint">{m.coauth_diff_unchanged()}</p>
		<!-- "Unchanged." -->
	{:else}
		<p class="diff" class:source>
			{#each parts as part, index (index)}{#if part.type === 'added'}<ins>{part.text}</ins
					>{:else if part.type === 'removed'}<del>{part.text}</del>{:else}<span>{part.text}</span
					>{/if}{/each}
		</p>
	{/if}
{/snippet}

<section class="changes">
	<h2>{m.coauth_diff_heading({ number: before.number })}</h2>
	<!-- "Changes against version {number}" -->
	<!-- The key to the two marks, in the marks themselves: struck through and underlined as well as
	     coloured, so neither a colour-blind reader nor a forced-colours display loses the difference. -->
	<p class="legend">
		<del>{m.coauth_diff_removed()}</del>
		<!-- "Removed" -->
		<ins>{m.coauth_diff_added()}</ins>
		<!-- "Added" -->
	</p>

	{#if failed}
		<p class="hint">{m.common_error_generic()}</p>
		<!-- "Something went wrong." -->
	{:else if !changes}
		<p class="hint">{m.common_loading()}</p>
		<!-- "Loading…" -->
	{:else}
		<dl>
			<dt>{m.coauth_diff_title()}</dt>
			<!-- "Title" -->
			<dd>{@render diffText(changes.title, false)}</dd>

			<dt>{m.coauth_diff_description()}</dt>
			<!-- "Description" -->
			<dd>{@render diffText(changes.description, false)}</dd>

			<dt>{m.coauth_diff_content()}</dt>
			<!-- "Content" -->
			<dd>
				{#if before.kind !== after.kind}
					<p>
						{m.coauth_diff_kindChanged({
							before: VERSION_KIND_LABELS[before.kind](),
							after: VERSION_KIND_LABELS[after.kind]()
						})}
						<!-- "The kind changed: {before} → {after}." -->
					</p>
				{:else if after.kind === 'file'}
					<!-- Always new: a file version carries a file of its own, never its basis's blob. -->
					<p>{m.coauth_diff_newFile()}</p>
					<!-- "A new file." -->
				{:else if after.kind === 'link'}
					{#if before.url === after.url}
						<p class="hint">{m.coauth_diff_unchanged()}</p>
						<!-- "Unchanged." -->
					{:else}
						<p class="link-change">
							{m.coauth_diff_linkChanged({ before: before.url, after: after.url })}
							<!-- "The link changed from {before} to {after}." -->
						</p>
					{/if}
				{:else}
					{@render diffText(changes.body, true)}
				{/if}
			</dd>
		</dl>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

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
		p {
			margin: 0;
			font-size: var(--font-size-sm);
		}
	}
	.legend {
		display: flex;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
	}
	dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	dt {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}
	dd {
		margin: 0 0 var(--space-2);
	}
	// Whitespace exactly as stored: a removed paragraph break has to be visible to be reviewed.
	.diff {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.6;
	}
	// The raw source of a description or a text: Markdown and LaTeX read better in a fixed width,
	// and a long one scrolls inside its own box rather than pushing the decision off the page.
	.source {
		font-family: var(--font-mono, monospace);
		font-size: var(--font-size-xs);
		max-height: 60vh;
		overflow: auto;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
	}
	.link-change {
		overflow-wrap: anywhere;
	}
	.hint {
		color: var(--text-secondary);
	}
	// Theme tokens only, so light, dark and high contrast each get their own pair. The text keeps the
	// page's own colour (the status hues are for marks, not for reading), and the mark is doubled —
	// a background AND a line — because a background alone disappears under forced colours.
	ins,
	del {
		color: var(--text-primary);
		// A hair of room so two marks that meet (a word struck out, its replacement right after) do
		// not read as one word. Padding, never margin: the text between them is contiguous.
		padding: 0 2px;
		border-radius: 2px;
		text-decoration-thickness: 2px;
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
	}
	ins {
		background: var(--status-success-bg);
		text-decoration-line: underline;
		text-decoration-color: var(--status-success);
	}
	del {
		background: var(--status-danger-bg);
		text-decoration-line: line-through;
		text-decoration-color: var(--status-danger);
	}
	// High contrast darkens the status hues (theme.scss) — right for text on white, nearly invisible
	// as a line through white-on-black. There the line follows the text itself, whichever it is.
	:global(:root[data-contrast='high']) ins,
	:global(:root[data-contrast='high']) del {
		text-decoration-color: currentColor;
	}
</style>
