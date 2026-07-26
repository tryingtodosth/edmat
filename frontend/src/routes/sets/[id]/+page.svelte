<script lang="ts">
	// The real, previously-missing "share a link to my set" feature (CLAUDE.md Section 16's own
	// "deferred to a later phase" note) — a read-only view of SOMEONE ELSE's server-side set,
	// reached via a direct link (their own set's plain numeric id — study/views.py's own
	// ExerciseSetViewSet.retrieve is deliberately public now, see that file's doc comment for why
	// a set's content was never sensitive enough to need an opaque token). Works for a guest
	// exactly as it does for a logged-in visitor, matching the exercise/course detail pages' own
	// "no server-rendered auth story, plain $effect keyed off page.params" pattern.
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
					<li class="set-item">
						<div class="set-item__top">
							<h3>{i + 1}. <MathTitle text={exercise.title} /></h3>
							<DifficultyBadge difficulty={exercise.difficulty} />
						</div>
						<MathContent source={exercise.statement} />
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
</style>
