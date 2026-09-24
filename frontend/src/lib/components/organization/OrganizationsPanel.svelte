<script lang="ts">
	/** Mount point A on `ManagementPanels` (MANAGEMENT-BRIEF.md §3.A): the organisations standing
	 * behind this course, event, material or organisation — and, for somebody who runs both ends, the
	 * one control that puts a new badge there.
	 *
	 * **It draws nothing at all** when there is nothing to show and nothing this reader could do
	 * about it. That is not tidiness: `ManagementPanels` sits mid-page on somebody else's course, and
	 * a panel that renders an empty box there adds a grey paragraph to a page it does not own. The
	 * same reasoning made `VenuePanel` check its own kill switch instead of being wrapped in
	 * `FeatureGate` (which renders an "unavailable" notice — right for a route, wrong for a panel);
	 * that one was found by looking at an e2e screenshot.
	 *
	 * Every refusal is rendered as its own sentence from `ORGANIZATION_BLOCK_LABELS`: the API hands
	 * back a WORD (`not_node_manager`, `already_linked`), never a boolean, because "you do not run
	 * this" and "somebody already did it" are two completely different things to do about (house
	 * rule 6).
	 */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import {
		getManagedOrganizations,
		getNodeOrganizations,
		linkNode,
		unlinkNode,
		OrganizationRefusedError
	} from '$lib/services/organizations';
	import type { NodeRef } from '$lib/types/node';
	import type {
		OrganizationLink,
		OrganizationLinkKind,
		OrganizationSummary
	} from '$lib/types/organization';
	import {
		ORGANIZATION_KIND_LABELS,
		ORGANIZATION_LINK_KIND_LABELS,
		organizationBlockLabel
	} from '$lib/utils/labels';

	let { node }: { node: NodeRef } = $props();

	/** An organisation's OWN page gets the panel stack too (it is a node like any other), and this
	 *  panel has nothing to say there: `organizations/access.py: LINKABLE_KINDS` leaves `organization`
	 *  out on purpose — a body inside a body is not modelled — so there can never be a link pointing
	 *  at one, and a picker offering to link it to itself would be offering a refusal. Found by
	 *  looking at the screenshot of the organisation page. */
	let applies = $derived(node.kind !== 'organization');

	// The kill switch, checked here rather than by a wrapper — see the comment above. `isModerator`
	// mirrors the backend's own `is_staff` bypass in `feature_gate`.
	let organizationsOn = $derived(
		featureFlagsStore.isEnabled('organizations') || authStore.isModerator
	);

	let links = $state<OrganizationLink[]>([]);
	let managed = $state<OrganizationSummary[]>([]);
	let loaded = $state(false);
	let busy = $state(false);
	let error = $state('');

	let chosen = $state('');
	let claim = $state<OrganizationLinkKind>('runs');

	// The id-changed guard frontend/CLAUDE.md trap 2 asks for: an `$effect` reading a prop re-fires
	// with no navigation at all. Keyed on the reader too, because `canManage` resolves asynchronously
	// and the picker only exists for a manager.
	let loadedFor = $state('');
	$effect(() => {
		if (!organizationsOn || !applies) return;
		const key = `${node.kind}:${node.id}:${authStore.user?.id ?? 'anon'}`;
		if (key === loadedFor) return;
		loadedFor = key;
		void load(key);
	});

	async function load(key: string) {
		try {
			const rows = await getNodeOrganizations(node.kind, node.id);
			if (loadedFor === key) links = rows;
		} catch {
			if (loadedFor === key) links = [];
		}
		if (node.canManage && authStore.isAuthenticated) {
			try {
				const mine = await getManagedOrganizations();
				if (loadedFor === key) managed = mine;
			} catch {
				if (loadedFor === key) managed = [];
			}
		} else if (loadedFor === key) {
			managed = [];
		}
		if (loadedFor === key) loaded = true;
	}

	/** The organisations this person runs that are not already behind this node — offering one that
	 *  the API would refuse with `already_linked` is a refusal we can simply not offer. */
	let linkable = $derived(
		managed.filter((org) => !links.some((link) => link.organization.id === org.id))
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!chosen || busy) return;
		busy = true;
		error = '';
		try {
			const created = await linkNode(chosen, node.kind, node.id, claim);
			links = [created, ...links];
			chosen = '';
		} catch (err) {
			error =
				err instanceof OrganizationRefusedError
					? organizationBlockLabel(err.reason)
					: organizationBlockLabel('generic');
		} finally {
			busy = false;
		}
	}

	async function remove(link: OrganizationLink) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await unlinkNode(link.id);
			links = links.filter((row) => row.id !== link.id);
		} catch (err) {
			error =
				err instanceof OrganizationRefusedError
					? organizationBlockLabel(err.reason)
					: organizationBlockLabel('generic');
		} finally {
			busy = false;
		}
	}
