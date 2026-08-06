<script lang="ts">
	import type {
		Branch,
		EditSuggestion,
		ExerciseSubmission,
		ExerciseTranslation,
		FeatureFlagKey,
		Discipline,
		GovernableNodeKind,
		MaterialSubmission,
		NodeGovernorGrant,
		ReportGroup,
		User
	} from '$lib/types';
	import type { TaxonomyProposal } from '$lib/services/moderation';
	import { m } from '$lib/paraglide/messages.js';
	import {
		decideTaxonomyProposal,
		getModerationQueue,
		decideEditSuggestion,
		decideExerciseSubmission,
		decideMaterialSubmission,
		decideTranslation,
		resolveReport,
		listNodeGovernors,
		grantNodeGovernor,
		revokeNodeGovernor
	} from '$lib/services/moderation';
	import { getUserById } from '$lib/services/users';
	import { getBranchById, getDisciplines, getAllBranches } from '$lib/services/taxonomy';
	import { getExercisesByIds } from '$lib/services/exercises';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { MATERIAL_TYPE_LABELS, FEATURE_FLAG_LABELS } from '$lib/utils/labels';
	import { resolve } from '$app/paths';
	import MathTitle from '$lib/components/shared/MathTitle.svelte';

	// "reports" first — this is the literal "gets a priority in the moderation queue" requirement:
	// reported content (some of it possibly already auto-hidden, waiting on a decision) is the
	// first thing a moderator opening this page sees, not the last tab they'd have to click to.
	// "governors" — the node-governor administration panel itself — only ever rendered as a real
	// tab option for a global (is_staff) moderator; a scoped governor never sees it at all (see the
	// tab bar's own `{#if authStore.isModerator}` guard below).
	let tab = $state<
		'reports' | 'submissions' | 'materials' | 'edits' | 'translations' | 'governors' | 'flags'
	>('reports');
	let flagTogglePending = $state<Record<string, boolean>>({});
	let flagError = $state('');
	let taxonomyProposals = $state<TaxonomyProposal[]>([]);
	let reports = $state<ReportGroup[]>([]);
	let submissions = $state<ExerciseSubmission[]>([]);
	let materialSubmissions = $state<MaterialSubmission[]>([]);
	let editSuggestions = $state<EditSuggestion[]>([]);
	let translations = $state<ExerciseTranslation[]>([]);
	let usersById = $state<Record<string, User>>({});
	let coursesById = $state<Record<string, Branch>>({});
	let exerciseTitles = $state<Record<string, string>>({});
	let notes = $state<Record<string, string>>({});
	let loading = $state(true);

	// Node-governor state — `myGovernedNodes` is what EVERY moderator sees (the backend already
	// scopes GET /moderation/governors/ to "my own grants" for a non-staff user, so this is a real,
	// live list even for a scoped governor, not a staff-only concept); `disciplines`/`allBranches` back
	// the grant form's own node picker, only ever fetched for a real global moderator.
	let myGovernedNodes = $state<NodeGovernorGrant[]>([]);
	let allGovernors = $state<NodeGovernorGrant[]>([]);
	let disciplines = $state<Discipline[]>([]);
	let allBranches = $state<Branch[]>([]);
	let grantUserId = $state('');
	let grantKind = $state<GovernableNodeKind>('branch');
	let grantNodeSlug = $state('');
	let grantError = $state('');
	let grantSubmitting = $state(false);

	async function load() {
		loading = true;
		const queue = await getModerationQueue();
		reports = queue.reports;
		taxonomyProposals = queue.taxonomyProposals;
		submissions = queue.exerciseSubmissions;
		materialSubmissions = queue.materialSubmissions;
		editSuggestions = queue.editSuggestions;
		translations = queue.translations;

		const userIds = [
			...submissions.map((s) => s.submittedByUserId),
			...materialSubmissions.map((s) => s.submittedByUserId),
			...editSuggestions.map((e) => e.submittedByUserId),
			...translations.map((t) => t.translatedByUserId).filter((id): id is string => Boolean(id))
		];
		const users = await Promise.all([...new Set(userIds)].map((id) => getUserById(id)));
		const uMap: Record<string, User> = {};
		for (const u of users) if (u) uMap[u.id] = u;
		usersById = uMap;

		const branchIds = [
			...new Set([
				...submissions.map((s) => s.branchId),
				...materialSubmissions.map((s) => s.branchId)
			])
		];
		const branches = await Promise.all(branchIds.map((id) => getBranchById(id)));
		const cMap: Record<string, Branch> = {};
		for (const c of branches) if (c) cMap[c.id] = c;
		coursesById = cMap;

		const exerciseIds = [
			...new Set([
				...editSuggestions.map((e) => e.exerciseId),
				...translations.map((t) => t.exerciseId)
			])
		];
		// ✅ Phase 4 — one bulk request instead of one GET per distinct exercise id. Under a real
		// seeded backlog (the moderation-queue load test) this used to fire up to 115 individual
		// requests here alone, ~10s of the page's own real load time — see CLAUDE.md's own writeup.
		const exs = await getExercisesByIds(exerciseIds, 'pl');
		const titles: Record<string, string> = {};
		for (const e of exs) titles[e.id] = e.title;
		exerciseTitles = titles;

		// Node-governor data — `listNodeGovernors()` is ALREADY scoped to "my own grants" server-side
		// for a non-staff user (moderation/views.py's NodeGovernorViewSet.get_queryset), so the same
		// one call correctly backs the "you govern: X" banner for a scoped governor; a real global
		// moderator additionally sees every grant (for the Governors tab's own management list) and
		// gets the Discipline/Branch pickers the grant form needs.
		myGovernedNodes = await listNodeGovernors();
		if (authStore.isModerator) {
			allGovernors = myGovernedNodes;
			[disciplines, allBranches] = await Promise.all([getDisciplines(), getAllBranches()]);
			// Kill switches are the same "real global staff only" scope as granting/revoking a node
			// governor above — a scoped governor never sees this tab at all (the tab button's own
			// {#if authStore.isModerator} guard below), so no point fetching it for them.
			await featureFlagsStore.refresh();
		}

		loading = false;
	}

	async function toggleFlag(key: FeatureFlagKey, isEnabled: boolean) {
		flagError = '';
		flagTogglePending = { ...flagTogglePending, [key]: true };
		try {
			await featureFlagsStore.toggle(key, isEnabled);
		} catch {
			flagError = m.moderation_flags_toggleFailed();
		} finally {
			flagTogglePending = { ...flagTogglePending, [key]: false };
		}
	}

	$effect(() => {
		if (authStore.canModerate) load();
	});

	async function approveSubmission(s: ExerciseSubmission) {
		if (!authStore.user) return;
		await decideExerciseSubmission(s.id, 'approved', authStore.user.id, notes[s.id]);
		await load();
	}
	async function rejectSubmission(s: ExerciseSubmission) {
		if (!authStore.user) return;
		await decideExerciseSubmission(s.id, 'rejected', authStore.user.id, notes[s.id]);
		await load();
	}
	async function approveMaterial(s: MaterialSubmission) {
		if (!authStore.user) return;
		await decideMaterialSubmission(s.id, 'approved', authStore.user.id, notes[s.id]);
		await load();
	}
	async function rejectMaterial(s: MaterialSubmission) {
		if (!authStore.user) return;
		await decideMaterialSubmission(s.id, 'rejected', authStore.user.id, notes[s.id]);
		await load();
	}
	async function approveEdit(e: EditSuggestion) {
		if (!authStore.user) return;
		await decideEditSuggestion(e.id, 'approved', authStore.user.id, notes[e.id]);
		await load();
	}
	async function rejectEdit(e: EditSuggestion) {
		if (!authStore.user) return;
		await decideEditSuggestion(e.id, 'rejected', authStore.user.id, notes[e.id]);
		await load();
	}
	async function approveTranslation(t: ExerciseTranslation) {
		if (!authStore.user) return;
		await decideTranslation(t.id, 'approved', authStore.user.id, notes[t.id]);
		await load();
	}
	async function rejectTranslation(t: ExerciseTranslation) {
		if (!authStore.user) return;
		await decideTranslation(t.id, 'rejected', authStore.user.id, notes[t.id]);
		await load();
	}

	// `kind:objectId` — a report group has no single numeric id of its own (it's a GROUP of every
	// pending Report row against one target, moderation/services.py's build_report_queue), so the
	// composite key both identifies a `notes[...]` entry and is what gets passed straight through
	// to resolveReport's own (kind, objectId) pair.
	function reportKey(r: ReportGroup): string {
		return `${r.kind}:${r.objectId}`;
	}

	const REPORT_KIND_LABELS: Record<ReportGroup['kind'], () => string> = {
		exercise: m.report_kind_exercise,
		comment: m.report_kind_comment,
		review: m.report_kind_review,
		service: m.report_kind_service,
		tag: m.report_kind_tag,
		material: m.report_kind_material,
		requirement: m.report_kind_requirement,
		service_review: m.report_kind_service_review
	};

	async function restoreReport(r: ReportGroup) {
		reports = await resolveReport(r.kind, r.objectId, 'restore', notes[reportKey(r)]);
	}

	async function removeReport(r: ReportGroup) {
		reports = await resolveReport(r.kind, r.objectId, 'remove', notes[reportKey(r)]);
	}

	// The candidate node list for the grant form's own picker — every Discipline, or every Branch,
	// depending on `grantKind`; re-derived reactively rather than re-fetched, since both lists are
	// already loaded once in `load()` above.
	let grantNodeOptions = $derived(grantKind === 'discipline' ? disciplines : allBranches);

	async function submitGrant() {
		grantError = '';
		if (!grantUserId.trim() || !grantNodeSlug) {
			grantError = m.moderation_governors_grantMissingFields();
			return;
		}
		grantSubmitting = true;
		try {
			await grantNodeGovernor(grantUserId.trim(), grantKind, grantNodeSlug);
			grantUserId = '';
			grantNodeSlug = '';
			allGovernors = await listNodeGovernors();
		} catch {
			// A duplicate grant / bad node slug / nonexistent user id are all real, expected 400s from
			// the backend (moderation/serializers.py's own NodeGovernorSerializer.validate) — a single
			// honest message covers every case without needing to parse the specific field error out
			// of the response body just for this small admin form.
			grantError = m.moderation_governors_grantFailed();
		} finally {
			grantSubmitting = false;
		}
	}

	async function revokeGrant(grant: NodeGovernorGrant) {
		await revokeNodeGovernor(grant.id);
		allGovernors = allGovernors.filter((g) => g.id !== grant.id);
	}
