<script lang="ts">
	/** One organisation's page, rendered by `/organizations/[slug]` and — for the project's own body —
	 * by `/about` (2026-10-08). What it is, who is in it, what it stands behind — and, because an
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
	import { resolve } from '$app/paths';
	import { localizedPath } from '$lib/utils/localizedPath';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import MathContent from '$lib/components/shared/MathContent.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import ManagementPanels from '$lib/components/management/ManagementPanels.svelte';
	import ManagementTextMenu from '$lib/components/translations/ManagementTextMenu.svelte';
	import LanguageNote from '$lib/components/translations/LanguageNote.svelte';
	import RowDiscussion from '$lib/components/discussion/RowDiscussion.svelte';
	import { RowDiscussions } from '$lib/components/discussion/rowDiscussions.svelte';
	import { discussionKeyFor } from '$lib/utils/discussionKeys';
	import { authStore } from '$lib/state/auth.svelte';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
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

	let {
		slug,
		headTitle,
		headDescription,
		quietWhenOff = false
	}: {
		slug: string;
		headTitle?: string;
		headDescription?: string;
		/** Draw NOTHING, rather than the gate's "this feature is unavailable" notice, while the
		 *  `organizations` switch is off. For `/about`, where the organisation is one section of a
		 *  page that goes on below it and an unexplained "unavailable" line at the top reads as if
		 *  the whole About page were switched off (WP11). `/organizations/[slug]` keeps the notice:
		 *  there the organisation IS the page. */
		quietWhenOff?: boolean;
	} = $props();

	let organization = $state<Organization | null>(null);
	let members = $state<OrganizationMember[]>([]);
	let links = $state<OrganizationLink[]>([]);
	let loading = $state(true);
	let missing = $state(false);

	// The organisation's own thread, drawn under its description (`community/discussions.py`, "And
	// so is an organisation's own page"). One key, so the batched read is a request for one row —
	// used anyway because `RowDiscussions` carries the reader-keyed guard this page needs for the
	// same reason its own load does (`frontend/CLAUDE.md` trap 2): `can_post` changes the moment a
	// session resolves. Keyed on the SLUG, which is what `organizations/<slug>` spells over there and
	// what `/organizations/[slug]` resolves here.
	const rowDiscussions = new RowDiscussions();
	const discussionKey = $derived(
		organization ? discussionKeyFor('organizations', organization.slug) : ''
	);
	$effect(() =>
		rowDiscussions.load(discussionKey ? [discussionKey] : [], authStore.user?.id ?? 'anon')
	);

	// Not asked at all while the `organizations` switch is off for this reader (house rule 3: a
	// killed feature stops ASKING, not only drawing). `/about` mounts this page for every visitor,
	// and an anonymous reader with the switch off got a refused request in the console on every
	// visit (WP11). `isLoaded` is waited for because `isEnabled` fails OPEN until the first flag
	// fetch lands — right for drawing a link, wrong for firing a request (`users/[id]` and
	// `RotaPanel` say the same). `|| isModerator` is `FeatureGate`'s own bypass, which mirrors the
	// backend's staff bypass; the switch state is part of the key, so turning it back on loads.
	let enabled = $derived(featureFlagsStore.isEnabled('organizations') || authStore.isModerator);
	let loadedFor = $state('');
	$effect(() => {
		if (!featureFlagsStore.isLoaded) return;
		const key = `${slug}:${authStore.user?.id ?? 'anon'}:${enabled}`;
		if (!slug || key === loadedFor) return;
		loadedFor = key;
		if (!enabled) {
			// The gate below draws its own notice; nothing here to fetch or show.
			organization = null;
			members = [];
			links = [];
			loading = false;
			return;
		}
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
	title={headTitle ?? organization?.name ?? m.orgs_browseTitle()}
	description={headDescription ?? (organization?.city || m.orgs_browseIntro())}
/>
<!-- "Organisations" / "Bodies that stand behind what happens here — faculties, schools, student circles and the rest." -->

{#if !(quietWhenOff && !enabled)}
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
							{ORGANIZATION_KIND_LABELS[organization.kind]?.() ??
								organization.kind}{organization.city ? ` · ${organization.city}` : ''}
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
					<div class="block__head">
						<h2>{m.orgs_aboutHeading()}</h2>
						<!-- "About" -->
						{#if organization.canManage}
							<!-- The first paragraph on `/about` is this one, and until 2026-10-08 it was a
						     single field with the Polish and the English glued together by hand
						     (`work/edmat_project.py: _pl_en`). This writes them as two. There is no
						     heading pane: an organisation's NAME is a registered name and the same in
						     every language. -->
							<ManagementTextMenu
								kind="organization"
								id={organization.id}
								versions={organization.textVersions}
								fallbackBody={organization.description}
								withHeading={false}
								headingLabel={m.orgs_aboutHeading()}
								bodyLabel={m.orgs_descriptionLabel()}
								label={m.orgs_aboutActionsLabel()}
								onSaved={(written) => {
									if (!organization) return;
									organization = {
										...organization,
										description: written.body,
										language: written.language,
										textVersions: written.textVersions
									};
								}}
							/>
						{/if}
					</div>
					<LanguageNote language={organization.language} />
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
					<!-- The thread the owner asked for: "after the header, the description should be
				     commentable as well". Named by the organisation rather than by the heading —
				     "Comments on EdMat.net" says what the talk is about, where "Comments on About"
				     would not. Draws nothing until the policy lands and nothing when the location is
				     off (house rule 3, which `SectionDiscussion` keeps). -->
					<RowDiscussion policy={rowDiscussions.byKey[discussionKey]} title={organization.name} />
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
									<span class="role"
										>{ORGANIZATION_ROLE_LABELS[member.role]?.() ?? member.role}</span
									>
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
											<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `localizedPath()` wraps the `resolve()` call so a localized route renders its Polish address; the rule only sees a bare `resolve()` without type-aware linting, which this project does not run. See lib/utils/localizedPath.ts. -->
											<a href={localizedPath(resolve('/materials/[id]', { id: link.node.id }))}
												>{link.node.title}</a
											>
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
{/if}

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
	.block__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
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
