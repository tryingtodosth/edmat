<script lang="ts">
	// A new material, in one form. Since co-authoring (COAUTHORING-BRIEF.md §0) this is "a project
	// with a team of one": the submit creates the project and its first version and asks the server
	// to publish that version in the same request. The form, its fields and its switch did not
	// change — `material_submissions` still gates it, because bringing a NEW material into being is
	// that switch's ability, and `coauthoring` (collaborating on one that exists) is a different one.
	// What happens next is the server's call and this page reads it rather than assuming: staff, a
	// verified contributor or a governor of the branch publish at once; anybody else's first
	// publication waits in the moderation queue's Materials tab for a person to read it.
	import AudienceSelect from '$lib/components/shared/AudienceSelect.svelte';
	import type { Audience } from '$lib/types';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Branch, Discipline, MaterialType, Topic } from '$lib/types';
	import type { MaterialProject, ProjectCoverageDraft } from '$lib/types/materialProject';
	import { m } from '$lib/paraglide/messages.js';
	import {
		getBranchesForDiscipline,
		getDisciplines,
		getTopicsForBranch,
		proposeTaxonomyNode
	} from '$lib/services/taxonomy';
	import { createProject, ProjectRefusedError } from '$lib/services/materialProjects';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { MATERIAL_CURRENCIES } from '$lib/utils/labels';
	import { isComposingKey } from '$lib/utils/textInput';
	import { materialTypesStore } from '$lib/state/materialTypes.svelte';
	import { COAUTHORING_FLAG, refusalMessage } from '$lib/components/coauthoring/labels';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import ProposeNodeButton from '$lib/components/discipline/ProposeNodeButton.svelte';
	import TaxonomyOptions, { OTHER_VALUE } from '$lib/components/shared/TaxonomyOptions.svelte';
	import { pageTitle } from '$lib/utils/pageTitle';

	// "exams, tests, etc. — usually a PDF/PNG, but a whole LaTeX/Word document should be accepted
	// too, scanned and kept safe" — the actual real content-type sniffing + optional malware scan
	// both run server-side (materials/validators.py); this `accept` attribute is a real, matching
	// convenience for the file PICKER, not the security boundary itself — the backend still
	// re-checks every upload's real bytes regardless of what this hints the OS file dialog toward.
	const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.webp,.tex,.doc,.docx,.odt';

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
	// The BACKEND SLUG, not the camelCase frontend name: the picker's options are keyed by slug
	// (`typeOptions` below, because a proposed kind only ever has one), so seeding this with
	// `examCollection` left the select with nothing selected while the form went on sending "exam
	// collection" — a picker that showed blank and submitted a value. Found by looking at the page.
	let type = $state<MaterialType>('exam_collection');
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
	/**
	 * What the submit actually did, read off the server's answer — never assumed from which button
	 * was pressed:
	 *   published — the project has a material (`materialId`), live now;
	 *   queued    — no material yet: the first version waits in the moderation queue;
	 *   draft     — the head came back still a draft, i.e. the server saved it without publishing.
	 *               The contract says that does not happen with `publish`; if it ever does, the page
	 *               says "draft" rather than "awaiting review", because nobody would be reviewing it.
	 */
	type Outcome =
		| { kind: 'published'; materialId: string }
		| { kind: 'queued'; projectId: string }
		| { kind: 'draft'; projectId: string };
	let outcome = $state<Outcome | null>(null);
	let errorMessage = $state('');
	/** The server's own message per refused field, drawn under that field (keyed by the API's field
	 *  name). A file refusal is not in here: it gets one of the two sentences in `describeFailure`. */
	let fieldErrors = $state<Record<string, string>>({});

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

	// "Covers" — topic + level only: a subtopic breakdown is a votable claim on a material that
	// exists, added from its page after publication, and a draft project's catalogue carries plain
	// `{topic, level, kind}` triples (ProjectCoverageDraft). Every row here is a `covers` claim.
	// `coverageLevel` is text/`inputmode="numeric"`, not `type="number"`, the same real,
	// live-reproduced Svelte 5 `bind:value` mismatch this file's own doc comment above already
	// explains for `priceAmount`/`estimatedMinutes`.
	let coverage = $state<ProjectCoverageDraft[]>([]);
	let coverageTopicId = $state('');
	let coverageLevel = $state('50');

	function addCoverage() {
		if (!coverageTopicId) return;
		const level = Number(coverageLevel);
		if (!Number.isFinite(level) || level < 1 || level > 100) return;
		if (coverage.some((c) => c.topicId === coverageTopicId)) return;
		coverage = [...coverage, { topicId: coverageTopicId, level, kind: 'covers' }];
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

	// A file OR a link — never neither, and never both: a version carries exactly one payload, and
	// the server would keep the file and silently drop the link rather than refuse the pair. Checked
	// here so the button is honest rather than the refusal (or the loss) arriving after a submit; the
	// "one or the other" hint above the two fields turns into the warning it is while both are set.
	let bothPayloads = $derived(Boolean(file) && Boolean(url.trim()));
	let canSubmit = $derived(
		Boolean(branchId && title.trim() && (file || url.trim())) &&
			!bothPayloads &&
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

	/** The API's field names this form draws a note under. Every other field it could refuse is one
	 *  the form itself never lets go wrong (the band, the kind), so a refusal there falls through to
	 *  the page-level sentence. */
	const NOTED_FIELDS = [
		'branch',
		'title',
		'type',
		'locale',
		'description',
		'url',
		'author',
		'source_url',
		'coverage',
		'requirements',
		'price_amount',
		'price_currency',
		'estimated_minutes'
	];

	/**
	 * The sentence for a refused submit, and the per-field notes that go with it.
	 *
	 * A refused FILE keeps the two sentences this form has always had — the verified-contributors
	 * one when that is the reason (`material_uploads_verified_only`, which the server reports on the
	 * `file` field in its own words, matched below), the "couldn't be accepted" one for everything
	 * else a file can fail (type, size, the scan). Any other refused field is named where it is,
	 * with the server's own message, which is the precedent the guardian and contribution forms set.
	 * A refusal that carries a reason (`{detail: 'minor'}`) gets that reason's sentence, and a 403
	 * means the switch went off while the form was open.
	 */
	function describeFailure(error: unknown): { message: string; fields: Record<string, string> } {
		if (error instanceof ProjectRefusedError) {
			return { message: refusalMessage(error.reason), fields: {} };
		}
		if (error instanceof ApiError && error.status === 403) {
			return { message: m.featureFlags_disabledNotice(), fields: {} }; // "This feature is currently unavailable — please check back later."
		}
		if (error instanceof ApiError && error.status === 400) {
			const body = (error.body ?? {}) as Record<string, unknown>;
			const said = (key: string): string[] => {
				const value = body[key];
				if (Array.isArray(value)) return value.map(String);
				return typeof value === 'string' ? [value] : [];
			};
			const fileErrors = said('file');
			if (fileErrors.length > 0) {
				// The server's sentence: coauthoring/services.py `_require_verified_contributor_for_uploads`.
				const verifiedOnly = fileErrors.some((text) => /verified contributor/i.test(text));
				return {
					message: verifiedOnly
						? m.submitMaterial_verifiedContributorsOnly() // "Material uploads are currently limited to verified contributors. …"
						: m.submitMaterial_uploadFailed(), // "This file couldn't be accepted — …"
					fields: {}
				};
			}
			const fields: Record<string, string> = {};
			for (const key of NOTED_FIELDS) {
				const text = said(key).join(' ');
				if (text) fields[key] = text;
			}
			if (Object.keys(fields).length > 0) {
				return { message: m.submitMaterial_checkFields(), fields }; // "Some details were not accepted — see the notes under the fields."
			}
		}
		return {
			// Anything else — a proxy's own 413, a dropped connection — is most likely the upload
			// when there was one, and honestly unknown when there was not.
			message: file ? m.submitMaterial_uploadFailed() : m.common_error_generic(),
			fields: {}
		};
	}

	/** Reads what the create request did — see `Outcome`. */
	function outcomeOf(project: MaterialProject): Outcome {
		if (project.materialId) return { kind: 'published', materialId: project.materialId };
		if (project.headVersion?.status === 'draft') return { kind: 'draft', projectId: project.id };
		return { kind: 'queued', projectId: project.id };
	}

	// The project page (and the version pages under it) sit behind the `coauthoring` switch, which
	// staff bypass the way FeatureGate does. Offering a link into a page that would only say "this
	// feature is unavailable" is a link that lies about where it goes.
	let canOpenProject = $derived(
		featureFlagsStore.isEnabled(COAUTHORING_FLAG) || authStore.isModerator
	);

	async function handleSubmit() {
		if (!audience) return;
		if (!authStore.user || !canSubmit) return;
		errorMessage = '';
		fieldErrors = {};
		submitting = true;
		// Which half failed decides which sentence is true: a refused "Other…" proposal is not a file
		// that could not be accepted.
		let stage: 'taxonomy' | 'material' = 'taxonomy';
		try {
			const filedBranchId = await resolveBranch();
			const filedType = await resolveMaterialType();
			stage = 'material';
			const project = await createProject(
				{
					branchId: filedBranchId,
					locale,
					type: filedType,
					audience: audience as Audience,
					author: author.trim() || undefined,
					sourceUrl: normalizeUrl(sourceUrl),
					requirements: requirements.length > 0 ? requirements : undefined,
					coverage: coverage.length > 0 ? coverage : undefined,
					priceAmount: priceAmount.trim() ? Number(priceAmount) : undefined,
					priceCurrency: priceAmount.trim() ? priceCurrency.trim() || 'PLN' : undefined,
					estimatedMinutes: estimatedMinutes.trim() ? Number(estimatedMinutes) : undefined,
					// Version 1: the file when there is one, otherwise the link — `canSubmit` has
					// already made sure it is exactly one of the two.
					version: {
						kind: file ? 'file' : 'link',
						title: title.trim(),
						description: description.trim(),
						url: file ? undefined : normalizeUrl(url)
					}
				},
				file,
				{ publish: true }
			);
			outcome = outcomeOf(project);
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
			if (stage === 'taxonomy') {
				errorMessage = m.common_error_generic(); // "Something went wrong."
			} else {
				const failure = describeFailure(e);
				errorMessage = failure.message;
				fieldErrors = failure.fields;
			}
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(m.submitMaterial_heading())}</title>
</svelte:head>

<!-- The server's own message for a refused field, under the field it refused. One snippet rather
     than a line per field: the keys are the API's field names, and a price refusal can name either
     half of the pair. -->
{#snippet fieldNote(keys: string[])}
	{@const text = keys
		.map((key) => fieldErrors[key])
		.filter(Boolean)
		.join(' ')}
	{#if text}
		<span class="field-error">{text}</span>
	{/if}
{/snippet}

<FeatureGate feature="material_submissions">
	<div class="page">
		<h1>{m.submitMaterial_heading()}</h1>
		<!-- Reads the same isVerifiedContributor flag /submit's own subtitle already reads, and the
		     fast path it promises is real: `access.can_autopublish_first` publishes a first
		     publication at once for staff, a verified contributor or a governor of the branch. It
		     cannot name the governor case in advance (that depends on the branch picked below), so it
		     says the honest general thing and the confirmation says what actually happened. -->
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
		{:else if authStore.user?.isMinor}
			<!-- Said here rather than after a filled-in form is refused: creating a material publishes
			     something under somebody's name with nobody in between, which is the one thing a minor's
			     account may not do (COAUTHORING-BRIEF.md §0). Proposing a change to a material that
			     exists stays open to them — a person always reads a proposal. -->
			<p class="minor-notice">{m.submitMaterial_minorBlocked()}</p>
			<!-- "An account belonging to someone under 18 cannot add a new material. You can still
			     suggest a change to a material that already exists, from its own page." -->
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
					{@render fieldNote(['branch'])}
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
						maxlength="300"
						placeholder={m.submitMaterial_titlePlaceholder()}
						required
					/>
					{@render fieldNote(['title'])}
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
						{@render fieldNote(['type'])}
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
						{@render fieldNote(['locale'])}
					</label>
					<AudienceSelect bind:value={audience} />
				</div>

				<label class="field">
					<span>{m.submitMaterial_field_description()} <em>({m.common_optional()})</em></span>
					<textarea rows="3" bind:value={description}></textarea>
					{@render fieldNote(['description'])}
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
					<!-- The rule, and the refusal when it is broken: a version holds exactly one payload, so
					     filling in both is the one state the submit button will not take. -->
					<p class="file-hint" class:hint-refused={bothPayloads}>
						{m.submitMaterial_whereHint()}
					</p>

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
						{@render fieldNote(['url'])}
					</label>
				</fieldset>

				<!-- Provenance, placed directly after the file: these two questions are about the file
				     that was just picked, and the uploader is the only person who can answer either —
				     a moderator reviewing the pending PDF cannot recover them from the bytes. -->
				<label class="field">
					<span>{m.submitMaterial_field_author()} <em>({m.common_optional()})</em></span>
					<input type="text" bind:value={author} maxlength="200" />
					<span class="file-hint">{m.submitMaterial_authorHint()}</span>
					{@render fieldNote(['author'])}
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
					{@render fieldNote(['source_url'])}
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
						{@render fieldNote(['coverage'])}
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
					{@render fieldNote(['requirements'])}
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
						{@render fieldNote(['price_amount', 'price_currency'])}
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
						{@render fieldNote(['estimated_minutes'])}
					</label>
				</div>

				<button type="submit" class="submit" disabled={!canSubmit || submitting}>
					{m.common_submit()}
				</button>
			</form>
		{/if}
	</div>
</FeatureGate>

{#if outcome}
	<!-- A centered modal, triggered the instant the submit resolves — not the old top-of-page
	     banner, which a submitter who had just clicked "Submit" at the bottom of a long form never
	     saw without scrolling back up. ModalShell is the same shell every other confirmation dialog
	     in this app already uses.

	     Three outcomes, three sentences: live now, waiting for a moderator, or saved as a draft
	     nobody is reviewing. The link into the project is offered for the last two, since that is
	     where the decision will show up and where co-authors can be invited — but only while that
	     page is reachable (`coauthoring`, staff bypassing it). -->
	<ModalShell title={m.submitMaterial_successTitle()} onClose={() => (outcome = null)}>
		<p class="success-body">
			{#if outcome.kind === 'published'}
				{m.submitMaterial_successPublished()}
				<!-- "Published! Your material is live now — thanks for contributing." -->
				<a href={resolve('/materials/[id]', { id: outcome.materialId })}
					>{m.submitMaterial_viewMaterial()}</a
				>
				<!-- "View material" -->
			{:else}
				{#if outcome.kind === 'queued'}
					{m.submitMaterial_success()}
					<!-- "Thanks! Your material was submitted and is awaiting review." -->
				{:else}
					{m.coauth_new_created()}
					<!-- "The project exists and the first version is saved as a draft. Publish it when it
					     is ready." -->
				{/if}
				{#if canOpenProject}
					<a href={resolve('/material-projects/[id]', { id: outcome.projectId })}
						>{m.submitMaterial_viewProject()}</a
					>
					<!-- "Open its project page" -->
				{/if}
			{/if}
		</p>
		<button type="button" class="success-close" onclick={() => (outcome = null)}>
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
	// The same hint, now the reason the submit button will not move.
	.hint-refused {
		color: var(--status-danger);
		font-weight: 600;
	}
	// The server's own words about one field, under that field.
	.field-error {
		font-size: var(--font-size-xs);
		color: var(--status-danger);
		font-weight: 600;
	}
	.minor-notice {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
		align-self: flex-start;
		white-space: normal;
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
