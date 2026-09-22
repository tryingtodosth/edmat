<script lang="ts">
	// What co-authoring looks like from a material page: which version you are reading, who looks
	// after it, and the one action this reader can actually take.
	//
	// It renders NOTHING when the switch is off and the reader cannot moderate — house rule 3 says a
	// kill switch removes the links, not just the pages, and a panel offering "Improve this
	// material" for a feature whose API is closed has not been hidden, only made to fail somewhere
	// less useful. It also renders nothing when a material has no project at all, which is the
	// honest state for anything the backfill has not reached.
	//
	// "Improve this material" opens the editor INLINE rather than in a modal — the exercise page's
	// own suggest-an-edit and translate forms established that shape, and for the same reason: you
	// are improving the thing you are looking at, so it should stay on screen.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { getProjectForMaterial, getVersion } from '$lib/services/materialProjects';
	import type { MaterialProject, MaterialVersion } from '$lib/types/materialProject';
	import { COAUTHORING_FLAG, PROPOSE_BLOCK_LABELS } from './labels';
	import VersionEditor from './VersionEditor.svelte';

	let { materialId }: { materialId: string } = $props();

	let project = $state<MaterialProject | null>(null);
	let proposing = $state(false);
	/** The published version in full — fetched only when the editor opens, because prefilling it is
	 *  the only thing that needs the body, and a reader who never proposes should not pay for it. */
	let head = $state<MaterialVersion | null>(null);
	let notice = $state('');

	let enabled = $derived(featureFlagsStore.isEnabled(COAUTHORING_FLAG) || authStore.canModerate);

	// Keyed on the material AND on who is asking: `canPropose`, `myRole` and the block reason all
	// change the moment a session resolves, and an unguarded effect would re-fire itself.
	let loadedFor = $state('');
	$effect(() => {
		if (!enabled) return;
		const key = `${materialId}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		project = null;
		proposing = false;
		head = null;
		getProjectForMaterial(materialId)
			.then((found) => (project = found))
			.catch(() => (project = null));
	});

	let coauthors = $derived((project?.members ?? []).map((member) => member.displayName).join(', '));

	async function openProposal() {
		notice = '';
		proposing = true;
		const publishedId = project?.publishedVersion?.id;
		if (publishedId && !head) head = await getVersion(publishedId);
	}
</script>

{#if enabled && project}
	<section class="project-panel">
		<h2>{m.coauth_heading()}</h2>
		<!-- "Co-authoring" -->

		{#if project.publishedVersion}
			<p class="version-line">
				{#if project.publishedVersion.publishedAt}
					{m.coauth_panel_versionLine({
						number: project.publishedVersion.number,
						date: formatDate(project.publishedVersion.publishedAt),
						name: project.publishedVersion.createdByDisplayName
					})}
					<!-- "Version {number} · published {date} by {name}" -->
				{:else}
					{m.coauth_panel_versionLineNoDate({ number: project.publishedVersion.number })}
					<!-- "Version {number}" -->
				{/if}
			</p>
		{/if}

		<p class="coauthors">
			{#if coauthors}
				{m.coauth_panel_coauthors({ names: coauthors })}
				<!-- "Co-authors: {names}" -->
			{:else}
				{m.coauth_panel_noCoauthors()}
				<!-- "Nobody looks after this material yet." -->
			{/if}
		</p>

		<div class="actions">
			<a class="link" href={resolve('/material-projects/[id]', { id: project.id })}>
				{project.canEdit ? m.coauth_panel_edit() : m.coauth_panel_openProject()}
				<!-- "Edit" / "Open the project" -->
			</a>
			{#if project.canPropose && !proposing}
				<button type="button" class="secondary" onclick={openProposal}>
					{m.coauth_panel_improve()}
					<!-- "Improve this material" -->
				</button>
			{/if}
		</div>

		{#if !project.canPropose && project.proposeBlockReason}
			<p class="hint">{PROPOSE_BLOCK_LABELS[project.proposeBlockReason]()}</p>
		{/if}

		{#if notice}<p class="notice">{notice}</p>{/if}

		{#if proposing}
			<VersionEditor
				mode="propose"
				projectId={project.id}
				basedOn={project.publishedVersion}
				initial={head}
				oncancel={() => (proposing = false)}
				onsaved={() => {
					proposing = false;
					notice = m.coauth_panel_proposalSent(); // "Sent. A co-author reads it and decides."
				}}
			/>
		{/if}
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.project-panel {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	.version-line {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.coauthors {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.link {
		font-size: var(--font-size-sm);
		color: var(--accent);
	}
	.secondary {
		@include mix.button-secondary;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
		white-space: normal;
	}
</style>
