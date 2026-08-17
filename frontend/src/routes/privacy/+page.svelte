<script lang="ts">
	// The privacy policy. Its text lives in `lib/content/privacy.ts` rather than the message
	// catalogue — see that file's own header for why legal text is the one deliberate exception to
	// this project's "every string is a message key" rule.
	//
	// This page replaces the cookie-consent banner as the site's transparency mechanism. That banner
	// was removed because it gated nothing: EdMat sets no analytics or tracking cookie, so its
	// "Analytics & non-essential" category was empty by the component's own admission, and the only
	// real cookies (the login token and the locale preference) are strictly necessary and exempt from
	// consent. Disclosure is still owed — it just belongs somewhere readable and permanent rather
	// than in a dialog people dismiss to get it out of the way.
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { privacyPolicyFor } from '$lib/content/privacy';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	const policy = $derived(privacyPolicyFor(getLocale()));
</script>

<PageHead title={m.privacy_metaTitle()} description={m.seo_privacy_description()} />

<article class="policy">
	<header class="policy__header">
		<h1>{policy.title}</h1>
		<p class="policy__updated">{policy.updated}</p>
	</header>

	{#each policy.intro as paragraph (paragraph)}
		<p class="policy__lead">{paragraph}</p>
	{/each}

	{#each policy.sections as section (section.heading)}
		<section class="policy__section">
			<h2>{section.heading}</h2>

			{#each section.body ?? [] as paragraph (paragraph)}
				<p>{paragraph}</p>
			{/each}

			{#if section.bullets}
				<ul>
					{#each section.bullets as bullet (bullet)}
						<li>{bullet}</li>
					{/each}
				</ul>
			{/if}

			{#if section.table}
				<div class="policy__table-wrap">
					<table>
						<thead>
							<tr>
								<th scope="col">{section.table.columns[0]}</th>
								<th scope="col">{section.table.columns[1]}</th>
							</tr>
						</thead>
						<tbody>
							{#each section.table.rows as row (row[0])}
								<tr>
									<th scope="row">{row[0]}</th>
									<td>{row[1]}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/each}
</article>

<style lang="scss">
	.policy {
		max-width: 46rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) var(--space-6);
	}
	.policy__header {
		margin-bottom: var(--space-5);
	}
	.policy__updated {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.policy__lead {
		font-size: var(--font-size-lg);
		line-height: 1.6;
		margin-bottom: var(--space-3);
	}
	.policy__section {
		margin-top: var(--space-5);

		h2 {
			margin-bottom: var(--space-2);
		}
		p {
			line-height: 1.65;
			margin-bottom: var(--space-2);
		}
		ul {
			margin: 0 0 var(--space-2) var(--space-4);
			line-height: 1.65;
		}
		li {
			margin-bottom: var(--space-1);
		}
	}
	/* A narrow phone can't fit a two-column table of prose; scrolling it beats reflowing each cell
	   into an unreadable column one word wide. */
	.policy__table-wrap {
		overflow-x: auto;
		margin-bottom: var(--space-2);
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
</style>
