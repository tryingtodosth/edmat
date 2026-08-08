<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Branch, MaterialCoverageDraft, MaterialType, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getAllBranches, getTopicsForBranch } from '$lib/services/taxonomy';
	import { submitMaterial } from '$lib/services/materials';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { MATERIAL_CURRENCIES } from '$lib/utils/labels';
	import { isComposingKey } from '$lib/utils/textInput';
	import { materialTypesStore } from '$lib/state/materialTypes.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import ProposeNodeButton from '$lib/components/discipline/ProposeNodeButton.svelte';
	import TaxonomyOptions from '$lib/components/shared/TaxonomyOptions.svelte';

	// "exams, tests, etc. — usually a PDF/PNG, but a whole LaTeX/Word document should be accepted
	// too, scanned and kept safe" — the actual real content-type sniffing + optional malware scan
	// both run server-side (materials/validators.py); this `accept` attribute is a real, matching
	// convenience for the file PICKER, not the security boundary itself — the backend still
	// re-checks every upload's real bytes regardless of what this hints the OS file dialog toward.
	const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.tex,.doc,.docx,.odt';

	let branches = $state<Branch[]>([]);
	let branchId = $state('');
	let topics = $state<Topic[]>([]);
	let type = $state<MaterialType>('examCollection');
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

	async function init() {
		branches = await getAllBranches();
		if (branches.length) branchId = branches[0].id;
	}
	init();

	$effect(() => {
		if (!branchId) return;
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
	let canSubmit = $derived(Boolean(branchId && title.trim() && (file || url.trim())));

	/** The backend field is a real `URLField`, which rejects a bare `example.edu/x.pdf` outright.
	 * Someone typing a link by hand very reasonably omits the scheme, so prepend `https://` when
	 * none is present rather than bouncing the whole submission back over it. */
	function normalizeUrl(value: string): string | undefined {
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	}

	async function handleSubmit() {
		if (!authStore.user || !canSubmit) return;
		errorMessage = '';
		submitting = true;
		try {
			await submitMaterial(
				{
					branchId,
					type,
					title: title.trim(),
					description: description.trim(),
					locale,
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
			title = description = '';
			author = sourceUrl = '';
			file = null;
			url = '';
			requirements = [];
			requirementDraft = '';
			coverage = [];
			priceAmount = '';
			estimatedMinutes = '';
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
		<p class="subtitle">{m.submitMaterial_subtitle()}</p>

		{#if !authStore.isAuthenticated}
			<p class="login-prompt"><a href={resolve('/login')}>{m.submitMaterial_loginRequired()}</a></p>
		{:else}
			{#if success}
				<p class="notice">{m.submitMaterial_success()}</p>
			{/if}
			{#if errorMessage}
				<p class="error">{errorMessage}</p>
			{/if}

			<form class="submit-form" onsubmit={(e) => (e.preventDefault(), handleSubmit())}>
				<!-- The branch this material belongs to. Unlike /submit there is no discipline step
				     here — the list is every branch, flat — which is exactly why suggesting a new one
				     was unreachable from this page: a branch needs a discipline, and this form has
				     none to hand. The dialog asks for it instead. -->
				<div class="field">
					<div class="field-heading">
						<label for="submit-material-branch">{m.submitMaterial_field_course()}</label>
						<ProposeNodeButton
							kind="branch"
							onproposed={async (slug) => {
								branches = await getAllBranches();
								branchId = slug;
							}}
						/>
					</div>
					<select id="submit-material-branch" bind:value={branchId}>
						<TaxonomyOptions nodes={branches} />
					</select>
				</div>

				<label class="field">
					<span>{m.submitMaterial_field_title()}</span>
					<input type="text" bind:value={title} required />
				</label>

				<div class="field-row">
					<!-- The propose trigger sits on the label's own row rather than below the control, so it
					     reads as a footnote about this one field instead of a second action belonging to
					     the form. `.field-heading` wraps — and this field is a grid column barely half the
					     form wide, so it genuinely does wrap here rather than only on a phone. -->
					<div class="field">
						<div class="field-heading">
							<label for="submit-material-type">{m.submitMaterial_field_type()}</label>
							<!-- The case this exists for: a document that is genuinely not one of the thirteen
							     kinds somebody guessed at from a seven-material corpus. -->
							<ProposeNodeButton
								kind="material_type"
								onproposed={async (slug) => {
									await materialTypesStore.refresh();
									type = slug;
								}}
							/>
						</div>
						<!-- The vocabulary, not a fixed list: anything somebody has proposed appears under
						     "Others" via TaxonomyOptions, exactly as a proposed discipline does. -->
						<select id="submit-material-type" bind:value={type}>
							<TaxonomyOptions nodes={typeOptions} />
						</select>
					</div>
					<label class="field">
						<span>{m.submitMaterial_field_language()}</span>
						<select bind:value={locale}>
							<option value="pl">PL</option>
							<option value="en">EN</option>
						</select>
					</label>
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
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
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
</style>
