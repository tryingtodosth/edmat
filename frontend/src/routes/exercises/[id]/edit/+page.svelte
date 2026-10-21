<!--
  The author's (or staff's) in-place edit of an exercise (owner, 2026-10-21: "even though im a
  superadmin and author of a specific exercise, there's no edit option … and there should").
  Mirrors the /submit form field for field, minus what an edit cannot change (branch, licence —
  the licence has its own control on the exercise page) and minus the founding hint/solution, which
  live in the pool and are edited there. Saves through PATCH /api/exercises/{id}/, which asks
  `exercises/editing.py`; a stranger who lands here is told so and sent to the suggestion path.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import RichEditor from '$lib/components/editor/RichEditor.svelte';
	import InsertStrip from '$lib/components/editor/InsertStrip.svelte';
	import AudienceSelect from '$lib/components/shared/AudienceSelect.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { ApiError } from '$lib/api/client';
	import { getExerciseById, updateExercise } from '$lib/services/exercises';
	import { getTopicsForBranch } from '$lib/services/taxonomy';
	import { authStore } from '$lib/state/auth.svelte';
	import type { Audience, Difficulty, ResolvedExercise, SourceType, Topic } from '$lib/types';
	import {
		DIFFICULTY_LABELS,
		PART_REFUSAL_LABELS,
		SOURCE_TYPE_LABELS,
		firstRefusalWord
	} from '$lib/utils/labels';
	import { pageTitle } from '$lib/utils/pageTitle';

	const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
	const SOURCE_TYPES: SourceType[] = ['exercises', 'midterm', 'exam', 'other'];

	let exercise = $state<ResolvedExercise | null>(null);
	let topics = $state<Topic[]>([]);
	let loading = $state(true);
	let notFound = $state(false);
	let loadedFor = $state('');

	let title = $state('');
	let statement = $state('');
	let answer = $state('');
	let difficulty = $state<Difficulty>('medium');
	let audience = $state<Audience | ''>('');
	let selectedTopicIds = $state<string[]>([]);
	let tagsInput = $state('');
	let sourceType = $state<SourceType>('other');
	let sourceName = $state('');
	let sourceCollection = $state('');
	let sourcePages = $state('');
	let sourceChapter = $state('');
	let sourceNumber = $state('');

	let statementEditor = $state<RichEditor | null>(null);
	let statementStrip = $state<InsertStrip | null>(null);
	let answerEditor = $state<RichEditor | null>(null);
	let answerStrip = $state<InsertStrip | null>(null);

	let saving = $state(false);
	let error = $state('');

	// The Parts section (`SUBEXERCISES-BRIEF.md` §4). One row per part in display order; `key` is
	// the row's own identity for the keyed list (a new row has no `id` yet), and a KNOWN part that
	// is removed stays in the list as `removed` so the page can say what saving will delete and
	// offer Undo — a part leaves only on save, with its hints and solutions.
	type PartRow = {
		key: string;
		id?: string;
		label: string;
		statement: string;
		answer: string;
		removed: boolean;
	};
	let partRows = $state<PartRow[]>([]);
	let hadParts = $state(false);
	let nextRowKey = 0;
	// Each row's two editors and their insert strips, by `<key>:statement` / `<key>:answer`.
	let partEditors = $state<Record<string, RichEditor | null>>({});
	let partStrips = $state<Record<string, InsertStrip | null>>({});
	// The in-page "these parts go, with their entries" question — asked once per save attempt.
	let confirmingDrop = $state(false);

	let liveRows = $derived(partRows.filter((r) => !r.removed));
	let droppedRows = $derived(partRows.filter((r) => r.removed && r.id !== undefined));

	function addPart() {
		partRows = [
			...partRows,
			{ key: `new-${nextRowKey++}`, label: '', statement: '', answer: '', removed: false }
		];
	}

	function removePart(row: PartRow) {
		confirmingDrop = false;
		// A row that was never saved has nothing to lose: it simply goes.
		if (row.id === undefined) partRows = partRows.filter((r) => r.key !== row.key);
		else row.removed = true;
	}

	function movePart(row: PartRow, step: -1 | 1) {
		// Moves among the LIVE rows; a removed row keeps its place, it is never sent.
		const live = partRows.filter((r) => !r.removed);
		const at = live.indexOf(row);
		const to = at + step;
		if (at < 0 || to < 0 || to >= live.length) return;
		const a = partRows.indexOf(live[at]);
		const b = partRows.indexOf(live[to]);
		const next = [...partRows];
		[next[a], next[b]] = [next[b], next[a]];
		partRows = next;
	}

	function entryCount(partId: string, kind: 'hint' | 'solution'): number {
		return exercise?.entries.filter((e) => e.partId === partId && e.kind === kind).length ?? 0;
	}

	// Trap 2: keyed on the id with a guard, so a re-fire with no navigation is a no-op; `untrack`
	// on the guard so the effect does not depend on the state it writes (trap 4).
	$effect(() => {
		const id = page.params.id!;
		if (untrack(() => loadedFor) === id) return;
		loadedFor = id;
		void load(id);
	});

	async function load(id: string) {
		loading = true;
		notFound = false;
		try {
			// The ORIGINAL text, whatever the reader's interface language: an edit is to the
			// exercise as written, and the API resolves `lang=<original>` to exactly that row.
			const first = await getExerciseById(id, getLocale());
			const ex =
				first && !first.isOriginal ? await getExerciseById(id, first.originalLocale) : first;
			if (!ex) {
				notFound = true;
				return;
			}
			exercise = ex;
			title = ex.title;
			statement = ex.statement;
			answer = ex.answer;
			difficulty = ex.difficulty;
			audience = ex.audience;
			selectedTopicIds = [...ex.topicIds];
			tagsInput = ex.tags.join(', ');
			sourceType = ex.source.type;
			sourceName = ex.source.name ?? '';
			sourceCollection = ex.source.collection ?? '';
			sourcePages = ex.source.pages ?? '';
			sourceChapter = ex.source.chapter ? String(ex.source.chapter) : '';
			sourceNumber = ex.source.originalProblemNumber ? String(ex.source.originalProblemNumber) : '';
			partRows = ex.parts.map((p) => ({
				key: `part-${p.id}`,
				id: p.id,
				label: p.label,
				statement: p.statement,
				answer: p.answer,
				removed: false
			}));
			hadParts = ex.parts.length > 0;
			topics = await getTopicsForBranch(ex.branchId);
		} finally {
			loading = false;
		}
	}

	function toggleTopic(id: string) {
		selectedTopicIds = selectedTopicIds.includes(id)
			? selectedTopicIds.filter((t) => t !== id)
			: [...selectedTopicIds, id];
	}

	function refusalLabel(detail: string): string {
		switch (detail) {
			case 'topics_not_in_branch':
				return m.exercise_edit_refusal_topics_not_in_branch(); // "One of the chosen topics belongs to another branch."
			case 'tag_removed':
				return m.exercise_edit_refusal_tag_removed(); // "One of the tags was removed by a moderator."
			case 'exercise_not_editor':
				return m.exercise_edit_refusal_exercise_not_editor(); // "Only the author or staff may edit this exercise."
			default:
				return Object.hasOwn(PART_REFUSAL_LABELS, detail) ? PART_REFUSAL_LABELS[detail]() : detail;
		}
	}

	// Walks nested bodies too: a refusal about one part arrives as `{parts: [{}, {label: [word]}]}`.
	function firstDetail(body: unknown): string {
		if (!body || typeof body !== 'object') return '';
		return firstRefusalWord(body);
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		if (!exercise || saving) return;
		// Saving would delete known parts: say which, with what goes with them, and ask once.
		if (droppedRows.length > 0 && !confirmingDrop) {
			confirmingDrop = true;
			return;
		}
		void doSave();
	}

	async function doSave() {
		if (!exercise || saving) return;
		confirmingDrop = false;
		saving = true;
		error = '';
		const chapter = sourceChapter.trim() ? Number(sourceChapter.trim()) : undefined;
		const number = sourceNumber.trim() ? Number(sourceNumber.trim()) : undefined;
		try {
			await updateExercise(
				exercise.id,
				{
					title: title.trim(),
					statement,
					answer,
					difficulty,
					audience: (audience || exercise.audience) as Audience,
					topicIds: selectedTopicIds,
					tags: tagsInput
						.split(',')
						.map((t) => t.trim())
						.filter(Boolean),
					source: {
						type: sourceType,
						name: sourceName.trim(),
						collection: sourceCollection.trim(),
						pages: sourcePages.trim(),
						chapter: Number.isFinite(chapter) ? chapter : undefined,
						originalProblemNumber: Number.isFinite(number) ? number : undefined
					},
					// Only when there are or were parts: an ordinary exercise's edit sends exactly
					// what it sent before parts existed.
					...(hadParts || liveRows.length > 0
						? {
								parts: liveRows.map((r) => ({
									...(r.id === undefined ? {} : { id: r.id }),
									label: r.label.trim(),
									statement: r.statement,
									answer: r.answer
								}))
							}
						: {})
				},
				exercise.locale
			);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved, then given a query parameter
			await goto(`${resolve('/exercises/[id]', { id: exercise.id })}?saved=1`);
		} catch (e) {
			const detail = e instanceof ApiError ? firstDetail(e.body) || e.message : String(e);
			error = m.exercise_edit_failed({ reason: refusalLabel(detail) }); // "Could not save: {reason}"
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(m.exercise_edit_heading())}</title>
</svelte:head>

<div class="page" data-exercise-edit>
	{#if loading}
		<p class="muted">{m.common_loading()}</p>
	{:else if notFound || !exercise}
		<p class="muted">{m.exercise_notFound()}</p>
	{:else if !exercise.canEdit}
		<p class="refused" role="status">{m.exercise_edit_notAllowed()}</p>
		<!-- "You cannot edit this exercise. You can suggest an edit from its page." -->
		<a href={resolve('/exercises/[id]', { id: exercise.id })}>{m.exercise_edit_back()}</a>
	{:else}
		<a class="back" href={resolve('/exercises/[id]', { id: exercise.id })}
			>{m.exercise_edit_back()}</a
		>
		<!-- "← Back to the exercise" -->
		<h1>{m.exercise_edit_heading()}</h1>
		<!-- "Edit exercise" -->
		<p class="subtitle">
			{exercise.submittedByUserId === authStore.user?.id
				? m.exercise_edit_lead()
				: m.exercise_edit_leadStaff()}
		</p>

		<form class="form" onsubmit={save}>
			<h2>{m.exercise_edit_sectionText()}</h2>
			<!-- "Text" -->
			<p class="muted">{m.exercise_edit_textNote({ lang: exercise.locale.toUpperCase() })}</p>
			<!-- "The text is edited in its original language ({lang}); translations are separate." -->
			<label class="field">
				<span>{m.submit_field_title()}</span>
				<input type="text" bind:value={title} required maxlength="300" />
			</label>
			<label class="field">
				<span>{m.submit_field_statement()}</span>
				<RichEditor
					bind:this={statementEditor}
					bind:value={statement}
					rows={6}
					required={true}
					onChemEdit={(id) => statementStrip?.editChem(id)}
					onSketchEdit={(id) => statementStrip?.editSketch(id)}
				/>
			</label>
			<InsertStrip bind:this={statementStrip} editor={statementEditor} allowFiles={false} />
			<label class="field">
				<span>{m.submit_field_answer()} <em>({m.common_optional()})</em></span>
				<RichEditor
					bind:this={answerEditor}
					bind:value={answer}
					rows={3}
					onChemEdit={(id) => answerStrip?.editChem(id)}
					onSketchEdit={(id) => answerStrip?.editSketch(id)}
				/>
			</label>
			<InsertStrip bind:this={answerStrip} editor={answerEditor} allowFiles={false} />

			<section class="parts" data-parts-editor>
				<h2>{m.parts_editorHeading()}</h2>
				<!-- "Parts" -->
				<p class="muted">{m.parts_editorNote()}</p>
				<!-- "Split a set-shaped exercise into parts, each with its own statement, answer, hints and solutions. …" -->
				{#if partRows.length === 0}
					<p class="muted">{m.parts_none()}</p>
					<!-- "No parts — this exercise is one problem." -->
				{/if}
				{#each partRows as row (row.key)}
					{#if row.removed}
						<div class="part-row part-row--removed" data-part-removed={row.id}>
							<p>{m.parts_removedRow({ label: row.label })}</p>
							<!-- "Part {label} will be deleted when you save, together with its hints and solutions." -->
							<button
								type="button"
								class="small"
								onclick={() => {
									row.removed = false;
									confirmingDrop = false;
								}}>{m.parts_undo()}</button
							>
							<!-- "Undo" -->
						</div>
					{:else}
						{@const at = liveRows.indexOf(row)}
						<div class="part-row" data-part-row data-part-id={row.id ?? ''}>
							<div class="part-row__head">
								<label class="field part-row__label">
									<span>{m.parts_label()}</span>
									<!-- "Label" -->
									<input
										type="text"
										bind:value={row.label}
										required
										maxlength="20"
										placeholder={m.parts_labelHint()}
									/>
									<!-- "As it should be shown: a, 1, ii …" -->
								</label>
								<div class="part-row__tools">
									<button
										type="button"
										class="small"
										disabled={at === 0}
										onclick={() => movePart(row, -1)}
										data-part-up>{m.parts_moveUp()}</button
									>
									<!-- "Move up" -->
									<button
										type="button"
										class="small"
										disabled={at === liveRows.length - 1}
										onclick={() => movePart(row, 1)}
										data-part-down>{m.parts_moveDown()}</button
									>
									<!-- "Move down" -->
									<button
										type="button"
										class="small small--danger"
										onclick={() => removePart(row)}
										data-part-remove>{m.parts_remove()}</button
									>
									<!-- "Remove" -->
								</div>
							</div>
							<label class="field">
								<span>{m.parts_statement()}</span>
								<!-- "Statement of this part" -->
								<RichEditor
									bind:this={partEditors[`${row.key}:statement`]}
									bind:value={row.statement}
									rows={3}
									required={true}
									onChemEdit={(id) => partStrips[`${row.key}:statement`]?.editChem(id)}
									onSketchEdit={(id) => partStrips[`${row.key}:statement`]?.editSketch(id)}
								/>
							</label>
							<InsertStrip
								bind:this={partStrips[`${row.key}:statement`]}
								editor={partEditors[`${row.key}:statement`] ?? null}
								allowFiles={false}
							/>
							<label class="field">
								<span>{m.parts_answer()} <em>({m.common_optional()})</em></span>
								<!-- "Answer to this part" -->
								<RichEditor
									bind:this={partEditors[`${row.key}:answer`]}
									bind:value={row.answer}
									rows={2}
									onChemEdit={(id) => partStrips[`${row.key}:answer`]?.editChem(id)}
									onSketchEdit={(id) => partStrips[`${row.key}:answer`]?.editSketch(id)}
								/>
							</label>
							<InsertStrip
								bind:this={partStrips[`${row.key}:answer`]}
								editor={partEditors[`${row.key}:answer`] ?? null}
								allowFiles={false}
							/>
						</div>
					{/if}
				{/each}
				<button type="button" class="add-part" onclick={addPart} data-part-add>
					{m.parts_add()}
				</button>
				<!-- "Add a part" -->
			</section>

			<h2>{m.exercise_edit_sectionDetails()}</h2>
			<!-- "Details" -->
			<div class="field-row">
				<label class="field">
					<span>{m.submit_field_difficulty()}</span>
					<select bind:value={difficulty}>
						{#each DIFFICULTIES as d (d)}
							<option value={d}>{DIFFICULTY_LABELS[d]()}</option>
						{/each}
					</select>
				</label>
				<AudienceSelect bind:value={audience} />
			</div>
			<fieldset class="field topics">
				<legend>{m.submit_field_topics()}</legend>
				{#if topics.length === 0}
					<p class="muted">{m.exercise_edit_topicsNone()}</p>
					<!-- "This branch has no topics yet." -->
				{:else}
					<ul class="chip-list">
						{#each topics as topic (topic.id)}
							<li>
								<label class="chip" class:chip--on={selectedTopicIds.includes(topic.id)}>
									<input
										type="checkbox"
										checked={selectedTopicIds.includes(topic.id)}
										onchange={() => toggleTopic(topic.id)}
									/>
									{topic.name}
								</label>
							</li>
						{/each}
					</ul>
				{/if}
			</fieldset>
			<label class="field">
				<span>{m.submit_field_tags()}</span>
				<input type="text" bind:value={tagsInput} />
			</label>

			<h2>{m.exercise_edit_sectionSource()}</h2>
			<!-- "Source" -->
			<div class="field-row">
				<label class="field">
					<span>{m.submit_field_sourceType()}</span>
					<select bind:value={sourceType}>
						{#each SOURCE_TYPES as t (t)}
							<option value={t}>{SOURCE_TYPE_LABELS[t]()}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>{m.submit_field_sourceName()} <em>({m.common_optional()})</em></span>
					<input type="text" bind:value={sourceName} maxlength="300" />
				</label>
			</div>
			<div class="field-row">
				<label class="field">
					<span>{m.exercise_edit_sourceCollection()} <em>({m.common_optional()})</em></span>
					<input type="text" bind:value={sourceCollection} maxlength="200" />
				</label>
				<label class="field">
					<span>{m.exercise_edit_sourcePages()} <em>({m.common_optional()})</em></span>
					<input type="text" bind:value={sourcePages} maxlength="20" />
				</label>
				<label class="field">
					<span>{m.exercise_edit_sourceChapter()} <em>({m.common_optional()})</em></span>
					<input type="text" inputmode="numeric" bind:value={sourceChapter} />
				</label>
				<label class="field">
					<span>{m.exercise_edit_sourceNumber()} <em>({m.common_optional()})</em></span>
					<input type="text" inputmode="numeric" bind:value={sourceNumber} />
				</label>
			</div>

			{#if confirmingDrop}
				<div
					class="confirm"
					role="alertdialog"
					aria-labelledby="parts-confirm-heading"
					data-parts-confirm
				>
					<h3 id="parts-confirm-heading">{m.parts_confirmHeading()}</h3>
					<!-- "Delete parts?" -->
					<p>{m.parts_confirmLead()}</p>
					<!-- "Saving deletes these parts together with every hint and solution written for them. …" -->
					<ul>
						{#each droppedRows as row (row.key)}
							<li>
								{m.parts_confirmLine({
									label: row.label,
									hints: entryCount(row.id!, 'hint'),
									solutions: entryCount(row.id!, 'solution')
								})}
								<!-- "Part {label} — hints: {hints}, solutions: {solutions}" -->
							</li>
						{/each}
					</ul>
					<div class="actions">
						<button
							type="button"
							class="danger"
							onclick={() => void doSave()}
							data-parts-confirm-yes>{m.parts_confirmYes()}</button
						>
						<!-- "Delete and save" -->
						<button type="button" class="small" onclick={() => (confirmingDrop = false)}
							>{m.parts_confirmNo()}</button
						>
						<!-- "Go back" -->
					</div>
				</div>
			{/if}
			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}
			<div class="actions">
				<button type="submit" class="primary" disabled={saving}>
					{saving ? m.common_saving() : m.common_save()}
				</button>
				<a class="cancel" href={resolve('/exercises/[id]', { id: exercise.id })}
					>{m.common_cancel()}</a
				>
			</div>
		</form>
	{/if}
</div>

<style lang="scss">
	@use '../../../../lib/styles/mixins' as mix;

	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	h2 {
		font-size: var(--font-size-md);
		margin-top: var(--space-2);
	}
	.subtitle,
	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.back,
	.cancel {
		color: var(--accent);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.refused {
		@include mix.status-message(warning);
	}
	.error {
		@include mix.status-message(danger);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
		em {
			color: var(--text-secondary);
			font-weight: 400;
		}
	}
	legend {
		padding: 0;
		margin-bottom: var(--space-1);
	}
	.field-row {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 10rem), 1fr));
		gap: var(--space-2);
		> :global(*) {
			min-width: 0;
		}
		:global(select) {
			width: 100%;
		}
	}
	input,
	select {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font-family: inherit;
	}
	.chip-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		font-weight: 400;
		cursor: pointer;
		input {
			margin: 0;
		}
	}
	.chip--on {
		@include mix.selected-soft;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.primary {
		@include mix.button-primary;
	}
	.parts {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.part-row {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.part-row--removed {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		border-style: dashed;
	}
	.part-row__head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.part-row__label input {
		width: 10rem;
	}
	.part-row__tools {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.small {
		@include mix.button-secondary;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
	}
	.small--danger {
		color: var(--status-danger);
	}
	.add-part {
		@include mix.button-secondary;
		align-self: flex-start;
	}
	.confirm {
		@include mix.status-message(warning);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		h3 {
			font-size: var(--font-size-base);
			margin: 0;
		}
		ul {
			margin: 0;
			padding-left: var(--space-4);
		}
	}
	// The one destructive command on the page: the secondary shape in the danger hue, never a
	// filled accent box (a filled accent box is the page's own Save).
	.danger {
		@include mix.button-secondary;
		color: var(--status-danger);
		border-color: var(--status-danger);
		font-weight: 600;
	}
</style>
