<script lang="ts">
	import type { ReportKind } from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import ReportModal from './ReportModal.svelte';

	let { kind, objectId }: { kind: ReportKind; objectId: string } = $props();

	let open = $state(false);
</script>

{#if authStore.isAuthenticated}
	<button type="button" class="report-trigger" onclick={() => (open = true)}>
		{m.report_action()}
	</button>
{/if}

{#if open}
	<ReportModal {kind} {objectId} onClose={() => (open = false)} />
{/if}

<style lang="scss">
	.report-trigger {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		cursor: pointer;
		&:hover {
			color: var(--status-danger);
		}
	}
</style>
