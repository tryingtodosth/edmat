<!-- Pick ONE existing tag by typing part of it (WP15, "ask a question in a tag").

     Existing tags only, by the owner-question default of 2026-10-15: a tag is global, free-form and
     already the one ungated label on the site (`exercises/models.py: Tag`), so a question box that
     could mint new ones would be a second, busier way to put a slur on every chip. New tags still
     arrive the way they always have — with an exercise or a concept article somebody submits — and
     the "no match" line says so instead of leaving the reader at a dead end.

     Most of the corpus's tags are ASCII slugs ("calka-gaussa"), some are not ("całka z 1-formy",
     "forma dokładna"), and people type Polish either way — so BOTH sides are folded before
     matching: lower case, diacritics off, spaces to hyphens. Prefix matches first, then
     anywhere-in-the-word, at most eight shown. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getAllTags } from '$lib/services/exercises';

	let {
		value = $bindable(''),
		id = 'tag-picker'
	}: {
		/** The chosen tag's slug, or '' while nothing is chosen. */
		value: string;
		id?: string;
	} = $props();

	let tags = $state<string[]>([]);
	let loadFailed = $state(false);
	let query = $state('');

	onMount(async () => {
		try {
			tags = await getAllTags();
		} catch {
			loadFailed = true;
		}
	});

	/** "Całka  Gaussa" → "calka-gaussa": the shape every tag slug in the corpus has. */
	function fold(text: string): string {
		return text
			.toLowerCase()
			.replace(/ł/g, 'l')
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/^#/, '')
			.trim()
			.replace(/[\s_]+/g, '-');
	}

	// Folded once per load, not once per keystroke per tag (about a thousand of them).
	let folded = $derived(tags.map((tag) => [tag, fold(tag)] as const));

	let matches = $derived.by((): string[] => {
		const wanted = fold(query);
		if (!wanted) return [];
		const starts: string[] = [];
		const contains: string[] = [];
		for (const [tag, key] of folded) {
			if (key.startsWith(wanted)) starts.push(tag);
			else if (key.includes(wanted)) contains.push(tag);
			if (starts.length >= 8) break;
		}
		return [...starts, ...contains].slice(0, 8);
	});

	function choose(tag: string) {
		value = tag;
		query = '';
	}
</script>

<div class="tag-picker">
	{#if value}
		<p class="tag-picker__chosen">
			<span class="tag-picker__label">{m.ask_tagLabel()}</span>
			<!-- "Tag" -->
			<span class="tag-picker__chip">#{value}</span>
			<button type="button" class="tag-picker__change" onclick={() => (value = '')}
				>{m.ask_tagChange()}</button
			>
			<!-- "Change" -->
		</p>
	{:else}
		<label class="tag-picker__label" for={id}>{m.ask_tagLabel()}</label>
		<!-- "Tag" -->
		<input
			{id}
			type="search"
			autocomplete="off"
			bind:value={query}
			placeholder={m.ask_tagPlaceholder()}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					if (matches.length > 0) choose(matches[0]);
				}
			}}
		/>
		<!-- "Start typing, e.g. integral" -->
		{#if loadFailed}
			<p class="tag-picker__note">{m.common_error_generic()}</p>
		{:else if matches.length > 0}
			<ul class="tag-picker__matches" aria-label={m.ask_tagMatches()}>
				<!-- "Matching tags" -->
				{#each matches as tag (tag)}
					<li>
						<button type="button" class="tag-picker__match" onclick={() => choose(tag)}
							>#{tag}</button
						>
					</li>
				{/each}
			</ul>
		{:else if query.trim() && tags.length > 0}
			<p class="tag-picker__note">{m.ask_tagNoMatch()}</p>
			<!-- "No tag like that yet. Pick the closest one that exists — new tags arrive with submitted exercises, which moderators check." -->
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.tag-picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		input {
			font: inherit;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
			width: 100%;
			max-width: 24rem;
		}
	}
	.tag-picker__label {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}
	.tag-picker__chosen {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.tag-picker__chip {
		@include mix.selected-soft;
		border-radius: var(--radius-sm);
		padding: 2px var(--space-2);
		font-size: var(--font-size-sm);
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.tag-picker__change {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		font: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
	}
	.tag-picker__matches {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.tag-picker__match {
		@include mix.focus-ring;
		@include mix.neutral-pill;
		border: 1px solid transparent;
		cursor: pointer;
		font: inherit;
		font-size: var(--font-size-xs);
		padding: 2px var(--space-2);
		max-width: 100%;
		overflow-wrap: anywhere;
		&:hover,
		&:focus-visible {
			color: var(--accent);
			border-color: var(--accent);
		}
	}
	.tag-picker__note {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		max-width: 36rem;
	}
</style>
