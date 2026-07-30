<script lang="ts">
	// The material detail page — the RICH view MaterialCard.svelte deliberately no longer is (that
	// component was rewritten to a compact grid/list summary only, see its own doc comment for why:
	// a material with dozens of coverage claims used to flood every card in a grid with inline
	// badges). Everything interactive a material actually has now lives HERE instead: the full,
	// vote-sortable "Covers"/"Requires" groups (each claim type independently votable — "split
	// material tags into two groups... each votable, so users can sort by that"), a whole-material
	// discussion thread, and star reviews — the same "compact card, rich detail page" split
	// ServiceCard/the tutoring-listing detail page already establish for a different content type.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type {
		Comment,
		Course,
		Field,
		Material,
		MaterialCoverage,
		MaterialReview,
		Topic,
		User
	} from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import {
		castRequirementVote,
		DuplicateCoverageError,
		DuplicateRequirementError,
		getMaterialById,
		getMaterialReviews,
		proposeCoverage,
		proposeRequirement,
		retractRequirementVote,
		setMaterialRequirements,
		submitMaterialReview
	} from '$lib/services/materials';
	import { getCourseById, getFieldById, getTopicsForCourse } from '$lib/services/taxonomy';
	import { getCommentsForTarget, submitComment } from '$lib/services/comments';
	import { getUserById } from '$lib/services/users';
	import { authStore } from '$lib/state/auth.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';
	import CoverageBadge from '$lib/components/material/CoverageBadge.svelte';
	import CoveragePopover from '$lib/components/material/CoveragePopover.svelte';
	import AddCoverageForm from '$lib/components/material/AddCoverageForm.svelte';
	import RequirementsEditor from '$lib/components/material/RequirementsEditor.svelte';
	import CoverageVoteWidget from '$lib/components/material/CoverageVoteWidget.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import ReportButton from '$lib/components/shared/ReportButton.svelte';
	import ReviewList from '$lib/components/review/ReviewList.svelte';
	import ReviewForm from '$lib/components/review/ReviewForm.svelte';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';

	let material = $state<Material | undefined>(undefined);
	let course = $state<Course | undefined>(undefined);
	let field = $state<Field | undefined>(undefined);
	let topics = $state<Topic[]>([]);
	let loading = $state(true);
	let notFound = $state(false);

	let comments = $state<Comment[]>([]);
	let reviews = $state<MaterialReview[]>([]);
	let usersById = $state<Record<string, User>>({});
	let submissionNotice = $state<'review' | null>(null);

	// Coverage — proposing a brand-new claim is open to any authenticated user (materials/models.py's
	// MaterialCoverage doc comment: a community-verified peer-review signal, not moderator-gated).
	let coverageOverlay = $state<MaterialCoverage[]>([]);
	let allCoverage = $derived([...(material?.coverage ?? []), ...coverageOverlay]);
	let sortedCoverage = $derived(
		[...allCoverage].sort((a, b) => b.voteSummary.netWeight - a.voteSummary.netWeight)
	);
	let openCoverageId = $state<string | null>(null);
	let openCoverage = $derived(allCoverage.find((c) => c.id === openCoverageId) ?? null);
	let addingCoverage = $state(false);
	let addError = $state<string | null>(null);

	// Requirements — a real, found gap: proposing a brand-new one used to be governor-only end to
	// end, same as bulk-reordering/removing — an ordinary user had NO way to add one at all, unlike
	// `coverage`'s own "anyone can propose" openness. `propose_requirement` (backend) opened just
	// the PROPOSE half to any authenticated user; bulk reorder/removal (`editingRequirements` below)
	// stays governor-only, materials/views.py's own `requirements` action doc comment.
	let requirementsOverlay = $state<Material['requirements'] | null>(null);
	let sortedRequirements = $derived(
		[...(requirementsOverlay ?? material?.requirements ?? [])].sort(
			(a, b) => b.voteSummary.netWeight - a.voteSummary.netWeight
		)
	);
	let editingRequirements = $state(false);
	let requirementsError = $state<string | null>(null);
	let proposingRequirement = $state(false);
	let newRequirementLabel = $state('');
	let proposeRequirementError = $state<string | null>(null);

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
		coverageOverlay = [];
		requirementsOverlay = null;
		submissionNotice = null;

		const mat = await getMaterialById(id);
		if (!mat) {
			notFound = true;
			loading = false;
			return;
		}
		material = mat;

		const [c, cmts, revs] = await Promise.all([
			getCourseById(mat.courseId),
			getCommentsForTarget('material', id),
			getMaterialReviews(id)
		]);
		course = c;
		const [f, t] = await Promise.all([
			c ? getFieldById(c.fieldId) : Promise.resolve(undefined),
			c ? getTopicsForCourse(c.id) : Promise.resolve([])
		]);
		field = f;
		topics = t;
		comments = cmts;
		reviews = revs;

		await resolveUsers([...cmts.map((cm) => cm.authorId), ...revs.map((r) => r.userId)]);
		loading = false;
	}

	// Same id-changed idempotency guard the exercise detail page already established.
	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		loadAll(id);
	});

	function slugify(name: string): string {
		return name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/(^-|-$)/g, '');
	}

	async function handleProposeCoverage(input: {
		topicId: string;
		subtopicName: string;
		level: number;
	}) {
		if (!material) return;
		addError = null;
		try {
			const coverage = await proposeCoverage(material.id, {
				topicId: input.topicId,
				level: input.level,
				...(input.subtopicName
					? { subtopicSlug: slugify(input.subtopicName), subtopicName: input.subtopicName }
					: {})
			});
			coverageOverlay = [...coverageOverlay, coverage];
			addingCoverage = false;
		} catch (e) {
			addError =
				e instanceof DuplicateCoverageError ? m.coverage_addDuplicate() : m.common_error_generic();
		}
	}

	function applyCoverageUpdate(updated: MaterialCoverage) {
		if (material) {
			material.coverage = material.coverage.map((c) => (c.id === updated.id ? updated : c));
		}
		coverageOverlay = coverageOverlay.map((c) => (c.id === updated.id ? updated : c));
	}

	async function handleRequirementVote(requirementId: string, value: 1 | -1) {
		const updated = await castRequirementVote(requirementId, value);
		applyRequirementUpdate(updated);
	}

	async function handleRequirementRetract(requirementId: string) {
		const updated = await retractRequirementVote(requirementId);
		applyRequirementUpdate(updated);
	}

	function applyRequirementUpdate(updated: Material['requirements'][number]) {
		const base = requirementsOverlay ?? material?.requirements ?? [];
		requirementsOverlay = base.map((r) => (r.id === updated.id ? updated : r));
	}

	async function handleSaveRequirements(labels: string[]) {
		if (!material) return;
		requirementsError = null;
		try {
			const updated = await setMaterialRequirements(material.id, labels);
			requirementsOverlay = updated.requirements;
			editingRequirements = false;
		} catch {
			requirementsError = m.material_requirementsSaveError();
		}
	}

	async function handleProposeRequirement() {
		if (!material) return;
		const label = newRequirementLabel.trim();
		if (!label) return;
		proposeRequirementError = null;
		try {
			const requirement = await proposeRequirement(material.id, label);
			const base = requirementsOverlay ?? material.requirements;
			requirementsOverlay = [...base, requirement];
			newRequirementLabel = '';
			proposingRequirement = false;
		} catch (e) {
			proposeRequirementError =
				e instanceof DuplicateRequirementError
					? m.material_requirementAddDuplicate()
					: m.common_error_generic();
		}
	}

	async function handleReviewSubmit(rating: number, body: string) {
		if (!material || !authStore.user) return;
		const review = await submitMaterialReview(material.id, authStore.user.id, rating, body);
		// Resubmitting an existing review returns the SAME id (unique_together = [('material',
		// 'author')]) — filter out any existing row with that id before prepending, the same fix the
		// exercise/service detail pages already needed for the identical upsert-on-resubmit shape.
		reviews = [review, ...reviews.filter((r) => r.id !== review.id)];
		await resolveUsers([review.userId]);
		submissionNotice = 'review';
		const refreshed = await getMaterialById(material.id);
		if (refreshed) material = refreshed;
	}

	async function handleCommentSubmit(body: string, parentId?: string) {
		if (!material || !authStore.user) return;
		const comment = await submitComment('material', material.id, authStore.user.id, body, parentId);
		comments = [...comments, comment];
	}