</script>

<svelte:head>
	<title>{m.moderation_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.moderation_heading()}</h1>
	<p class="subtitle">{m.moderation_subtitle()}</p>

	{#if !authStore.canModerate}
		<p class="denied">{m.moderation_accessDenied()}</p>
	{:else if loading}
		<p class="loading">{m.common_loading()}</p>
	{:else}
		{#if !authStore.isModerator && myGovernedNodes.length > 0}
			<!-- A scoped node governor (not a real global moderator) — makes it unambiguous this is
			     a NARROWER view than the full platform queue, and which node(s) it's scoped to. -->
			<p class="scope-banner">
				{m.moderation_governors_youGovern({
					nodes: myGovernedNodes.map((g) => g.nodeLabel).join(', ')
				})}
			</p>
		{/if}
		<!-- Proposed taxonomy entries. Above the tabs rather than inside one: a proposal is cheap
		     to decide and blocks whoever is waiting to file content under the word, so burying it
		     behind a tab is how it ends up unreviewed. -->
		{#if taxonomyProposals.length > 0}
			<section class="taxonomy-proposals">
				<h2>{m.moderation_taxonomy_heading()}</h2>
				<ul>
					{#each taxonomyProposals as proposal (proposal.kind + proposal.id)}
						<li>
							<span class="kind">{proposal.kind}</span>
							<strong>{proposal.name}</strong>
							<code>{proposal.slug}</code>
							{#if proposal.parent}
								<span class="hint">← {proposal.parent}</span>
							{/if}
							<button
								type="button"
								class="link"
								onclick={async () => {
									await decideTaxonomyProposal(proposal.kind, proposal.id, 'approve');
									await load();
								}}
							>
								{m.moderation_taxonomy_approve()}
							</button>
							<button
								type="button"
								class="link danger"
								onclick={async () => {
									await decideTaxonomyProposal(proposal.kind, proposal.id, 'reject');
									await load();
								}}
							>
								{m.moderation_taxonomy_reject()}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<div class="tabs" role="tablist">
			<button
				type="button"
				role="tab"
				id="mod-tab-reports"
				aria-selected={tab === 'reports'}
				aria-controls="mod-tabpanel"
				class:active={tab === 'reports'}
				onclick={() => (tab = 'reports')}
			>
				{m.moderation_tab_reports({ count: reports.length })}
			</button>
			<button
				type="button"
				role="tab"
				id="mod-tab-submissions"
				aria-selected={tab === 'submissions'}
				aria-controls="mod-tabpanel"
				class:active={tab === 'submissions'}
				onclick={() => (tab = 'submissions')}
			>
				{m.moderation_tab_submissions({ count: submissions.length })}
			</button>
			<button
				type="button"
				role="tab"
				id="mod-tab-materials"
				aria-selected={tab === 'materials'}
				aria-controls="mod-tabpanel"
				class:active={tab === 'materials'}
				onclick={() => (tab = 'materials')}
			>
				{m.moderation_tab_materials({ count: materialSubmissions.length })}
			</button>
			<button
				type="button"
				role="tab"
				id="mod-tab-edits"
				aria-selected={tab === 'edits'}
				aria-controls="mod-tabpanel"
				class:active={tab === 'edits'}
				onclick={() => (tab = 'edits')}
			>
				{m.moderation_tab_edits({ count: editSuggestions.length })}
			</button>
			<button
				type="button"
				role="tab"
				id="mod-tab-translations"
				aria-selected={tab === 'translations'}
				aria-controls="mod-tabpanel"
				class:active={tab === 'translations'}
				onclick={() => (tab = 'translations')}
			>
				{m.moderation_tab_translations({ count: translations.length })}
			</button>
			{#if authStore.isModerator}
				<!-- Staff (global moderator) only — a scoped node governor can't grant/revoke this role
				     at all in v1 (CLAUDE.md's own documented scope decision), so this tab simply isn't
				     offered to them, rather than being reachable and then 403ing on every action inside. -->
				<button
					type="button"
					role="tab"
					id="mod-tab-governors"
					aria-selected={tab === 'governors'}
					aria-controls="mod-tabpanel"
					class:active={tab === 'governors'}
					onclick={() => (tab = 'governors')}
				>
					{m.moderation_tab_governors({ count: allGovernors.length })}
				</button>
				<!-- Kill switches are the same platform-wide, staff-only scope as node-governor
				     grant/revoke — not offered to a scoped governor either, same reasoning as above. -->
				<button
					type="button"
					role="tab"
					id="mod-tab-flags"
					aria-selected={tab === 'flags'}
					aria-controls="mod-tabpanel"
					class:active={tab === 'flags'}
					onclick={() => (tab = 'flags')}
				>
					{m.moderation_tab_flags()}
				</button>
			{/if}
		</div>

		<!--
			One shared tabpanel wrapping every {#if tab === ...} branch below, rather than four separate
			panels — only one is ever rendered at a time regardless, and `aria-labelledby` swaps to
			track whichever tab is actually active. The visually-hidden <h2> restores a real, correct
			h1 -> h2 -> h3 document outline for screen-reader heading navigation (a real axe-core
			`heading-order` finding, not a cosmetic one) — the active queue genuinely is a level-2
			section of "Moderation queue," and each queue-item's own <h3> title genuinely nests under
			it; the tabs' own visual styling already communicates the same boundary for sighted users,
			so the heading itself doesn't need to be visible too.
		-->
		<div
			class="tabpanel"
			role="tabpanel"
			id="mod-tabpanel"
			aria-labelledby={`mod-tab-${tab}`}
			tabindex="-1"
		>
			<h2 class="visually-hidden">
				{#if tab === 'reports'}{m.moderation_tab_reports({ count: reports.length })}
				{:else if tab === 'submissions'}{m.moderation_tab_submissions({
						count: submissions.length
					})}
				{:else if tab === 'materials'}{m.moderation_tab_materials({
						count: materialSubmissions.length
					})}
				{:else if tab === 'edits'}{m.moderation_tab_edits({ count: editSuggestions.length })}
				{:else if tab === 'translations'}{m.moderation_tab_translations({
						count: translations.length
					})}
				{:else if tab === 'governors'}{m.moderation_tab_governors({ count: allGovernors.length })}
				{:else}{m.moderation_tab_flags()}
				{/if}
			</h2>

			{#if tab === 'reports'}
				{#if reports.length === 0}
					<p class="empty">{m.moderation_empty()}</p>
				{:else}
					<ul class="queue">
						{#each reports as r (reportKey(r))}
							<li class="queue-item" class:queue-item--urgent={r.isAutoHidden}>
								<div class="report-header">
									<span class="report-kind">{REPORT_KIND_LABELS[r.kind]()}</span>
									{#if r.isAutoHidden}
										<span class="hidden-badge">{m.moderation_alreadyHidden()}</span>
									{/if}
								</div>
								<h3><MathTitle text={r.preview} /></h3>
								<p class="meta">
									{m.moderation_reportStats({
										count: r.reportCount,
										percent: r.percentReported ?? 0
									})}
									{#if r.exerciseTitle && r.kind !== 'exercise'}
										· {m.moderation_forExercise({ exercise: r.exerciseTitle })}
									{/if}
								</p>
								{#if r.exerciseId}
									<a
										class="context-link"
										href={resolve('/exercises/[id]', { id: r.exerciseId })}
										target="_blank"
										rel="noopener noreferrer"
									>
										{m.moderation_viewInContext()}
									</a>
								{/if}
								{#if r.reasons.length > 0}
									<ul class="reasons-list">
										{#each r.reasons as reason, i (i)}
											<li class="reason">"{reason}"</li>
										{/each}
									</ul>
								{/if}
								<textarea
									rows="1"
									placeholder={m.moderation_reviewNote()}
									bind:value={notes[reportKey(r)]}></textarea>
								<div class="actions">
									<button type="button" class="approve" onclick={() => restoreReport(r)}>
										{m.moderation_restore()}
									</button>
									<button type="button" class="reject" onclick={() => removeReport(r)}>
										{m.moderation_remove()}
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if tab === 'submissions'}
				{#if submissions.length === 0}
					<p class="empty">{m.moderation_empty()}</p>
				{:else}
					<ul class="queue">
						{#each submissions as s (s.id)}
							<li class="queue-item">
								<h3><MathTitle text={s.draft.title} /></h3>
								<p class="meta">
									{m.moderation_submittedBy({
										name: usersById[s.submittedByUserId]?.displayName ?? '—'
									})}
									{m.moderation_forBranch({ branch: coursesById[s.branchId]?.name ?? s.branchId })}
								</p>
								<p class="excerpt">{s.draft.statement.replace(/<[^>]+>/g, '').slice(0, 200)}</p>
								<textarea rows="1" placeholder={m.moderation_reviewNote()} bind:value={notes[s.id]}
								></textarea>
								<div class="actions">
									<button type="button" class="approve" onclick={() => approveSubmission(s)}
										>{m.moderation_approve()}</button
									>
									<button type="button" class="reject" onclick={() => rejectSubmission(s)}
										>{m.moderation_reject()}</button
									>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if tab === 'materials'}
				{#if materialSubmissions.length === 0}
					<p class="empty">{m.moderation_empty()}</p>
				{:else}
					<ul class="queue">
						{#each materialSubmissions as s (s.id)}
							<li class="queue-item">
								<div class="report-header">
									<span class="report-kind">{MATERIAL_TYPE_LABELS[s.type]()}</span>
									{#if s.scanStatus === 'skipped'}
										<span class="scan-badge scan-badge--skipped"
											>{m.moderation_material_scanSkipped()}</span
										>
									{:else if s.scanStatus === 'clean'}
										<span class="scan-badge scan-badge--clean"
											>{m.moderation_material_scanClean()}</span
										>
									{:else}
										<span class="scan-badge scan-badge--flagged"
											>{m.moderation_material_scanFlagged()}</span
										>
									{/if}
								</div>
								<h3>{s.title}</h3>
								<p class="meta">
									{m.moderation_submittedBy({
										name: usersById[s.submittedByUserId]?.displayName ?? '—'
									})}
									{m.moderation_forBranch({ branch: coursesById[s.branchId]?.name ?? s.branchId })}
								</p>
								<p class="excerpt">{s.description.slice(0, 200)}</p>
								<!-- Provenance, surfaced to the reviewing moderator rather than only stored.
								     CLAUDE.md Section 18 item 2 is a still-open question about the copyright
								     status of transcribed branch material — that is a judgment the person
								     clicking Approve is actually making, so where the file came from belongs
								     in front of them at that moment, not just in the database. -->
								{#if s.author || s.sourceUrl}
									<p class="meta submission-provenance">
										{#if s.author}
											<span>{m.material_by({ author: s.author })}</span>
										{/if}
										{#if s.sourceUrl}
											<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a user-declared external URL, not an app route resolve() can express -->
											<a href={s.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
												{m.material_source()}
											</a>
										{/if}
									</p>
								{/if}
								{#if s.requirements.length > 0 || s.priceAmount !== undefined || s.estimatedMinutes !== undefined}
									<div class="submission-declared">
										{#if s.requirements.length > 0}
											<span class="declared-label">{m.moderation_material_requirementsLabel()}</span
											>
											{#each s.requirements as requirement (requirement)}
												<span class="requirement-chip">{requirement}</span>
											{/each}
										{/if}
										{#if s.priceAmount !== undefined}
											<span class="meta-pill price"
												>{m.material_price({
													amount: s.priceAmount.toFixed(2),
													currency: s.priceCurrency
												})}</span
											>
										{/if}
										{#if s.estimatedMinutes !== undefined}
											<span class="meta-pill time"
												>{m.material_estimatedMinutes({ minutes: s.estimatedMinutes })}</span
											>
										{/if}
									</div>
								{/if}
								<!-- eslint-disable svelte/no-navigation-without-resolve -- an external file URL (the Django media server), not an app route resolve() can express -->
								<a
									class="context-link"
									href={s.fileUrl}
									target="_blank"
									rel="noopener noreferrer"
									download
								>
									{m.moderation_material_viewFile({ name: s.fileName })}
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
								<textarea rows="1" placeholder={m.moderation_reviewNote()} bind:value={notes[s.id]}
								></textarea>
								<div class="actions">
									<button type="button" class="approve" onclick={() => approveMaterial(s)}
										>{m.moderation_approve()}</button
									>
									<button type="button" class="reject" onclick={() => rejectMaterial(s)}
										>{m.moderation_reject()}</button
									>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if tab === 'edits'}
				{#if editSuggestions.length === 0}
					<p class="empty">{m.moderation_empty()}</p>
				{:else}
					<ul class="queue">
						{#each editSuggestions as e (e.id)}
							<li class="queue-item">
								<h3>
									{e.field} — <MathTitle text={exerciseTitles[e.exerciseId] ?? e.exerciseId} />
								</h3>
								<p class="meta">
									{m.moderation_submittedBy({
										name: usersById[e.submittedByUserId]?.displayName ?? '—'
									})}
								</p>
								<p class="excerpt">{e.proposedValue.replace(/<[^>]+>/g, '').slice(0, 200)}</p>
								{#if e.reason}
									<p class="reason">“{e.reason}”</p>
								{/if}
								<textarea rows="1" placeholder={m.moderation_reviewNote()} bind:value={notes[e.id]}
								></textarea>
								<div class="actions">
									<button type="button" class="approve" onclick={() => approveEdit(e)}
										>{m.moderation_approve()}</button
									>
									<button type="button" class="reject" onclick={() => rejectEdit(e)}
										>{m.moderation_reject()}</button
									>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if tab === 'translations'}
				{#if translations.length === 0}
					<p class="empty">{m.moderation_empty()}</p>
				{:else}
					<ul class="queue">
						{#each translations as t (t.id)}
							<li class="queue-item">
								<h3>
									{t.locale.toUpperCase()} — <MathTitle
										text={exerciseTitles[t.exerciseId] ?? t.exerciseId}
									/>
								</h3>
								<p class="meta">
									{m.moderation_submittedBy({
										name: t.translatedByUserId
											? (usersById[t.translatedByUserId]?.displayName ?? '—')
											: '—'
									})}
								</p>
								<p class="excerpt"><MathTitle text={t.title} /></p>
								<textarea rows="1" placeholder={m.moderation_reviewNote()} bind:value={notes[t.id]}
								></textarea>
								<div class="actions">
									<button type="button" class="approve" onclick={() => approveTranslation(t)}
										>{m.moderation_approve()}</button
									>
									<button type="button" class="reject" onclick={() => rejectTranslation(t)}
										>{m.moderation_reject()}</button
									>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if tab === 'governors'}
				<!-- only ever reachable via the tab button itself, which only renders for a real
				     global moderator (authStore.isModerator), so no extra guard needed here beyond
				     what already got us into this branch at all. -->
				<div class="governors-panel">
					<form class="grant-form" onsubmit={(e) => (e.preventDefault(), submitGrant())}>
						<h3>{m.moderation_governors_grantHeading()}</h3>
						<label>
							{m.moderation_governors_userIdLabel()}
							<!-- type="text", not "number" — Svelte 5's bind:value on a number input binds a
							     real `number` (or undefined), not the string grantUserId is declared and used
							     as everywhere else (submitGrant's own .trim() call, grantNodeGovernor's string
							     param) — a real runtime TypeError this project's own live-browser verification
							     caught, svelte-check didn't. inputmode keeps the numeric keyboard on mobile. -->
							<input
								type="text"
								inputmode="numeric"
								pattern="[0-9]*"
								placeholder={m.moderation_governors_userIdPlaceholder()}
								bind:value={grantUserId}
							/>
						</label>
						<label>
							{m.moderation_governors_kindLabel()}
							<select bind:value={grantKind} onchange={() => (grantNodeSlug = '')}>
								<option value="branch">{m.moderation_governors_kindBranch()}</option>
								<option value="discipline">{m.moderation_governors_kindDiscipline()}</option>
							</select>
						</label>
						<label>
							{m.moderation_governors_nodeLabel()}
							<select bind:value={grantNodeSlug}>
								<option value="">{m.moderation_governors_nodePlaceholder()}</option>
								{#each grantNodeOptions as node (node.id)}
									<option value={node.id}>{node.name}</option>
								{/each}
							</select>
						</label>
						{#if grantError}
							<p class="grant-error">{grantError}</p>
						{/if}
						<button type="submit" class="approve" disabled={grantSubmitting}>
							{m.moderation_governors_grantSubmit()}
						</button>
					</form>

					<h3>{m.moderation_governors_listHeading()}</h3>
					{#if allGovernors.length === 0}
						<p class="empty">{m.moderation_governors_listEmpty()}</p>
					{:else}
						<ul class="governors-list">
							{#each allGovernors as g (g.id)}
								<li class="governor-row">
									<span class="governor-user">{g.userDisplayName}</span>
									<span class="governor-scope">
										{g.nodeType === 'discipline'
											? m.moderation_governors_scopeDiscipline({ label: g.nodeLabel })
											: m.moderation_governors_scopeBranch({ label: g.nodeLabel })}
									</span>
									<button type="button" class="reject" onclick={() => revokeGrant(g)}>
										{m.moderation_governors_revoke()}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{:else}
				<!-- tab === 'flags' — same "only ever reachable via a staff-only tab button" reasoning
				     as the governors branch right above. -->
				<div class="flags-panel">
					<p class="flags-intro">{m.moderation_flags_intro()}</p>
					{#if flagError}
						<p class="grant-error">{flagError}</p>
					{/if}
					<ul class="flags-list">
						{#each featureFlagsStore.all as flag (flag.key)}
							<li class="flag-row">
								<div class="flag-info">
									<span class="flag-name">{FEATURE_FLAG_LABELS[flag.key]()}</span>
									<span class="flag-status" class:flag-status--off={!flag.isEnabled}>
										{flag.isEnabled ? m.moderation_flags_on() : m.moderation_flags_off()}
									</span>
									{#if flag.updatedByDisplayName}
										<span class="flag-meta">
											{m.moderation_flags_lastChangedBy({ name: flag.updatedByDisplayName })}
										</span>
									{/if}
								</div>
								<button
									type="button"
									class={flag.isEnabled ? 'reject' : 'approve'}
									disabled={flagTogglePending[flag.key]}
									onclick={() => toggleFlag(flag.key, !flag.isEnabled)}
								>
									{flag.isEnabled ? m.moderation_flags_turnOff() : m.moderation_flags_turnOn()}
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.taxonomy-proposals ul {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.taxonomy-proposals li {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.taxonomy-proposals .kind {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		text-transform: uppercase;
	}


	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.subtitle {
		color: var(--text-secondary);
	}
	.denied,
	.loading,
	.empty {
		color: var(--text-secondary);
	}
	.tabs {
		display: flex;
		gap: var(--space-2);
		border-bottom: 1px solid var(--border-color);
	}
	.tabs button {
		background: none;
		border: none;
		padding: var(--space-2) var(--space-1);
		font-weight: 600;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tabs button.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
	.tabpanel {
		// Programmatically focusable (tabindex="-1") so an assistive-tech user tabbing through the
		// tablist per the standard ARIA authoring pattern can be moved straight into the panel
		// content — never in the regular Tab order itself, hence -1 rather than 0.
		outline: none;
	}
	.visually-hidden {
		@include mix.visually-hidden;
	}
	.queue {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.queue-item {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	// A visual priority signal, not just the sort order — an already-hidden item is genuinely more
	// urgent (it's live-hidden right now) than one that's merely pending review.
	.queue-item--urgent {
		border-color: var(--status-danger);
	}
	.queue-item h3 {
		font-size: var(--font-size-base);
	}
	.report-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.report-kind {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.hidden-badge {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.scan-badge {
		font-size: var(--font-size-xs);
	}
	.scan-badge--skipped {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
	.scan-badge--clean {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.scan-badge--flagged {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.context-link {
		align-self: flex-start;
		font-size: var(--font-size-xs);
		color: var(--accent);
		font-weight: 600;
	}
	.reasons-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.meta {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.excerpt {
		font-size: var(--font-size-sm);
	}
	.submission-declared {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}
	.declared-label {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.requirement-chip {
		@include mix.status-pill(var(--status-info), var(--bg-surface-alt));
	}
	.meta-pill {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		font-weight: 600;
	}
	.reason {
		font-size: var(--font-size-xs);
		font-style: italic;
		color: var(--text-secondary);
	}
	textarea {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font-family: inherit;
		resize: vertical;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.approve {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		border: 1px solid var(--status-success);
		cursor: pointer;
	}
	.reject {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		border: 1px solid var(--status-danger);
		cursor: pointer;
	}
	.scope-banner {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.governors-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.grant-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 360px;
	}
	.grant-form label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.grant-form input,
	.grant-form select {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font-family: inherit;
	}
	.grant-error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.governors-list {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.governor-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
	}
	.governor-user {
		font-weight: 600;
	}
	.governor-scope {
		flex: 1;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.flags-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.flags-intro {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.flags-list {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.flag-row {
		@include mix.card-surface;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3);
	}
	.flag-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.flag-name {
		font-weight: 600;
	}
	.flag-status {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
	.flag-status--off {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.flag-meta {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
</style>
