<script lang="ts">
	/**
	 * A labelled list of things — a lesson's items, a session's links, a school's classes, a set's
	 * exercises. The fourth use is what earned it its own file (house rule 13's three strikes).
	 *
	 * Deliberately NOT a copy of any one real component: `CourseContent` and `Programme` each draw
	 * their rows with their own controls attached, and a showcase of those controls would be a
	 * showcase of buttons that do nothing. What repeats across all four lists is the shape — a kind,
	 * a title, a short fact — so that is what this draws.
	 */
	import type { ShowcaseRow } from '$lib/content/showcase';

	let { rows, title = '' }: { rows: ShowcaseRow[]; title?: string } = $props();
</script>

<div class="rows">
	{#if title}
		<p class="rows__title">{title}</p>
	{/if}
	<ul>
		{#each rows as row (row.title)}
			<li>
				<span class="rows__label">{row.label}</span>
				<span class="rows__name">{row.title}</span>
				{#if row.note}
					<span class="rows__note">{row.note}</span>
				{/if}
			</li>
		{/each}
	</ul>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.rows__title {
		margin: 0;
		font-weight: 600;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--bg-surface);
		border-top: 1px solid var(--border-color);

		&:first-child {
			border-top: 0;
		}
	}
	.rows__label {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		flex: 0 0 auto;
	}
	.rows__name {
		flex: 1 1 14rem;
	}
	.rows__note {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		flex: 0 0 auto;
	}
</style>
