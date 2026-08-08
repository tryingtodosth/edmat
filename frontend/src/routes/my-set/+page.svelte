<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ExerciseSet, ExerciseSetItemOptions, ResolvedExercise } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getExercisesByIds } from '$lib/services/exercises';
	import { createSet, getSetsForUser, setExerciseSetPrivacy } from '$lib/services/exerciseSets';
	import { authStore } from '$lib/state/auth.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import DifficultyBadge from '$lib/components/shared/DifficultyBadge.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';

	type IncludeField = 'hint' | 'answer' | 'solution';
	type IncludeFlags = Record<IncludeField, boolean>;

	let exercises = $state<ResolvedExercise[]>([]);
	let savedSets = $state<ExerciseSet[]>([]);
	let newSetName = $state('');
	// Which saved set's own share link was just copied — per-row, not a single page-wide flag, so
	// copying one set's link doesn't show a stale "copied" note next to a DIFFERENT set below it.
	let sharedSetId = $state<string | null>(null);
	let saveNotice = $state(false);

	// Per-exercise "what to show beyond the statement" — keyed by exercise id, one entry per
	// exercise currently in the working set. Purely local until "Save set" persists it (study's own
	// ExerciseSetItem.include_hint/include_answer/include_solution) — the on-screen/print view below
	// reflects it immediately either way, since a study sheet is exactly what this page IS, not just
	// a preview of what saving would produce.
	let itemOptions = $state<Record<string, IncludeFlags>>({});

	// Fills in a default (all-false) entry for any exercise that doesn't have one yet — added
	// exercises start "statement only," matching this feature's own pre-existing behavior; never
	// clobbers a choice already made for an exercise still in the set.
	$effect(() => {
		for (const exercise of exercises) {
			if (!(exercise.id in itemOptions)) {
				itemOptions[exercise.id] = { hint: false, answer: false, solution: false };
			}
		}
	});

	function setItemOption(exerciseId: string, field: IncludeField, value: boolean) {
		itemOptions[exerciseId] = { ...itemOptions[exerciseId], [field]: value };
	}

	// The bulk row's own checkboxes read as "checked" only once EVERY exercise already has that
	// field on — clicking one applies that same new value to every exercise at once, a genuine
	// bulk toggle, not just a default applied to future additions.
	let bulkHint = $derived(exercises.length > 0 && exercises.every((e) => itemOptions[e.id]?.hint));
	let bulkAnswer = $derived(
		exercises.length > 0 && exercises.every((e) => itemOptions[e.id]?.answer)
	);
	let bulkSolution = $derived(
		exercises.length > 0 && exercises.every((e) => itemOptions[e.id]?.solution)
	);

	function setBulkOption(field: IncludeField, value: boolean) {
		for (const exercise of exercises) {
			itemOptions[exercise.id] = { ...itemOptions[exercise.id], [field]: value };
		}
	}

	function toItemOptionsPayload(): Record<string, ExerciseSetItemOptions> {
		const payload: Record<string, ExerciseSetItemOptions> = {};
		for (const exercise of exercises) {
			const opts = itemOptions[exercise.id];
			if (!opts) continue;
			payload[exercise.id] = {
				includeHint: opts.hint,
				includeAnswer: opts.answer,
				includeSolution: opts.solution
			};
		}
		return payload;
	}

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
		const set = await createSet(
			authStore.user.id,
			newSetName.trim(),
			guestSetStore.ids,
			toItemOptionsPayload()
		);
		savedSets = [set, ...savedSets];
		newSetName = '';
		saveNotice = true;
	}

	// Also seeds the local include-flags from the saved set's own persisted choices, so reopening a
	// saved set shows exactly what it was saved with, ready to adjust and save again.
	function loadSet(set: ExerciseSet) {
		guestSetStore.setAll(set.exerciseIds);
		const next: Record<string, IncludeFlags> = {};
		for (const exerciseId of set.exerciseIds) {
			const opts = set.itemOptions[exerciseId];
			next[exerciseId] = opts
				? { hint: opts.includeHint, answer: opts.includeAnswer, solution: opts.includeSolution }
				: { hint: false, answer: false, solution: false };
		}
		itemOptions = next;
	}

	// Clicking "Share" both copies the link AND makes the set public if it wasn't already — a set
	// is private by default (study/models.py's `is_public`), so a share link that isn't yet public
	// would otherwise silently 404 for whoever it's sent to. The explicit "Public" checkbox next to
	// each set (below) is the real, visible privacy control this same toggle also drives — checking
	// it does the same thing Share does minus the clipboard copy; unchecking it revokes access,
	// resolving CLAUDE.md Section 17J's own "no unshare mechanism" gap.
	async function shareSet(set: ExerciseSet) {
		if (!set.isPublic) {
			const updated = await setExerciseSetPrivacy(set.id, true);
			savedSets = savedSets.map((s) => (s.id === updated.id ? updated : s));
			set = updated;
		}
		const url = `${window.location.origin}${resolve('/sets/[id]', { id: set.id })}`;
		await navigator.clipboard.writeText(url);
		sharedSetId = set.id;
	}

	async function togglePublic(set: ExerciseSet, isPublic: boolean) {
		const updated = await setExerciseSetPrivacy(set.id, isPublic);
		savedSets = savedSets.map((s) => (s.id === updated.id ? updated : s));
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
		{#if authStore.restoring}
			<!-- Nothing: this is an aside beside content that renders anyway. -->
		{:else if !authStore.isAuthenticated}
			<p data-session-hidden class="guest-note">{m.myset_guestNote()}</p>
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
							<label class="public-toggle">
								<input
									type="checkbox"
									checked={set.isPublic}
									onchange={(e) => togglePublic(set, e.currentTarget.checked)}
								/>
								{m.myset_public()}
							</label>
							{#if sharedSetId === set.id}
								<span class="notice notice--inline">{m.myset_shareCopied()}</span>
							{/if}
							<button type="button" class="share" onclick={() => shareSet(set)}
								>{m.myset_share()}</button
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
			<div class="bulk-options no-print">
				<span class="bulk-options__label">{m.myset_includeForAll()}</span>
				<label>
					<input
						type="checkbox"
						checked={bulkHint}
						onchange={(e) => setBulkOption('hint', e.currentTarget.checked)}
					/>
					{m.myset_field_hint()}
				</label>
				<label>
					<input
						type="checkbox"
						checked={bulkAnswer}
						onchange={(e) => setBulkOption('answer', e.currentTarget.checked)}
					/>
					{m.myset_field_answer()}
				</label>
				<label>
					<input
						type="checkbox"
						checked={bulkSolution}
						onchange={(e) => setBulkOption('solution', e.currentTarget.checked)}
					/>
					{m.myset_field_solution()}
				</label>
			</div>
			<ol class="set-list">
				{#each exercises as exercise, i (exercise.id)}
					{@const options = itemOptions[exercise.id]}
					<li class="set-item">
						<div class="set-item__top">
							<h3>
								{i + 1}.
								<a
									class="set-item__link no-print"
									href={resolve('/exercises/[id]', { id: exercise.id })}
								>
									<MathTitle text={exercise.title} />
								</a>
								<span class="print-only"><MathTitle text={exercise.title} /></span>
							</h3>
							<DifficultyBadge difficulty={exercise.difficulty} />
							<button
								type="button"
								class="remove no-print"
								onclick={() => guestSetStore.remove(exercise.id)}
							>
								{m.myset_remove()}
							</button>
						</div>
						<div class="item-options no-print">
							<label>
								<input
									type="checkbox"
									checked={options?.hint ?? false}
									onchange={(e) => setItemOption(exercise.id, 'hint', e.currentTarget.checked)}
								/>
								{m.myset_field_hint()}
							</label>
							<label>
								<input
									type="checkbox"
									checked={options?.answer ?? false}
									onchange={(e) => setItemOption(exercise.id, 'answer', e.currentTarget.checked)}
								/>
								{m.myset_field_answer()}
							</label>
							<label>
								<input
									type="checkbox"
									checked={options?.solution ?? false}
									onchange={(e) => setItemOption(exercise.id, 'solution', e.currentTarget.checked)}
								/>
								{m.myset_field_solution()}
							</label>
						</div>
						<MathContent source={exercise.statement} />
						{#if options?.hint && exercise.hint}
							<p class="content-label">{m.myset_field_hint()}</p>
							<MathContent source={exercise.hint} />
						{/if}
						{#if options?.answer && exercise.answer}
							<p class="content-label">{m.myset_field_answer()}</p>
							<MathContent source={exercise.answer} />
						{/if}
						{#if options?.solution && exercise.solution}
							<p class="content-label">{m.myset_field_solution()}</p>
							<MathContent source={exercise.solution} />
						{/if}
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
	.notice--inline {
		font-size: var(--font-size-xs);
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
	.public-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	.share {
		@include mix.button-secondary;
		padding: 2px var(--space-2);
		font-size: var(--font-size-xs);
		margin-left: auto;
	}
	.load {
		@include mix.button-secondary;
		padding: 2px var(--space-2);
		font-size: var(--font-size-xs);
	}
	.bulk-options {
		@include mix.card-surface;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding: var(--space-3);
		font-size: var(--font-size-sm);
		label {
			display: inline-flex;
			align-items: center;
			gap: var(--space-1);
		}
	}
	.bulk-options__label {
		color: var(--text-secondary);
		font-weight: 500;
	}
	.item-options {
		display: flex;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		label {
			display: inline-flex;
			align-items: center;
			gap: var(--space-1);
		}
	}
	.content-label {
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		margin-top: var(--space-2);
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
	.set-item__link {
		color: var(--text-primary);
		&:hover {
			color: var(--accent);
		}
	}
	.remove {
		@include mix.focus-ring;
		background: none;
		border: none;
		color: var(--status-danger);
		font-size: var(--font-size-xs);
		border-radius: var(--radius-sm);
		padding: 2px var(--space-1);
		// A real, explicit hover/focus background — a bare `background: none` button left every
		// hover/focus affordance up to whatever the browser's own unstyled-button default happens to
		// be, which is inconsistent across browsers and can render as a dark highlight the existing
		// dark-red text (readable against the plain page background) doesn't have enough contrast
		// against. Reusing the same status-danger-bg token this app's own moderation "Reject"
		// button already uses (confirmed accessible, Section 17E's real axe-core contrast pass)
		// rather than leaving this to chance.
		&:hover,
		&:focus-visible {
			background: var(--status-danger-bg);
		}
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
