<script lang="ts">
	import type {
		Course,
		EditSuggestion,
		ExerciseSubmission,
		ExerciseTranslation,
		ReportGroup,
		User
	} from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import {
		getModerationQueue,
		decideEditSuggestion,
		decideExerciseSubmission,
		decideTranslation,
		resolveReport
	} from '$lib/services/moderation';
	import { getUserById } from '$lib/services/users';
	import { getCourseById } from '$lib/services/taxonomy';
	import { getExerciseById } from '$lib/services/exercises';
	import { authStore } from '$lib/state/auth.svelte';
	import { resolve } from '$app/paths';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';

	// "reports" first — this is the literal "gets a priority in the moderation queue" requirement:
	// reported content (some of it possibly already auto-hidden, waiting on a decision) is the
	// first thing a moderator opening this page sees, not the last tab they'd have to click to.
	let tab = $state<'reports' | 'submissions' | 'edits' | 'translations'>('reports');
	let reports = $state<ReportGroup[]>([]);
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
		reports = queue.reports;
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

	// `kind:objectId` — a report group has no single numeric id of its own (it's a GROUP of every
	// pending Report row against one target, moderation/services.py's build_report_queue), so the
	// composite key both identifies a `notes[...]` entry and is what gets passed straight through
	// to resolveReport's own (kind, objectId) pair.
	function reportKey(r: ReportGroup): string {
		return `${r.kind}:${r.objectId}`;
	}

	const REPORT_KIND_LABELS: Record<ReportGroup['kind'], () => string> = {
		exercise: m.report_kind_exercise,
		comment: m.report_kind_comment,
		review: m.report_kind_review
	};

	async function restoreReport(r: ReportGroup) {
		reports = await resolveReport(r.kind, r.objectId, 'restore', notes[reportKey(r)]);
	}

	async function removeReport(r: ReportGroup) {
		reports = await resolveReport(r.kind, r.objectId, 'remove', notes[reportKey(r)]);
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
			<button type="button" class:active={tab === 'reports'} onclick={() => (tab = 'reports')}>
				{m.moderation_tab_reports({ count: reports.length })}
			</button>
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

		{#if tab === 'reports'}
			{#if reports.length === 0}
				<p class="empty">{m.moderation_empty()}</p>
			{:else}
				<ul class="queue">
					{#each reports as r (reportKey(r))}
						<li class="queue-item" class:queue-item--urgent={r.isAutoHidden}>
							<div class="report-header">
								<span class="report-kind">{REPORT_KIND_LABELS[r.kind]()}</span>
								{#if r.isAutoHidden}
									<span class="hidden-badge">{m.moderation_alreadyHidden()}</span>
								{/if}
							</div>
							<h3><MathTitle text={r.preview} /></h3>
							<p class="meta">
								{m.moderation_reportStats({
									count: r.reportCount,
									percent: r.percentReported ?? 0
								})}
								{#if r.exerciseTitle && r.kind !== 'exercise'}
									· {m.moderation_forExercise({ exercise: r.exerciseTitle })}
								{/if}
							</p>
							{#if r.exerciseId}
								<a
									class="context-link"
									href={resolve('/exercises/[id]', { id: r.exerciseId })}
									target="_blank"
									rel="noopener noreferrer"
								>
									{m.moderation_viewInContext()}
								</a>
							{/if}
							{#if r.reasons.length > 0}
								<ul class="reasons-list">
									{#each r.reasons as reason, i (i)}
										<li class="reason">"{reason}"</li>
									{/each}
								</ul>
							{/if}
							<textarea
								rows="1"
								placeholder={m.moderation_reviewNote()}
								bind:value={notes[reportKey(r)]}></textarea>
							<div class="actions">
								<button type="button" class="approve" onclick={() => restoreReport(r)}>
									{m.moderation_restore()}
								</button>
								<button type="button" class="reject" onclick={() => removeReport(r)}>
									{m.moderation_remove()}
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if tab === 'submissions'}
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
	// A visual priority signal, not just the sort order — an already-hidden item is genuinely more
	// urgent (it's live-hidden right now) than one that's merely pending review.
	.queue-item--urgent {
		border-color: var(--status-danger);
	}
	.queue-item h3 {
		font-size: var(--font-size-base);
	}
	.report-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.report-kind {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.hidden-badge {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.context-link {
		align-self: flex-start;
		font-size: var(--font-size-xs);
		color: var(--accent);
		font-weight: 600;
	}
	.reasons-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
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
