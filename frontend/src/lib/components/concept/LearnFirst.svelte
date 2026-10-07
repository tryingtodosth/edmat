<script lang="ts">
	/**
	 * "Before this, know…" — the bounded prerequisite closure, drawn two ways.
	 *
	 * On an **exercise page** (`exerciseId`) it is a flat row of chips, nearest first: everything
	 * the exercise's own concepts say to know first, one hop or four, each named by the article this
	 * reader would land on. That is the whole point of walking the graph rather than showing the one
	 * hop a chip row already shows — a reader stuck on an eigenvalue problem is not helped by being
	 * told "eigenvalue"; they are helped by "linear map, and before that vector space".
	 *
	 * On a **concept page** (`slug` + `title`, `variant="path"`) the same rows are drawn as a path
	 * instead: farthest first, arrows between them, ending at the concept you are reading. A list
	 * and an order are different answers to the same data, and on a concept page the order is the
	 * one worth having — it is the sequence somebody would actually read them in.
	 *
	 * **Renders nothing when there is nothing**: no heading, no empty state, no border. Most content
	 * has no prerequisites and a line saying so on every page is worse than no line (the
	 * `LinkedConcepts` / `AppearsInSessions` precedent).
	 *
	 * With `concepts` off the exercise-page endpoint answers `[]` on purpose rather than refusing
	 * (house rule 3's one documented carve-out, `backend/concepts/views.py`), so this goes quiet and
	 * the page around it keeps working. A moderator still sees it, mirroring the backend's own
	 * `is_staff` bypass.
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import { getLearnFirst, getPrerequisites } from '$lib/services/concepts';
	import type { ConceptPrerequisite } from '$lib/types/concept';
	import { CONCEPTS_FLAG } from './labels';

	let {
		exerciseId,
		slug,
		title = '',
		variant = 'flat'
	}: {
		/** An exercise page: the union closure of everything it is about. */
		exerciseId?: string;
		/** A concept page: that concept's own closure. */
		slug?: string;
		/** The concept's resolved title — the last rung of the path. Only read when `variant="path"`. */
		title?: string;
		variant?: 'flat' | 'path';
	} = $props();

	let rows = $state<ConceptPrerequisite[]>([]);

	/** Farthest first, ending at the thing you are reading — the order somebody would read them in. */
	const path = $derived([...rows].sort((a, b) => b.distance - a.distance));

	// `$effect` with an id-changed guard rather than `onMount` (frontend/CLAUDE.md traps 2, 3 and
	// 5): a service call at component top level runs during SSR and prerendering with no token, and
	// an `$effect` keyed on the id survives a route whose parameter changes without a navigation.
	// Gated on `isLoaded` because `featureFlagsStore` fails OPEN until its first fetch resolves —
	// right for drawing a link, wrong for firing a request the API would refuse.
	let loadedFor = $state('');
	$effect(() => {
		if (!featureFlagsStore.isLoaded) return;
		const source = exerciseId ? `exercise:${exerciseId}` : `concept:${slug ?? ''}`;
		const key = `${source}|${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		void load();
	});

	async function load() {
		if (!featureFlagsStore.isEnabled(CONCEPTS_FLAG) && !authStore.isModerator) {
			rows = [];
			return;
		}
		if (exerciseId) rows = await getLearnFirst('exercise', exerciseId);
		else if (slug) rows = await getPrerequisites(slug);
		else rows = [];
	}
</script>

{#if rows.length > 0}
	{#if variant === 'path'}
		<div class="learn-path">
			<h3>{m.paths_path_heading()}</h3>
			<!-- "The order to read them in" -->
			<ol>
				{#each path as row (row.slug)}
					<li>
						<a href={resolve('/concepts/[slug]', { slug: row.slug })}>
							<MathTitle text={row.title || row.slug} />
						</a>
					</li>
				{/each}
				<li class="here" aria-current="page">
					<MathTitle text={title || slug || ''} />
				</li>
			</ol>
			<p class="hint">{m.paths_path_hint()}</p>
			<!-- "Each one builds on the one before it." -->
		</div>
	{:else}
		<section class="learn-first">
			<h2>{m.paths_learnFirst_heading()}</h2>
			<!-- "Before this, know…" -->
			<ul>
				{#each rows as row (row.slug)}
					<li class:further={row.distance > 1}>
						<a
							href={resolve('/concepts/[slug]', { slug: row.slug })}
							title={row.distance > 1 ? m.paths_learnFirst_further() : m.paths_learnFirst_direct()}
						>
							<MathTitle text={row.title || row.slug} />
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

<style lang="scss">
	.learn-first {
		margin-top: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		align-items: flex-start;

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
	}
	.learn-first li {
		display: inline-flex;
		padding: 2px var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		font-size: var(--font-size-xs);
	}
	/* A rung more than one hop away is real but quieter: it is further from what the reader is
	   looking at, and the chip should say so without needing a number. */
	.learn-first li.further {
		border-style: dashed;
	}
	a {
		color: var(--accent);
	}

	.learn-path {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);

		h3 {
			margin: var(--space-2) 0 0;
			font-size: var(--font-size-sm);
		}
		ol {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-1);
			font-size: var(--font-size-sm);
		}
		li + li::before {
			content: '→';
			margin-right: var(--space-1);
			color: var(--text-secondary);
		}
		/* "You are here": the same inset-underline idiom as the header's current section — the
		   accent as selected / current, not as a link. The prerequisites stay accent links. */
		.here {
			color: var(--text-primary);
			font-weight: 600;
			box-shadow: inset 0 -2px 0 var(--accent);
		}
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
