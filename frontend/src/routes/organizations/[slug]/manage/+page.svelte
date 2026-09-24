<script lang="ts">
	/** Running an organisation: its details, its roster, and what it stands behind.
	 *
	 * Every control here has a server-side counterpart that refuses with a WORD, and every word has a
	 * sentence in `ORGANIZATION_BLOCK_LABELS` (house rule 6). The page does not try to predict them —
	 * `last_owner` in particular is a recount the server does and the page simply shows.
	 *
	 * Members are added by **account id**, and the form says so: there is no people search on this
	 * platform (root CLAUDE.md, known gaps), and a search box that cannot work is worse than a number
	 * field with an explanation.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		addMember,
		dissolveOrganization,
		getMembers,
		getOrganizationBySlug,
		getOrganizationLinks,
		linkNode,
		OrganizationRefusedError,
		removeMember,
		setMemberRole,
		unlinkNode,
		updateOrganization
	} from '$lib/services/organizations';
	import type { NodeKind } from '$lib/types/node';
	import type {
		Organization,
		OrganizationKind,
		OrganizationLink,
		OrganizationLinkKind,
		OrganizationMember,
		OrganizationRole
	} from '$lib/types/organization';
	import {
		NODE_KIND_LABELS,
		ORGANIZATION_KIND_LABELS,
		ORGANIZATION_LINK_KIND_LABELS,
		ORGANIZATION_ROLE_LABELS,
		organizationBlockLabel
	} from '$lib/utils/labels';

	const KINDS: OrganizationKind[] = [
		'university',
		'faculty',
		'school',
		'student_circle',
		'ngo',
		'company',
		'other'
	];
	const ROLES: OrganizationRole[] = ['owner', 'admin', 'member'];
	// `config/nodes.py`'s linkable kinds — `organizations/access.py: LINKABLE_KINDS`, which leaves
	// `organization` out on purpose (a body inside a body is not modelled).
	const NODE_KINDS: NodeKind[] = ['course', 'event', 'material'];

	let organization = $state<Organization | null>(null);
	let members = $state<OrganizationMember[]>([]);
	let links = $state<OrganizationLink[]>([]);
	let loading = $state(true);
	let missing = $state(false);
	let busy = $state(false);
	let error = $state('');
	let saved = $state(false);

	// The details form, kept as its own strings so that a failed save does not wipe what was typed.
	let name = $state('');
	let kind = $state<OrganizationKind>('other');
	let city = $state('');
	let website = $state('');
	let description = $state('');

	// The roster form. `type="text" inputmode="numeric"` on purpose — `bind:value` on a real
	// `<input type="number">` binds a number or `undefined`, which is frontend/CLAUDE.md's trap 1 and
	// has produced `.trim is not a function` on a live submit four times.
	let accountId = $state('');
	let newRole = $state<OrganizationRole>('member');

	// The link form.
	let nodeKind = $state<NodeKind>('course');
	let nodeId = $state('');
	let claim = $state<OrganizationLinkKind>('runs');

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
				return;
			}
			name = found.name;
			kind = found.kind;
			city = found.city;
			website = found.website;
			description = found.description;
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

	function report(err: unknown) {
		error =
			err instanceof OrganizationRefusedError
				? organizationBlockLabel(err.reason)
				: organizationBlockLabel('generic');
	}

	async function saveDetails(event: SubmitEvent) {
		event.preventDefault();
		if (!organization || busy) return;
		busy = true;
		error = '';
		saved = false;
		try {
			organization = await updateOrganization(organization.id, {
				name: name.trim(),
				kind,
				city: city.trim(),
				website: website.trim(),
				description
			});
			saved = true;
		} catch (err) {
			report(err);
		} finally {
			busy = false;
		}
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (!organization || busy) return;
		const id = accountId.trim();
		if (!id) return;
		busy = true;
		error = '';
		try {
			const row = await addMember(organization.id, id, newRole);
			members = [...members, row];
			accountId = '';
		} catch (err) {
			report(err);
		} finally {
			busy = false;
		}
	}

	async function changeRole(member: OrganizationMember, role: OrganizationRole) {
		if (busy || role === member.role) return;
		busy = true;
		error = '';
		try {
			const updated = await setMemberRole(member.id, role);
			members = members.map((row) => (row.id === updated.id ? updated : row));
		} catch (err) {
			report(err);
			// Put the select back: the server refused, so the roster has not moved.
			members = [...members];
		} finally {
			busy = false;
		}
	}

	async function drop(member: OrganizationMember) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await removeMember(member.id);
			members = members.filter((row) => row.id !== member.id);
		} catch (err) {
			report(err);
		} finally {
			busy = false;
		}
	}

	async function link(event: SubmitEvent) {
		event.preventDefault();
		if (!organization || busy) return;
		const id = nodeId.trim();
		if (!id) return;
		busy = true;
		error = '';
		try {
			const created = await linkNode(organization.id, nodeKind, id, claim);
			links = [created, ...links];
			nodeId = '';
		} catch (err) {
			report(err);
		} finally {
			busy = false;
		}
	}

	async function unlink(row: OrganizationLink) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await unlinkNode(row.id);
			links = links.filter((link) => link.id !== row.id);
		} catch (err) {
			report(err);
		} finally {
			busy = false;
		}
	}

	async function dissolve() {
		if (!organization || busy) return;
		if (!confirm(m.orgs_dissolveConfirm())) return; // "Dissolve this organisation? Its badges come off every page that shows them."
		busy = true;
		error = '';
		try {
			await dissolveOrganization(organization.id);
			organization = { ...organization, isActive: false };
		} catch (err) {
			report(err);
		} finally {
			busy = false;
		}
	}
</script>

<PageHead title={m.orgs_manageTitle()} description={m.orgs_manageIntro()} />
<!-- "Running this organisation" / "The roster, what the organisation stands behind, and its own details." -->

<FeatureGate feature="organizations">
	<div class="page">
		{#if loading}
			<p class="status">{m.common_loading()}</p>
		{:else if missing || !organization}
			<p class="status">{m.orgs_notFound()}</p>
			<!-- "There is no organisation at this address." -->
		{:else if !organization.canManage}
			<p class="status">{m.orgs_notManagerNotice()}</p>
			<!-- "You do not run this organisation." -->
			<p>
				<a href={resolve('/organizations/[slug]', { slug: organization.slug })}>
					{organization.name}
				</a>
			</p>
		{:else}
			<header class="head">
				<h1>{organization.name}</h1>
				<a href={resolve('/organizations/[slug]', { slug: organization.slug })}>
					{m.orgs_browseTitle()}
					<!-- "Organisations" -->
				</a>
			</header>
			<p class="intro">{m.orgs_manageIntro()}</p>
			<!-- "The roster, what the organisation stands behind, and its own details." -->

			{#if error}<p class="error" role="alert">{error}</p>{/if}

			<section class="block">
				<h2>{m.orgs_detailsHeading()}</h2>
				<!-- "Details" -->
				<form class="edit-form" onsubmit={saveDetails}>
					<label class="field">
						<span>{m.orgs_fieldName()}</span>
						<!-- "Name" -->
						<input type="text" bind:value={name} required />
					</label>
					<label class="field">
						<span>{m.orgs_fieldKind()}</span>
						<!-- "Kind" -->
						<select bind:value={kind}>
							{#each KINDS as value (value)}
								<option {value}>{ORGANIZATION_KIND_LABELS[value]()}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>{m.orgs_fieldCity()}</span>
						<!-- "City" -->
						<input type="text" bind:value={city} />
					</label>
					<label class="field">
						<span>{m.orgs_fieldWebsite()}</span>
						<!-- "Website" -->
						<input type="url" bind:value={website} placeholder="https://" />
					</label>
					<label class="field">
						<span>{m.orgs_fieldDescription()}</span>
						<!-- "About" -->
						<textarea bind:value={description} rows="5"></textarea>
					</label>
					<div class="actions">
						<button type="submit" disabled={busy}>{m.orgs_saveAction()}</button>
						<!-- "Save" -->
						{#if saved}<span class="ok">{m.orgs_savedNotice()}</span>{/if}
						<!-- "Saved." -->
					</div>
				</form>
			</section>

			<section class="block">
				<h2>{m.orgs_rosterHeading()}</h2>
				<!-- "Members" -->
				<ul class="roster">
					{#each members as member (member.id)}
						<li>
							<a href={resolve('/users/[id]', { id: member.user.id })}>{member.user.displayName}</a>
							<select
								aria-label={m.orgs_fieldRole()}
								value={member.role}
								disabled={busy}
								onchange={(event) =>
									changeRole(
										member,
										(event.currentTarget as HTMLSelectElement).value as OrganizationRole
									)}
							>
								{#each ROLES as value (value)}
									<option {value}>{ORGANIZATION_ROLE_LABELS[value]()}</option>
								{/each}
							</select>
							<button type="button" disabled={busy} onclick={() => drop(member)}>
								{member.user.id === (authStore.user?.id ?? '')
									? m.orgs_leaveAction()
									: m.orgs_removeAction()}
								<!-- "Leave" / "Remove" -->
							</button>
						</li>
					{:else}
						<li class="status">{m.orgs_rosterEmpty()}</li>
						<!-- "Nobody is listed yet." -->
					{/each}
				</ul>

				<form class="add-form" onsubmit={add}>
					<h3>{m.orgs_addMemberHeading()}</h3>
					<!-- "Add somebody" -->
					<p class="note">{m.orgs_addMemberHint()}</p>
					<!-- "There is no people search here yet, so add somebody by their account id — the number at the end of their profile address." -->
					<div class="row">
						<label class="field">
							<span>{m.orgs_fieldAccountId()}</span>
							<!-- "Account id" -->
							<input type="text" inputmode="numeric" bind:value={accountId} />
						</label>
						<label class="field">
							<span>{m.orgs_fieldRole()}</span>
							<!-- "Role" -->
							<select bind:value={newRole}>
								{#each ROLES as value (value)}
									<option {value}>{ORGANIZATION_ROLE_LABELS[value]()}</option>
								{/each}
							</select>
						</label>
						<button type="submit" disabled={busy}>{m.orgs_addMemberAction()}</button>
						<!-- "Add" -->
					</div>
				</form>
			</section>

			<section class="block">
				<h2>{m.orgs_runsHeading()}</h2>
				<!-- "What it stands behind" -->
				<ul class="links">
					{#each links as row (row.id)}
						<li>
							<span>{row.node?.title ?? ''}</span>
							<span class="role">
								{row.node ? (NODE_KIND_LABELS[row.node.kind]?.() ?? row.node.kind) : ''} ·
								{ORGANIZATION_LINK_KIND_LABELS[row.kind]?.() ?? row.kind}
							</span>
							<button type="button" disabled={busy} onclick={() => unlink(row)}>
								{m.orgs_unlinkAction()}
								<!-- "Unlink" -->
							</button>
						</li>
					{:else}
						<li class="status">{m.orgs_runsEmpty()}</li>
						<!-- "Nothing has been linked to this organisation yet." -->
					{/each}
				</ul>

				<form class="add-form" onsubmit={link}>
					<h3>{m.orgs_linksHeading()}</h3>
					<!-- "Link something" -->
					<p class="note">{m.orgs_linkHint()}</p>
					<!-- "Link a course, an event or a material that you run. Both sides have to be yours, and the badge then appears on its page." -->
					<div class="row">
						<label class="field">
							<span>{m.orgs_fieldNodeKind()}</span>
							<!-- "What kind of thing" -->
							<select bind:value={nodeKind}>
								{#each NODE_KINDS as value (value)}
									<option {value}>{NODE_KIND_LABELS[value]()}</option>
								{/each}
							</select>
						</label>
						<label class="field">
							<span>{m.orgs_fieldNodeId()}</span>
							<!-- "Its id" -->
							<input type="text" inputmode="numeric" bind:value={nodeId} />
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
						<button type="submit" disabled={busy}>{m.orgs_linkAction()}</button>
						<!-- "Link it" -->
					</div>
				</form>
			</section>

			{#if organization.myRole === 'owner' && organization.isActive}
				<section class="block">
					<h2>{m.orgs_dissolveHeading()}</h2>
					<!-- "Dissolve" -->
					<p class="note">{m.orgs_dissolveHint()}</p>
					<!-- "The page stays for its own members and every badge comes off. Nothing is deleted." -->
					<button type="button" class="danger" disabled={busy} onclick={dissolve}>
						{m.orgs_dissolveAction()}
						<!-- "Dissolve this organisation" -->
					</button>
				</section>
			{:else if !organization.isActive}
				<p class="notice">{m.orgs_dissolvedNotice()}</p>
				<!-- "This organisation has been dissolved. Only its own members can see this page." -->
			{/if}
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
	h3 {
		margin: 0 0 0.2rem;
		font-size: 0.9rem;
	}
	.intro,
	.status,
	.note,
	.role {
		color: var(--text-secondary);
	}
	.intro,
	.note {
		margin: 0;
		font-size: 0.9rem;
	}
	.block {
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: var(--space-4);
	}
	.edit-form {
		display: grid;
		gap: 0.7rem;
	}
	.field {
		display: grid;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: flex-end;
		margin-top: 0.4rem;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		align-items: center;
	}
	.roster,
	.links {
		list-style: none;
		margin: 0 0 var(--space-4);
		padding: 0;
		display: grid;
		gap: 0.4rem;
	}
	.roster li,
	.links li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.role {
		font-size: 0.8rem;
	}
	.add-form {
		border-top: 1px solid var(--border-color);
		padding-top: var(--space-3);
	}
	.error {
		margin: 0;
		color: var(--status-danger);
	}
	.ok {
		color: var(--text-secondary);
		font-size: 0.85rem;
	}
	.notice {
		margin: 0;
		color: var(--text-secondary);
	}
	.danger {
		color: var(--status-danger);
	}
</style>
