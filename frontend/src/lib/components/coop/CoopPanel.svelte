<script lang="ts">
	// The cooperation overview on a material page: who looks after this material, how open it is,
	// what just happened — drawn in whichever of three designs the reader picked from the kebab —
	// plus the one action this reader can take, which is what `ProjectPanel` used to be and this
	// panel absorbed (its class names are kept on purpose; `e2e/coauthoring.mjs` reads them).
	//
	// It renders NOTHING when the switch is off and the reader cannot moderate (house rule 3), or
	// when the material has no project the reader may see — the service answers null for both,
	// and null means "draw nothing", not "draw an error".
	//
	// The design choice is a per-viewer convenience (localStorage, wrapped), never state anybody
	// else needs; a private window simply gets the default every time.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { getCoopOverview } from '$lib/services/materialsCoop';
	import { getVersion } from '$lib/services/materialProjects';
	import type { CoopOverview } from '$lib/types/materialsCoop';
	import type { MaterialVersion } from '$lib/types/materialProject';
	import { PROPOSE_BLOCK_LABELS } from '$lib/components/coauthoring/labels';
	import VersionEditor from '$lib/components/coauthoring/VersionEditor.svelte';
	import MeatballsMenu from '$lib/components/shared/MeatballsMenu.svelte';
	import {
		COOP_FLAG,
		COOP_LAYOUT_LABELS,
		COOP_LAYOUTS,
		readStoredLayout,
		storeLayout,
		type CoopLayout
	} from './labels';
	import CoopRosterView from './CoopRosterView.svelte';
	import CoopTimelineView from './CoopTimelineView.svelte';
	import CoopTilesView from './CoopTilesView.svelte';
	import PolicyBadge from './PolicyBadge.svelte';

	let { materialId }: { materialId: string } = $props();

	let overview = $state<CoopOverview | null>(null);
	let layout = $state<CoopLayout>('roster');
	let proposing = $state(false);
	/** The published version in full — fetched only when the editor opens (the ProjectPanel
	 *  precedent: a reader who never proposes should not pay for the body). */
	let head = $state<MaterialVersion | null>(null);
	let notice = $state('');

	let enabled = $derived(featureFlagsStore.isEnabled(COOP_FLAG) || authStore.canModerate);

	// Keyed on the material AND on who is asking: every `can*`, the counts and the block reasons
	// change the moment a session resolves, and an unguarded effect would re-fire itself.
	let loadedFor = $state('');
	$effect(() => {
		if (!enabled) return;
		const key = `${materialId}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		overview = null;
		proposing = false;
		head = null;
		layout = readStoredLayout();
		getCoopOverview(materialId)
			.then((found) => (overview = found))
			.catch(() => (overview = null));
	});

	function pick(next: CoopLayout) {
		layout = next;
		storeLayout(next);
	}

	let menuItems = $derived([
		...COOP_LAYOUTS.map((id) => ({
			label: (id === layout ? '✓ ' : '') + m.coop_menu_layout({ name: COOP_LAYOUT_LABELS[id]() }), // "Show as: {name}"
			onselect: () => pick(id)
		}))
	]);

	async function openProposal() {
		notice = '';
		proposing = true;
		const publishedId = overview?.publishedVersion?.id;
		if (publishedId && !head) head = await getVersion(publishedId);
	}
</script>

{#if enabled && overview}
	<section class="project-panel coop-panel" data-layout={layout}>
		<header class="head">
			<h2>{m.coop_heading()}</h2>
			<!-- "Cooperation" -->
			<PolicyBadge policy={overview.policy} />
			<span class="spacer"></span>
			<MeatballsMenu items={menuItems} label={m.coop_menu_label()} />
			<!-- "Change how the cooperation overview is drawn" -->
		</header>

		{#if overview.publishedVersion}
			<p class="version-line">
				{#if overview.publishedVersion.publishedAt}
					{m.coauth_panel_versionLine({
						number: overview.publishedVersion.number,
						date: formatDate(overview.publishedVersion.publishedAt),
						name: overview.publishedVersion.createdByDisplayName
					})}
					<!-- "Version {number} · published {date} by {name}" -->
				{:else}
					{m.coauth_panel_versionLineNoDate({ number: overview.publishedVersion.number })}
					<!-- "Version {number}" -->
				{/if}
			</p>
		{/if}

		<div class="view">
			{#if layout === 'timeline'}
				<CoopTimelineView {overview} limit={6} />
			{:else if layout === 'tiles'}
				<CoopTilesView {overview} />
			{:else}
				<CoopRosterView {overview} compact />
			{/if}
		</div>

		<div class="actions">
			<a class="link" href={resolve('/materials/[id]/coop', { id: materialId })}>
				{m.coop_panel_openPage()}
				<!-- "Cooperation page" -->
			</a>
			<a class="link" href={resolve('/material-projects/[id]', { id: overview.projectId })}>
				{overview.canEdit ? m.coauth_panel_edit() : m.coauth_panel_openProject()}
				<!-- "Edit" / "Open the project" -->
			</a>
			{#if overview.canPropose && !proposing}
				<button type="button" class="secondary" onclick={openProposal}>
					{m.coauth_panel_improve()}
					<!-- "Improve this material" -->
				</button>
			{/if}
		</div>

		{#if !overview.canPropose && overview.proposeBlockReason}
			<p class="hint">{PROPOSE_BLOCK_LABELS[overview.proposeBlockReason]()}</p>
		{/if}

		{#if notice}<p class="notice">{notice}</p>{/if}

		{#if proposing}
			<VersionEditor
				mode="propose"
				projectId={overview.projectId}
				basedOn={overview.publishedVersion}
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

	.coop-panel {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	.spacer {
		flex: 1;
	}
	.version-line {
		margin: 0;
		font-size: var(--font-size-sm);
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
