<script lang="ts">
	// The cooperation page of one material: the same overview the material page carries, at full
	// size, plus everything the panel only points at — the team and its queue, the history, the
	// team thread and (for a manager) the policy. `/materials/<id>/coop` rather than a project id,
	// because the material's id is the one a reader has in hand; the project's is in the answer.
	//
	// Five views under one URL (`?view=`), the shape 2donet's project dashboard takes: one list of
	// links, one body that swaps. Each view loads what it owns and no more — a reader who only
	// wants the timeline never fetches the invites.
	//
	// Every `can*` here is the server's answer, never re-derived (house rule 4).
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { formatDate } from '$lib/utils/datetime';
	import type { Comment, Material, User } from '$lib/types';
	import type { CoopOverview } from '$lib/types/materialsCoop';
	import type { MaterialVersion, ProjectJoinRequest } from '$lib/types/materialProject';
	import { getMaterialById } from '$lib/services/materials';
	import { getUserById } from '$lib/services/users';
	import { getCoopOverview, listCoopComments, postCoopComment } from '$lib/services/materialsCoop';
	import { listJoinRequests, listVersions } from '$lib/services/materialProjects';
	import DiscussionThread from '$lib/components/discussion/DiscussionThread.svelte';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import MeatballsMenu from '$lib/components/shared/MeatballsMenu.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import Tabs from '$lib/components/shared/Tabs.svelte';
	import InvitesPanel from '$lib/components/coauthoring/InvitesPanel.svelte';
	import JoinRequestsPanel from '$lib/components/coauthoring/JoinRequestsPanel.svelte';
	import MembersPanel from '$lib/components/coauthoring/MembersPanel.svelte';
	import VersionList from '$lib/components/coauthoring/VersionList.svelte';
	import { JOIN_BLOCK_LABELS, PROPOSE_BLOCK_LABELS } from '$lib/components/coauthoring/labels';
	import CoopRosterView from '$lib/components/coop/CoopRosterView.svelte';
	import CoopSettingsForm from '$lib/components/coop/CoopSettingsForm.svelte';
	import CoopTilesView from '$lib/components/coop/CoopTilesView.svelte';
	import CoopTimelineView from '$lib/components/coop/CoopTimelineView.svelte';
	import PolicyBadge from '$lib/components/coop/PolicyBadge.svelte';
	import {
		COOP_FLAG,
		COOP_LAYOUT_LABELS,
		COOP_LAYOUTS,
		POST_BLOCK_LABELS,
		coopErrorMessage,
		readStoredLayout,
		storeLayout,
		type CoopLayout
	} from '$lib/components/coop/labels';

	type View = 'overview' | 'team' | 'history' | 'discussion' | 'settings';

	let material = $state<Material | null>(null);
	let overview = $state<CoopOverview | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	let layout = $state<CoopLayout>('roster');

	let versions = $state<MaterialVersion[]>([]);
	let joinRequests = $state<ProjectJoinRequest[]>([]);
	let comments = $state<Comment[]>([]);
	let usersById = $state<Record<string, User>>({});
	let threadError = $state('');

	let materialId = $derived(page.params.id!);
	let view = $derived((page.url.searchParams.get('view') as View | null) ?? 'overview');

	async function load(id: string) {
		loading = true;
		notFound = false;
		layout = readStoredLayout();
		const [mat, found] = await Promise.all([getMaterialById(id), getCoopOverview(id)]);
		if (!mat || !found) {
			notFound = true;
			loading = false;
			return;
		}
		material = mat;
		overview = found;
		loading = false;
	}

	async function reloadOverview() {
		const next = await getCoopOverview(materialId).catch(() => null);
		if (next) overview = next;
	}

	// The id-changed guard every dynamic route needs (frontend/CLAUDE.md trap 2), keyed on the
	// session too because every `can*` changes the moment it resolves.
	let loadedFor = $state('');
	$effect(() => {
		const key = `${materialId}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		load(materialId);
	});

	// Each view's own data, fetched the first time it is opened for this project.
	let historyFor = $state('');
	let teamFor = $state('');
	let threadFor = $state('');
	$effect(() => {
		const current = overview;
		if (!current) return;
		const key = `${current.projectId}:${authStore.user?.id ?? 'anon'}`;
		if (view === 'history' && historyFor !== key) {
			historyFor = key;
			listVersions(current.projectId)
				.then((rows) => (versions = rows))
				.catch(() => (versions = []));
		}
		if (view === 'team' && teamFor !== key) {
			teamFor = key;
			joinRequests = [];
			if (authStore.isAuthenticated) {
				listJoinRequests(current.projectId)
					.then((rows) => (joinRequests = rows))
					.catch(() => (joinRequests = []));
			}
		}
		if (view === 'discussion' && threadFor !== key) {
			threadFor = key;
			loadThread();
		}
	});

	async function resolveUsers(ids: string[]) {
		const unique = [...new Set(ids)].filter((id) => !usersById[id]);
		if (unique.length === 0) return;
		const found = await Promise.all(unique.map((id) => getUserById(id)));
		const next = { ...usersById };
		for (const u of found) if (u) next[u.id] = u;
		usersById = next;
	}

	async function loadThread() {
		try {
			comments = await listCoopComments(materialId);
			await resolveUsers(comments.map((c) => c.authorId));
		} catch {
			comments = [];
		}
	}

	async function handleCommentSubmit(body: string, parentId?: string): Promise<Comment | void> {
		threadError = '';
		try {
			const comment = await postCoopComment(materialId, body, parentId);
			comments = [...comments, comment];
			await resolveUsers([comment.authorId]);
			return comment;
		} catch (e) {
			threadError = coopErrorMessage(e);
		}
	}

	function refreshTeam() {
		teamFor = '';
		reloadOverview();
	}

	function pick(next: CoopLayout) {
		layout = next;
		storeLayout(next);
	}
	let menuItems = $derived(
		COOP_LAYOUTS.map((id) => ({
			label: (id === layout ? '✓ ' : '') + m.coop_menu_layout({ name: COOP_LAYOUT_LABELS[id]() }), // "Show as: {name}"
			onselect: () => pick(id)
		}))
	);

	let tabs = $derived.by(() => {
		const current = overview;
		const list = [
			{ id: 'overview', label: m.coop_view_overview() }, // "Overview"
			{
				id: 'team',
				label: m.coop_view_team(), // "Team"
				badge: current?.stats.joinRequestsPending || undefined
			},
			{
				id: 'history',
				label: m.coop_view_history(), // "History"
				badge: current?.stats.proposalsPending || undefined
			},
			{ id: 'discussion', label: m.coop_view_discussion() } // "Discussion"
		];
		if (current?.canManage) list.push({ id: 'settings', label: m.coop_view_settings() }); // "Settings"
		return list;
	});

	let myJoinRequest = $derived(
		joinRequests.find((row) => row.userId === authStore.user?.id && row.status === 'pending') ??
			null
	);
</script>

<!-- "Cooperation: {title}"; the description falls back to "Who looks after this material, how open it is to changes, and what happened when." -->
<PageHead
	title={material ? m.coop_pageTitle({ title: material.title }) : m.coop_heading()}
	description={m.coop_seo()}
/>

<FeatureGate feature={COOP_FLAG}>
	<div class="page">
		{#if loading}
			<p class="loading">{m.common_loading()}</p>
		{:else if notFound || !material || !overview}
			<p class="empty">{m.material_notFound()}</p>
		{:else}
			<nav class="breadcrumb" aria-label={m.nav_breadcrumb()}>
				<a href={resolve('/materials/[id]', { id: material.id })}>{material.title}</a> ›
				<span>{m.coop_heading()}</span>
				<!-- "Cooperation" -->
			</nav>

			<header class="head">
				<div class="head__text">
					<h1>{m.coop_pageHeading({ title: material.title })}</h1>
					<!-- "Cooperation on {title}" -->
					<p class="head__line">
						<PolicyBadge policy={overview.policy} />
						{#if overview.publishedVersion?.publishedAt}
							<span class="muted">
								{m.coauth_panel_versionLine({
									number: overview.publishedVersion.number,
									date: formatDate(overview.publishedVersion.publishedAt),
									name: overview.publishedVersion.createdByDisplayName
								})}
								<!-- "Version {number} · published {date} by {name}" -->
							</span>
						{/if}
					</p>
				</div>
				<div class="head__actions">
					<a class="link" href={resolve('/material-projects/[id]', { id: overview.projectId })}>
						{overview.canEdit ? m.coauth_panel_edit() : m.coauth_panel_openProject()}
						<!-- "Edit" / "Open the project" -->
					</a>
					<MeatballsMenu items={menuItems} label={m.coop_menu_label()} />
					<!-- "Change how the cooperation overview is drawn" -->
				</div>
			</header>

			<Tabs
				{tabs}
				active={view}
				defaultTab="overview"
				param="view"
				idPrefix="coop-tab"
				panelPrefix="coop-panel"
				ariaLabel={m.coop_heading()}
			/>

			{#if view === 'overview'}
				<section id="coop-panel-overview" class="card" aria-labelledby="coop-tab-overview">
					{#if overview.welcomeNote}
						<div class="welcome">
							<h2>{m.coop_welcome_heading()}</h2>
							<!-- "From the team" -->
							<MathContent source={overview.welcomeNote} />
						</div>
					{/if}
					{#if layout === 'timeline'}
						<CoopTimelineView {overview} />
					{:else if layout === 'tiles'}
						<CoopTilesView {overview} />
					{:else}
						<CoopRosterView {overview} />
					{/if}
					{#if !overview.canPropose && overview.proposeBlockReason}
						<p class="hint">{PROPOSE_BLOCK_LABELS[overview.proposeBlockReason]()}</p>
					{/if}
				</section>
			{:else if view === 'team'}
				<section id="coop-panel-team" class="stack" aria-labelledby="coop-tab-team">
					<div class="card">
						<CoopRosterView {overview} />
					</div>
					{#if overview.canManage}
						<div class="card">
							<MembersPanel
								projectId={overview.projectId}
								members={overview.members.map((row) => ({
									userId: row.userId,
									displayName: row.displayName,
									role: row.role ?? 'coauthor',
									addedAt: row.addedAt ?? ''
								}))}
								canManage
								onchanged={refreshTeam}
							/>
						</div>
						<div class="card">
							<InvitesPanel projectId={overview.projectId} />
						</div>
					{/if}
					<div class="card">
						<JoinRequestsPanel
							projectId={overview.projectId}
							requests={joinRequests}
							canManage={overview.canManage}
							blockReason={overview.joinBlockReason}
							mine={myJoinRequest}
							onchanged={refreshTeam}
						/>
						{#if !overview.canManage && overview.joinBlockReason && overview.joinBlockReason !== 'member'}
							<p class="hint">{JOIN_BLOCK_LABELS[overview.joinBlockReason]()}</p>
						{/if}
					</div>
				</section>
			{:else if view === 'history'}
				<section id="coop-panel-history" class="stack" aria-labelledby="coop-tab-history">
					<div class="card">
						<CoopTimelineView {overview} />
					</div>
					<div class="card">
						<VersionList projectId={overview.projectId} {versions} currentNumber={undefined} />
					</div>
				</section>
			{:else if view === 'discussion'}
				<section id="coop-panel-discussion" class="card" aria-labelledby="coop-tab-discussion">
					<h2>{m.coop_thread_heading()}</h2>
					<!-- "The team's thread" -->
					<p class="hint">{m.coop_thread_hint()}</p>
					<!-- "About the work as a whole. Each version has its own review thread." -->
					{#if !overview.canPost && overview.postBlockReason}
						<p class="hint">{POST_BLOCK_LABELS[overview.postBlockReason]()}</p>
					{/if}
					{#if threadError}<p class="error">{threadError}</p>{/if}
					<DiscussionThread
						{comments}
						{usersById}
						onSubmit={handleCommentSubmit}
						canPost={overview.canPost}
					/>
				</section>
			{:else if view === 'settings' && overview.canManage}
				<section id="coop-panel-settings" class="card" aria-labelledby="coop-tab-settings">
					<h2>{m.coop_view_settings()}</h2>
					<!-- "Settings" -->
					<CoopSettingsForm {materialId} {overview} onsaved={(next) => (overview = next)} />
				</section>
			{/if}
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../../lib/styles/mixins' as mix;

	.page {
		max-width: 900px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.loading,
	.empty {
		color: var(--text-secondary);
	}
	.breadcrumb {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
	.head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		flex-wrap: wrap;
		h1 {
			margin: 0 0 var(--space-1);
			font-size: var(--font-size-xl);
		}
	}
	.head__text {
		flex: 1;
		min-width: 0;
	}
	.head__line {
		margin: 0;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-sm);
	}
	.head__actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.muted {
		color: var(--text-secondary);
	}
	.link {
		font-size: var(--font-size-sm);
		color: var(--accent);
	}
	.card {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		h2 {
			margin: 0;
			font-size: var(--font-size-base);
		}
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.welcome {
		padding: var(--space-3);
		border-left: 3px solid var(--accent);
		background: var(--bg-surface-alt);
		border-radius: var(--radius-sm);
		h2 {
			margin: 0 0 var(--space-2);
			font-size: var(--font-size-xs);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.error {
		margin: 0;
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
</style>
