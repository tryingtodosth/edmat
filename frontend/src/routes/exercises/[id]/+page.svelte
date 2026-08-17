<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Comment, Branch, ResolvedExercise, Review, Topic, User } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import {
		castExerciseRequirementVote,
		DuplicateExerciseRequirementError,
		getExerciseById,
		proposeExerciseRequirement,
		retractExerciseRequirementVote,
		setExerciseRequirements
	} from '$lib/services/exercises';
	import { getBranchById, getTopicsForBranch } from '$lib/services/taxonomy';
	import { getReviewsForExercise, submitReview } from '$lib/services/reviews';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { submitEditSuggestion } from '$lib/services/editSuggestions';
	import { submitTranslation, type TranslationDraft } from '$lib/services/translations';
	import { authStore } from '$lib/state/auth.svelte';
	import SaveToSetButton from '$lib/components/exercise/SaveToSetButton.svelte';
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
	import ReportButton from '$lib/components/shared/ReportButton.svelte';
	import TagChip from '$lib/components/shared/TagChip.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	// Reused from the material/ folder as-is — both components are already fully generic (a plain
	// label list / a vote-summary + callbacks), matching how `materials.services`'s own
	// `build_vote_summary`/`clean_requirement_labels` are reused cross-app on the backend rather
	// than duplicated; not worth a file move for this one additional caller.
	import RequirementsEditor from '$lib/components/material/RequirementsEditor.svelte';
	import CoverageVoteWidget from '$lib/components/material/CoverageVoteWidget.svelte';

	let exercise = $state<ResolvedExercise | undefined>(undefined);
	let branch = $state<Branch | undefined>(undefined);
	let topics = $state<Topic[]>([]);
	let reviews = $state<Review[]>([]);
	let comments = $state<Comment[]>([]);
	let usersById = $state<Record<string, User>>({});
	let contentLocale = $state('');
	let loading = $state(true);
	let notFound = $state(false);
	let loadFailed = $state(false);

	// "Requires" — the exact same open-propose/governor-only-bulk-edit/open-vote shape the material
	// detail page's own Requires section already establishes (routes/materials/[id]/+page.svelte),
	// applied here to Exercise for the first time. `exercise` is this page's own owned state (not a
	// shared prop the way MaterialCard's own `material` is), so requirement rows are mutated
	// directly on it — same direct-mutation convention `exercise.tags = ...` already uses below,
	// rather than porting Material's separate-overlay pattern (which exists there for a different
	// reason: MaterialCard renders a possibly-shared prop, not owned state).
	let sortedRequirements = $derived(
		[...(exercise?.requirements ?? [])].sort(
			(a, b) => b.voteSummary.netWeight - a.voteSummary.netWeight
		)
	);
	let editingRequirements = $state(false);
	let requirementsError = $state<string | null>(null);
	let proposingRequirement = $state(false);
	let newRequirementLabel = $state('');
	let proposeRequirementError = $state<string | null>(null);

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
		loadFailed = false;
		showHint = showAnswer = showSolution = showEditForm = showTranslateForm = false;
		submissionNotice = null;
		contentLocale = getLocale();

		// The whole load is guarded, deliberately: any one of the requests below throwing used to
		// leave `loading` true forever — an infinite spinner with the only evidence in the browser
		// console. Found the hard way on the live server (2026-08-17), where a permissions problem
		// made every write 500 and every logged-in exercise page spin: the SERVER bug was fixed,
		// but the page should never have presented it as an endless load in the first place.
		try {
			await loadAllInner(id);
		} catch {
			loadFailed = true;
		} finally {
			loading = false;
		}
	}

	async function loadAllInner(id: string) {
		const ex = await getExerciseById(id, contentLocale);
		if (!ex) {
			notFound = true;
			return;
		}
		exercise = ex;
		// The locale actually being SHOWN, which is not necessarily the one asked for: the API
		// resolves `?lang=` and falls back to the original when there is no translation. The picker
		// is a controlled `<select>`, so a value matching none of its options renders it blank —
		// which is what an English reader saw on every Polish-only exercise, an empty dropdown
		// beside a page that was in fact showing them Polish.
		contentLocale = ex.locale;
		// One real "view" per navigation to this page, not per content-locale switch (see
		// switchLocale below, which deliberately does NOT call this) — powers the Random Exercise
		// picker's "prefer unseen" / topic-affinity heuristics (CLAUDE.md's Random Exercise note).
		browsingHistoryStore.markSeen(ex.id, ex.topicIds);
		const [c, revs, cmts] = await Promise.all([
			getBranchById(ex.branchId),
			getReviewsForExercise(id),
			getCommentsForTarget('exercise', id)
		]);
		branch = c;
		topics = c ? await getTopicsForBranch(c.id) : [];
		reviews = revs;
		comments = cmts;

		const authorIds = [
			...(ex.submittedByUserId ? [ex.submittedByUserId] : []),
			...(ex.translatedByUserId ? [ex.translatedByUserId] : []),
			...revs.map((r) => r.userId),
			...cmts.map((c2) => c2.authorId)
		];
		await resolveUsers(authorIds);
	}

	async function switchLocale(next: string) {
		if (!exercise) return;
		contentLocale = next;
		const resolved = await getExerciseById(exercise.id, next);
		if (resolved) {
			exercise = resolved;
			// Corrected to what came back, for the same reason as above — asking for a locale is not
			// the same as getting it.
			contentLocale = resolved.locale;
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

	function applyRequirementUpdate(updated: ResolvedExercise['requirements'][number]) {
		if (!exercise) return;
		exercise.requirements = exercise.requirements.map((r) => (r.id === updated.id ? updated : r));
	}

	async function handleRequirementVote(requirementId: string, value: 1 | -1) {
		applyRequirementUpdate(await castExerciseRequirementVote(requirementId, value));
	}

	async function handleRequirementRetract(requirementId: string) {
		applyRequirementUpdate(await retractExerciseRequirementVote(requirementId));
	}

	async function handleSaveRequirements(labels: string[]) {
		if (!exercise) return;
		requirementsError = null;
		try {
			exercise = await setExerciseRequirements(exercise.id, labels);
			editingRequirements = false;
		} catch {
			requirementsError = m.exercise_requirementsSaveError();
		}
	}

	async function handleProposeRequirement() {
		if (!exercise) return;
		const label = newRequirementLabel.trim();
		if (!label) return;
		proposeRequirementError = null;
		try {
			const requirement = await proposeExerciseRequirement(exercise.id, label);
			exercise.requirements = [...exercise.requirements, requirement];
			newRequirementLabel = '';
			proposingRequirement = false;
		} catch (e) {
			proposeRequirementError =
				e instanceof DuplicateExerciseRequirementError
					? m.exercise_requirementAddDuplicate()
					: m.common_error_generic();
		}
	}

	async function handleReviewSubmit(rating: number, body: string) {
		if (!exercise || !authStore.user) return;
		const review = await submitReview(exercise.id, authStore.user.id, rating, body);
		// A real, reproducible bug: resubmitting an EXISTING review (the backend's own
		// `unique_together = [('exercise', 'author')]` upsert path, exercises/views.py's `reviews`
		// action) returns the SAME review id, not a new one. Blindly prepending it here left the old
		// entry for that id still in `reviews`, giving ReviewList.svelte's `{#each reviews as review
		// (review.id)}` two rows with the identical key — a real Svelte `each_key_duplicate`
		// exception that crashed the review list's render outright, which is exactly why the
		// resubmitted review never visibly appeared. Filtering out any existing row with the same id
		// before prepending makes an edit replace its old entry instead of duplicating it.
		reviews = [review, ...reviews.filter((r) => r.id !== review.id)];
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
</script>

<svelte:head>
	<title>{exercise?.title ?? m.common_appName()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else if loadFailed}
		<!-- A failed request is not a missing exercise: say so, and offer the retry that an
		     infinite spinner used to stand in for. -->
		<p class="empty">
			{m.exercise_loadFailed()}
			<button type="button" class="retry" onclick={() => loadAll(page.params.id!)}
				>{m.common_retry()}</button
			>
		</p>
	{:else if notFound || !exercise}
		<p class="empty">{m.exercise_notFound()}</p>
	{:else}
		{#if branch}
			<!-- "Breadcrumb" -->
			<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
				<a href={resolve('/disciplines')}>{m.common_home()}</a> ›
				<a href={resolve('/branches/[branch]', { branch: branch.id })}>{branch.name}</a>
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
				<!-- Everybody with a real account who worked on this, each linked to their profile.
				     Replaces a submitter-only line: an exercise genuinely has several contributors — whoever
				     submitted it, whoever wrote each locale's text, and whoever reviewed those — and naming
				     only the first credited most people not at all.

				     Absent entirely for the 742 imported corpus exercises, which nobody here submitted and
				     whose translations carry no account. That silence is honest: crediting somebody for a
				     row lifted from a branch archive would be inventing an author. -->
				{#if exercise.contributors.length > 0}
					<p class="contributors">
						<span class="contributors__label">{m.exercise_contributorsHeading()}</span>
						{#each exercise.contributors as contributor, index (`${contributor.id}-${contributor.role}-${contributor.locale ?? ''}`)}
							{#if index > 0}<span aria-hidden="true">·</span>{/if}
							<span class="contributors__person">
								<a class="contributors__link" href={resolve('/users/[id]', { id: contributor.id })}
									>{contributor.displayName}</a
								>
								<span class="contributors__role">
									{contributor.role === 'submitted'
										? m.exercise_role_submitted()
										: contributor.role === 'translated'
											? m.exercise_role_translated({ locale: contributor.locale ?? '' })
											: m.exercise_role_reviewed({ locale: contributor.locale ?? '' })}
								</span>
							</span>
						{/each}
					</p>
				{/if}
				<div class="exercise__toolbar">
					<LanguagePicker
						availableLocales={exercise.availableLocales}
						value={contentLocale}
						onchange={switchLocale}
					/>
					<SaveToSetButton exerciseId={exercise.id} variant="labelled" />
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
						<TagChip
							{tag}
							appliedTo={{
								kind: 'exercise',
								objectId: exercise.id,
								onRemoved: () => {
									if (exercise) exercise.tags = exercise.tags.filter((t) => t !== tag);
								}
							}}
						/>
					{/each}
				</div>
			{/if}

			<section class="content-section">
				<div class="claim-group__heading">
					<h2>{m.exercise_requiresHeading()}</h2>
					<div class="claim-group__actions">
						{#if authStore.isAuthenticated}
							<button
								type="button"
								class="add-trigger"
								onclick={() => ((proposingRequirement = true), (proposeRequirementError = null))}
							>
								+ {m.exercise_requirementAddTrigger()}
							</button>
						{/if}
						{#if authStore.canModerate}
							<button
								type="button"
								class="add-trigger"
								onclick={() => ((editingRequirements = true), (requirementsError = null))}
							>
								{m.exercise_requirementsEdit()}
							</button>
						{/if}
					</div>
				</div>
				{#if sortedRequirements.length === 0}
					<p class="status">{m.exercise_requiresEmpty()}</p>
				{:else}
					<ul class="requirement-list">
						{#each sortedRequirements as requirement (requirement.id)}
							<li class="requirement-row">
								<span class="requirement-row__label">{requirement.label}</span>
								<CoverageVoteWidget
									summary={requirement.voteSummary}
									question={m.exercise_requirementVoteQuestion}
									onVote={(value) => handleRequirementVote(requirement.id, value)}
									onRetract={() => handleRequirementRetract(requirement.id)}
								/>
								<ReportButton kind="requirement" objectId={requirement.id} />
							</li>
						{/each}
					</ul>
				{/if}
			</section>

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
				<ReportButton kind="exercise" objectId={exercise.id} />
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
				<ReviewList {reviews} {usersById} commentTarget="review" />
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

{#if proposingRequirement}
	<ModalShell
		title={m.exercise_requirementAddTrigger()}
		onClose={() => (proposingRequirement = false)}
	>
		{#if proposeRequirementError}
			<p class="add-error">{proposeRequirementError}</p>
		{/if}
		<form
			class="propose-requirement-form"
			onsubmit={(e) => (e.preventDefault(), handleProposeRequirement())}
		>
			<label class="field">
				<span class="visually-hidden">{m.exercise_requirementsAddPlaceholder()}</span>
				<input
					type="text"
					bind:value={newRequirementLabel}
					placeholder={m.exercise_requirementsAddPlaceholder()}
				/>
			</label>
			<div class="propose-requirement-form__actions">
				<button type="button" class="cancel" onclick={() => (proposingRequirement = false)}>
					{m.common_cancel()}
				</button>
				<button type="submit" class="submit" disabled={!newRequirementLabel.trim()}>
					{m.exercise_requirementsAdd()}
				</button>
			</div>
		</form>
	</ModalShell>
{/if}

{#if editingRequirements}
	<ModalShell
		title={m.exercise_requirementsModalTitle()}
		onClose={() => (editingRequirements = false)}
	>
		{#if requirementsError}
			<p class="add-error">{requirementsError}</p>
		{/if}
		<RequirementsEditor
			initial={sortedRequirements.map((r) => r.label)}
			onSubmit={handleSaveRequirements}
			onCancel={() => (editingRequirements = false)}
		/>
	</ModalShell>
{/if}

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.contributors {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.contributors__label {
		font-weight: 600;
	}
	.contributors__person {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
	}
	.contributors__role {
		opacity: 0.8;
	}

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
	.claim-group__heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.claim-group__actions {
		display: flex;
		gap: var(--space-2);
		flex-shrink: 0;
	}
	.status {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.add-trigger {
		@include mix.focus-ring;
		background: none;
		border: 1px dashed var(--border-color);
		border-radius: var(--radius-sm);
		padding: 2px var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		cursor: pointer;
		&:hover {
			color: var(--accent);
			border-color: var(--accent);
		}
	}
	.add-error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.propose-requirement-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.propose-requirement-form .field input {
		@include mix.focus-ring;
		width: 100%;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
	.propose-requirement-form__actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.propose-requirement-form__actions .cancel {
		@include mix.button-secondary;
	}
	.propose-requirement-form__actions .submit {
		@include mix.button-primary;
	}
	.requirement-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.requirement-row {
		border-bottom: 1px solid var(--border-color);
		padding-bottom: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		&:last-child {
			border-bottom: none;
			padding-bottom: 0;
		}
	}
	.requirement-row__label {
		font-weight: 600;
		font-size: var(--font-size-sm);
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
	.retry {
		margin-left: var(--space-1);
		padding: 0.15rem 0.6rem;
		font-size: inherit;
		color: var(--text-primary);
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.retry:hover {
		background: var(--bg-surface-alt);
	}

	.loading,
	.empty {
		color: var(--text-secondary);
	}
</style>
