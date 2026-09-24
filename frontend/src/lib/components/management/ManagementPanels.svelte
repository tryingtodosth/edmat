<script lang="ts">
	/** The management layer's one mount (MANAGEMENT-BRIEF.md §2): sits once on a course, an event, a
	 * material and an organisation page, asks the API what this node is and where the reader stands
	 * on it, and hands that `NodeRef` to six panels — one per parallel step, one marker each below.
	 *
	 * It renders NOTHING when the node 404s (a stranger on a draft — house rule 4: for them it does
	 * not exist, so neither does anything hung on it) and nothing while loading, so the page above
	 * never shifts for a reader who gets no panels. Each panel decides for itself whether to draw
	 * anything: its own kill switch, and whether this reader may see what it holds.
	 *
	 * Keyed on the node AND on who is asking (the CoopPanel precedent): every `is*`/`can*` changes
	 * the moment a session resolves, and an unguarded effect would re-fire itself.
	 */
	import { getNodeRef } from '$lib/services/nodes';
	import type { NodeKind, NodeRef } from '$lib/types/node';
	import { authStore } from '$lib/state/auth.svelte';
	// Management imports (MANAGEMENT-BRIEF.md §4 rule 4): each step adds ONE import line directly
	// below this comment, in step order, and touches nothing else in this script block.
	import PlansPanel from '$lib/components/plans/PlansPanel.svelte';

	let { nodeKind, nodeId }: { nodeKind: NodeKind; nodeId: string } = $props();

	let node = $state<NodeRef | null>(null);
	let loadedFor = $state('');
	$effect(() => {
		const key = `${nodeKind}:${nodeId}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		node = null;
		getNodeRef(nodeKind, nodeId).then(
			(ref) => {
				if (loadedFor === key) node = ref;
			},
			() => {
				// 404 or a network failure: draw nothing. A panel that cannot know what it sits on
				// has nothing honest to show.
				if (loadedFor === key) node = null;
			}
		);
	});
</script>

{#if node}
	<div class="management-panels" data-node-kind={node.kind} data-node-id={node.id}>
		<!-- Management mount points (MANAGEMENT-BRIEF.md §4 rule 4): one marker per parallel step,
		     each replaced by its own component on its own branch and given `{node}`. Kept apart by
		     blank lines so that six branches editing this file merge without touching each other's
		     lines. F mounts nothing here (its surface is /work); its marker stays so the file has six. -->

		<!-- management: organizations (A) -->

		<!-- management: tasks (B) -->

		<!-- management: needs (C) -->

		<!-- management: plans (D) -->
		<PlansPanel {node} />

		<!-- management: polls (E) -->

		<!-- management: work (F) — nothing is mounted here by design -->
	</div>
{/if}

<style lang="scss">
	.management-panels {
		display: grid;
		gap: var(--space-6, 1.5rem);
		// Collapses to nothing while every panel inside chooses to draw nothing, so a reader with
		// no standing sees no empty box.
		&:empty {
			display: none;
		}
	}
</style>