</script>

{#if organizationsOn && applies && loaded && (links.length > 0 || node.canManage)}
	<section class="orgs-panel" aria-labelledby="orgs-panel-heading">
		<h2 id="orgs-panel-heading">{m.orgs_panelTitle()}</h2>
		<!-- "Organisations" -->

		{#if links.length === 0}
			<p class="empty">{m.orgs_panelEmpty()}</p>
			<!-- "No organisation stands behind this yet." -->
		{:else}
			<ul class="badges">
				{#each links as link (link.id)}
					<li class="badge">
						<a href={resolve('/organizations/[slug]', { slug: link.organization.slug })}>
							{link.organization.name}
						</a>
						<span class="claim">{ORGANIZATION_LINK_KIND_LABELS[link.kind]?.() ?? link.kind}</span>
						<span class="kind">
							{ORGANIZATION_KIND_LABELS[link.organization.kind]?.() ?? link.organization.kind}
						</span>
						{#if node.canManage}
							<button type="button" class="unlink" disabled={busy} onclick={() => remove(link)}>
								{m.orgs_unlinkAction()}
								<!-- "Unlink" -->
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if node.canManage}
			<form class="link-form" onsubmit={submit}>
				<h3>{m.orgs_panelLinkHeading()}</h3>
				<!-- "Link an organisation you run" -->
				{#if linkable.length === 0}
					<p class="empty">{m.orgs_panelNoneManaged()}</p>
					<!-- "You do not run an organisation yet." -->
				{:else}
					<div class="row">
						<label class="field">
							<span>{m.orgs_panelTitle()}</span>
							<!-- "Organisations" -->
							<select bind:value={chosen}>
								<option value="">{m.orgs_panelChoosePlaceholder()}</option>
								<!-- "Choose an organisation" -->
								{#each linkable as org (org.id)}
									<option value={org.id}>{org.name}</option>
								{/each}
							</select>
						</label>
						<label class="field">
							<span>{m.orgs_fieldLinkKind()}</span>
							<!-- "The claim" -->
							<select bind:value={claim}>
								<option value="runs">{m.orgs_linkKind_runs()}</option>
								<!-- "Runs" -->
								<option value="supports">{m.orgs_linkKind_supports()}</option>
								<!-- "Supports" -->
							</select>
						</label>
						<button type="submit" disabled={busy || !chosen}>
							{m.orgs_linkAction()}
							<!-- "Link it" -->
						</button>
					</div>
				{/if}
				{#if error}<p class="error" role="alert">{error}</p>{/if}
			</form>
		{/if}
	</section>
{/if}

<style lang="scss">
	.orgs-panel {
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: var(--space-4);
		background: var(--bg-surface);
	}
	h2 {
		margin: 0 0 0.6rem;
		font-size: 1.05rem;
	}
	h3 {
		margin: 0 0 0.4rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}
	.empty {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}
	.badges {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.badge {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
	}
	.claim,
	.kind {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.link-form {
		margin-top: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-color);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: flex-end;
	}
	.field {
		display: grid;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	.error {
		margin: 0.5rem 0 0;
		color: var(--status-danger);
		font-size: 0.85rem;
	}
</style>
