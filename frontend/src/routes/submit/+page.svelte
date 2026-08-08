<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Branch, Difficulty, Discipline, SourceType, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import {
		getBranchesForDiscipline,
		getDisciplines,
		getTopicsForBranch
	} from '$lib/services/taxonomy';
	import ProposeNodeButton from '$lib/components/discipline/ProposeNodeButton.svelte';
	import { submitExercise } from '$lib/services/submissions';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		DIFFICULTIES,
		DIFFICULTY_LABELS,
		SOURCE_TYPES,
		SOURCE_TYPE_LABELS
	} from '$lib/utils/labels';
	import { isComposingKey } from '$lib/utils/textInput';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import TaxonomyOptions from '$lib/components/shared/TaxonomyOptions.svelte';

	let fields = $state<Discipline[]>([]);
	let branches = $state<Branch[]>([]);
	let topics = $state<Topic[]>([]);

	let disciplineId = $state('');
	let branchId = $state('');
	let title = $state('');
	let difficulty = $state<Difficulty>('medium');
	let selectedTopicIds = $state<string[]>([]);
	let sourceType = $state<SourceType>('other');
	let sourceName = $state('');
	let statement = $state('');
	let hint = $state('');
	let answer = $state('');
	let solution = $state('');
	let locale = $state('pl');
	let tagsInput = $state('');
	// Free-text prerequisite/"skill tag" chips — same add-one-at-a-time interaction
	// submit-material/+page.svelte's own requirements editor already establishes for a Material,
	// applied here to Exercise for the first time.
	let requirements = $state<string[]>([]);
	let requirementDraft = $state('');
	let showPreview = $state(false);
	let success = $state(false);
	// ✅ Verified-contributor fast path (CLAUDE.md Section 18 item 4) — a submission from a verified
	// contributor comes back with status: 'approved' and a real resultingExerciseId already, since
	// the backend published it synchronously rather than queuing it (moderation/views.py's
	// ExerciseSubmissionViewSet.perform_create). This flag is what the template below reads to show
	// the right outcome and a real link, instead of always implying "awaiting review" regardless of
	// what actually happened.
	let publishedExerciseId = $state<string | null>(null);

	async function init() {
		fields = await getDisciplines();
		if (fields.length) await onFieldChange(fields[0].id);
	}
	init();

	// Discipline → Branch cascade — same pattern RandomExerciseButton.svelte's own filter popover
	// already establishes: picking a field resets the branch (and, transitively via the $effect
	// below, the topics) to that field's own first branch, rather than a flat, cross-field branch
	// list a submitter had to scroll through to find the right one.
	async function onFieldChange(next: string) {
		disciplineId = next;
		branches = disciplineId ? await getBranchesForDiscipline(disciplineId) : [];
		branchId = branches.length ? branches[0].id : '';
	}

	$effect(() => {
		if (!branchId) return;
		getTopicsForBranch(branchId).then((t) => {
			topics = t;
			selectedTopicIds = [];
		});
	});

	// "Covers" — chip-picker over the branch's own real Topics (a controlled vocabulary, unlike the
	// free-text requirement chips below): an "add topic" select offers only topics not yet picked;
	// picking one adds it immediately, shown as a removable chip, replacing the old plain checkbox
	// list with the same chip visual language MaterialCard's own "Covers"/"Requires" chips use.
	let availableTopics = $derived(topics.filter((t) => !selectedTopicIds.includes(t.id)));

	function addTopic(id: string) {
		if (!id || selectedTopicIds.includes(id)) return;
		selectedTopicIds = [...selectedTopicIds, id];
	}

	function removeTopic(id: string) {
		selectedTopicIds = selectedTopicIds.filter((t) => t !== id);
	}

	function addRequirement() {
		const trimmed = requirementDraft.trim();
		if (!trimmed) return;
		requirements = [...requirements, trimmed];
		requirementDraft = '';
	}

	function removeRequirement(index: number) {
		requirements = requirements.filter((_, i) => i !== index);
	}

	let canSubmit = $derived(Boolean(branchId && title.trim() && statement.trim()));

	async function handleSubmit() {
		if (!authStore.user || !canSubmit) return;
		const result = await submitExercise(branchId, authStore.user.id, {
			title: title.trim(),
			topicIds: selectedTopicIds,
			difficulty,
			source: { type: sourceType, name: sourceName.trim() || undefined },
			tags: tagsInput
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean),
			requirements: requirements.length > 0 ? requirements : undefined,
			statement,
			hint,
			answer,
			solution,
			locale
		});
		success = true;
		publishedExerciseId =
			result.status === 'approved' ? (result.resultingExerciseId ?? null) : null;
		title = statement = hint = answer = solution = sourceName = tagsInput = '';
		selectedTopicIds = [];
		requirements = [];
		requirementDraft = '';
	}
