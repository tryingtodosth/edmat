<script lang="ts">
	// Everything about a material that is not its content: where it is filed, who wrote it, what it
	// costs, what it covers, and whether the project wants company.
	//
	// The "Other…" pickers are the ones `/submit-material` already established, reused rather than
	// re-invented: picking "Other…" for a discipline, a branch, a topic or a material type names a
	// new node and files against it immediately (pending until a moderator confirms). Somebody
	// starting a material on a subject this database has never heard of is exactly the person who
	// most needs it to work.
	//
	// The form never calls the API itself. `collect()` is what a page asks for when ITS submit is
	// pressed — because creating a project sends the catalogue and the first version in one request,
	// and two forms that each saved themselves could leave half a project behind.
	import { m } from '$lib/paraglide/messages.js';
	import type { Audience, Branch, ClaimKind, Discipline, MaterialType, Topic } from '$lib/types';
	import type {
		MaterialProject,
		ProjectCatalogueResult,
		ProjectCoverageDraft
	} from '$lib/types/materialProject';
	import {
		getBranchesForDiscipline,
		getDisciplines,
		getTopicsForBranch,
		proposeTaxonomyNode
	} from '$lib/services/taxonomy';
	import { materialTypesStore } from '$lib/state/materialTypes.svelte';
	import { MATERIAL_CURRENCIES } from '$lib/utils/labels';
	import { isComposingKey } from '$lib/utils/textInput';
	import AudienceSelect from '$lib/components/shared/AudienceSelect.svelte';
	import ProposeNodeButton from '$lib/components/discipline/ProposeNodeButton.svelte';
	import TaxonomyOptions, { OTHER_VALUE } from '$lib/components/shared/TaxonomyOptions.svelte';

	let {
		mode,
		project = null,
		busy = false,
		onsubmit = undefined,
		headingLevel = 3
	}: {
		/** `create` asks for the branch and the language too; `edit` cannot move a project. */
		mode: 'create' | 'edit';
		project?: MaterialProject | null;
		busy?: boolean;
		/** `edit` only — `create` is collected by the page, which submits it with the version. */
		onsubmit?: (patch: ProjectCatalogueResult) => void;
		/** `h2` when this sits straight under the page's `h1`; `h3` inside a section (axe
		 * `heading-order`: a level may not be skipped). */
		headingLevel?: 2 | 3;
	} = $props();

	let disciplines = $state<Discipline[]>([]);
	let branches = $state<Branch[]>([]);
	let disciplineId = $state('');
	// svelte-ignore state_referenced_locally
	let branchId = $state(project?.branchId ?? '');
	let customDisciplineName = $state('');
	let customBranchName = $state('');
	let isCustomDiscipline = $derived(disciplineId === OTHER_VALUE);
	let isCustomBranch = $derived(branchId === OTHER_VALUE);

	// svelte-ignore state_referenced_locally
	let locale = $state(project?.locale ?? 'pl');
	// The BACKEND SLUG, never the camelCase frontend name — `typeOptions` below is keyed by slug,
	// and `project?.type` arrives as one too. Seeding it with `examCollection` left the select
	// showing nothing while the form went on submitting a real type: the same blank-picker bug
	// `/submit-material` carries the note about, found here by reading that note.
	// svelte-ignore state_referenced_locally
	let type = $state<MaterialType>(project?.type ?? 'exam_collection');
	let customTypeName = $state('');
	let isCustomType = $derived(type === OTHER_VALUE);
	// svelte-ignore state_referenced_locally
	let audience = $state<Audience | ''>(project?.audience ?? '');
	// svelte-ignore state_referenced_locally
	let author = $state(project?.author ?? '');
	// svelte-ignore state_referenced_locally
	let sourceUrl = $state(project?.sourceUrl ?? '');
	// Text, never `type="number"` — Svelte 5 binds a real number there and every `.trim()` below
	// would throw on first submit (frontend/CLAUDE.md trap 1, hit four times on this project).
	// svelte-ignore state_referenced_locally
	let priceAmount = $state(project?.priceAmount !== undefined ? String(project.priceAmount) : '');
	// svelte-ignore state_referenced_locally
	let priceCurrency = $state(project?.priceCurrency || 'PLN');
	// svelte-ignore state_referenced_locally
	let estimatedMinutes = $state(
		project?.estimatedMinutes !== undefined ? String(project.estimatedMinutes) : ''
	);
	// svelte-ignore state_referenced_locally
	let requirements = $state<string[]>([...(project?.requirements ?? [])]);
	let requirementDraft = $state('');
	// svelte-ignore state_referenced_locally
	let coverage = $state<ProjectCoverageDraft[]>([...(project?.coverage ?? [])]);
	let coverageTopicId = $state('');
	let coverageLevel = $state('50');
	let coverageKind = $state<ClaimKind>('covers');
	// svelte-ignore state_referenced_locally
	let seekingCoauthors = $state(project?.seekingCoauthors ?? false);
	// svelte-ignore state_referenced_locally
	let seekingNote = $state(project?.seekingNote ?? '');

	let topics = $state<Topic[]>([]);
	let typeOptions = $derived(
		materialTypesStore.list.map((t) => ({ id: t.slug, name: t.name, status: t.status }))
	);
	let availableCoverageTopics = $derived(
		topics.filter((t) => !coverage.some((c) => c.topicId === t.id && c.kind === coverageKind))
	);

	/** Guards the real race `/submit-material` found live: the first load fires this for the default
	 *  discipline, and a choice made before that resolves used to be overwritten by the stale
	 *  answer. A call whose id is no longer the latest must not write anything. */
	let branchRequestId = 0;
	async function onDisciplineChange(next: string) {
		disciplineId = next;
		const requestId = ++branchRequestId;
		if (next === OTHER_VALUE) {
			branches = [];
			branchId = OTHER_VALUE;
			return;
		}
		const fetched = await getBranchesForDiscipline(next);
		if (requestId !== branchRequestId) return;
		branches = fetched;
		branchId = branches.length ? branches[0].id : '';
	}

	let loadedOnce = $state(false);
	$effect(() => {
		if (loadedOnce) return;
		loadedOnce = true;
		if (mode !== 'create') return;
		// In `onMount`-equivalent position rather than at component top level: a top-level service
		// call runs during SSR with no token, which once took the dev server down (trap 5).
		void (async () => {
			disciplines = await getDisciplines();
			if (disciplines.length) await onDisciplineChange(disciplines[0].id);
		})();
	});

	let topicsFor = $state('');
	$effect(() => {
		const branch = branchId;
		if (branch === topicsFor) return;
		topicsFor = branch;
		if (!branch || branch === OTHER_VALUE) {
			topics = [];
			return;
		}
		getTopicsForBranch(branch).then((rows) => (topics = rows));
	});

	function addRequirement() {
		const trimmed = requirementDraft.trim();
		if (!trimmed) return;
		requirements = [...requirements, trimmed];
		requirementDraft = '';
	}

	function addCoverage() {
		if (!coverageTopicId) return;
		const level = Number(coverageLevel);
		if (!Number.isFinite(level) || level < 1 || level > 100) return;
		coverage = [...coverage, { topicId: coverageTopicId, level, kind: coverageKind }];
		coverageTopicId = '';
		coverageLevel = '50';
	}

	function topicName(topicId: string): string {
		return topics.find((t) => t.id === topicId)?.name ?? topicId;
	}

	/** The backend field is a real `URLField` and refuses a bare `example.edu/x.pdf`; somebody
	 *  typing a link by hand very reasonably omits the scheme. */
	function normalizeUrl(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) return '';
		return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	}

	/** Turns an "Other…" choice into a real node and answers with the slug to file against. */
	async function resolveBranch(): Promise<string> {
		let disciplineSlug = disciplineId;
		if (isCustomDiscipline) {
			disciplineSlug = (
				await proposeTaxonomyNode({ kind: 'discipline', name: customDisciplineName.trim() })
			).slug;
		}
		if (!isCustomBranch) return branchId;
		return (
			await proposeTaxonomyNode({
				kind: 'branch',
				name: customBranchName.trim(),
				parent: disciplineSlug
			})
		).slug;
	}

	async function resolveType(): Promise<MaterialType> {
		if (!isCustomType) return type;
		return (await proposeTaxonomyNode({ kind: 'material_type', name: customTypeName.trim() })).slug;
	}

	let ready = $derived(
		Boolean(audience) &&
			(mode === 'edit' || Boolean(branchId)) &&
			(!isCustomDiscipline || Boolean(customDisciplineName.trim())) &&
			(!isCustomBranch || Boolean(customBranchName.trim())) &&
			(!isCustomType || Boolean(customTypeName.trim()))
	);

	/** Async because an "Other…" choice is a real node that has to exist before anything can be
	 *  filed under it. Null when the form is not ready — the page's button is disabled then anyway,
	 *  so this is the belt to that braces. */
	export async function collect(): Promise<ProjectCatalogueResult | null> {
		if (!ready || !audience) return null;
		return {
			branchId: mode === 'create' ? await resolveBranch() : '',
			locale,
			type: await resolveType(),
			audience: audience as Audience,
			author: author.trim(),
			sourceUrl: normalizeUrl(sourceUrl),
			priceAmount: priceAmount.trim() ? Number(priceAmount) : undefined,
			priceCurrency: priceAmount.trim() ? priceCurrency || 'PLN' : 'PLN',
			estimatedMinutes: estimatedMinutes.trim() ? Number(estimatedMinutes) : undefined,
			requirements,
			coverage,
			seekingCoauthors,
			seekingNote: seekingNote.trim()
		};
	}

	export function isReady(): boolean {
		return ready;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const result = await collect();
		if (result) onsubmit?.(result);
	}
