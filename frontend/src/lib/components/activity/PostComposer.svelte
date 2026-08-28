<!-- The post composer: words (Markdown+LaTeX, live preview) + the REQUIRED anchor (exactly one
     discipline/branch/tag — the whole educational-by-construction frame) + optionally one content
     reference and one image. Publishing is immediate; the server enforces everything this form
     merely encourages. -->
<script lang="ts">
	import type { FixedAnchor, Material, ResolvedExercise, Post } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { createPost } from '$lib/services/activity';
	import { getDisciplines, getAllBranches } from '$lib/services/taxonomy';
	import { getAllTags, searchExercises } from '$lib/services/exercises';
	import { searchMaterials } from '$lib/services/materials';
	import { getCourses } from '$lib/services/course';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import { onMount } from 'svelte';

	let {
		onCreated,
		fixedAnchor = null
	}: {
		onCreated: (post: Post) => void;
		/** Set when the page is already filtered to one anchor (a claim chip landed here): the
		 * composer posts INTO that thread by default, with a "change" escape back to the pickers.
		 * This is also the only way to anchor to a TOPIC — the manual pickers deliberately don't
		 * offer topics (a branch→topic cascade for thousands of topics is a picker nobody asked
		 * for; the claim chips ARE the topic picker). */
		fixedAnchor?: FixedAnchor | null;
	} = $props();

	// The escape hatch: "change" drops back to the manual pickers for this composer session.
	let useFixed = $state(true);
	let activeFixed = $derived(useFixed && fixedAnchor ? fixedAnchor : null);

	let body = $state('');
	let showPreview = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	// --- the anchor ------------------------------------------------------------------------------
	let anchorKind = $state<'branch' | 'discipline' | 'tag'>('branch');
	let anchorBranch = $state('');
	let anchorDiscipline = $state('');
	let anchorTag = $state('');
	let branches = $state<{ id: string; name: string }[]>([]);
	let disciplines = $state<{ id: string; name: string }[]>([]);
	let tags = $state<string[]>([]);

	onMount(async () => {
		try {
			const [b, d, t] = await Promise.all([getAllBranches(), getDisciplines(), getAllTags()]);
			branches = b.map((x) => ({ id: x.id, name: x.name }));
			disciplines = d.map((x) => ({ id: x.id, name: x.name }));
			tags = t;
		} catch {
			/* the selects just stay empty; submitting still fails loudly server-side */
		}
	});

	// --- the optional reference ------------------------------------------------------------------
	let refKind = $state<'none' | 'exercise' | 'material' | 'course'>('none');
	let refQuery = $state('');
	let refResults = $state<{ id: string; label: string }[]>([]);
	let refChosen = $state<{ id: string; label: string } | null>(null);
	let refCourses = $state<{ id: string; label: string }[]>([]);
	let refSearching = $state(false);

	async function searchRef() {
		if (!refQuery.trim() || refSearching) return;
		refSearching = true;
		try {
			if (refKind === 'exercise') {
				const found: ResolvedExercise[] = await searchExercises(refQuery, getLocale(), 6);
				refResults = found.map((e) => ({ id: e.id, label: e.title }));
			} else if (refKind === 'material') {
				const found: Material[] = await searchMaterials(refQuery);
				refResults = found.slice(0, 6).map((mat) => ({ id: mat.id, label: mat.title }));
			}
		} catch {
			refResults = [];
		} finally {
			refSearching = false;
		}
	}

	async function onRefKindChange() {
		refChosen = null;
		refResults = [];
		refQuery = '';
		if (refKind === 'course' && refCourses.length === 0) {
			try {
				refCourses = (await getCourses({ openOnly: true })).map((c) => ({
					id: c.id,
					label: c.title
				}));
			} catch {
				refCourses = [];
			}
		}
	}

	async function submit() {
		if (!body.trim() || busy) return;
		busy = true;
		error = null;
		try {
			const post = await createPost({
				body,
				disciplineId: activeFixed
					? activeFixed.kind === 'discipline'
						? activeFixed.id
						: undefined
					: anchorKind === 'discipline'
						? anchorDiscipline
						: undefined,
				branchId: activeFixed
					? activeFixed.kind === 'branch'
						? activeFixed.id
						: undefined
					: anchorKind === 'branch'
						? anchorBranch
						: undefined,
				topicId: activeFixed?.kind === 'topic' ? activeFixed.id : undefined,
				tagSlug: activeFixed
					? activeFixed.kind === 'tag'
						? activeFixed.id
						: undefined
					: anchorKind === 'tag'
						? anchorTag.trim().replace(/^#/, '')
						: undefined,
				refExerciseId: refKind === 'exercise' ? refChosen?.id : undefined,
				refMaterialId: refKind === 'material' ? refChosen?.id : undefined,
				refCourseId: refKind === 'course' ? refChosen?.id : undefined,
				image: imageFile
			});
			body = '';
			refChosen = null;
			refKind = 'none';
			imageFile = null;
			if (imageInput) imageInput.value = '';
			onCreated(post);
		} catch {
			error = m.post_submitError(); // "Could not publish — check the anchor and try again."
		} finally {
			busy = false;
		}
	}

	// --- the optional image ----------------------------------------------------------------------
	let imageFile = $state<File | null>(null);
	let imageInput = $state<HTMLInputElement | null>(null);

	function onImagePicked(event: Event) {
		imageFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
	}
</script>

<div class="composer">
	<textarea rows="4" bind:value={body} placeholder={m.post_composerPlaceholder()}></textarea>

	{#if activeFixed}
		<div class="composer__row">
			<span class="field"><span>{m.post_anchorLabel()}</span></span>
			<span class="fixed-anchor">{activeFixed.label}</span>
			<button type="button" class="link" onclick={() => (useFixed = false)}
				>{m.post_anchorChange()}</button
			>
		</div>
	{:else}
		<div class="composer__row">
			<label class="field">
				<span>{m.post_anchorLabel()}</span>
				<select bind:value={anchorKind}>
					<option value="branch">{m.post_anchorBranch()}</option>
					<option value="discipline">{m.post_anchorDiscipline()}</option>
					<option value="tag">{m.post_anchorTag()}</option>
				</select>
			</label>
			{#if anchorKind === 'branch'}
				<select class="anchor-value" bind:value={anchorBranch}>
					<option value="">{m.post_anchorPick()}</option>
					{#each branches as branch (branch.id)}
						<option value={branch.id}>{branch.name}</option>
					{/each}
				</select>
			{:else if anchorKind === 'discipline'}
				<select class="anchor-value" bind:value={anchorDiscipline}>
					<option value="">{m.post_anchorPick()}</option>
					{#each disciplines as discipline (discipline.id)}
						<option value={discipline.id}>{discipline.name}</option>
					{/each}
				</select>
			{:else}
				<input
					class="anchor-value"
					type="text"
					list="post-composer-tags"
					bind:value={anchorTag}
					placeholder={m.post_anchorTagPlaceholder()}
				/>
				<datalist id="post-composer-tags">
					{#each tags as tag (tag)}
						<option value={tag}></option>
					{/each}
				</datalist>
			{/if}
		</div>
	{/if}

	<div class="composer__row">
		<label class="field">
			<span>{m.post_refLabel()}</span>
			<select bind:value={refKind} onchange={onRefKindChange}>
				<option value="none">{m.post_refNone()}</option>
				<option value="exercise">{m.post_refKindExercise()}</option>
				<option value="material">{m.post_refKindMaterial()}</option>
				<option value="course">{m.post_refKindCourse()}</option>
			</select>
		</label>
		{#if refKind === 'exercise' || refKind === 'material'}
			{#if refChosen}
				<span class="ref-chosen"
					>{refChosen.label}
					<button type="button" class="link" onclick={() => (refChosen = null)}>✕</button></span
				>
			{:else}
				<input
					type="text"
					bind:value={refQuery}
					placeholder={m.post_refSearchPlaceholder()}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							searchRef();
						}
					}}
				/>
				<button type="button" class="secondary" disabled={refSearching} onclick={searchRef}
					>{m.common_search()}</button
				>
			{/if}
		{:else if refKind === 'course'}
			<select
				onchange={(e) => {
					const id = (e.currentTarget as HTMLSelectElement).value;
					refChosen = refCourses.find((c) => c.id === id) ?? null;
				}}
			>
				<option value="">{m.post_anchorPick()}</option>
				{#each refCourses as course (course.id)}
					<option value={course.id}>{course.label}</option>
				{/each}
			</select>
		{/if}
	</div>

	{#if refResults.length > 0 && !refChosen}
		<ul class="ref-results">
			{#each refResults as result (result.id)}
				<li>
					<button
						type="button"
						class="link"
						onclick={() => {
							refChosen = result;
							refResults = [];
						}}>{result.label}</button
					>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="composer__row">
		<label class="field">
			<span>{m.post_imageLabel()}</span>
			<input
				type="file"
				accept="image/png,image/jpeg,image/webp,image/gif"
				bind:this={imageInput}
				onchange={onImagePicked}
			/>
		</label>
	</div>

	<div class="composer__actions">
		<button type="button" class="secondary" onclick={() => (showPreview = !showPreview)}
			>{showPreview ? m.entry_hidePreview() : m.entry_showPreview()}</button
		>
		<button type="button" class="primary" disabled={busy || !body.trim()} onclick={submit}
			>{m.post_publish()}</button
		>
	</div>
	{#if showPreview && body.trim()}
		<div class="composer__preview"><MathContent source={body} /></div>
	{/if}
	{#if error}
		<p class="error">{error}</p>
	{/if}
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.composer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		background: var(--bg-surface);
		textarea,
		input,
		select {
			font: inherit;
			padding: var(--space-1);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.composer__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-weight: 600;
	}
	.anchor-value {
		min-width: 14rem;
	}
	.fixed-anchor {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--accent);
	}
	.ref-chosen {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.ref-results {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		font-size: var(--font-size-sm);
		cursor: pointer;
		text-align: left;
	}
	.composer__actions {
		display: flex;
		gap: var(--space-2);
	}
	.primary {
		@include mix.button-primary;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-3);
	}
	.secondary {
		@include mix.button-secondary;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-3);
	}
	.composer__preview {
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
	}
	.error {
		font-size: var(--font-size-xs);
		color: var(--status-danger);
	}
</style>
