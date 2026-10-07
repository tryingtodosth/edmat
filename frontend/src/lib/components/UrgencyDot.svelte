<script lang="ts">
	/**
	 * A visual indicator of item urgency (0-3), used on the work dashboard.
	 *
	 * Colour appears only when something is near or past due (urgency 0 is a transparent box, so
	 * rows stay aligned), and the word is always there for a screen reader — the dot used to be
	 * hue-only with an English `title` on a div (house rule 1 and WCAG 1.4.1 both).
	 */
	import { m } from '$lib/paraglide/messages.js';

	let { urgency = 0 }: { urgency?: 0 | 1 | 2 | 3 } = $props();

	const LABELS = {
		0: () => m.work_urgency_none(), // "Not urgent"
		1: () => m.work_urgency_month(), // "This month"
		2: () => m.work_urgency_week(), // "This week"
		3: () => m.work_urgency_urgent() // "Urgent — due today or overdue"
	} as const;

	const CLASSES = {
		0: 'urgency-none',
		1: 'urgency-month',
		2: 'urgency-week',
		3: 'urgency-urgent'
	} as const;
</script>

<span class={`urgency-dot ${CLASSES[urgency]}`}>
	<span class="visually-hidden">{LABELS[urgency]()}</span>
</span>

<style lang="scss">
	@use '../styles/mixins' as mix;

	.urgency-dot {
		position: relative;
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.urgency-none {
		background-color: transparent;
	}

	.urgency-month {
		background-color: var(--status-neutral);
	}

	.urgency-week {
		background-color: var(--status-warning);
	}

	.urgency-urgent {
		background-color: var(--status-danger);
	}

	.visually-hidden {
		@include mix.visually-hidden;
	}
</style>
