<script lang="ts">
	import type {
		Course,
		EditSuggestion,
		ExerciseSubmission,
		ExerciseTranslation,
		User
	} from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import {
		getModerationQueue,
		decideEditSuggestion,
		decideExerciseSubmission,
		decideTranslation
	} from '$lib/services/moderation';
	import { getUserById } from '$lib/services/users';
	import { getCourseById } from '$lib/services/taxonomy';
	import { getExerciseById } from '$lib/services/exercises';
	import { authStore } from '$lib/state/auth.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';

	let tab = $state<'submissions' | 'edits' | 'translations'>('submissions');
	let submissions = $state<ExerciseSubmission[]>([]);
	let editSuggestions = $state<EditSuggestion[]>([]);
	let translations = $state<ExerciseTranslation[]>([]);
	let usersById = $state<Record<string, User>>({});
	let coursesById = $state<Record<string, Course>>({});
	let exerciseTitles = $state<Record<string, string>>({});
	let notes = $state<Record<string, string>>({});
	let loading = $state(true);

	async function load() {
		loading = true;
		const queue = await getModerationQueue();
		submissions = queue.exerciseSubmissions;
		editSuggestions = queue.editSuggestions;
		translations = queue.translations;

		const userIds = [
			...submissions.map((s) => s.submittedByUserId),
			...editSuggestions.map((e) => e.submittedByUserId),
			...translations.map((t) => t.translatedByUserId).filter((id): id is string => Boolean(id))
		];
		const users = await Promise.all([...new Set(userIds)].map((id) => getUserById(id)));
		const uMap: Record<string, User> = {};
		for (const u of users) if (u) uMap[u.id] = u;
		usersById = uMap;

		const courseIds = [...new Set(submissions.map((s) => s.courseId))];
		const courses = await Promise.all(courseIds.map((id) => getCourseById(id)));
		const cMap: Record<string, Course> = {};
		for (const c of courses) if (c) cMap[c.id] = c;
		coursesById = cMap;

		const exerciseIds = [
			...new Set([
				...editSuggestions.map((e) => e.exerciseId),
				...translations.map((t) => t.exerciseId)
			])
		];
		const exs = await Promise.all(exerciseIds.map((id) => getExerciseById(id, 'pl')));
		const titles: Record<string, string> = {};
		for (const e of exs) if (e) titles[e.id] = e.title;
		exerciseTitles = titles;

		loading = false;
	}

	$effect(() => {
		if (authStore.isModerator) load();
	});

	async function approveSubmission(s: ExerciseSubmission) {
		if (!authStore.user) return;
		await decideExerciseSubmission(s.id, 'approved', authStore.user.id, notes[s.id]);
		await load();
	}
	async function rejectSubmission(s: ExerciseSubmission) {
		if (!authStore.user) return;
		await decideExerciseSubmission(s.id, 'rejected', authStore.user.id, notes[s.id]);
		await load();
	}
	async function approveEdit(e: EditSuggestion) {
		if (!authStore.user) return;
		await decideEditSuggestion(e.id, 'approved', authStore.user.id, notes[e.id]);
		await load();
	}
	async function rejectEdit(e: EditSuggestion) {
		if (!authStore.user) return;
		await decideEditSuggestion(e.id, 'rejected', authStore.user.id, notes[e.id]);
		await load();
	}
	async function approveTranslation(t: ExerciseTranslation) {
		if (!authStore.user) return;
		await decideTranslation(t.id, 'approved', authStore.user.id, notes[t.id]);
		await load();
	}
	async function rejectTranslation(t: ExerciseTranslation) {
		if (!authStore.user) return;
		await decideTranslation(t.id, 'rejected', authStore.user.id, notes[t.id]);
		await load();
	}
</script>

