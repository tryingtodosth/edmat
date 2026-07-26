<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Course, Difficulty, SourceType, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getAllCourses, getTopicsForCourse } from '$lib/services/taxonomy';
	import { submitExercise } from '$lib/services/submissions';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		DIFFICULTIES,
		DIFFICULTY_LABELS,
		SOURCE_TYPES,
		SOURCE_TYPE_LABELS
	} from '$lib/utils/labels';
	import MathContent from '$lib/components/shared/MathContent.svelte';

	let courses = $state<Course[]>([]);
	let topics = $state<Topic[]>([]);

	let courseId = $state('');
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
		courses = await getAllCourses();
		if (courses.length) courseId = courses[0].id;
	}
	init();

	$effect(() => {
		if (!courseId) return;
		getTopicsForCourse(courseId).then((t) => {
			topics = t;
			selectedTopicIds = [];
		});
	});

	function toggleTopic(id: string) {
		selectedTopicIds = selectedTopicIds.includes(id)
			? selectedTopicIds.filter((t) => t !== id)
			: [...selectedTopicIds, id];
	}

	let canSubmit = $derived(Boolean(courseId && title.trim() && statement.trim()));

	async function handleSubmit() {
		if (!authStore.user || !canSubmit) return;
		const result = await submitExercise(courseId, authStore.user.id, {
			title: title.trim(),
			topicIds: selectedTopicIds,
			difficulty,
			source: { type: sourceType, name: sourceName.trim() || undefined },
			tags: tagsInput
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean),
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
	}
</script>

<svelte:head>
	<title>{m.submit_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.submit_heading()}</h1>
	<!-- Reads the same isVerifiedContributor flag CoverageVoteWidget.svelte already reads for its own
	     2x-vote-weight note — same real tier, a second honest surface for it. -->
	<p class="subtitle">
		{authStore.user?.isVerifiedContributor ? m.submit_subtitleVerified() : m.submit_subtitle()}
	</p>

	{#if !authStore.isAuthenticated}
		<p class="login-prompt"><a href={resolve('/login')}>{m.submit_loginRequired()}</a></p>
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
			<label class="field">
				<span>{m.submit_field_course()}</span>
				<select bind:value={courseId}>
					{#each courses as c (c.id)}
						<option value={c.id}>{c.name}</option>
					{/each}
				</select>
			</label>

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
					<span>{m.submit_field_topics()}</span>
					<div class="topic-checks">
						{#each topics as topic (topic.id)}
							<label class="checkbox">
								<input
									type="checkbox"
									checked={selectedTopicIds.includes(topic.id)}
									onchange={() => toggleTopic(topic.id)}
								/>
								{topic.name}
							</label>
						{/each}
					</div>
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

			<button type="button" class="preview-toggle" onclick={() => (showPreview = !showPreview)}>
				{m.submit_preview()}
			</button>
			{#if showPreview}
				<div class="preview">
					<MathContent source={statement || '*(empty)*'} />
				</div>
			{/if}

			<button type="submit" class="submit" disabled={!canSubmit}>{m.common_submit()}</button>
		</form>
	{/if}
</div>

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
	.topic-checks {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.checkbox {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-weight: 400;
		font-size: var(--font-size-xs);
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
	}
	.submit {
		@include mix.button-primary;
		align-self: flex-start;
	}
</style>
