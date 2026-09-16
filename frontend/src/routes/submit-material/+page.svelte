<script lang="ts">
	import AudienceSelect from '$lib/components/shared/AudienceSelect.svelte';
	import type { Audience } from '$lib/types';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Branch, Discipline, MaterialCoverageDraft, MaterialType, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import {
		getBranchesForDiscipline,
		getDisciplines,
		getTopicsForBranch,
		proposeTaxonomyNode
	} from '$lib/services/taxonomy';
	import { submitMaterial } from '$lib/services/materials';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { MATERIAL_CURRENCIES } from '$lib/utils/labels';
	import { isComposingKey } from '$lib/utils/textInput';
	import { materialTypesStore } from '$lib/state/materialTypes.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import ProposeNodeButton from '$lib/components/discipline/ProposeNodeButton.svelte';
	import TaxonomyOptions, { OTHER_VALUE } from '$lib/components/shared/TaxonomyOptions.svelte';

	// "exams, tests, etc. — usually a PDF/PNG, but a whole LaTeX/Word document should be accepted
	// too, scanned and kept safe" — the actual real content-type sniffing + optional malware scan
	// both run server-side (materials/validators.py); this `accept` attribute is a real, matching
	// convenience for the file PICKER, not the security boundary itself — the backend still
	// re-checks every upload's real bytes regardless of what this hints the OS file dialog toward.
	const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.tex,.doc,.docx,.odt';

	let disciplines = $state<Discipline[]>([]);
	let branches = $state<Branch[]>([]);
	let disciplineId = $state('');
	let branchId = $state('');
	// "Other…" at either level — the discipline → branch cascade below (mirroring /submit's own
	// pattern exactly) is what makes proposing a brand-new DISCIPLINE reachable at all here: this
	// form used to list every branch flat with no discipline step, so naming a new branch had
	// nowhere to ask which (existing-only) discipline it belonged to, and naming a new discipline
	// outright was simply not offered anywhere. Picking "Other…" for the discipline forces the
	// branch to be new too, matching /submit's own reasoning: a discipline that does not exist yet
	// cannot already have a branch in it.
	let customDisciplineName = $state('');
	let customBranchName = $state('');
	let isCustomDiscipline = $derived(disciplineId === OTHER_VALUE);
	let isCustomBranch = $derived(branchId === OTHER_VALUE);
	let topics = $state<Topic[]>([]);
	let type = $state<MaterialType>('examCollection');
	// "Other…" for the type select too, the identical inline pattern rather than the separate
	// "Suggest a kind" link this used to be the only field on this form to use — one mechanism per
	// field, not two competing ones for the same action.
	let customTypeName = $state('');
	let isCustomType = $derived(type === OTHER_VALUE);
	let title = $state('');
	let description = $state('');
	// Provenance. Both plain strings and both `type="text"` — deliberately NOT `type="url"` for
	// the source: this project has hit the Svelte `bind:value` coercion bug twice already (the
	// node-governor grant form, then this very form's own price/minutes fields), and while `url`
	// binds a string safely, its browser-native validation would also reject a perfectly reasonable
	// `example.edu/handout.pdf` typed without a scheme. Normalized in handleSubmit instead.
	let author = $state('');
	let sourceUrl = $state('');
	let locale = $state('pl');
	let audience = $state<Audience | ''>('');
	let file = $state<File | null>(null);
	let url = $state('');
	// TaxonomyOptions is keyed by `id`; a material type is identified by its slug, which IS what
	// the select must bind. Mapped here rather than widening that component, which is shared with
	// three genuinely id-keyed taxonomy levels.
	let typeOptions = $derived(
		materialTypesStore.list.map((t) => ({ id: t.slug, name: t.name, status: t.status }))
	);
	let submitting = $state(false);
	let success = $state(false);
	// ✅ Verified-contributor fast path, extended to materials (mirrors /submit's own
	// publishedExerciseId): set only when the backend published this upload immediately
	// (`status: 'approved'`, `resultingMaterialId` present) rather than queuing it, so the
	// confirmation can say what actually happened instead of always implying a review queue.
	let publishedMaterialId = $state<string | null>(null);
	let errorMessage = $state('');

	// All three genuinely optional, matching the real Material fields they'll eventually become
	// (materials/models.py) — a submission that leaves them all unset behaves exactly as before this
	// feature existed. `requirementDraft` is the plain-text add-one-at-a-time input; `requirements`
	// is the accumulated list actually submitted.
	//
	// `priceAmount`/`estimatedMinutes` are deliberately `type="text" inputmode="decimal"/"numeric"`,
	// NOT `type="number"` — a real, live-reproduced bug found during this feature's own end-to-end
	// verification, the exact same class Section 17M's own node-governor grant form already hit:
	// Svelte 5's `bind:value` on a real `<input type="number">` binds a genuine JS `number` (or
	// `undefined`), not the `string` `handleSubmit`'s own `.trim()` calls below assume — the first
	// live submit attempt threw a real `$.get(...).trim is not a function` in the browser console,
	// caught only because this was actually driven through a headless browser, not just
	// `svelte-check`'d. Kept as `string` state end to end, matching every other text field on this
	// same form, exactly the fix that section already established for the identical mismatch.
	let requirements = $state<string[]>([]);
	let requirementDraft = $state('');
	let priceAmount = $state('');
	let priceCurrency = $state('PLN');
	let estimatedMinutes = $state('');

	function addRequirement() {
		const trimmed = requirementDraft.trim();
		if (!trimmed) return;
		requirements = [...requirements, trimmed];
		requirementDraft = '';
	}

	function removeRequirement(index: number) {
		requirements = requirements.filter((_, i) => i !== index);
	}

	// "Covers" — topic + level only (no subtopic at submission time, see MaterialCoverageDraft's
	// own doc comment for why). `coverageLevel` is text/`inputmode="numeric"`, not `type="number"`,
	// the same real, live-reproduced Svelte 5 `bind:value` mismatch this file's own doc comment
	// above already explains for `priceAmount`/`estimatedMinutes`.
	let coverage = $state<MaterialCoverageDraft[]>([]);
	let coverageTopicId = $state('');
	let coverageLevel = $state('50');

	function addCoverage() {
		if (!coverageTopicId) return;
		const level = Number(coverageLevel);
		if (!Number.isFinite(level) || level < 1 || level > 100) return;
		if (coverage.some((c) => c.topicId === coverageTopicId)) return;
		coverage = [...coverage, { topicId: coverageTopicId, level }];
		coverageTopicId = '';
		coverageLevel = '50';
	}

	function removeCoverage(topicId: string) {
		coverage = coverage.filter((c) => c.topicId !== topicId);
	}

	function coverageTopicName(topicId: string): string {
		return topics.find((t) => t.id === topicId)?.name ?? topicId;
	}

	let availableCoverageTopics = $derived(
		topics.filter((t) => !coverage.some((c) => c.topicId === t.id))
	);

	// Discipline → branch cascade, the same pattern /submit's own onFieldChange already
	// establishes: picking a discipline narrows the branch list to that discipline's own branches
	// (rather than a flat, cross-discipline list to scroll through), and resets the branch to the
	// new discipline's own first one.
	//
	// `branchRequestId` guards against a real, found-live race: `init()` below fires this same
	// function for the page's own default discipline, and if somebody (or, as this feature's own
	// verification found, a script) picks a DIFFERENT discipline before that first fetch resolves,
	// the stale response used to land afterward and silently overwrite the deliberate choice —
	// dropping a freshly-picked "Other…" branch back to blank with no visible error. Each call
	// stamps its own id; a call whose id no longer matches the latest one by the time its fetch
	// resolves was superseded and must not write anything.
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
		if (requestId !== branchRequestId) return; // superseded by a later call — discard
		branches = fetched;
		branchId = branches.length ? branches[0].id : '';
	}

	async function init() {
		disciplines = await getDisciplines();
		if (disciplines.length) await onDisciplineChange(disciplines[0].id);
	}
	// In onMount, not at top level: this page is prerendered, and a top-level call runs at BUILD
	// time too, where `fetch('/api/…')` has no origin to resolve against and the build dies
	// (found by pack.sh's production build, not by the dev one, whose .env named a real host).
	onMount(() => {
		init();
	});

	$effect(() => {
		if (!branchId || branchId === OTHER_VALUE) {
			topics = [];
			coverage = [];
			return;
		}
		getTopicsForBranch(branchId).then((t) => {
			topics = t;
			coverage = [];
		});
	});

	function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		file = input.files?.[0] ?? null;
	}

	// A file OR a link, never neither — the same rule the backend enforces, checked here so the
	// button is honest rather than the refusal arriving after a submit.
	let canSubmit = $derived(
		Boolean(branchId && title.trim() && (file || url.trim())) &&
			(!isCustomDiscipline || Boolean(customDisciplineName.trim())) &&
			(!isCustomBranch || Boolean(customBranchName.trim())) &&
			(!isCustomType || Boolean(customTypeName.trim()))
	);

	/** Turns an "Other…" discipline/branch choice into a real node (mirrors /submit's own
	 * resolveBranch exactly) and returns the branch slug to file the material under. */
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

	/** Turns an "Other…" material-type choice into a real, immediately-usable node — no parent, a
	 * material type is not nested under anything. */
	async function resolveMaterialType(): Promise<string> {
		if (!isCustomType) return type;
		return (await proposeTaxonomyNode({ kind: 'material_type', name: customTypeName.trim() })).slug;
	}

	/** The backend field is a real `URLField`, which rejects a bare `example.edu/x.pdf` outright.
	 * Someone typing a link by hand very reasonably omits the scheme, so prepend `https://` when
	 * none is present rather than bouncing the whole submission back over it. */
	function normalizeUrl(value: string): string | undefined {
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	}

	async function handleSubmit() {
		if (!audience) return;
		if (!authStore.user || !canSubmit) return;
		errorMessage = '';
		submitting = true;
		try {
			const filedBranchId = await resolveBranch();
			const filedType = await resolveMaterialType();
			const result = await submitMaterial(
				{
					branchId: filedBranchId,
					type: filedType,
					title: title.trim(),
					description: description.trim(),
					locale,
					audience: audience as Audience,
					author: author.trim() || undefined,
					sourceUrl: normalizeUrl(sourceUrl),
					url: normalizeUrl(url),
					requirements: requirements.length > 0 ? requirements : undefined,
					coverage: coverage.length > 0 ? coverage : undefined,
					priceAmount: priceAmount.trim() ? Number(priceAmount) : undefined,
					priceCurrency: priceAmount.trim() ? priceCurrency.trim() || 'PLN' : undefined,
					estimatedMinutes: estimatedMinutes.trim() ? Number(estimatedMinutes) : undefined
				},
				file
			);
			success = true;
			publishedMaterialId =
				result.status === 'approved' ? (result.resultingMaterialId ?? null) : null;
			title = description = '';
			author = sourceUrl = '';
			file = null;
			url = '';
			requirements = [];
			requirementDraft = '';
			coverage = [];
			priceAmount = '';
			estimatedMinutes = '';
			customDisciplineName = customBranchName = customTypeName = '';
			const input = document.getElementById('material-file-input') as HTMLInputElement | null;
			if (input) input.value = '';
		} catch (e) {
			// A rejected content-type/oversized-file/failed-scan upload all come back as a real 400
			// from the backend (materials/validators.py's own validator, or MaterialSubmissionViewSet
			// .perform_create's scan check) — one honest, generic message covers every case, matching
			// this app's own established convention for the material-submission upload form
			// (materials/views.py's own doc comment). A 403 is a genuinely different failure kind —
			// the new material_uploads_verified_only kill switch (moderation/permissions.py's
			// RequireVerifiedContributorForMaterialUploads) — worth its own clearer message so a
			// non-verified user understands WHY, rather than assuming their file itself was rejected.
			if (e instanceof ApiError && e.status === 403) {
				errorMessage = m.submitMaterial_verifiedContributorsOnly();
			} else {
				errorMessage = m.submitMaterial_uploadFailed();
			}
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{m.submitMaterial_heading()} — {m.common_appName()}</title>
</svelte:head>

<FeatureGate feature="material_submissions">
	<div class="page">
		<h1>{m.submitMaterial_heading()}</h1>
		<!-- Reads the same isVerifiedContributor flag /submit's own subtitle already reads — the
		     material-upload pipeline now has the identical fast path (moderation/views.py's
		     MaterialSubmissionViewSet.perform_create). -->
		<p class="subtitle">
			{authStore.user?.isVerifiedContributor
				? m.submitMaterial_subtitleVerified()
				: m.submitMaterial_subtitle()}
		</p>

		{#if authStore.restoring}
			<p class="session-restoring">{m.common_loading()}</p>
		{:else if !authStore.isAuthenticated}
			<p data-session-hidden class="login-prompt">
				<a href={resolve('/login')}>{m.submitMaterial_loginRequired()}</a>
			</p>
		{:else}
			{#if errorMessage}
				<p class="error">{errorMessage}</p>
			{/if}

			<form class="submit-form" onsubmit={(e) => (e.preventDefault(), handleSubmit())}>
				<!-- The field this material belongs to — a real discipline → branch cascade now,
				     mirroring /submit exactly (CLAUDE.md's "Discipline & Branch Selection Flow" fix):
				     picking a discipline narrows the branch list to it, and "Other…" at the discipline
				     level is a real, reachable way to propose a brand-new discipline, not just a new
				     branch under an existing one. -->
				<div class="field">
					<div class="field-heading">
						<label for="submit-material-discipline">{m.submitMaterial_field_discipline()}</label>
					</div>
					<select
						id="submit-material-discipline"
						value={disciplineId}
						onchange={(e) => onDisciplineChange(e.currentTarget.value)}
					>
						<TaxonomyOptions nodes={disciplines} allowOther />
					</select>
					{#if isCustomDiscipline}
						<input
							type="text"
							class="other-name"
							bind:value={customDisciplineName}
							placeholder={m.taxonomy_otherDisciplineName()}
							aria-label={m.taxonomy_otherDisciplineName()}
							required
						/>
						<p class="other-hint">{m.taxonomy_otherPending()}</p>
					{/if}
				</div>

				<div class="field">
					<div class="field-heading">
						<label for="submit-material-branch">{m.submitMaterial_field_course()}</label>
					</div>
					<select id="submit-material-branch" bind:value={branchId} disabled={isCustomDiscipline}>
						<TaxonomyOptions nodes={branches} allowOther />
					</select>
					{#if isCustomBranch}
						<input
							type="text"
							class="other-name"
							bind:value={customBranchName}
							placeholder={m.taxonomy_otherBranchName()}
							aria-label={m.taxonomy_otherBranchName()}
							required
						/>
						{#if !isCustomDiscipline}
							<p class="other-hint">{m.taxonomy_otherPending()}</p>
						{/if}
					{/if}
				</div>

				<label class="field">
					<span>{m.submitMaterial_field_title()}</span>
					<input
						type="text"
						bind:value={title}
						placeholder={m.submitMaterial_titlePlaceholder()}
						required
					/>
				</label>

				<div class="field-row">
					<div class="field">
						<div class="field-heading">
							<label for="submit-material-type">{m.submitMaterial_field_type()}</label>
						</div>
						<!-- The vocabulary, not a fixed list: anything somebody has proposed appears under
						     "Others" via TaxonomyOptions, exactly as a proposed discipline does — and,
						     since this fix, so does "Other…" itself: a document that is genuinely not one
						     of the thirteen kinds somebody guessed at from a seven-material corpus gets the
						     same inline text input the discipline/branch pickers already use, rather than
						     the separate "Suggest a kind" link this used to be the only field to need. -->
						<select id="submit-material-type" bind:value={type}>
							<TaxonomyOptions nodes={typeOptions} allowOther />
						</select>
						{#if isCustomType}
							<input
								type="text"
								class="other-name"
								bind:value={customTypeName}
								placeholder={m.taxonomy_otherMaterialTypeName()}
								aria-label={m.taxonomy_otherMaterialTypeName()}
								required
							/>
							<p class="other-hint">{m.taxonomy_otherPending()}</p>
						{/if}
					</div>
					<label class="field">
						<span>{m.submitMaterial_field_language()}</span>
						<select bind:value={locale}>
							<option value="pl">PL</option>
							<option value="en">EN</option>
						</select>
					</label>
					<AudienceSelect bind:value={audience} />
				</div>

				<label class="field">
					<span>{m.submitMaterial_field_description()} <em>({m.common_optional()})</em></span>
					<textarea rows="3" bind:value={description}></textarea>
				</label>

				<!-- A file OR a link, and the form says so before either field rather than after a
				     refused submit. Plenty of what a course points students at is a recording or a
				     departmental page — something nobody can or should re-host — and requiring an
				     upload meant either losing those or uploading a copy of somebody else's work
				     just to be able to say where it was.

				     Neither input carries `required`: the browser would enforce both, which is the
				     opposite of the rule. The check below is on the pair. -->
				<fieldset class="field where">
					<legend>{m.submitMaterial_whereLegend()}</legend>
					<p class="file-hint">{m.submitMaterial_whereHint()}</p>

					<label class="field">
						<span>{m.submitMaterial_field_file()} <em>({m.common_optional()})</em></span>
						<input
							id="material-file-input"
							type="file"
							accept={ACCEPTED_EXTENSIONS}
							onchange={handleFileChange}
						/>
						<span class="file-hint">{m.submitMaterial_fileHint()}</span>
						{#if file}
							<span class="file-picked">{file.name}</span>
						{/if}
					</label>

					<label class="field">
						<span>{m.submitMaterial_field_url()} <em>({m.common_optional()})</em></span>
						<!-- `type="text"` with a url inputmode, not `type="url"`: native validation would
						     reject a perfectly reasonable `example.edu/notes.pdf` typed without a
						     scheme, and the submit handler normalizes that instead — the same call the
						     source-URL field beside it already makes. -->
						<input
							type="text"
							inputmode="url"
							bind:value={url}
							maxlength="500"
							placeholder={m.submitMaterial_urlPlaceholder()}
						/>
						<span class="file-hint">{m.submitMaterial_urlHint()}</span>
					</label>
				</fieldset>

				<!-- Provenance, placed directly after the file: these two questions are about the file
				     that was just picked, and the uploader is the only person who can answer either —
				     a moderator reviewing the pending PDF cannot recover them from the bytes. -->
				<label class="field">
					<span>{m.submitMaterial_field_author()} <em>({m.common_optional()})</em></span>
					<input type="text" bind:value={author} maxlength="200" />
					<span class="file-hint">{m.submitMaterial_authorHint()}</span>
				</label>

				<label class="field">
					<span>{m.submitMaterial_field_sourceUrl()} <em>({m.common_optional()})</em></span>
					<input
						type="text"
						inputmode="url"
						bind:value={sourceUrl}
						maxlength="500"
						placeholder={m.submitMaterial_sourceUrlPlaceholder()}
					/>
					<span class="file-hint">{m.submitMaterial_sourceUrlHint()}</span>
				</label>

				<!-- Keyed on the branch rather than on `topics.length`, so the block still renders for a
				     branch that has no topics yet — which is precisely when proposing one is the thing
				     somebody needs, the same reasoning `/submit`'s own topic proposal already states. -->
				{#if branchId}
					<div class="field">
						<div class="field-heading">
							<span>{m.submitMaterial_field_coverage()} <em>({m.common_optional()})</em></span>
							<!-- Selecting the proposal, not merely refreshing the list: somebody who suggested
							     a topic did so because they wanted to file this material under it.
							     `proposeTaxonomyNode` answers with a SLUG, while a Topic's own frontend id is
							     the numeric pk (`mapTopic`), so the id has to be resolved off the refreshed
							     list rather than assumed equal to the slug. -->
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
							<ul class="requirements-list">
								{#each coverage as entry (entry.topicId)}
									<li>
										<span>{coverageTopicName(entry.topicId)} — {entry.level}%</span>
										<button type="button" onclick={() => removeCoverage(entry.topicId)}
											>&times;</button
										>
									</li>
								{/each}
							</ul>
						{/if}
						{#if availableCoverageTopics.length > 0}
							<div class="price-inputs">
								<select
									bind:value={coverageTopicId}
									aria-label={m.submitMaterial_coverageTopicLabel()}
								>
									<option value="">{m.submitMaterial_coverageTopicPlaceholder()}</option>
									<TaxonomyOptions nodes={availableCoverageTopics} />
								</select>
								<input
									type="text"
									inputmode="numeric"
									class="currency-input"
									aria-label={m.submitMaterial_coverageLevelLabel()}
									bind:value={coverageLevel}
								/>
								<button type="button" class="add-coverage-btn" onclick={addCoverage}>
									{m.submitMaterial_coverageAdd()}
								</button>
							</div>
						{/if}
						<span class="file-hint">{m.submitMaterial_coverageHint()}</span>
					</div>
				{/if}

				<div class="field">
					<span>{m.submitMaterial_field_requirements()} <em>({m.common_optional()})</em></span>
					{#if requirements.length > 0}
						<ul class="requirements-list">
							{#each requirements as requirement, index (index)}
								<li>
									<span>{requirement}</span>
									<button type="button" onclick={() => removeRequirement(index)}>&times;</button>
								</li>
							{/each}
						</ul>
					{/if}
					<input
						type="text"
						placeholder={m.submitMaterial_requirementsAddPlaceholder()}
						bind:value={requirementDraft}
						onkeydown={(e) => {
							// Enter belongs to the input method while a composition is open — see the
							// identical guard on /submit's own requirements input.
							if (isComposingKey(e)) return;
							if (e.key === 'Enter') {
								e.preventDefault();
								addRequirement();
							}
						}}
					/>
					<span class="file-hint">{m.submitMaterial_requirementsHint()}</span>
				</div>

				<div class="field-row">
					<label class="field">
						<span>{m.submitMaterial_field_price()} <em>({m.common_optional()})</em></span>
						<div class="price-inputs">
							<input
								type="text"
								inputmode="decimal"
								placeholder={m.submitMaterial_priceAmountPlaceholder()}
								bind:value={priceAmount}
							/>
							<select
								class="currency-input"
								aria-label={m.submitMaterial_field_priceCurrency()}
								bind:value={priceCurrency}
							>
								{#each MATERIAL_CURRENCIES as currency (currency)}
									<option value={currency}>{currency}</option>
								{/each}
							</select>
						</div>
					</label>
					<label class="field">
						<span>{m.submitMaterial_field_estimatedMinutes()} <em>({m.common_optional()})</em></span
						>
						<input
							type="text"
							inputmode="numeric"
							pattern="[0-9]*"
							placeholder={m.submitMaterial_estimatedMinutesPlaceholder()}
							bind:value={estimatedMinutes}
						/>
					</label>
				</div>

				<button type="submit" class="submit" disabled={!canSubmit || submitting}>
					{m.common_submit()}
				</button>
			</form>
		{/if}
	</div>
</FeatureGate>

{#if success}
	<!-- A centered modal, triggered the instant the submit resolves — not the old top-of-page
	     banner, which a submitter who had just clicked "Submit" at the bottom of a long form never
	     saw without scrolling back up. ModalShell is the same shell every other confirmation dialog
	     in this app already uses. -->
	<ModalShell title={m.submitMaterial_successTitle()} onClose={() => (success = false)}>
		<p class="success-body">
			{#if publishedMaterialId}
				{m.submitMaterial_successPublished()}
				<a href={resolve('/materials/[id]', { id: publishedMaterialId })}
					>{m.submitMaterial_viewMaterial()}</a
				>
			{:else}
				{m.submitMaterial_success()}
			{/if}
		</p>
		<button type="button" class="success-close" onclick={() => (success = false)}>
			{m.common_close()}
		</button>
	</ModalShell>
{/if}

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

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
	.subtitle {
		color: var(--text-secondary);
	}
	.login-prompt a {
		color: var(--accent);
		font-weight: 600;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
	.success-body {
		font-size: var(--font-size-sm);
		a {
			display: block;
			margin-top: var(--space-2);
			color: var(--accent);
			font-weight: 600;
		}
	}
	.success-close {
		@include mix.button-primary;
		margin-top: var(--space-3);
	}
	.submit-form {
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
		em {
			color: var(--text-secondary);
			font-weight: 400;
		}
	}
	// Label on the left, the quiet propose trigger on the right. `wrap` is the whole responsive
	// story: when the two no longer fit side by side the trigger drops to its own line rather than
	// crushing the label, and the control still sits underneath both.
	.field-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-1) var(--space-2);
	}
	.field-row {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-2);

		// Inside a half-width grid column there is no useful far side to push the trigger to —
		// right-aligning it only parks it hard against the NEXT column's label, which reads as if it
		// belonged to that field instead. Keep it next to the label it actually describes.
		.field-heading {
			justify-content: flex-start;
		}
	}
	input,
	select,
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font-family: inherit;
		resize: vertical;
	}
	.file-hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-weight: 400;
	}
	.file-picked {
		font-size: var(--font-size-xs);
		color: var(--accent);
		font-weight: 600;
	}
	.requirements-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		li {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-2);
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			font-weight: 400;
			font-size: var(--font-size-sm);
			button {
				background: none;
				border: none;
				color: var(--text-secondary);
				cursor: pointer;
				font-size: var(--font-size-base);
				line-height: 1;
				&:hover {
					color: var(--status-danger);
				}
			}
		}
	}
	.price-inputs {
		display: flex;
		gap: var(--space-2);
		input {
			flex: 1;
		}
		.currency-input {
			flex: 0 0 4.5em;
			text-transform: uppercase;
		}
	}
	.submit {
		@include mix.button-primary;
		align-self: flex-start;
	}
	.add-coverage-btn {
		@include mix.button-secondary;
		flex-shrink: 0;
	}
	.other-name {
		margin-top: var(--space-2);
		width: 100%;
	}
	.other-hint {
		margin-top: var(--space-1);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