</script>

<svelte:head>
	<title>{material ? material.title : m.material_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else if notFound || !material}
		<p class="empty">{m.material_notFound()}</p>
	{:else}
		<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
			<a href={resolve('/fields')}>{m.common_home()}</a> ›
			{#if field}
				<a href={resolve('/fields/[field]', { field: field.id })}>{field.name}</a> ›
			{/if}
			{#if course}
				<a href={resolve('/courses/[course]', { course: course.id })}>{course.name}</a>
			{/if}
		</nav>

		<MaterialCard {material} linkTitle={false} />
		<ReportButton kind="material" objectId={material.id} />

		<section class="claim-group">
			<div class="claim-group__heading">
				<h2>{m.material_coversHeading()}</h2>
				{#if authStore.isAuthenticated && topics.length > 0}
					<button
						type="button"
						class="add-trigger"
						onclick={() => ((addingCoverage = true), (addError = null))}
					>
						+ {m.coverage_addTrigger()}
					</button>
				{/if}
			</div>
			{#if sortedCoverage.length === 0}
				<p class="status">{m.material_coversEmpty()}</p>
			{:else}
				<div class="claim-group__badges">
					{#each sortedCoverage as coverage (coverage.id)}
						<CoverageBadge {coverage} onclick={() => (openCoverageId = coverage.id)} />
					{/each}
				</div>
			{/if}
		</section>

		<section class="claim-group">
			<div class="claim-group__heading">
				<h2>{m.material_requiresHeading()}</h2>
				<div class="claim-group__actions">
					{#if authStore.isAuthenticated}
						<button
							type="button"
							class="add-trigger"
							onclick={() => ((proposingRequirement = true), (proposeRequirementError = null))}
						>
							+ {m.material_requirementAddTrigger()}
						</button>
					{/if}
					{#if authStore.canModerate}
						<button
							type="button"
							class="add-trigger"
							onclick={() => ((editingRequirements = true), (requirementsError = null))}
						>
							{m.material_requirementsEdit()}
						</button>
					{/if}
				</div>
			</div>
			{#if sortedRequirements.length === 0}
				<p class="status">{m.material_requiresEmpty()}</p>
			{:else}
				<ul class="requirement-list">
					{#each sortedRequirements as requirement (requirement.id)}
						<li class="requirement-row">
							<span class="requirement-row__label">{requirement.label}</span>
							<CoverageVoteWidget
								summary={requirement.voteSummary}
								question={m.material_requirementVoteQuestion}
								onVote={(value) => handleRequirementVote(requirement.id, value)}
								onRetract={() => handleRequirementRetract(requirement.id)}
							/>
							<ReportButton kind="requirement" objectId={requirement.id} />
						</li>
					{/each}
				</ul>
			{/if}
		</section>

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
			<ReviewList {reviews} {usersById} showReportButton={false} />
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
	{/if}
</div>

{#if openCoverage}
	<CoveragePopover
		coverage={openCoverage}
		onClose={() => (openCoverageId = null)}
		onVoteChange={applyCoverageUpdate}
	/>
{/if}

{#if addingCoverage}
	<ModalShell title={m.coverage_addTrigger()} onClose={() => (addingCoverage = false)}>
		{#if addError}
			<p class="add-error">{addError}</p>
		{/if}
		<AddCoverageForm
			{topics}
			onSubmit={handleProposeCoverage}
			onCancel={() => (addingCoverage = false)}
		/>
	</ModalShell>
{/if}

{#if proposingRequirement}
	<ModalShell
		title={m.material_requirementAddTrigger()}
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
				<span class="visually-hidden">{m.material_requirementsAddPlaceholder()}</span>
				<input
					type="text"
					bind:value={newRequirementLabel}
					placeholder={m.material_requirementsAddPlaceholder()}
				/>
			</label>
			<div class="propose-requirement-form__actions">
				<button type="button" class="cancel" onclick={() => (proposingRequirement = false)}>
					{m.common_cancel()}
				</button>
				<button type="submit" class="submit" disabled={!newRequirementLabel.trim()}>
					{m.material_requirementsAdd()}
				</button>
			</div>
		</form>
	</ModalShell>
{/if}

{#if editingRequirements}
	<ModalShell
		title={m.material_requirementsModalTitle()}
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

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.loading,
	.empty {
		color: var(--text-secondary);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
	.claim-group {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.claim-group__heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.claim-group__heading h2 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.claim-group__badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
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
	.review-summary {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
	.login-prompt {
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
</style>
