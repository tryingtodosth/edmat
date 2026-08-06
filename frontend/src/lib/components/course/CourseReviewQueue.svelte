<script lang="ts">
	// What participants have offered and nobody has decided on yet.
	//
	// Declining carries an optional reason, which is why the field is here rather than a bare button:
	// a refusal without one is the complaint every review queue in this project already tries to
	// avoid, and the person who spent time offering something deserves a sentence back.
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import type { CourseItem } from '$lib/types/course';

	let {
		pending,
		busy = false,
		ondecide
	}: {
		pending: CourseItem[];
		busy?: boolean;
		ondecide?: (itemId: string, decision: 'approve' | 'reject', note: string) => void;
	} = $props();

	// One note per row, keyed by id. A plain read (`??`, never `??=`) so this can be called during
	// render without mutating state as a side effect of a template read — the Svelte 5 rule that
	// makes lazy-init in a `{@const}` a real runtime error.
	let notes = $state<Record<string, string>>({});
	const noteFor = (id: string) => notes[id] ?? '';
	const setNote = (id: string, value: string) => (notes = { ...notes, [id]: value });

	function href(item: CourseItem): string {
		return item.kind === 'material'
			? resolve('/materials/[id]', { id: item.material ?? '' })
			: resolve('/exercises/[id]', { id: item.exercise ?? '' });
	}
</script>

<section class="queue">
	<h2>{m.course_review_heading()} <span class="count">{pending.length}</span></h2>

	{#if pending.length === 0}
		<p class="hint">{m.course_review_empty()}</p>
	{:else}
		<ul>
			{#each pending as item (item.id)}
				<li>
					<div class="row">
						<span class="kind">
							{item.kind === 'material' ? m.course_items_material() : m.course_items_exercise()}
						</span>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the href is built by a helper that calls resolve() itself; the rule only sees the attribute -->
						<a href={href(item)}>{item.label}</a>
						{#if item.submittedBy}
							<span class="by">
								{m.course_review_by({ name: item.submittedBy.displayName })}
							</span>
						{/if}
					</div>

					{#if item.note}
						<p class="note">{item.note}</p>
					{/if}

					<div class="row">
						<input
							type="text"
							placeholder={m.course_review_note()}
							value={noteFor(item.id)}
							oninput={(event) => setNote(item.id, (event.currentTarget as HTMLInputElement).value)}
						/>
						<button
							type="button"
							class="primary"
							disabled={busy}
							onclick={() => ondecide?.(item.id, 'approve', noteFor(item.id))}
						>
							{m.course_review_approve()}
						</button>
						<button
							type="button"
							disabled={busy}
							onclick={() => ondecide?.(item.id, 'reject', noteFor(item.id))}
						>
							{m.course_review_reject()}
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.queue {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.count {
		font-size: var(--font-size-sm);
		color: var(--bg-surface);
		background: var(--accent);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-2);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	li {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.kind {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.by,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.note {
		font-size: var(--font-size-sm);
		font-style: italic;
		color: var(--text-secondary);
	}
	input {
		@include mix.focus-ring;
		flex: 1;
		min-width: 10rem;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	button {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
	}
	.primary {
		border: none;
		background: var(--accent);
		color: var(--bg-surface);
	}
</style>