</script>

<form class="catalogue" onsubmit={submit}>
	<svelte:element this={`h${headingLevel}`}>{m.coauth_catalogue_heading()}</svelte:element>
	<!-- "About the material" -->

	{#if mode === 'create'}
		<div class="field">
			<label for="coauth-discipline">{m.submitMaterial_field_discipline()}</label>
			<!-- "Field of study" -->
			<select
				id="coauth-discipline"
				value={disciplineId}
				onchange={(e) => onDisciplineChange(e.currentTarget.value)}
			>
				<TaxonomyOptions nodes={disciplines} allowOther />
			</select>
			{#if isCustomDiscipline}
				<!-- "Name of the new discipline" -->
				<input
					type="text"
					bind:value={customDisciplineName}
					placeholder={m.taxonomy_otherDisciplineName()}
					aria-label={m.taxonomy_otherDisciplineName()}
					required
				/>
				<span class="hint">{m.taxonomy_otherPending()}</span>
				<!-- "A new entry you name here is created when you submit — real straight away…" -->
			{/if}
		</div>

		<div class="field">
			<label for="coauth-branch">{m.submitMaterial_field_course()}</label>
			<!-- "Subject" -->
			<select id="coauth-branch" bind:value={branchId} disabled={isCustomDiscipline}>
				<TaxonomyOptions nodes={branches} allowOther />
			</select>
			{#if isCustomBranch}
				<!-- "Name of the new branch" -->
				<input
					type="text"
					bind:value={customBranchName}
					placeholder={m.taxonomy_otherBranchName()}
					aria-label={m.taxonomy_otherBranchName()}
					required
				/>
				{#if !isCustomDiscipline}
					<span class="hint">{m.taxonomy_otherPending()}</span>
					<!-- "A new entry you name here is created when you submit — real straight away…" -->
				{/if}
			{/if}
		</div>
	{/if}

	<div class="row">
		<div class="field">
			<label for="coauth-type">{m.submitMaterial_field_type()}</label>
			<!-- "Type" -->
			<select id="coauth-type" bind:value={type}>
				<TaxonomyOptions nodes={typeOptions} allowOther />
			</select>
			{#if isCustomType}
				<!-- "Name of the new type" -->
				<input
					type="text"
					bind:value={customTypeName}
					placeholder={m.taxonomy_otherMaterialTypeName()}
					aria-label={m.taxonomy_otherMaterialTypeName()}
					required
				/>
				<span class="hint">{m.taxonomy_otherPending()}</span>
				<!-- "A new entry you name here is created when you submit — real straight away…" -->
			{/if}
		</div>

		<label class="field">
			<span>{m.submitMaterial_field_language()}</span>
			<!-- "Language" -->
			<!-- Only while drafting: after the first publication the versions' language is what the
			     material's original-locale translation row says, and moving it is a different job. -->
			<select bind:value={locale} disabled={mode === 'edit' && project?.materialId !== null}>
				<option value="pl">PL</option>
				<option value="en">EN</option>
			</select>
		</label>

		<AudienceSelect bind:value={audience} />
	</div>

	<div class="row">
		<label class="field">
			<span>{m.submitMaterial_field_author()} <em>({m.common_optional()})</em></span>
			<!-- "Author" / "optional" -->
			<input type="text" bind:value={author} maxlength="200" />
			<span class="hint">{m.submitMaterial_authorHint()}</span>
			<!-- "Who wrote it — a lecturer, TA, or the department. Not your own account name." -->
		</label>

		<label class="field">
			<span>{m.submitMaterial_field_sourceUrl()} <em>({m.common_optional()})</em></span>
			<!-- "Where it came from" / "optional" -->
			<!-- "example.edu/courses/materials" -->
			<input
				type="text"
				inputmode="url"
				bind:value={sourceUrl}
				maxlength="500"
				placeholder={m.submitMaterial_sourceUrlPlaceholder()}
			/>
			<span class="hint">{m.submitMaterial_sourceUrlHint()}</span>
			<!-- "Where this came from, if it is available online…" -->
		</label>
	</div>

	<div class="row">
		<label class="field">
			<span>{m.submitMaterial_field_price()} <em>({m.common_optional()})</em></span>
			<!-- "Price" / "optional" -->
			<div class="pair">
				<!-- "e.g. 29.99 (optional)" and the "Currency" label on the select beside it -->
				<input
					type="text"
					inputmode="decimal"
					bind:value={priceAmount}
					placeholder={m.submitMaterial_priceAmountPlaceholder()}
				/>
				<select aria-label={m.submitMaterial_field_priceCurrency()} bind:value={priceCurrency}>
					{#each MATERIAL_CURRENCIES as currency (currency)}
						<option value={currency}>{currency}</option>
					{/each}
				</select>
			</div>
		</label>

		<label class="field">
			<span>{m.submitMaterial_field_estimatedMinutes()} <em>({m.common_optional()})</em></span>
			<!-- "How long it takes (minutes)" / "optional" -->
			<!-- "e.g. 45 (optional)" -->
			<input
				type="text"
				inputmode="numeric"
				bind:value={estimatedMinutes}
				placeholder={m.submitMaterial_estimatedMinutesPlaceholder()}
			/>
		</label>
	</div>

	{#if branchId && branchId !== OTHER_VALUE}
		<div class="field">
			<div class="field-heading">
				<span>{m.submitMaterial_field_coverage()} <em>({m.common_optional()})</em></span>
				<!-- "What it covers" / "optional" -->
				<ProposeNodeButton
					kind="topic"
					parent={branchId}
					onproposed={async (slug) => {
						topics = await getTopicsForBranch(branchId);
						coverageTopicId = topics.find((t) => t.slug === slug)?.id ?? '';
					}}
				/>
			</div>
			{#if coverage.length > 0}
				<ul class="chips">
					{#each coverage as entry, index (`${entry.kind}:${entry.topicId}:${index}`)}
						<li>
							<!-- "What's required" / "What it covers" -->
							<span>
								{entry.kind === 'requires'
									? m.material_requiresHeading()
									: m.material_coversHeading()}: {topicName(entry.topicId)} — {entry.level}%
							</span>
							<!-- "Remove" -->
							<button
								type="button"
								aria-label={m.common_remove()}
								onclick={() => (coverage = coverage.filter((_, i) => i !== index))}>&times;</button
							>
						</li>
					{/each}
				</ul>
			{/if}
			{#if availableCoverageTopics.length > 0}
				<div class="pair">
					<!-- "What it covers" / "What's required", then "Topic" ("Choose a topic…") and
					     "Coverage level (1-100)" -->
					<select bind:value={coverageKind} aria-label={m.material_coversHeading()}>
						<option value="covers">{m.material_coversHeading()}</option>
						<option value="requires">{m.material_requiresHeading()}</option>
					</select>
					<select bind:value={coverageTopicId} aria-label={m.submitMaterial_coverageTopicLabel()}>
						<option value="">{m.submitMaterial_coverageTopicPlaceholder()}</option>
						<TaxonomyOptions nodes={availableCoverageTopics} />
					</select>
					<input
						type="text"
						inputmode="numeric"
						aria-label={m.submitMaterial_coverageLevelLabel()}
						bind:value={coverageLevel}
					/>
					<button type="button" onclick={addCoverage}>{m.submitMaterial_coverageAdd()}</button>
					<!-- "Add" -->
				</div>
			{/if}
			<span class="hint">{m.submitMaterial_coverageHint()}</span>
			<!-- "Optional — which topics this material covers, and how deeply (1-100)…" -->
		</div>
	{/if}

	<div class="field">
		<span>{m.submitMaterial_field_requirements()} <em>({m.common_optional()})</em></span>
		<!-- "What you need first" / "optional" -->
		{#if requirements.length > 0}
			<ul class="chips">
				{#each requirements as requirement, index (index)}
					<li>
						<span>{requirement}</span>
						<!-- "Remove" -->
						<button
							type="button"
							aria-label={m.common_remove()}
							onclick={() => (requirements = requirements.filter((_, i) => i !== index))}
							>&times;</button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<!-- "Add a requirement…" -->
		<input
			type="text"
			placeholder={m.submitMaterial_requirementsAddPlaceholder()}
			bind:value={requirementDraft}
			onkeydown={(e) => {
				// Enter belongs to the input method while a composition is open — the same guard every
				// other add-one-at-a-time input in this app carries.
				if (isComposingKey(e)) return;
				if (e.key === 'Enter') {
					e.preventDefault();
					addRequirement();
				}
			}}
		/>
		<span class="hint">{m.submitMaterial_requirementsHint()}</span>
		<!-- "Optional — press Enter to add each one, e.g. \"English B2+\"." -->
	</div>

	<label class="checkbox">
		<input type="checkbox" bind:checked={seekingCoauthors} />
		<span>{m.coauth_catalogue_seeking()}</span>
		<!-- "Looking for co-authors" -->
	</label>
	{#if seekingCoauthors}
		<label class="field">
			<span>{m.coauth_catalogue_seekingNote()}</span>
			<!-- "What kind of help do you want?" -->
			<textarea rows="2" maxlength="500" bind:value={seekingNote}></textarea>
			<span class="hint">{m.coauth_catalogue_seekingHint()}</span>
			<!-- "Shown to anybody browsing the projects that are looking for people." -->
		</label>
	{/if}

	{#if onsubmit}
		<button type="submit" class="primary" disabled={busy || !ready}>
			{m.common_save()}
			<!-- "Save" -->
		</button>
	{/if}
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.catalogue {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);

		h3 {
			margin: 0;
			font-size: var(--font-size-md);
		}
	}
	.row {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;

		> :global(*) {
			flex: 1 1 12rem;
		}
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.field-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.pair {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	input,
	select,
	textarea {
		@include mix.focus-ring;
		font: inherit;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;

		li {
			display: inline-flex;
			align-items: center;
			gap: var(--space-1);
			padding: 2px var(--space-2);
			border-radius: 999px;
			background: var(--bg-surface-alt);
			font-size: var(--font-size-xs);
		}
		button {
			border: 0;
			background: none;
			cursor: pointer;
			color: var(--text-secondary);
		}
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
		min-height: 44px;
		padding: var(--space-2) var(--space-4);
	}
</style>
