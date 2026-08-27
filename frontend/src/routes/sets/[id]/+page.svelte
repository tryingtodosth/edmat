<script lang="ts">
	// The real, previously-missing "share a link to my set" feature (CLAUDE.md Section 16's own
	// "deferred to a later phase" note) — a read-only view of SOMEONE ELSE's server-side set,
	// reached via its own unguessable slug (study/models.py's `_generate_set_slug`). A set is
	// PRIVATE by default (study/views.py's own ExerciseSetViewSet.retrieve gates on `is_public`) —
	// this route resolves for anyone once the owner has actually shared it, and ALSO for the owner
	// themselves previewing their own still-private one (the "is this what my friend will see"
	// check, see the private-preview note below). Works for a guest exactly as it does for a
	// logged-in visitor, matching the exercise/branch detail pages' own "no server-rendered auth
	// story, plain $effect keyed off page.params" pattern.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { ExerciseSet, ResolvedExercise } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getExercisesByIds } from '$lib/services/exercises';
	import { createSet, getSharedSet } from '$lib/services/exerciseSets';
	import { authStore } from '$lib/state/auth.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import DifficultyBadge from '$lib/components/shared/DifficultyBadge.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';

	let set = $state<ExerciseSet | undefined>(undefined);
	let exercises = $state<ResolvedExercise[]>([]);

	// The printable hint/solution content comes from the pool (`exercise.entries`): the published
	// entries in the exercise's own resolved locale (pinned/top-voted order preserved from the
	// server); if that locale has none, whatever published entries exist — a language beats a
	// blank on a printed study sheet.
	function printableEntries(exercise: ResolvedExercise, kind: 'hint' | 'solution') {
		const published = exercise.entries.filter((e) => e.kind === kind && e.status === 'published');
		const local = published.filter((e) => e.locale === exercise.locale);
		return local.length > 0 ? local : published;
	}
	let loading = $state(true);
	let notFound = $state(false);
	let loadedIntoMySet = $state(false);
	let savingCopy = $state(false);
	let savedCopy = $state(false);

	async function loadAll(id: string) {
		loading = true;
		notFound = false;
		loadedIntoMySet = false;
		savedCopy = false;
		const resolved = await getSharedSet(id);
		if (!resolved) {
			notFound = true;
			loading = false;
			return;
		}
		set = resolved;
		exercises = await getExercisesByIds(resolved.exerciseIds, getLocale());
		loading = false;
	}

	// Same id-changed idempotency guard `exercises/[id]/+page.svelte` already found necessary for
	// this exact `page.params.id` pattern — a bare `$effect(() => loadAll(page.params.id))`
	// re-fires spuriously on unrelated state changes on this same page, not just on a genuine
	// navigation to a different set; guarding on the id ACTUALLY changing makes it idempotent
	// regardless of how many times it re-fires.
	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		loadAll(id);
	});

	function loadIntoMySet() {
		if (!set) return;
		guestSetStore.setAll(set.exerciseIds);
		loadedIntoMySet = true;
	}

	async function saveCopy() {
		if (!set || !authStore.user) return;
		savingCopy = true;
		try {
			await createSet(authStore.user.id, set.name, set.exerciseIds);
			savedCopy = true;
		} finally {
			savingCopy = false;
		}
	}
</script>

<svelte:head>
	<title
		>{set ? m.sharedSet_heading({ name: set.name }) : m.myset_heading()} — {m.common_appName()}</title
	>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="hint">{m.common_loading()}</p>
	{:else if notFound || !set}
		<p class="empty">{m.sharedSet_notFound()}</p>
	{:else}
		<header>
			<h1><MathTitle text={set.name} /></h1>
			{#if set.ownerDisplayName}
				<p class="shared-by">{m.sharedSet_sharedBy({ name: set.ownerDisplayName })}</p>
			{/if}
			{#if !set.isPublic && authStore.user?.id === set.ownerId}
				<!-- Only the owner can even reach this branch at all — a stranger holding this exact
				     link gets a real 404 from the backend the instant is_public is false (the owner-
				     preview exception, study/views.py's own ExerciseSetViewSet.get_queryset), so this
				     note is never shown to anyone else by mistake. -->
				<p class="private-note">{m.sharedSet_privateOwnerNote()}</p>
			{/if}
		</header>

		<div class="toolbar">
			<button type="button" class="load" onclick={loadIntoMySet}>
				{m.sharedSet_loadIntoMySet()}
			</button>
			{#if loadedIntoMySet}
				<span class="notice">
					{m.sharedSet_loadedNotice()}
					<a href={resolve('/my-set')}>{m.myset_heading()}</a>
				</span>
			{/if}

			{#if authStore.isAuthenticated}
				<button type="button" class="save-copy" disabled={savingCopy} onclick={saveCopy}>
					{savingCopy ? m.common_loading() : m.sharedSet_saveCopy()}
				</button>
				{#if savedCopy}
					<span class="notice">{m.sharedSet_saveCopySuccess()}</span>
				{/if}
			{:else}
				<span class="hint">{m.sharedSet_loginToSaveCopy()}</span>
			{/if}
		</div>

		{#if exercises.length === 0}
			<p class="empty">{m.myset_empty()}</p>
		{:else}
			<ol class="set-list">
				{#each exercises as exercise, i (exercise.id)}
					{@const options = set.itemOptions[exercise.id]}
					<li class="set-item">
						<div class="set-item__top">
							<h3>
								{i + 1}.
								<a class="set-item__link" href={resolve('/exercises/[id]', { id: exercise.id })}>
									<MathTitle text={exercise.title} />
								</a>
							</h3>
							<DifficultyBadge difficulty={exercise.difficulty} />
						</div>
						<MathContent source={exercise.statement} />
						{#if options?.includeHint && printableEntries(exercise, 'hint').length > 0}
							<p class="content-label">{m.myset_field_hint()}</p>
							{#each printableEntries(exercise, 'hint') as entry (entry.id)}
								<MathContent source={entry.body} />
							{/each}
						{/if}
						{#if options?.includeAnswer && exercise.answer}
							<p class="content-label">{m.myset_field_answer()}</p>
							<MathContent source={exercise.answer} />
						{/if}
						{#if options?.includeSolution && printableEntries(exercise, 'solution').length > 0}
							<p class="content-label">{m.myset_field_solution()}</p>
							{#each printableEntries(exercise, 'solution') as entry (entry.id)}
								<MathContent source={entry.body} />
							{/each}
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.shared-by {
		color: var(--text-secondary);
		margin-top: var(--space-1);
	}
	.private-note {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
		margin-top: var(--space-2);
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.empty {
		color: var(--text-secondary);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.load {
		@include mix.button-primary;
	}
	.save-copy {
		@include mix.button-secondary;
	}
	.notice {
		color: var(--status-success);
		font-size: var(--font-size-sm);
		display: flex;
		align-items: center;
		gap: var(--space-1);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.set-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.set-item {
		@include mix.card-surface;
		padding: var(--space-4);
	}
	.content-label {
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		margin-top: var(--space-2);
	}
	.set-item__top {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
		h3 {
			flex: 1;
			font-size: var(--font-size-base);
		}
	}
	.set-item__link {
		color: var(--text-primary);
		&:hover {
			color: var(--accent);
		}
	}
</style>
