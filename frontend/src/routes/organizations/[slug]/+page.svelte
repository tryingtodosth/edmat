<script lang="ts">
	/** One organisation: what it is, who is in it, what it stands behind — and, because an
	 * organisation is itself a management node (`config/nodes.py`), the whole management panel stack
	 * mounted on itself, so a student circle can keep its own tasks, needs, plans and polls.
	 *
	 * `ManagementPanels` is given `nodeKind="organization"` and the numeric id, never the slug: the
	 * slug is what the URL carries, the pk is what the API speaks (root CLAUDE.md, "Ids").
	 *
	 * The load is keyed on the slug AND on who is asking, with the id-changed guard
	 * frontend/CLAUDE.md trap 2 requires — `myRole` and `canManage` change the moment a session
	 * resolves, and an unguarded `$effect` would refetch in a loop.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import ManagementPanels from '$lib/components/management/ManagementPanels.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		getMembers,
		getOrganizationBySlug,
		getOrganizationLinks
	} from '$lib/services/organizations';
	import type { Organization, OrganizationLink, OrganizationMember } from '$lib/types/organization';
	import {
		NODE_KIND_LABELS,
		ORGANIZATION_KIND_LABELS,
		ORGANIZATION_LINK_KIND_LABELS,
		ORGANIZATION_ROLE_LABELS
	} from '$lib/utils/labels';

	let organization = $state<Organization | null>(null);
	let members = $state<OrganizationMember[]>([]);
	let links = $state<OrganizationLink[]>([]);
	let loading = $state(true);
	let missing = $state(false);

	let loadedFor = $state('');
	$effect(() => {
		const slug = page.params.slug ?? '';
		const key = `${slug}:${authStore.user?.id ?? 'anon'}`;
		if (!slug || key === loadedFor) return;
		loadedFor = key;
		void load(slug, key);
	});

	async function load(slug: string, key: string) {
		loading = true;
		missing = false;
		try {
			const found = await getOrganizationBySlug(slug);
			if (loadedFor !== key) return;
			organization = found;
			if (!found) {
				missing = true;
				members = [];
				links = [];
				return;
			}
			const [roster, badges] = await Promise.all([
				getMembers(found.id),
				getOrganizationLinks(found.id)
			]);
			if (loadedFor !== key) return;
			members = roster;
			links = badges;
		} catch {
			if (loadedFor !== key) return;
			organization = null;
			missing = true;
		} finally {
			if (loadedFor === key) loading = false;
		}
	}
</script>

<PageHead
	title={organization?.name ?? m.orgs_browseTitle()}
	description={organization?.city || m.orgs_browseIntro()}
/>
<!-- "Organisations" / "Bodies that stand behind what happens here — faculties, schools, student circles and the rest." -->

<FeatureGate feature="organizations">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if missing || !organization}
			<p class="status">{m.orgs_notFound()}</p>
			<!-- "There is no organisation at this address." -->
		{:else}
			<header class="head">
				<div>
					<h1>{organization.name}</h1>
					<p class="meta">
						{ORGANIZATION_KIND_LABELS[organization.kind]?.() ?? organization.kind}{organization.city
							? ` · ${organization.city}`
							: ''}
					</p>
				</div>
				{#if organization.canManage}
					<a
						class="manage"
						href={resolve('/organizations/[slug]/manage', { slug: organization.slug })}
					>
						{m.orgs_manageAction()}
						<!-- "Manage" -->
					</a>
				{/if}
			</header>

			{#if !organization.isActive}
				<p class="notice">{m.orgs_dissolvedNotice()}</p>
				<!-- "This organisation has been dissolved. Only its own members can see this page." -->
			{/if}

			<section class="block">
				<h2>{m.orgs_aboutHeading()}</h2>
				<!-- "About" -->
				{#if organization.description}
					<MathContent source={organization.description} />
				{:else}
					<p class="status">{m.orgs_noDescription()}</p>
					<!-- "This organisation has not written anything about itself yet." -->
				{/if}
				<ul class="facts">
					{#if organization.website}
						<li>
							{m.orgs_websiteLabel()}:
							<!-- "Website" -->
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external address the organisation gave -->
							<a href={organization.website} rel="nofollow noopener external">
								{organization.website}
							</a>
						</li>
					{/if}
					{#if organization.createdBy}
						<li>
							{m.orgs_foundedByLabel()}:
							<!-- "Founded by" -->
							<a href={resolve('/users/[id]', { id: organization.createdBy.id })}>
								{organization.createdBy.displayName}
							</a>
						</li>
					{/if}
				</ul>
			</section>

			<section class="block">
				<h2>{m.orgs_rosterHeading()}</h2>
				<!-- "Members" -->
				{#if members.length === 0}
					<p class="status">{m.orgs_rosterEmpty()}</p>
					<!-- "Nobody is listed yet." -->
				{:else}
					<ul class="roster">
						{#each members as member (member.id)}
							<li>
								<a href={resolve('/users/[id]', { id: member.user.id })}>
									{member.user.displayName}
								</a>
								<span class="role">{ORGANIZATION_ROLE_LABELS[member.role]?.() ?? member.role}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="block">
				<h2>{m.orgs_runsHeading()}</h2>
				<!-- "What it stands behind" -->
				<p class="note">{m.orgs_membershipNote()}</p>
				<!-- "Being on this list gives nobody any standing on the courses, events or materials below — each of those has its own team." -->
				{#if links.length === 0}
					<p class="status">{m.orgs_runsEmpty()}</p>
					<!-- "Nothing has been linked to this organisation yet." -->
				{:else}
					<ul class="links">
						{#each links as link (link.id)}
							{#if link.node}
								<li>
									{#if link.node.kind === 'course'}
										<a href={resolve('/courses/[id]', { id: link.node.id })}>{link.node.title}</a>
									{:else if link.node.kind === 'event'}
										<a href={resolve('/events/[id]', { id: link.node.id })}>{link.node.title}</a>
									{:else if link.node.kind === 'material'}
										<a href={resolve('/materials/[id]', { id: link.node.id })}>{link.node.title}</a>
									{:else}
										<span>{link.node.title}</span>
									{/if}
									<span class="role">
										{NODE_KIND_LABELS[link.node.kind]?.() ?? link.node.kind} ·
										{ORGANIZATION_LINK_KIND_LABELS[link.kind]?.() ?? link.kind}
									</span>
								</li>
							{/if}
						{/each}
					</ul>
				{/if}
			</section>

			<ManagementPanels nodeKind="organization" nodeId={organization.id} />
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 820px;
		margin: 0 auto;
		padding: var(--space-4) var(--space-4) var(--space-6);
		display: grid;
		gap: var(--space-5);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: baseline;
		justify-content: space-between;
	}
	h1 {
		margin: 0;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.05rem;
	}
	.meta,
	.status,
	.note,
	.role {
		color: var(--text-secondary);
	}
	.meta,
	.note {
		margin: 0.2rem 0 0;
		font-size: 0.9rem;
	}
	.notice {
		margin: 0;
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		color: var(--text-secondary);
	}
	.block {
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: var(--space-4);
	}
	.facts,
	.roster,
	.links {
		list-style: none;
		margin: 0.6rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
		font-size: 0.95rem;
	}
	.role {
		font-size: 0.8rem;
		margin-left: 0.4rem;
	}
</style>