</script>

<svelte:head>
	<title>{m.submit_heading()} — {m.common_appName()}</title>
</svelte:head>

<FeatureGate feature="exercise_submissions">
	<div class="page">
		<h1>{m.submit_heading()}</h1>
		<!-- Reads the same isVerifiedContributor flag CoverageVoteWidget.svelte already reads for its own
	     2x-vote-weight note — same real tier, a second honest surface for it. -->
		<p class="subtitle">
			{authStore.user?.isVerifiedContributor ? m.submit_subtitleVerified() : m.submit_subtitle()}
		</p>

		{#if authStore.restoring}
			<p class="session-restoring">{m.common_loading()}</p>
		{:else if !authStore.isAuthenticated}
			<p data-session-hidden class="login-prompt">
				<a href={resolve('/login')}>{m.submit_loginRequired()}</a>
			</p>
		{:else}
			{#if success}
				<p class="notice">
					{#if publishedExerciseId}
						{m.submit_successPublished()}
						<a href={resolve('/exercises/[id]', { id: publishedExerciseId })}
							>{m.submit_viewExercise()}</a
						>
					{:else}
						{m.submit_success()}
					{/if}
				</p>
			{/if}

			<form class="submit-form" onsubmit={(e) => (e.preventDefault(), handleSubmit())}>
				<!-- The propose trigger sits on the label's own row rather than below the control. Under
				     it, it read as a second action belonging to the form; beside the label it reads as a
				     footnote about that one field, which is what it is. `.field-heading` wraps, so on a
				     narrow screen the trigger drops onto its own line instead of squeezing the label. -->
				<div class="field">
					<div class="field-heading">
						<label for="submit-discipline">{m.submit_field_field()}</label>
						<!-- Selecting what was just proposed rather than only refreshing the list: somebody
						     who suggested a discipline did so BECAUSE they wanted to file under it. -->
						<ProposeNodeButton
							kind="discipline"
							onproposed={async (slug) => {
								fields = await getDisciplines();
								await onFieldChange(slug);
							}}
						/>
					</div>
					<select
						id="submit-discipline"
						value={disciplineId}
						onchange={(e) => onFieldChange(e.currentTarget.value)}
					>
						<TaxonomyOptions nodes={fields} />
					</select>
				</div>

				<div class="field">
					<div class="field-heading">
						<label for="submit-branch">{m.submit_field_course()}</label>
						{#if disciplineId}
							<ProposeNodeButton
								kind="branch"
								parent={disciplineId}
								onproposed={async (slug) => {
									branches = await getBranchesForDiscipline(disciplineId);
									branchId = slug;
								}}
							/>
						{/if}
					</div>
					<select id="submit-branch" bind:value={branchId}>
						<TaxonomyOptions nodes={branches} />
					</select>
				</div>

				<label class="field">
					<span>{m.submit_field_title()}</span>
					<input type="text" bind:value={title} required />
				</label>

				<div class="field-row">
					<label class="field">
						<span>{m.submit_field_difficulty()}</span>
						<select bind:value={difficulty}>
							{#each DIFFICULTIES as d (d)}
								<option value={d}>{DIFFICULTY_LABELS[d]()}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>{m.submit_field_sourceType()}</span>
						<select bind:value={sourceType}>
							{#each SOURCE_TYPES as s (s)}
								<option value={s}>{SOURCE_TYPE_LABELS[s]()}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>{m.submit_field_language()}</span>
						<select bind:value={locale}>
							<option value="pl">PL</option>
							<option value="en">EN</option>
						</select>
					</label>
				</div>

				{#if topics.length}
					<div class="field">
						<div class="field-heading">
							<span>{m.submit_field_topics()}</span>
							<!-- The case this whole feature exists for: an exercise on measure theory with no
							     `teoria-miary` topic to file it under. Offered even when the list is empty,
							     which is exactly when it is most needed. -->
							{#if branchId}
								<ProposeNodeButton
									kind="topic"
									parent={branchId}
									onproposed={async () => {
										topics = await getTopicsForBranch(branchId);
									}}
								/>
							{/if}
						</div>
						{#if selectedTopicIds.length > 0}
							<ul class="chip-list">
								{#each selectedTopicIds as id (id)}
									{@const topic = topics.find((t) => t.id === id)}
									{#if topic}
										<li>
											<span>{topic.name}</span>
											<button type="button" onclick={() => removeTopic(id)}>&times;</button>
										</li>
									{/if}
								{/each}
							</ul>
						{/if}
						{#if availableTopics.length > 0}
							<select
								value=""
								onchange={(e) => (addTopic(e.currentTarget.value), (e.currentTarget.value = ''))}
							>
								<option value="" disabled>{m.submit_topicsAddPlaceholder()}</option>
								<TaxonomyOptions nodes={availableTopics} />
							</select>
						{/if}
					</div>
				{/if}

				<label class="field">
					<span>{m.submit_field_sourceName()} <em>({m.common_optional()})</em></span>
					<input type="text" bind:value={sourceName} />
				</label>

				<label class="field">
					<span>{m.submit_field_statement()}</span>
					<textarea rows="4" bind:value={statement} required></textarea>
				</label>
				<label class="field">
					<span>{m.submit_field_hint()} <em>({m.common_optional()})</em></span>
					<textarea rows="2" bind:value={hint}></textarea>
				</label>
				<label class="field">
					<span>{m.submit_field_answer()} <em>({m.common_optional()})</em></span>
					<textarea rows="2" bind:value={answer}></textarea>
				</label>
				<label class="field">
					<span>{m.submit_field_solution()} <em>({m.common_optional()})</em></span>
					<textarea rows="4" bind:value={solution}></textarea>
				</label>

				<p class="markdown-hint">{m.submit_markdownHint()}</p>

				<label class="field">
					<span>{m.submit_field_tags()}</span>
					<input type="text" bind:value={tagsInput} />
				</label>

				<div class="field">
					<span>{m.submit_field_requirements()} <em>({m.common_optional()})</em></span>
					{#if requirements.length > 0}
						<ul class="chip-list">
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
						placeholder={m.submit_requirementsAddPlaceholder()}
						bind:value={requirementDraft}
						onkeydown={(e) => {
							// Mid-composition, Enter means "accept the candidate I am looking at" — so
							// acting on it here would add a chip holding a half-typed word and break the
							// composition at the same time. Nothing is preventDefault'ed in that case
							// either: the key belongs to the input method.
							if (isComposingKey(e)) return;
							if (e.key === 'Enter') {
								e.preventDefault();
								addRequirement();
							}
						}}
					/>
					<span class="markdown-hint">{m.submit_requirementsHint()}</span>
				</div>

				<button type="button" class="preview-toggle" onclick={() => (showPreview = !showPreview)}>
					{m.submit_preview()}
				</button>
				{#if showPreview}
					<!-- Every field the reader will eventually see, not the statement alone. Previewing the
					     statement only left the three fields where the fiddliest LaTeX usually goes — a
					     hint's inline fragment, an answer, a multi-step solution — unverifiable until after
					     the thing had been submitted, which is exactly when it stops being editable.
					     The optional three are omitted entirely when empty rather than rendered as an empty
					     labelled box, the same restraint MaterialCard already applies to a price nobody set. -->
					<div class="preview">
						<section>
							<h2>{m.submit_field_statement()}</h2>
							<MathContent source={statement || '*(empty)*'} />
						</section>
						{#if hint.trim()}
							<section>
								<h2>{m.submit_field_hint()}</h2>
								<MathContent source={hint} />
							</section>
						{/if}
						{#if answer.trim()}
							<section>
								<h2>{m.submit_field_answer()}</h2>
								<MathContent source={answer} />
							</section>
						{/if}
						{#if solution.trim()}
							<section>
								<h2>{m.submit_field_solution()}</h2>
								<MathContent source={solution} />
							</section>
						{/if}
					</div>
				{/if}

				<button type="submit" class="submit" disabled={!canSubmit}>{m.common_submit()}</button>
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
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-2);
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
	.chip-list {
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
		}
		button {
			@include mix.focus-ring;
			background: none;
			border: none;
			color: var(--text-secondary);
			cursor: pointer;
			font-size: var(--font-size-md);
			line-height: 1;
			&:hover {
				color: var(--status-danger);
			}
		}
	}
	.markdown-hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.preview-toggle {
		@include mix.button-secondary;
		align-self: flex-start;
	}
	.preview {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);

		h2 {
			font-size: var(--font-size-xs);
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
			margin-bottom: var(--space-1);
		}
		// A rule between sections, not around each — the point of the preview is reading the four
		// fields as one exercise, which is how they will actually be read.
		section + section {
			border-top: 1px solid var(--border-color);
			padding-top: var(--space-3);
		}
	}
	.submit {
		@include mix.button-primary;
		align-self: flex-start;
	}
</style>
