<script lang="ts">
	/** Mount point C on `ManagementPanels` (MANAGEMENT-BRIEF.md §3.C): the open needs on this node,
	 * a post-a-need form for its manager, and a link into each need's own page for the rest (apply,
	 * withdraw, the applications queue). Draws nothing when the kill switch is off or this reader
	 * cannot see the node at all — `ManagementPanels` itself already withheld `node` in the second
	 * case, so the only thing left to check here is the flag. */
	import { m } from '$lib/paraglide/messages.js';
	import FoldSection from '$lib/components/shared/FoldSection.svelte';
	import { resolve } from '$app/paths';
	import type { NodeRef } from '$lib/types/node';
	import type { Need, NeedDraft } from '$lib/types/need';
	import {
		cancelNeed,
		createNeed,
		getNodeNeeds,
		reopenNeed,
		updateNeed
	} from '$lib/services/needs';
	import NeedForm from './NeedForm.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';
	import ManagementTextMenu from '$lib/components/translations/ManagementTextMenu.svelte';
	import LanguageNote from '$lib/components/translations/LanguageNote.svelte';
	import RowDiscussion from '$lib/components/discussion/RowDiscussion.svelte';
	import { RowDiscussions } from '$lib/components/discussion/rowDiscussions.svelte';
	import { discussionKeyFor } from '$lib/utils/discussionKeys';
	import type { WrittenText } from '$lib/services/textVersions';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { ApiError } from '$lib/api/client';
	import { NEED_KIND_LABELS, NEED_STATUS_LABELS } from '$lib/utils/labels';

	let { node }: { node: NodeRef } = $props();

	const canSee = $derived(featureFlagsStore.isEnabled('needs') || authStore.isModerator);

	let needs = $state<Need[]>([]);
	// Every row's thread policy in ONE request (`rowDiscussions.svelte.ts`).
	const rowDiscussions = new RowDiscussions();
	$effect(() =>
		rowDiscussions.load(
			needs.map((row) => discussionKeyFor('needs', row.id)),
			authStore.user?.id ?? 'anon'
		)
	);
	let loading = $state(true);
	let loadedFor = $state('');
	let showForm = $state(false);
	let busy = $state(false);
	let error = $state('');
	/** The need whose fields are being edited, in a dialog — `null` when nobody is editing. The row
	 *  itself stays a line (the board's rows are deliberately one line each), so the form that
	 *  writes eight fields opens over it rather than inside it. */
	let editing = $state<Need | null>(null);

	/** The text came back resolved for this reader, so the row is patched in place rather than
	 *  refetching the whole panel — the write endpoint answers with the new reading for exactly
	 *  this reason. */
	function applyText(id: string, written: WrittenText) {
		needs = needs.map((need) =>
			need.id === id
				? {
						...need,
						title: written.heading,
						description: written.body,
						language: written.language,
						textVersions: written.textVersions
					}
				: need
		);
	}

	async function toggleCancelled(need: Need) {
		error = '';
		try {
			const updated =
				need.status === 'cancelled' ? await reopenNeed(need.id) : await cancelNeed(need.id);
			needs = needs.map((row) => (row.id === updated.id ? updated : row));
		} catch {
			error = m.common_error_generic();
		}
	}

	async function load() {
		loading = true;
		try {
			needs = await getNodeNeeds(node.kind, node.id);
		} catch {
			// A kind the API does not (yet) support, or a network hiccup — an empty panel is the
			// honest thing to show rather than an error nobody on this page can act on.
			needs = [];
		} finally {
			loading = false;
		}
	}

	// Keyed on the node, the same idempotency guard `ManagementPanels` itself uses — an unguarded
	// effect reading `needs` after `load()` assigns it would re-enter itself.
	$effect(() => {
		const key = `${node.kind}:${node.id}`;
		if (!canSee || key === loadedFor) return;
		loadedFor = key;
		void load();
	});

	function refusal(err: unknown): string {
		return err instanceof ApiError
			? (((err.body as Record<string, unknown> | undefined)?.detail as string | undefined) ??
					m.common_error())
			: m.common_error();
	}

	async function create(draft: NeedDraft) {
		busy = true;
		error = '';
		try {
			const created = await createNeed(node.kind, node.id, draft);
			needs = [created, ...needs];
			showForm = false;
		} catch (err) {
			error = refusal(err);
		} finally {
			busy = false;
		}
	}

	/** The other half of the `⋯` (2026-10-10). The TEXT also goes through `updateNeed`, and the
	 *  backend routes it into the versions table for the original language only
	 *  (`translations.serializers.PlainTextWriteMixin`) — so an edit here is visible, and a reader
	 *  of the other language is honestly told the original is newer. Whoever wants to write both
	 *  languages at once still has "Edit in both languages…" in the same menu. */
	async function saveEdit(draft: NeedDraft) {
		const target = editing;
		if (!target) return;
		busy = true;
		error = '';
		try {
			const updated = await updateNeed(target.id, draft);
			needs = needs.map((row) => (row.id === updated.id ? updated : row));
			editing = null;
		} catch (err) {
			error = refusal(err);
		} finally {
			busy = false;
		}
	}
