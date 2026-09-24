<script lang="ts">
	/** Founding an organisation. The founder becomes its first owner in the same transaction
	 * (`organizations/services.found`), so there is never a moment at which a body exists with
	 * nobody able to run it.
	 *
	 * A minor is refused server-side with the word `minor` and the sentence is drawn here — the form
	 * is not hidden from them, because "you have to be 16 or over" is information and a missing form
	 * is a puzzle.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { createOrganization, OrganizationRefusedError } from '$lib/services/organizations';
	import type { OrganizationKind } from '$lib/types/organization';
	import { ORGANIZATION_KIND_LABELS, organizationBlockLabel } from '$lib/utils/labels';

	const KINDS: OrganizationKind[] = [
		'university',
		'faculty',
		'school',
		'student_circle',
		'ngo',
		'company',
		'other'
	];

	let name = $state('');
	let kind = $state<OrganizationKind>('student_circle');
	let city = $state('');
	let website = $state('');
	let description = $state('');
	let busy = $state(false);
	let error = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		if (!name.trim()) {
			error = m.orgs_nameRequired(); // "An organisation needs a name."
			return;
		}
		busy = true;
		error = '';
		try {
			const created = await createOrganization({
				name: name.trim(),
				kind,
				city: city.trim(),
				website: website.trim(),
				description
			});
			await goto(resolve('/organizations/[slug]', { slug: created.slug }));
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

<PageHead title={m.orgs_newTitle()} description={m.orgs_newIntro()} />
<!-- "New organisation" / "Found a body that stands behind what you run. You become its first owner." -->

<FeatureGate feature="organizations">
	<div class="page">
		<h1>{m.orgs_newTitle()}</h1>
		<!-- "New organisation" -->
		<p class="intro">{m.orgs_newIntro()}</p>
		<!-- "Found a body that stands behind what you run. You become its first owner." -->

		{#if !authStore.isAuthenticated}
			<p class="status">{m.orgs_signInToCreate()}</p>
			<!-- "Sign in to found an organisation." -->
		{:else}
			<form class="edit-form" onsubmit={submit}>
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
					<textarea bind:value={description} rows="6"></textarea>
				</label>
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<button type="submit" disabled={busy}>
					{busy ? m.orgs_creating() : m.orgs_createAction()}
					<!-- "Founding…" / "Found it" -->
				</button>
			</form>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-4) var(--space-4) var(--space-6);
	}
	.intro,
	.status {
		color: var(--text-secondary);
	}
	.edit-form {
		display: grid;
		gap: 0.8rem;
		margin-top: var(--space-4);
	}
	.field {
		display: grid;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	.error {
		margin: 0;
		color: var(--status-danger);
	}
	button[type='submit'] {
		justify-self: start;
	}
</style>
