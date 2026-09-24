<script lang="ts">
	/**
	 * A visual indicator of item urgency (0-3).
	 * Used on the work dashboard.
	 */

	const { urgency = 0 } = $props<{ urgency?: 0 | 1 | 2 | 3 }>();

	function getUrgencyTitle(u: 0 | 1 | 2 | 3): string {
		switch (u) {
			case 0:
				return 'No urgency';
			case 1:
				return 'This month';
			case 2:
				return 'This week';
			case 3:
				return 'Urgent — overdue or today';
		}
	}

	function getUrgencyClass(u: 0 | 1 | 2 | 3): string {
		return {
			0: 'urgency-none',
			1: 'urgency-month',
			2: 'urgency-week',
			3: 'urgency-urgent'
		}[u];
	}
</script>

<div class={`urgency-dot ${getUrgencyClass(urgency)}`} title={getUrgencyTitle(urgency)}></div>

<style>
	.urgency-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.urgency-none {
		background-color: var(--status-neutral);
	}

	.urgency-month {
		background-color: var(--status-info);
	}

	.urgency-week {
		background-color: var(--status-warning);
	}

	.urgency-urgent {
		background-color: var(--status-danger);
	}
</style>
