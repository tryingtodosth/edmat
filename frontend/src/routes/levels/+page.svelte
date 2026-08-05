<script lang="ts">
	// Levels and limits. Its text lives in `lib/content/levels.ts` rather than the message catalogue,
	// for the reason that file's own header sets out — it is a document, and a document split across
	// fifty keys cannot be read or reviewed end to end in either language.
	//
	// Structurally the same page as `/privacy`, deliberately: same content-module shape, same table
	// markup, same narrow measure. The one addition is the planned/live distinction, which matters
	// enough to be a visible badge on every heading rather than a sentence somebody might skim past —
	// almost everything here describes a design, and exactly one section describes what actually runs.
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { levelsDocFor } from '$lib/content/levels';

	const doc = $derived(levelsDocFor(getLocale()));
</script>

<svelte:head>
	<title>{doc.title} — {m.common_appName()}</title>
</svelte:head>

<article class="levels">
	<header class="levels__header">
		<h1>{doc.title}</h1>
		{#each doc.lead as paragraph (paragraph)}
			<p class="levels__lead">{paragraph}</p>
		{/each}
	</header>

	<!-- Not a `role="alert"`: nothing has just happened and nothing is being interrupted. It is the
	     first thing on the page because reading nine tables of rules that turn out not to apply to you
	     is worse than being told so up front. -->
	<p class="levels__notice">{doc.notice}</p>

	{#each doc.sections as section (section.heading)}
		<section class="levels__section">
			<div class="levels__heading">
				<h2>{section.heading}</h2>
				<span class="badge" class:badge--live={section.live}>
					{section.live ? doc.liveBadge : doc.plannedBadge}
				</span>
			</div>

			{#each section.body ?? [] as paragraph (paragraph)}
				<p>{paragraph}</p>
			{/each}

			<!-- Bullets before the table, not after: where a section has both, the list is the prose that
			     introduces the table rather than a footnote to it. -->
			{#if section.bullets}
				<ul>
					{#each section.bullets as bullet (bullet)}
						<li>{bullet}</li>
					{/each}
				</ul>
			{/if}

			{#if section.table}
				<!-- A table of prose cannot reflow onto a phone without each column collapsing to about
				     one word wide, so it scrolls instead. Same call `/privacy` makes. -->
				<div class="levels__table-wrap">
					<table>
						<thead>
							<tr>
								{#each section.table.columns as column (column)}
									<th scope="col">{column}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each section.table.rows as row (row[0])}
								<tr>
									{#each row as cell, i (i)}
										{#if i === 0}
											<th scope="row">{cell}</th>
										{:else}
											<td>{cell}</td>
										{/if}
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#each section.after ?? [] as paragraph (paragraph)}
				<p>{paragraph}</p>
			{/each}
		</section>
	{/each}

	<p class="levels__source">{doc.sourceNote}</p>
</article>

<style lang="scss">
	.levels {
		max-width: 52rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) var(--space-6);
	}
	.levels__header {
		margin-bottom: var(--space-4);
	}
	.levels__lead {
		font-size: var(--font-size-lg);
		line-height: 1.6;
		margin-top: var(--space-3);
	}
	.levels__notice {
		border: 1px solid var(--status-warning, #b7791f);
		border-left-width: 4px;
		border-radius: var(--radius-sm);
		padding: var(--space-3);
		line-height: 1.6;
		color: var(--text-primary);
		background: var(--bg-surface, transparent);
	}
	.levels__section {
		margin-top: var(--space-5);

		p {
			line-height: 1.65;
			margin-bottom: var(--space-2);
		}
		ul {
			margin: 0 0 var(--space-2) var(--space-4);
			line-height: 1.65;
		}
		li {
			margin-bottom: var(--space-2);
		}
	}
	.levels__heading {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	.badge {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.15rem var(--space-2);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.badge--live {
		border-color: var(--accent);
		color: var(--accent);
	}
	.levels__table-wrap {
		overflow-x: auto;
		margin-bottom: var(--space-3);
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: var(--font-size-sm);
	}
	th,
	td {
		text-align: left;
		vertical-align: top;
		padding: var(--space-2);
		border-bottom: 1px solid var(--border-color);
	}
	thead th {
		border-bottom: 2px solid var(--border-color);
	}
	tbody th {
		font-weight: 600;
		white-space: nowrap;
	}
	.levels__source {
		margin-top: var(--space-5);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-color);
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
</style>
