<script lang="ts">
	/** The management layer's one mount (MANAGEMENT-BRIEF.md §2): sits once on a course, an event, a
	 * material and an organisation page, asks the API what this node is and where the reader stands
	 * on it, and hands that `NodeRef` to seven panels — one per parallel step, one marker each
	 * below, plus `GoalsPanel` above them (2026-10-08).
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
	import PollsPanel from '$lib/components/decisions/PollsPanel.svelte';
	// Management imports (MANAGEMENT-BRIEF.md §4 rule 4): each step adds ONE import line directly
	// below this comment, in step order, and touches nothing else in this script block.
	import PlansPanel from '$lib/components/plans/PlansPanel.svelte';

	import NeedsPanel from '$lib/components/needs/NeedsPanel.svelte';

	import TasksPanel from '$lib/components/task/TasksPanel.svelte';

	import OrganizationsPanel from '$lib/components/organization/OrganizationsPanel.svelte';

	// Goals and their definitions of done (goals/, 2026-10-08) — the seventh panel, added after the
	// six parallel steps had landed, so it is a plain import rather than one of their markers.
	import GoalsPanel from '$lib/components/goal/GoalsPanel.svelte';

	// Attachments on anything (attachments/, 2026-10-08). Mounted here because this component is
	// already the one place that reaches all four node kinds with a `NodeRef` in hand — and it is
	// deliberately NOT drawn on a course or an event yet: both still have their own, older
	// attachment surfaces (`courses.Attachment`'s Files tab, `documents.EventDocument`'s panel),
	// and two attachment UIs on one page is worse than one in the wrong place. Those two are
	// absorbed by `manage.py absorb_legacy_attachments`, which the owner runs when they choose; the
	// line below loses its condition on the same day.
	import AttachmentsPanel from '$lib/components/attachments/AttachmentsPanel.svelte';

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

		<!-- Goals first: the tasks, needs and plans below are work TOWARDS something, and a reader
		     who meets the board before the goals meets a list of chores with no reason attached
		     (`GoalsPanel` argues it). On `/about` the ordering is the owner's own call — the twelve
		     module plans stay where they are and the goals go above them. -->
		<GoalsPanel {node} />

		<!-- management: organizations (A) -->
		<OrganizationsPanel {node} />

		<!-- management: tasks (B) -->
		<TasksPanel {node} />

		<!-- management: needs (C) -->
		<NeedsPanel {node} />

		<!-- management: plans (D) -->
		<PlansPanel {node} />

		<!-- management: polls (E) -->
		<PollsPanel {node} />

		{#if node.kind !== 'course' && node.kind !== 'event'}
			<AttachmentsPanel
				targetKind={node.kind}
				targetId={node.id}
				canAttach={node.isStaff || node.canManage}
				canManage={node.canManage}
			/>
		{/if}

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
