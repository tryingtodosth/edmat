<script lang="ts">
	import type { ExerciseSet, ResolvedExercise } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getExercisesByIds } from '$lib/services/exercises';
	import { createSet, getSetsForUser } from '$lib/services/exerciseSets';
	import { authStore } from '$lib/state/auth.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import DifficultyBadge from '$lib/components/shared/DifficultyBadge.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';

	let exercises = $state<ResolvedExercise[]>([]);
	let savedSets = $state<ExerciseSet[]>([]);
	let newSetName = $state('');
	let saveNotice = $state(false);

	async function reload() {
		exercises = await getExercisesByIds(guestSetStore.ids, getLocale());
	}

	async function loadSavedSets() {
		if (!authStore.user) {
			savedSets = [];
			return;
		}
		savedSets = await getSetsForUser(authStore.user.id);
	}

	$effect(() => {
		// Reading .ids (not just calling reload()) is what registers it as this effect's
		// dependency — assigned to a throwaway const so it reads as a real statement, not a bare
		// expression the linter (rightly, for ordinary code) treats as dead.
		const _ids = guestSetStore.ids;
		reload();
	});

	$effect(() => {
		const _isAuthenticated = authStore.isAuthenticated;
		loadSavedSets();
	});

	async function saveNamedSet() {
		if (!authStore.user || !newSetName.trim()) return;
		const set = await createSet(authStore.user.id, newSetName.trim(), guestSetStore.ids);
		savedSets = [set, ...savedSets];
		newSetName = '';
		saveNotice = true;
	}

	function loadSet(set: ExerciseSet) {
		guestSetStore.setAll(set.exerciseIds);
	}

	function exportPdf() {
		window.print();
	}
</script>

<svelte:head>
	<title>{m.myset_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<header class="no-print">
		<h1>{m.myset_heading()}</h1>
		<p>{m.myset_subtitle()}</p>
		{#if !authStore.isAuthenticated}
			<p class="guest-note">{m.myset_guestNote()}</p>
		{/if}
	</header>

	<div class="toolbar no-print">
		<button type="button" class="export" disabled={exercises.length === 0} onclick={exportPdf}>
			{m.myset_export()}
		</button>
		<span class="hint">{m.myset_exportHint()}</span>
		{#if exercises.length > 0}
			<button type="button" class="clear" onclick={() => guestSetStore.clear()}
				>{m.myset_clear()}</button
			>
		{/if}
	</div>

	{#if authStore.isAuthenticated}
		<section class="named-sets no-print">
			<h2>{m.myset_saveAsNamed()}</h2>
			<form class="save-form" onsubmit={(e) => (e.preventDefault(), saveNamedSet())}>
				<input type="text" placeholder={m.myset_namePlaceholder()} bind:value={newSetName} />
				<button type="submit" class="save" disabled={exercises.length === 0 || !newSetName.trim()}>
					{m.myset_saveButton()}
				</button>
			</form>
			{#if saveNotice}
				<p class="notice">✓</p>
			{/if}

			{#if savedSets.length > 0}
				<h3>{m.myset_savedSets()}</h3>
				<ul class="saved-list">
					{#each savedSets as set (set.id)}
						<li>
							<span>{set.name}</span>
							<span class="muted"
								>{m.myset_savedSetItemCount({ count: set.exerciseIds.length })}</span
							>
							<button type="button" class="load" onclick={() => loadSet(set)}
								>{m.myset_loadSet()}</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<div class="print-area">
		<h2 class="print-only">{m.myset_printTitle()}</h2>
		{#if exercises.length === 0}
			<p class="empty">{m.myset_empty()}</p>
		{:else}
			<ol class="set-list">
				{#each exercises as exercise, i (exercise.id)}
					<li class="set-item">
						<div class="set-item__top">
							<h3>{i + 1}. <MathTitle text={exercise.title} /></h3>
							<DifficultyBadge difficulty={exercise.difficulty} />
							<button
								type="button"
								class="remove no-print"
								onclick={() => guestSetStore.remove(exercise.id)}
							>
								{m.myset_remove()}
							</button>
						</div>
						<MathContent source={exercise.statement} />
					</li>
				{/each}
			</ol>
		{/if}
	</div>
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

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
	header p {
		color: var(--text-secondary);
		margin-top: var(--space-1);
	}
	.guest-note {
		font-size: var(--font-size-xs);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.export {
		@include mix.button-primary;
	}
	.clear {
		@include mix.button-secondary;
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.named-sets {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.named-sets h2 {
		font-size: var(--font-size-base);
	}
	.named-sets h3 {
		font-size: var(--font-size-sm);
		margin-top: var(--space-2);
		color: var(--text-secondary);
	}
	.save-form {
		display: flex;
		gap: var(--space-2);
	}
	input {
		@include mix.focus-ring;
		flex: 1;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
	}
	.save {
		@include mix.button-secondary;
	}
	.notice {
		color: var(--status-success);
	}
	.saved-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		li {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			font-size: var(--font-size-sm);
		}
	}
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	.load {
		@include mix.button-secondary;
		padding: 2px var(--space-2);
		font-size: var(--font-size-xs);
		margin-left: auto;
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
	.remove {
		background: none;
		border: none;
		color: var(--status-danger);
		font-size: var(--font-size-xs);
	}
	.empty {
		color: var(--text-secondary);
	}
	.print-only {
		display: none;
	}
	@media print {
		.print-only {
			display: block;
			margin-bottom: var(--space-4);
		}
	}
</style>
