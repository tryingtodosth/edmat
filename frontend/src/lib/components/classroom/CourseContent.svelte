<script lang="ts">
	// A course's materials and exercises, grouped into chapters, with the lock state shown honestly.
	//
	// The rule this component exists to make visible: a locked chapter still RENDERS — its title, its
	// description and its unlock date — while its contents do not. Hiding the chapter entirely would
	// make a course look shorter than it is, and "week 3 exists and opens on the 14th" is exactly the
	// thing a participant wants to know. Staff see the contents early, and are told the chapter is
	// still shut, because they are the people who have to prepare it.
	//
	// Everything here is presentation over what the course payload already carried: the server
	// decided what this viewer may see (`CourseItem.is_visible_to`), so nothing is filtered again
	// here. A client that re-derived that would be a client that could get it wrong.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import type { Chapter, CourseItem, TaughtCourse } from '$lib/types/classroom';

	let {
		course,
		onmove,
		onremove,
		ondeletechapter
	}: {
		course: TaughtCourse;
		onmove?: (itemId: string, chapterId: string | null) => void;
		onremove?: (itemId: string) => void;
		ondeletechapter?: (chapterId: string) => void;
	} = $props();

	let chapters = $derived(course.chapters);
	let unfiled = $derived(course.unfiledItems);
	let hasAnything = $derived(chapters.length > 0 || unfiled.length > 0);

	function itemHref(item: CourseItem): string {
		return item.kind === 'material'
			? resolve('/materials/[id]', { id: item.material ?? '' })
			: resolve('/exercises/[id]', { id: item.exercise ?? '' });
	}

	/** A date somebody can read, in their own locale rather than an ISO string. */
	function when(value: string | null): string {
		if (!value) return '';
		return new Date(value).toLocaleString();
	}

	function lockLabel(chapter: Chapter): string {
		return course.canCurate
			? m.classroom_chapter_lockedStaff({ when: when(chapter.unlocksAt) })
			: m.classroom_chapter_locked({ when: when(chapter.unlocksAt) });
	}
</script>

<section class="content">
	<h2>{m.classroom_items_heading()}</h2>

	{#if !hasAnything}
		<p class="empty">{m.classroom_items_empty()}</p>
	{/if}

	{#each chapters as chapter (chapter.id)}
		<article class="chapter" class:chapter--locked={!chapter.isUnlocked}>
			<header>
				<h3>{chapter.title}</h3>
				{#if !chapter.isUnlocked}
					<span class="lock" title={when(chapter.unlocksAt)}>🔒 {lockLabel(chapter)}</span>
				{/if}
			</header>
			{#if chapter.description}
				<p class="description">{chapter.description}</p>
			{/if}

			{#if chapter.items.length > 0}
				<ul class="items">
					{#each chapter.items as item (item.id)}
						{@render itemRow(item)}
					{/each}
				</ul>
			{:else if !chapter.isUnlocked}
				<!-- The honest empty state for a participant: not "nothing here", which would be a
				     different and wrong statement about a chapter that is merely shut. -->
				<p class="empty">{m.classroom_chapter_lockedEmpty()}</p>
			{:else}
				<p class="empty">{m.classroom_items_empty()}</p>
			{/if}

			{#if course.canCurate && ondeletechapter}
				<div class="chapter-actions">
					<button type="button" class="link danger" onclick={() => ondeletechapter?.(chapter.id)}>
						{m.classroom_chapters_delete()}
					</button>
					<span class="hint">{m.classroom_chapters_deleteHint()}</span>
				</div>
			{/if}
		</article>
	{/each}

	{#if unfiled.length > 0}
		<article class="chapter">
			<header>
				<!-- Its own group rather than a nameless chapter: "not filed yet" is a real state, and a
				     course that uses no chapters at all quite legitimately keeps everything here. -->
				<h3>{chapters.length > 0 ? m.classroom_items_unfiled() : m.classroom_items_heading()}</h3>
			</header>
			<ul class="items">
				{#each unfiled as item (item.id)}
					{@render itemRow(item)}
				{/each}
			</ul>
		</article>
	{/if}
</section>

{#snippet itemRow(item: CourseItem)}
	<li class="item" class:item--pending={item.status !== 'approved'}>
		<span class="kind">
			{item.kind === 'material' ? m.classroom_items_material() : m.classroom_items_exercise()}
		</span>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the href is built by a helper that calls resolve() itself; the rule only sees the attribute -->
		<a class="label" href={itemHref(item)}>{item.label}</a>

		{#if item.status === 'pending'}
			<span class="pill pill--pending">{m.classroom_item_pending()}</span>
		{:else if item.status === 'rejected'}
			<span class="pill pill--rejected">{m.classroom_item_rejected()}</span>
		{/if}

		{#if item.note}
			<span class="note">{item.note}</span>
		{/if}

		{#if course.canCurate && onmove}
			<!-- Filing is a plain select rather than drag-and-drop: this list is read far more often
			     than it is rearranged, and a select works on a phone and from a keyboard. -->
			<label class="move">
				<span class="visually-hidden">{m.classroom_items_moveTo()}</span>
				<select
					value={item.chapter ?? ''}
					onchange={(event) =>
						onmove?.(item.id, (event.currentTarget as HTMLSelectElement).value || null)}
				>
					<option value="">{m.classroom_items_moveNone()}</option>
					{#each chapters as chapter (chapter.id)}
						<option value={chapter.id}>{chapter.title}</option>
					{/each}
				</select>
			</label>
		{/if}

		{#if onremove && (course.canCurate || item.status === 'pending')}
			<button type="button" class="link danger" onclick={() => onremove?.(item.id)}>
				{course.canCurate ? m.classroom_items_remove() : m.classroom_item_withdraw()}
			</button>
		{/if}
	</li>
{/snippet}

<style lang="scss">
	.content {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.chapter {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.chapter--locked {
		// Dimmed rather than hidden — the chapter is still information.
		background: var(--bg-surface-alt);
	}
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	h3 {
		font-size: var(--font-size-md);
	}
	.lock {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.description,
	.empty,
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--border-color);
		&:last-child {
			border-bottom: none;
		}
	}
	.item--pending {
		opacity: 0.75;
	}
	.kind {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		min-width: 5rem;
	}
	.label {
		font-weight: 500;
	}
	.note {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-style: italic;
	}
	.pill {
		font-size: var(--font-size-xs);
		padding: 1px var(--space-2);
		border-radius: var(--radius-sm);
	}
	.pill--pending {
		color: var(--status-info);
		background: var(--status-info-bg);
	}
	.pill--rejected {
		color: var(--text-secondary);
		background: var(--bg-surface-alt);
	}
	.chapter-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.move select {
		font-size: var(--font-size-xs);
		padding: 2px var(--space-1);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: var(--font-size-xs);
		cursor: pointer;
		text-decoration: underline;
		color: var(--text-secondary);
	}
	.danger:hover {
		color: var(--status-danger, #c0392b);
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
