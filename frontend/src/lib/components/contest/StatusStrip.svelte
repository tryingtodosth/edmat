<script lang="ts">
	/** The seven forward statuses as a strip, the current one lit — the answer to "where is this
	 * contest up to?" without reading a date.
	 *
	 * `cancelled` is not a step and is not drawn in the strip: it is a single line instead, because
	 * a cancelled contest is not "further along" than a running one and putting it at the end of
	 * the row would say that it was. The accent means "current" here, which is the one thing it is
	 * allowed to mean (frontend/CLAUDE.md, the colour vocabulary); a step already passed is a fact
	 * and takes `--status-neutral`.
	 */
	import { m } from '$lib/paraglide/messages.js';
	import { CONTEST_STATUS_FLOW } from '$lib/types/contest';
	import { contestStatusLabel } from '$lib/utils/labels';
	import type { ContestStatus } from '$lib/types/contest';

	let { status }: { status: ContestStatus } = $props();

	const index = $derived(CONTEST_STATUS_FLOW.indexOf(status));
</script>

{#if status === 'cancelled'}
	<p class="cancelled" role="status">{m.contests_statusCancelledNote()}</p>
	<!-- "This contest was cancelled. The organiser announced it in the same place they announced the contest." -->
{:else}
	<ol class="strip" aria-label={m.contests_statusStripLabel()}>
		<!-- "How far this contest has got" -->
		{#each CONTEST_STATUS_FLOW as step, position (step)}
			<li
				class="step"
				class:step--done={position < index}
				class:step--now={position === index}
				aria-current={position === index ? 'step' : undefined}
			>
				<span class="step__dot" aria-hidden="true"></span>
				<span class="step__text">{contestStatusLabel(step)()}</span>
			</li>
		{/each}
	</ol>
{/if}

<style lang="scss">
	.strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0.1rem 0.6rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.step {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.step__dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--border-color);
		flex: 0 0 auto;
	}
	.step--done .step__dot {
		background: var(--status-neutral);
	}
	.step--now {
		color: var(--accent);
		font-weight: 600;
	}
	.step--now .step__dot {
		background: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.cancelled {
		margin: 0;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--status-neutral-bg);
		color: var(--text-primary);
		font-size: var(--font-size-sm);
	}

	@media (max-width: 640px) {
		.step__text {
			font-size: var(--font-size-xs);
		}
	}
</style>
