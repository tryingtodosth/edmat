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
		ClaimKind,
		Comment,
		Branch,
		Discipline,
		Material,
		MaterialCoverage,
		MaterialReview,
		Topic,
		User
	} from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { claimsOfKind } from '$lib/utils/coverage';
	import {
		castRequirementVote,
		DuplicateCoverageError,
		getMaterialById,
		getMaterialReviews,
		proposeCoverage,
		retractRequirementVote,
		setMaterialRequirements,
		submitMaterialReview
	} from '$lib/services/materials';
	import { getBranchById, getDisciplineById, getTopicsForBranch } from '$lib/services/taxonomy';
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
	import PdfViewer from '$lib/components/material/PdfViewer.svelte';

	let material = $state<Material | undefined>(undefined);
	let branch = $state<Branch | undefined>(undefined);
	let field = $state<Discipline | undefined>(undefined);
	let topics = $state<Topic[]>([]);
	let loading = $state(true);
	let notFound = $state(false);

	// The in-browser preview (§17AJ) — offered for hosted PDFs only (a link-only material lives at
	// its own URL, and other file types have no in-browser story). Collapsed until asked for:
	// PdfViewer only mounts on the click, which is also when its ~1.5 MB pdf.js chunk loads.
	let showPreview = $state(false);
	let isPdf = $derived(Boolean(material?.fileUrl && /\.pdf($|\?)/i.test(material.fileUrl)));

	let comments = $state<Comment[]>([]);
	let reviews = $state<MaterialReview[]>([]);
	let usersById = $state<Record<string, User>>({});
	let submissionNotice = $state<'review' | null>(null);

	// Claims — proposing a new one of either kind is open to any authenticated user (a community-
	// verified peer-review signal, not moderator-gated). Both groups are the same rows split by
	// `kind`, in the order the community's importance votes produce.
	// New and updated claims are written straight into `material.coverage` (a `$state` object, so
	// deep reactive) rather than a side overlay: the header card renders the same `material`, and an
	// overlay it cannot see left a just-added claim missing from the card until a reload.
	let allCoverage = $derived(material?.coverage ?? []);
	let sortedCoverage = $derived(claimsOfKind(allCoverage, 'covers'));
	let sortedRequirements = $derived(claimsOfKind(allCoverage, 'requires'));
	let openCoverageId = $state<string | null>(null);
	let openCoverage = $derived(allCoverage.find((c) => c.id === openCoverageId) ?? null);
	// Which kind the open "add" form is proposing, or null when it is closed.
	let addingKind = $state<ClaimKind | null>(null);
	let addError = $state<string | null>(null);

	// Legacy free-text requirements (`MaterialRequirement`) — kept readable and governor-editable
	// for any material that still carries them, but no longer offered for new entries: a
	// requirement is now a claim like any other, with a topic, a level, votes and a thread.
	let requirementsOverlay = $state<Material['requirements'] | null>(null);
	let legacyRequirements = $derived(
		[...(requirementsOverlay ?? material?.requirements ?? [])].sort(
			(a, b) => b.voteSummary.netWeight - a.voteSummary.netWeight
		)
	);
	let editingRequirements = $state(false);
	let requirementsError = $state<string | null>(null);

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
			getBranchById(mat.branchId),
			getCommentsForTarget('material', id),
			getMaterialReviews(id)
		]);
		branch = c;
		const [f, t] = await Promise.all([
			c ? getDisciplineById(c.disciplineId) : Promise.resolve(undefined),
			c ? getTopicsForBranch(c.id) : Promise.resolve([])
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
		kind: ClaimKind;
		topicId: string;
		subtopicName: string;
		level: number;
	}) {
		if (!material) return;
		addError = null;
		try {
			const coverage = await proposeCoverage(material.id, {
				kind: input.kind,
				topicId: input.topicId,
				level: input.level,
				...(input.subtopicName
					? { subtopicSlug: slugify(input.subtopicName), subtopicName: input.subtopicName }
					: {})
			});
			material.coverage = [...material.coverage, coverage];
			addingKind = null;
		} catch (e) {
			addError =
				e instanceof DuplicateCoverageError ? m.coverage_addDuplicate() : m.common_error_generic();
		}
	}

	function applyCoverageUpdate(updated: MaterialCoverage) {
		if (material) {
			material.coverage = material.coverage.map((c) => (c.id === updated.id ? updated : c));
		}
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
			<a href={resolve('/disciplines')}>{m.common_home()}</a> ›
			{#if field}
				<a href={resolve('/disciplines/[discipline]', { discipline: field.id })}>{field.name}</a> ›
			{/if}
			{#if branch}
				<a href={resolve('/branches/[branch]', { branch: branch.id })}>{branch.name}</a>
			{/if}
		</nav>

		<!-- headingLevel={1}: this card IS this page's header, so its title is the page's h1. Without
		     it the document had no h1 at all and went h3 -> h2, which reads to a screen reader and a
		     crawler alike as sections that outrank the thing they belong to. -->
		<MaterialCard {material} linkTitle={false} headingLevel={1} />
		<ReportButton kind="material" objectId={material.id} />

		{#if isPdf}
			<section class="content-section pdf-preview">
				<div class="pdf-preview__head">
					<h2>{m.pdfPreview_heading()}</h2>
					<button
						type="button"
						class="pdf-preview__toggle"
						onclick={() => (showPreview = !showPreview)}
					>
						{showPreview ? m.pdfPreview_hide() : m.pdfPreview_show()}
					</button>
				</div>
				{#if showPreview}
					<PdfViewer url={material.fileUrl} />
				{/if}
			</section>
		{/if}

		<section class="claim-group">
			<div class="claim-group__heading">
				<h2>{m.material_coversHeading()}</h2>
				{#if authStore.isAuthenticated && topics.length > 0}
					<button
						type="button"
						class="add-trigger"
						onclick={() => ((addingKind = 'covers'), (addError = null))}
					>
						+ {m.coverage_addTrigger()}
					</button>
				{/if}
			</div>
			<p class="group-hint">{m.material_coversHint()}</p>
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
				{#if authStore.isAuthenticated && topics.length > 0}
					<button
						type="button"
						class="add-trigger"
						onclick={() => ((addingKind = 'requires'), (addError = null))}
					>
						+ {m.coverage_addRequirementTrigger()}
					</button>
				{/if}
			</div>
			<p class="group-hint">{m.material_requiresHint()}</p>
			{#if sortedRequirements.length === 0}
				<p class="status">{m.material_requiresEmpty()}</p>
			{:else}
				<div class="claim-group__badges">
					{#each sortedRequirements as coverage (coverage.id)}
						<CoverageBadge {coverage} onclick={() => (openCoverageId = coverage.id)} />
					{/each}
				</div>
			{/if}
		</section>

		{#if legacyRequirements.length > 0}
			<section class="claim-group">
				<div class="claim-group__heading">
					<h2>{m.material_legacyRequirementsHeading()}</h2>
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
				<ul class="requirement-list">
					{#each legacyRequirements as requirement (requirement.id)}
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
			</section>
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
			<ReviewList {reviews} {usersById} showReportButton={false} commentTarget="materialReview" />
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

{#if addingKind}
	<ModalShell
		title={addingKind === 'requires' ? m.coverage_addRequirementTrigger() : m.coverage_addTrigger()}
		onClose={() => (addingKind = null)}
	>
		{#if addError}
			<p class="add-error">{addError}</p>
		{/if}
		<AddCoverageForm
			kind={addingKind}
			{topics}
			onSubmit={handleProposeCoverage}
			onCancel={() => (addingKind = null)}
		/>
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
			initial={legacyRequirements.map((r) => r.label)}
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
	.group-hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		margin-top: calc(-1 * var(--space-1));
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
	.pdf-preview__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.pdf-preview__toggle {
		font: inherit;
		font-size: var(--font-size-xs);
		font-weight: 600;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
		cursor: pointer;
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