</script>

{#if canSee}
	<FoldSection key="needs" title={m.needs_panelHeading()} count={needs.length}>
		{#snippet actions()}
			{#if node.canManage && !showForm}
				<button
					type="button"
					class="primary"
					onclick={() => {
						// A refusal from a cancel/reopen must not greet the next person who opens the
						// form: the form is handed `error` and would draw somebody else's failure.
						error = '';
						showForm = true;
					}}
				>
					{m.needs_addNeed()}
				</button>
			{/if}
		{/snippet}
		<div class="needs-panel" data-needs-panel>
			{#if showForm}
				<NeedForm
					{busy}
					{error}
					submitLabel={m.common_save()}
					onsubmit={create}
					oncancel={() => {
						showForm = false;
						error = '';
					}}
				/>
			{/if}

			<!-- A refusal from cancel/reopen, which has no form of its own to carry it (house rule 6:
			     a refusal carries its reason — and the reason has to be somewhere a person can read
			     it). While a form is open it is that form's, so the two never both draw it. -->
			{#if error && !showForm && !editing}
				<p class="error" role="alert">{error}</p>
			{/if}

			{#if loading}
				<p class="status">{m.common_loading()}</p>
			{:else if needs.length === 0}
				<p class="status">{m.needs_panelEmpty()}</p>
			{:else}
				<ul class="list">
					{#each needs as need (need.id)}
						<li
							class="row"
							class:row--over={need.status === 'cancelled' || need.status === 'fulfilled'}
						>
							<a class="title" href={resolve('/needs/[id]', { id: need.id })}>{need.title}</a>
							<span class="kind">{NEED_KIND_LABELS[need.kind]()}</span>
							<span class="pill pill--{need.status}">{NEED_STATUS_LABELS[need.status]()}</span>
							<span class="count"
								>{m.needs_acceptedOfWanted({
									accepted: need.acceptedCount,
									wanted: need.wantedCount
								})}</span
							>
							{#if node.canManage}
								<!-- The menu the owner asked for: until this, a need's own words could only be
							     changed in Django admin — `updateNeed` had been in the service with no call
							     site since the needs board was built. -->
								<ManagementTextMenu
									kind="need"
									id={need.id}
									versions={need.textVersions}
									fallbackHeading={need.title}
									fallbackBody={need.description}
									headingLabel={m.needs_formTitleLabel()}
									bodyLabel={m.needs_formDescriptionLabel()}
									label={m.needs_rowActionsLabel()}
									items={[
										{
											label: m.needs_editNeed(),
											// "Edit the posting"
											onselect: () => {
												error = '';
												editing = need;
											}
										},
										{
											label:
												need.status === 'cancelled' ? m.needs_reopenNeed() : m.needs_cancelNeed(),
											danger: need.status !== 'cancelled',
											onselect: () => void toggleCancelled(need)
										}
									]}
									onSaved={(written) => applyText(need.id, written)}
								/>
							{/if}
							<LanguageNote language={need.language} />
							<RowDiscussion
								policy={rowDiscussions.byKey[discussionKeyFor('needs', need.id)]}
								title={need.title}
							/>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</FoldSection>

	{#if editing}
		<ModalShell title={m.needs_editModalTitle()} onClose={() => (editing = null)} size="wide">
			<!-- "Edit this posting" — `wide` because eight fields in a 560px column is a scroll. -->
			<NeedForm
				initialTitle={editing.title}
				initialDescription={editing.description}
				initialKind={editing.kind}
				initialSkillLevel={editing.skillLevel}
				initialEstimatedHours={editing.estimatedHours}
				initialDeadline={editing.deadline}
				initialIsRemote={editing.isRemote}
				initialWantedCount={editing.wantedCount}
				{busy}
				{error}
				submitLabel={m.common_save()}
				onsubmit={saveEdit}
				oncancel={() => (editing = null)}
			/>
		</ModalShell>
	{/if}
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	// Card chrome and the heading are `FoldSection`'s since 2026-10-08; this is its body.
	.needs-panel {
		display: grid;
		gap: var(--space-3, 0.75rem);
	}
	button {
		min-height: 40px;
		padding: 0 0.8rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-surface);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.primary {
		@include mix.button-primary;
	}
	.status {
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
	.error {
		color: var(--status-danger);
		font-size: 0.85rem;
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border-color);
		border-radius: 8px;
	}
	.title {
		font-weight: 600;
	}
	.row--over .title {
		color: var(--text-secondary);
		font-weight: 500;
	}
	.kind,
	.count {
		font-size: 0.82rem;
		color: var(--text-secondary);
	}
	.pill {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--border-color);
	}
	// The call for help is open to anyone — the info pair (§1: an open question for the reader).
	.pill--open {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
		border-color: transparent;
	}
	.pill--in_progress {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
		border-color: transparent;
	}
	.pill--fulfilled {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		border-color: transparent;
	}
	.pill--cancelled {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
		border-color: transparent;
	}
</style>