<svelte:head>
	<title>{m.moderation_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.moderation_heading()}</h1>
	<p class="subtitle">{m.moderation_subtitle()}</p>

	{#if !authStore.isModerator}
		<p class="denied">{m.moderation_accessDenied()}</p>
	{:else if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else}
		<div class="tabs" role="tablist">
			<button
				type="button"
				class:active={tab === 'submissions'}
				onclick={() => (tab = 'submissions')}
			>
				{m.moderation_tab_submissions({ count: submissions.length })}
			</button>
			<button type="button" class:active={tab === 'edits'} onclick={() => (tab = 'edits')}>
				{m.moderation_tab_edits({ count: editSuggestions.length })}
			</button>
			<button
				type="button"
				class:active={tab === 'translations'}
				onclick={() => (tab = 'translations')}
			>
				{m.moderation_tab_translations({ count: translations.length })}
			</button>
		</div>

		{#if tab === 'submissions'}
			{#if submissions.length === 0}
				<p class="empty">{m.moderation_empty()}</p>
			{:else}
				<ul class="queue">
					{#each submissions as s (s.id)}
						<li class="queue-item">
							<h3><MathTitle text={s.draft.title} /></h3>
							<p class="meta">
								{m.moderation_submittedBy({
									name: usersById[s.submittedByUserId]?.displayName ?? '—'
								})}
								{m.moderation_forCourse({ course: coursesById[s.courseId]?.name ?? s.courseId })}
							</p>
							<p class="excerpt">{s.draft.statement.replace(/<[^>]+>/g, '').slice(0, 200)}</p>
							<textarea rows="1" placeholder={m.moderation_reviewNote()} bind:value={notes[s.id]}
							></textarea>
							<div class="actions">
								<button type="button" class="approve" onclick={() => approveSubmission(s)}
									>{m.moderation_approve()}</button
								>
								<button type="button" class="reject" onclick={() => rejectSubmission(s)}
									>{m.moderation_reject()}</button
								>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if tab === 'edits'}
			{#if editSuggestions.length === 0}
				<p class="empty">{m.moderation_empty()}</p>
			{:else}
				<ul class="queue">
					{#each editSuggestions as e (e.id)}
						<li class="queue-item">
							<h3>{e.field} — <MathTitle text={exerciseTitles[e.exerciseId] ?? e.exerciseId} /></h3>
							<p class="meta">
								{m.moderation_submittedBy({
									name: usersById[e.submittedByUserId]?.displayName ?? '—'
								})}
							</p>
							<p class="excerpt">{e.proposedValue.replace(/<[^>]+>/g, '').slice(0, 200)}</p>
							{#if e.reason}
								<p class="reason">“{e.reason}”</p>
							{/if}
							<textarea rows="1" placeholder={m.moderation_reviewNote()} bind:value={notes[e.id]}
							></textarea>
							<div class="actions">
								<button type="button" class="approve" onclick={() => approveEdit(e)}
									>{m.moderation_approve()}</button
								>
								<button type="button" class="reject" onclick={() => rejectEdit(e)}
									>{m.moderation_reject()}</button
								>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if translations.length === 0}
			<p class="empty">{m.moderation_empty()}</p>
		{:else}
			<ul class="queue">
				{#each translations as t (t.id)}
					<li class="queue-item">
						<h3>
							{t.locale.toUpperCase()} — <MathTitle
								text={exerciseTitles[t.exerciseId] ?? t.exerciseId}
							/>
						</h3>
						<p class="meta">
							{m.moderation_submittedBy({
								name: t.translatedByUserId
									? (usersById[t.translatedByUserId]?.displayName ?? '—')
									: '—'
							})}
						</p>
						<p class="excerpt"><MathTitle text={t.title} /></p>
						<textarea rows="1" placeholder={m.moderation_reviewNote()} bind:value={notes[t.id]}
						></textarea>
						<div class="actions">
							<button type="button" class="approve" onclick={() => approveTranslation(t)}
								>{m.moderation_approve()}</button
							>
							<button type="button" class="reject" onclick={() => rejectTranslation(t)}
								>{m.moderation_reject()}</button
							>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
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
	.subtitle {
		color: var(--text-secondary);
	}
	.denied,
	.loading,
	.empty {
		color: var(--text-secondary);
	}
	.tabs {
		display: flex;
		gap: var(--space-2);
		border-bottom: 1px solid var(--border-color);
	}
	.tabs button {
		background: none;
		border: none;
		padding: var(--space-2) var(--space-1);
		font-weight: 600;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tabs button.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
	.queue {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.queue-item {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.queue-item h3 {
		font-size: var(--font-size-base);
	}
	.meta {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.excerpt {
		font-size: var(--font-size-sm);
	}
	.reason {
		font-size: var(--font-size-xs);
		font-style: italic;
		color: var(--text-secondary);
	}
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font-family: inherit;
		resize: vertical;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.approve {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		border: 1px solid var(--status-success);
		cursor: pointer;
	}
	.reject {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		border: 1px solid var(--status-danger);
		cursor: pointer;
	}
</style>
