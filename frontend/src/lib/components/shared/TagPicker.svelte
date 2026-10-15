<!-- Pick ONE tag by typing part of it — or name a NEW one (WP15, then WP16, 2026-10-15: the owner's
     "tag creation is a must").

     Existing tags first: prefix matches, then anywhere-in-the-word, at most eight shown. When nothing
     already MEANS what was typed, the picker offers "Utwórz tag „…”" and shows the slug it will
     become; the tag itself is made by the server together with the question
     (`backend/exercises/tags.py: create_tag_from`), never here, so a tag never exists without a post.

     Most of the corpus's tags are ASCII slugs ("calka-gaussa"), some are not ("całka z 1-formy"),
     and people type Polish either way — so BOTH sides are folded before matching. `fold` below is
     the backend's `exercises/tags.py: fold`, mirrored (house rule 13): when a typed name folds to an
     existing tag, the picker names that tag and does not offer to create a near-duplicate — and
     the server would reuse it anyway. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getAllTags } from '$lib/services/exercises';

	let {
		value = $bindable(''),
		newName = $bindable(''),
		id = 'tag-picker'
	}: {
		/** The chosen EXISTING tag's slug, or '' while nothing is chosen. */
		value: string;
		/** The name of a NEW tag to create with the post, or ''. At most one of the two is set. */
		newName?: string;
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

	/** "Całka  Gaussa" → "calka-gaussa": the shape most corpus slugs have, and the slug a new tag
	 * gets. Mirrors `backend/exercises/tags.py: fold` — keep the two the same. */
	function fold(text: string): string {
		return text
			.toLowerCase()
			.replace(/ł/g, 'l')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
	}

	/** Trimmed, inner whitespace collapsed, a leading `#` dropped — what is sent as the new name. */
	function cleanName(text: string): string {
		return text.split(/\s+/).filter(Boolean).join(' ').replace(/^#+/, '').trim();
	}

	// Folded once per load, not once per keystroke per tag (about a thousand of them).
	let folded = $derived(tags.map((tag) => [tag, fold(tag)] as const));

	let wanted = $derived(fold(query));
	// The tag that already MEANS what was typed, if any — offered first, and instead of "create".
	let exact = $derived(wanted ? (folded.find(([, key]) => key === wanted)?.[0] ?? null) : null);

	let matches = $derived.by((): string[] => {
		if (!wanted) return [];
		const starts: string[] = [];
		const contains: string[] = [];
		for (const [tag, key] of folded) {
			if (tag === exact) continue;
			if (key.startsWith(wanted)) starts.push(tag);
			else if (key.includes(wanted)) contains.push(tag);
			if (starts.length >= 8) break;
		}
		return [...(exact ? [exact] : []), ...starts, ...contains].slice(0, 8);
	});

	// Two letters or digits is the server's floor too (`MIN_SLUG_LENGTH`); everything else about a
	// name (length, links, a removed tag, who may) is the server's to refuse, with its reason.
	let canCreate = $derived(!loadFailed && !exact && wanted.length >= 2);
	let newSlug = $derived(wanted.slice(0, 50).replace(/-+$/, ''));

	function choose(tag: string) {
		value = tag;
		newName = '';
		query = '';
	}

	function create() {
		newName = cleanName(query);
		value = '';
		query = '';
	}

	function reset() {
		value = '';
		newName = '';
	}
</script>

<div class="tag-picker">
	{#if value || newName}
		<p class="tag-picker__chosen">
			<span class="tag-picker__label">{m.ask_tagLabel()}</span>
			<!-- "Tag" -->
			<span class="tag-picker__chip">#{value || fold(newName)}</span>
			{#if newName}
				<span class="tag-picker__badge">{m.tagnew_badge()}</span>
				<!-- "new tag" -->
			{/if}
			<button type="button" class="tag-picker__change" onclick={reset}>{m.ask_tagChange()}</button>
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
					else if (canCreate) create();
				}
			}}
		/>
		<!-- "Start typing, e.g. integral" -->
		{#if loadFailed}
			<p class="tag-picker__note">{m.common_error_generic()}</p>
		{:else if wanted}
			{#if exact}
				<p class="tag-picker__note">{m.tagnew_exists({ name: cleanName(query), tag: exact })}</p>
				<!-- "“{name}” is already a tag — pick #{tag} below and your question goes there." -->
			{/if}
			{#if matches.length > 0}
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
			{:else if tags.length > 0}
				<p class="tag-picker__note">{m.ask_tagNoMatch()}</p>
				<!-- "No tag like that yet — you can create it." -->
			{/if}
			{#if canCreate}
				<div class="tag-picker__create">
					<button type="button" class="tag-picker__create-button" onclick={create}
						>{m.tagnew_create({ name: cleanName(query) })}</button
					>
					<!-- "Create tag “{name}”" -->
					<p class="tag-picker__note">{m.tagnew_willBe({ slug: newSlug })}</p>
					<!-- "It will be #{slug}. Everyone sees tags, so name a topic — like “power series”." -->
				</div>
			{/if}
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
	.tag-picker__badge {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		padding: 0 var(--space-1);
	}
	.tag-picker__create {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
	}
	.tag-picker__create-button {
		@include mix.button-secondary;
		max-width: 100%;
		overflow-wrap: anywhere;
		text-align: left;
	}
	.tag-picker__note {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		max-width: 36rem;
	}
</style>
