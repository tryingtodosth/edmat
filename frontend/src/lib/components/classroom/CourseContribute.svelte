<script lang="ts">
	// Offering a material or an exercise to a course.
	//
	// It says up front whether the thing will appear immediately or wait for review, because that is
	// the single most useful sentence here: somebody who submits and then cannot find their material
	// assumes it failed. `contributionNeedsApproval` is resolved per viewer server-side, so staff —
	// who never queue behind themselves — correctly see the other message.
	//
	// Content is REFERENCED by id, never uploaded here: a course points at materials and exercises
	// that already exist in the corpus, so a corrected exercise stays corrected everywhere and a
	// course never becomes a silently diverging fork. Uploading something new is the existing
	// /submit-material flow, which is a different job.
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import type { TaughtCourse } from '$lib/types/classroom';

	let {
		course,
		busy = false,
		error = '',
		notice = '',
		onsubmit
	}: {
		course: TaughtCourse;
		busy?: boolean;
		error?: string;
		notice?: string;
		onsubmit?: (input: {
			kind: 'material' | 'exercise';
			id: string;
			chapterId: string | null;
			note: string;
		}) => void;
	} = $props();

	let kind = $state<'material' | 'exercise'>('material');
	let itemId = $state('');
	let chapterId = $state('');
	let note = $state('');

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = itemId.trim();
		if (!trimmed) return;
		onsubmit?.({ kind, id: trimmed, chapterId: chapterId || null, note: note.trim() });
		itemId = '';
		note = '';
	}
</script>

<section class="contribute">
	<h2>{m.classroom_contribute_heading()}</h2>

	<p class="hint">
		{course.contributionNeedsApproval
			? m.classroom_contribute_willWait()
			: m.classroom_contribute_willPublish()}
	</p>

	<form onsubmit={submit}>
		<label class="field">
			<span>{m.classroom_contribute_kind()}</span>
			<select bind:value={kind}>
				<option value="material">{m.classroom_items_material()}</option>
				<option value="exercise">{m.classroom_items_exercise()}</option>
			</select>
		</label>

		<label class="field">
			<span>
				{kind === 'material'
					? m.classroom_contribute_materialId()
					: m.classroom_contribute_exerciseId()}
			</span>
			<input type="text" bind:value={itemId} inputmode="numeric" required />
			<!-- Honest about the gap: there is no picker yet, so the id from the item's own page is the
			     real way to name it. Browsing links are right there for finding one. -->
			<span class="hint">
				{m.classroom_contribute_idHint()}
				<a href={kind === 'material' ? resolve('/materials') : resolve('/fields')}>
					{m.classroom_items_openLink()}
				</a>
			</span>
		</label>

		{#if course.canCurate && course.chapters.length > 0}
			<label class="field">
				<span>{m.classroom_items_moveTo()}</span>
				<select bind:value={chapterId}>
					<option value="">{m.classroom_items_moveNone()}</option>
					{#each course.chapters as chapter (chapter.id)}
						<option value={chapter.id}>{chapter.title}</option>
					{/each}
				</select>
			</label>
		{/if}

		<label class="field wide">
			<span>{m.classroom_contribute_note()}</span>
			<input type="text" bind:value={note} maxlength="500" />
		</label>

		<button type="submit" class="primary" disabled={busy}>
			{m.classroom_contribute_submit()}
		</button>
	</form>

	{#if notice}
		<p class="notice">{notice}</p>
	{/if}
	{#if error}
		<p class="error">{error}</p>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.contribute {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	form {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.wide {
		flex: 1;
		min-width: 12rem;
	}
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.notice {
		font-size: var(--font-size-sm);
		color: var(--status-info);
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger, #c0392b);
	}
	input,
	select {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	.primary {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-3);
		border: none;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--bg-surface);
		cursor: pointer;
	}
</style>
