<script lang="ts">
	import { untrack } from 'svelte';
	import type { ClaimKind, Topic } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import TaxonomyOptions from '$lib/components/shared/TaxonomyOptions.svelte';

	// One form for both claim kinds. The fields are identical — topic, optional subtopic, a 1-100
	// number — only the question the number answers differs, so the copy is chosen by `kind`
	// rather than the form being written twice.
	let {
		kind,
		topics,
		onSubmit,
		onCancel
	}: {
		kind: ClaimKind;
		topics: Topic[];
		onSubmit: (input: {
			kind: ClaimKind;
			topicId: string;
			subtopicName: string;
			level: number;
		}) => void;
		onCancel: () => void;
	} = $props();

	let topicId = $state(untrack(() => topics[0]?.id ?? ''));
	let subtopicName = $state('');
	let level = $state(50);
	// The typed value, kept as a string (type="text" — see frontend/CLAUDE.md on number inputs) and
	// folded back into `level` on every keystroke that parses. The slider and the box are two
	// handles on the same number: the slider for a feel, the box for an exact figure.
	let levelText = $state('50');

	function setFromSlider(value: number) {
		level = value;
		levelText = String(value);
	}

	function setFromText(value: string) {
		levelText = value;
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) level = Math.min(100, Math.max(1, parsed));
	}

	function submit() {
		if (!topicId) return;
		onSubmit({ kind, topicId, subtopicName: subtopicName.trim(), level });
	}

	let isRequirement = $derived(kind === 'requires');
</script>

<form class="add-coverage" onsubmit={(e) => (e.preventDefault(), submit())}>
	<p class="add-coverage__intro">
		{isRequirement ? m.coverage_addIntroRequires() : m.coverage_addIntro()}
	</p>

	<label class="field">
		<span>{m.coverage_topicLabel()}</span>
		<select bind:value={topicId}>
			<TaxonomyOptions nodes={topics} />
		</select>
	</label>

	<label class="field">
		<span>{m.coverage_subtopicLabel()} <span class="optional">({m.common_optional()})</span></span>
		<input type="text" bind:value={subtopicName} placeholder={m.coverage_subtopicPlaceholder()} />
	</label>

	<div class="field">
		<span id="level-label">
			{isRequirement ? m.coverage_requiredLevelLabel({ level }) : m.coverage_levelLabel({ level })}
		</span>
		<div class="level-row">
			<input
				type="range"
				min="1"
				max="100"
				value={level}
				aria-labelledby="level-label"
				oninput={(e) => setFromSlider(Number(e.currentTarget.value))}
			/>
			<input
				class="level-box"
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				maxlength="3"
				aria-label={m.coverage_levelInputLabel()}
				value={levelText}
				oninput={(e) => setFromText(e.currentTarget.value)}
				onblur={() => (levelText = String(level))}
			/>
			<span class="level-max">/ 100</span>
		</div>
		<span class="level-hint">
			{isRequirement ? m.coverage_requiredLevelHint() : m.coverage_levelHint()}
		</span>
	</div>

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
	.level-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		input[type='range'] {
			flex: 1;
		}
	}
	.level-box {
		width: 4.5em;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.level-max {
		color: var(--text-secondary);
		font-weight: 400;
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
