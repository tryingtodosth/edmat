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
	import { DIFFICULTY_LABELS, SOURCE_TYPE_LABELS } from '$lib/utils/labels';
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
				return detail;
		}
	}

	function firstDetail(body: unknown): string {
		if (!body || typeof body !== 'object') return '';
		for (const value of Object.values(body as Record<string, unknown>)) {
			if (typeof value === 'string') return value;
			if (Array.isArray(value) && value.length) return String(value[0]);
		}
		return '';
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!exercise || saving) return;
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
					}
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
</style>
