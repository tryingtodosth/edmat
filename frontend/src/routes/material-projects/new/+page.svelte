<script lang="ts">
	// Starting a material as a project rather than as a one-shot upload.
	//
	// Behind `material_submissions`, not `coauthoring`: creating a new material and collaborating on
	// an existing one are two different abilities, and COAUTHORING-BRIEF.md §0 gives them two
	// switches on purpose. A moderator who has turned submissions off has said "no new materials",
	// which this page is, whatever it is called.
	//
	// One submit for two forms. The catalogue and the first version travel in the same request
	// because a project without a version is a row nobody can act on — two forms that each saved
	// themselves could leave exactly that behind.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { createProject } from '$lib/services/materialProjects';
	import type { MaterialProject } from '$lib/types/materialProject';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import CatalogueForm from '$lib/components/coauthoring/CatalogueForm.svelte';
	import VersionEditor from '$lib/components/coauthoring/VersionEditor.svelte';
	import { messageForError } from '$lib/components/coauthoring/labels';

	let catalogueRef = $state<CatalogueForm | null>(null);
	let editorRef = $state<VersionEditor | null>(null);
	let busy = $state(false);
	let error = $state('');
	let created = $state<MaterialProject | null>(null);

	async function submit() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			// The version first: it is the half that can refuse locally ("add a file, a link or some
			// text"), and asking for it first means an "Other…" discipline is not proposed for a
			// submission that was never going to go through.
			const payload = editorRef?.collect();
			if (!payload) {
				busy = false;
				return;
			}
			const catalogue = await catalogueRef?.collect();
			if (!catalogue) {
				busy = false;
				return;
			}
			created = await createProject(
				{
					branchId: catalogue.branchId,
					locale: catalogue.locale,
					type: catalogue.type,
					audience: catalogue.audience,
					author: catalogue.author,
					sourceUrl: catalogue.sourceUrl,
					priceAmount: catalogue.priceAmount,
					priceCurrency: catalogue.priceCurrency,
					estimatedMinutes: catalogue.estimatedMinutes,
					requirements: catalogue.requirements,
					coverage: catalogue.coverage,
					seekingCoauthors: catalogue.seekingCoauthors,
					seekingNote: catalogue.seekingNote,
					version: payload.draft
				},
				payload.file
			);
		} catch (e) {
			error = messageForError(e);
		} finally {
			busy = false;
		}
	}
</script>

<!-- "Start a material together" / "Start a material as a project with a team, a version history
     and a first publication a moderator reads." -->
<PageHead title={m.coauth_new_heading()} description={m.coauth_seo_new()} />

<FeatureGate feature="material_submissions">
	<div class="page">
		<h1>{m.coauth_new_heading()}</h1>
		<!-- "Start a material together" -->
		<p class="lead">{m.coauth_new_lead()}</p>
		<!-- "A project with a team of one, until you invite somebody. The first version is read by a
		     moderator before it becomes a material." -->

		{#if authStore.restoring}
			<p class="hint">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if !authStore.isAuthenticated}
			<p class="hint">
				<a href={resolve('/login')}>{m.coauth_new_loginRequired()}</a>
				<!-- "Sign in to start a project." -->
			</p>
		{:else if created}
			<p class="notice">{m.coauth_new_created()}</p>
			<!-- "The project exists and the first version is saved as a draft…" -->
			<a class="primary" href={resolve('/material-projects/[id]', { id: created.id })}>
				{m.coauth_new_openProject()}
				<!-- "Open the project" -->
			</a>
		{:else}
			<CatalogueForm bind:this={catalogueRef} mode="create" {busy} headingLevel={2} />
			<VersionEditor bind:this={editorRef} mode="create" {busy} headingLevel={2} />

			{#if error}<p class="error">{error}</p>{/if}

			<button type="button" class="primary" disabled={busy} onclick={submit}>
				{m.coauth_new_create()}
				<!-- "Create the project" -->
			</button>
		{/if}
	</div>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);

		h1 {
			margin: 0;
		}
	}
	.lead {
		margin: 0;
		color: var(--text-secondary);
	}
	.hint {
		color: var(--text-secondary);

		a {
			color: var(--accent);
		}
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
		min-height: 44px;
		padding: var(--space-2) var(--space-4);
		text-decoration: none;
	}
</style>
