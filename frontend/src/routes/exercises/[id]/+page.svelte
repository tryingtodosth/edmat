<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Comment, Course, ResolvedExercise, Review, Topic, User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { getExerciseById } from '$lib/services/exercises';
	import { getCourseById, getTopicsForCourse } from '$lib/services/taxonomy';
	import { getReviewsForExercise, submitReview } from '$lib/services/reviews';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { submitEditSuggestion } from '$lib/services/editSuggestions';
	import { submitTranslation, type TranslationDraft } from '$lib/services/translations';
	import { authStore } from '$lib/state/auth.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import { browsingHistoryStore } from '$lib/state/browsingHistory.svelte';
	import DifficultyBadge from '$lib/components/shared/DifficultyBadge.svelte';
	import SourceTypeBadge from '$lib/components/shared/SourceTypeBadge.svelte';
	import VerifiedBadge from '$lib/components/shared/VerifiedBadge.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';
	import LanguagePicker from '$lib/components/exercise/LanguagePicker.svelte';
	import TranslationBadge from '$lib/components/exercise/TranslationBadge.svelte';
	import ReviewList from '$lib/components/review/ReviewList.svelte';
	import ReviewForm from '$lib/components/review/ReviewForm.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';
	import EditSuggestionForm from '$lib/components/submission/EditSuggestionForm.svelte';
	import TranslateForm from '$lib/components/submission/TranslateForm.svelte';

	let exercise = $state<ResolvedExercise | undefined>(undefined);
	let course = $state<Course | undefined>(undefined);
	let topics = $state<Topic[]>([]);
	let reviews = $state<Review[]>([]);
	let comments = $state<Comment[]>([]);
	let usersById = $state<Record<string, User>>({});
	let contentLocale = $state('');
	let loading = $state(true);
	let notFound = $state(false);

	let showHint = $state(false);
	let showAnswer = $state(false);
	let showSolution = $state(false);
	let showEditForm = $state(false);
	let showTranslateForm = $state(false);
	let submissionNotice = $state<'review' | 'comment' | 'edit' | 'translation' | null>(null);

	async function resolveUsers(ids: string[]) {
		const unique = [...new Set(ids)].filter((id) => !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const u of found) if (u) next[u.id] = u;
		usersById = next;
	}

	async function loadAll(id: string) {
		loading = true;
		notFound = false;
		showHint = showAnswer = showSolution = showEditForm = showTranslateForm = false;
		submissionNotice = null;
		contentLocale = getLocale();

		const ex = await getExerciseById(id, contentLocale);
		if (!ex) {
			notFound = true;
			loading = false;
			return;
		}
		exercise = ex;
		// One real "view" per navigation to this page, not per content-locale switch (see
		// switchLocale below, which deliberately does NOT call this) — powers the Random Exercise
		// picker's "prefer unseen" / topic-affinity heuristics (CLAUDE.md's Random Exercise note).
		browsingHistoryStore.markSeen(ex.id, ex.topicIds);
		const [c, revs, cmts] = await Promise.all([
			getCourseById(ex.courseId),
			getReviewsForExercise(id),
			getCommentsForTarget('exercise', id)
		]);
		course = c;
		topics = c ? await getTopicsForCourse(c.id) : [];
		reviews = revs;
		comments = cmts;

		const authorIds = [
			...(ex.submittedByUserId ? [ex.submittedByUserId] : []),
			...(ex.translatedByUserId ? [ex.translatedByUserId] : []),
			...revs.map((r) => r.userId),
			...cmts.map((c2) => c2.authorId)
		];
		await resolveUsers(authorIds);
		loading = false;
	}

	async function switchLocale(next: string) {
		if (!exercise) return;
		contentLocale = next;
		const resolved = await getExerciseById(exercise.id, next);
		if (resolved) {
			exercise = resolved;
			if (resolved.translatedByUserId) await resolveUsers([resolved.translatedByUserId]);
		}
	}

	// A real, found-and-fixed bug: `$effect(() => loadAll(page.params.id!))` re-fires spuriously
	// (confirmed live — it re-ran even with no navigation at all, immediately after switchLocale's
	// own state writes), each time resetting contentLocale back to the interface locale and
	// silently undoing a just-picked content-language switch. Guarding on the id ACTUALLY changing
	// makes the effect idempotent regardless of how many times it re-fires — the reload only ever
	// happens on a genuine navigation to a different exercise, never as a side effect of unrelated
	// state changes on this same page.
	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		loadAll(id);
	});

	function topicName(topicId: string): string {
		return topics.find((t) => t.id === topicId)?.name ?? topicId;
	}

	async function handleReviewSubmit(rating: number, body: string) {
		if (!exercise || !authStore.user) return;
		const review = await submitReview(exercise.id, authStore.user.id, rating, body);
		reviews = [review, ...reviews];
		await resolveUsers([review.userId]);
		submissionNotice = 'review';
	}

	async function handleCommentSubmit(body: string, parentId?: string) {
		if (!exercise || !authStore.user) return;
		const comment = await submitComment('exercise', exercise.id, authStore.user.id, body, parentId);
		comments = [...comments, comment];
	}

	async function handleEditSuggestion(
		field: 'title' | 'statement' | 'hint' | 'answer' | 'solution',
		proposedValue: string,
		reason: string
	) {
		if (!exercise || !authStore.user) return;
		await submitEditSuggestion(
			exercise.id,
			exercise.locale,
			field,
			proposedValue,
			authStore.user.id,
			reason
		);
		showEditForm = false;
		submissionNotice = 'edit';
	}

	async function handleTranslationSubmit(draft: TranslationDraft) {
		if (!exercise || !authStore.user) return;
		await submitTranslation(exercise.id, authStore.user.id, draft);
		showTranslateForm = false;
		submissionNotice = 'translation';
	}

	let inSet = $derived(exercise ? guestSetStore.has(exercise.id) : false);
