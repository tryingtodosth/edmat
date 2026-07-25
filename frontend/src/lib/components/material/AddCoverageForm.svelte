<script lang="ts">
	import { untrack } from 'svelte';
	import type { Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';

	let {
		topics,
		onSubmit,
		onCancel
	}: {
		topics: Topic[];
		onSubmit: (input: { topicId: string; subtopicName: string; level: number }) => void;
		onCancel: () => void;
	} = $props();

	let topicId = $state(untrack(() => topics[0]?.id ?? ''));
	let subtopicName = $state('');
	let level = $state(50);

	function submit() {
		if (!topicId) return;
		onSubmit({ topicId, subtopicName: subtopicName.trim(), level });
	}
</script>

<form class="add-coverage" onsubmit={(e) => (e.preventDefault(), submit())}>
	<p class="add-coverage__intro">{m.coverage_addIntro()}</p>

	<label class="field">
		<span>{m.coverage_topicLabel()}</span>
		<select bind:value={topicId}>
			{#each topics as topic (topic.id)}
				<option value={topic.id}>{topic.name}</option>
			{/each}
		</select>
	</label>

	<label class="field">
		<span>{m.coverage_subtopicLabel()} <span class="optional">({m.common_optional()})</span></span>
		<input type="text" bind:value={subtopicName} placeholder={m.coverage_subtopicPlaceholder()} />
	</label>

	<label class="field">
		<span>{m.coverage_levelLabel({ level })}</span>
		<input type="range" min="1" max="100" bind:value={level} />
		<span class="level-hint">{m.coverage_levelHint()}</span>
	</label>

	<div class="add-coverage__actions">
		<button type="button" class="cancel" onclick={onCancel}>{m.common_cancel()}</button>
		<button type="submit" class="submit" disabled={!topicId}>{m.coverage_addSubmit()}</button>
	</div>
</form>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.add-coverage {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.add-coverage__intro {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	.optional {
		font-weight: 400;
		color: var(--text-secondary);
	}
	select,
	input[type='text'] {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
	}
	.level-hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-weight: 400;
	}
	.add-coverage__actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	.submit {
		@include mix.button-primary;
	}
	.cancel {
		@include mix.button-secondary;
	}
</style>