</script>

<svelte:head>
	<title>{exercise?.title ?? m.common_appName()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else if notFound || !exercise}
		<p class="empty">{m.exercise_notFound()}</p>
	{:else}
		{#if course}
			<nav class="breadcrumb">
				<a href={resolve('/fields')}>{m.common_home()}</a> ›
				<a href={resolve('/courses/[course]', { course: course.id })}>{course.name}</a>
			</nav>
		{/if}

		<article class="exercise">
			<header class="exercise__header">
				<div class="exercise__title-row">
					<span class="number">{m.exercise_number({ number: exercise.number })}</span>
					<h1><MathTitle text={exercise.title} /></h1>
				</div>
				<div class="exercise__badges">
					<DifficultyBadge difficulty={exercise.difficulty} />
					<SourceTypeBadge sourceType={exercise.source.type} />
					<VerifiedBadge verified={exercise.verified} />
					<TranslationBadge
						isOriginal={exercise.isOriginal}
						translatorName={exercise.translatedByUserId
							? usersById[exercise.translatedByUserId]?.displayName
							: undefined}
					/>
				</div>
				<div class="exercise__toolbar">
					<LanguagePicker
						availableLocales={exercise.availableLocales}
						value={contentLocale}
						onchange={switchLocale}
					/>
					<button
						type="button"
						class="set-button"
						class:set-button--active={inSet}
						onclick={() => guestSetStore.toggle(exercise!.id)}
					>
						{inSet ? m.exercise_removeFromSet() : m.exercise_addToSet()}
					</button>
				</div>
			</header>

			{#if topics.length && exercise.topicIds.length}
				<div class="topics">
					<span class="label">{m.exercise_topics()}:</span>
					{#each exercise.topicIds as topicId (topicId)}
						<span class="topic-pill">{topicName(topicId)}</span>
					{/each}
				</div>
			{/if}

			<section class="content-section">
				<h2>{m.exercise_statement()}</h2>
				<MathContent source={exercise.statement} />
			</section>

			{#if exercise.hint}
				<section class="content-section">
					<button type="button" class="reveal-toggle" onclick={() => (showHint = !showHint)}>
						{showHint ? m.exercise_hideHint() : m.exercise_showHint()}
					</button>
					{#if showHint}
						<MathContent source={exercise.hint} />
					{/if}
				</section>
			{/if}

			{#if exercise.answer}
				<section class="content-section">
					<button type="button" class="reveal-toggle" onclick={() => (showAnswer = !showAnswer)}>
						{showAnswer ? m.exercise_hideAnswer() : m.exercise_showAnswer()}
					</button>
					{#if showAnswer}
						<MathContent source={exercise.answer} />
					{/if}
				</section>
			{/if}

			{#if exercise.solution}
				<section class="content-section">
					<button
						type="button"
						class="reveal-toggle"
						onclick={() => (showSolution = !showSolution)}
					>
						{showSolution ? m.exercise_hideSolution() : m.exercise_showSolution()}
					</button>
					{#if showSolution}
						{#if !exercise.answer}
							<p class="hint-note">{m.exercise_noAnswerNote()}</p>
						{/if}
						<MathContent source={exercise.solution} />
					{/if}
				</section>
			{/if}

			<section class="content-section">
				<h2>{m.exercise_source()}</h2>
				<p class="source-line">
					{#if exercise.source.name}
						{exercise.source.name}
					{:else}
						{m.exercise_sourceUnknown()}
					{/if}
					{#if exercise.source.pages}
						· p. {exercise.source.pages}
					{/if}
				</p>
			</section>

			{#if exercise.tags.length}
				<div class="topics">
					<span class="label">{m.exercise_tags()}:</span>
					{#each exercise.tags as tag (tag)}
						<span class="topic-pill topic-pill--tag">#{tag}</span>
					{/each}
				</div>
			{/if}

			<section class="actions no-print">
				{#if authStore.isAuthenticated}
					<button type="button" class="link-button" onclick={() => (showEditForm = !showEditForm)}>
						{m.exercise_suggestEdit()}
					</button>
					<button
						type="button"
						class="link-button"
						onclick={() => (showTranslateForm = !showTranslateForm)}
					>
						{m.exercise_suggestTranslation()}
					</button>
				{/if}
			</section>

			{#if submissionNotice === 'edit'}
				<p class="notice">{m.editSuggestion_success()}</p>
			{/if}
			{#if submissionNotice === 'translation'}
				<p class="notice">{m.translate_success()}</p>
			{/if}

			{#if showEditForm}
				<EditSuggestionForm
					currentValues={{
						title: exercise.title,
						statement: exercise.statement,
						hint: exercise.hint,
						answer: exercise.answer,
						solution: exercise.solution
					}}
					onSubmit={handleEditSuggestion}
					onCancel={() => (showEditForm = false)}
				/>
			{/if}

			{#if showTranslateForm}
				<TranslateForm
					sourceValues={{
						title: exercise.title,
						statement: exercise.statement,
						hint: exercise.hint,
						answer: exercise.answer,
						solution: exercise.solution
					}}
					onSubmit={handleTranslationSubmit}
					onCancel={() => (showTranslateForm = false)}
				/>
			{/if}

			<section class="content-section">
				<h2>{m.review_heading()}</h2>
				{#if reviews.length > 0}
					<p class="review-summary">
						{m.review_average({
							average:
								Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10,
							count: reviews.length
						})}
					</p>
				{/if}
				<ReviewList {reviews} {usersById} />
				{#if authStore.isAuthenticated}
					{#if submissionNotice === 'review'}
						<p class="notice">{m.review_thanks()}</p>
					{/if}
					<ReviewForm onSubmit={handleReviewSubmit} />
				{:else}
					<p class="login-prompt"><a href={resolve('/login')}>{m.review_loginToReview()}</a></p>
				{/if}
			</section>

			<section class="content-section">
				<h2>{m.discussion_heading()}</h2>
				<DiscussionThread {comments} {usersById} onSubmit={handleCommentSubmit} />
			</section>
		</article>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		margin-bottom: var(--space-3);
		a {
			color: var(--accent);
		}
	}
	.exercise {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.exercise__header {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.exercise__title-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.number {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.exercise__badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: center;
	}
	.exercise__toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.set-button {
		@include mix.button-secondary;
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
		&--active {
			background: var(--accent);
			color: var(--accent-contrast);
			border-color: var(--accent);
		}
	}
	.topics {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: center;
		font-size: var(--font-size-xs);
	}
	.label {
		color: var(--text-secondary);
		font-weight: 600;
	}
	.topic-pill {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
	.topic-pill--tag {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
	.content-section {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.content-section h2 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.reveal-toggle {
		@include mix.button-secondary;
		align-self: flex-start;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-3);
	}
	.hint-note {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-style: italic;
	}
	.source-line {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		gap: var(--space-4);
	}
	.link-button {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--accent);
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
	.review-summary {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.login-prompt {
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.loading,
	.empty {
		color: var(--text-secondary);
	}
</style>
