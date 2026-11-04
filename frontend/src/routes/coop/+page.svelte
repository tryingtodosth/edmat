<script lang="ts">
	// `/coop` is the project itself (owner, 2026-10-07/08): the EdMat organisation's page — its
	// description, roster, goals (plans), needs, tasks and polls. Until 2026-11-02 this page WAS
	// `/about`; the owner then asked for the promo reel on `/about` and for "what currently is about"
	// to move to `edmat.net/coop`. What a newcomer needs (the reel, the "New here?" strip, the "what
	// you can do here" grid, the manual and the showcase index) stayed on `/about`, which links here.
	//
	// The research thread's section (the Gemini report on registering the association,
	// `about#money-and-openness`) went with the association, by the owner's word of 2026-11-02
	// (`work/edmat_project.py: RETIRED`); the decisions the owner wants the members' view on are the
	// organisation's polls, which `OrganizationPage` draws.
	//
	// Prerendered (`+page.ts`), but the organisation body loads client-side, so the prerendered
	// HTML carries the head and the body paints after the SPA boots.
	import { m } from '$lib/paraglide/messages.js';
	import OrganizationPage from '$lib/components/organization/OrganizationPage.svelte';

	/** The project's own organisation — `work/edmat_project.py: ORGANIZATION_SLUG`. */
	const PROJECT_SLUG = 'edmat';
</script>

<OrganizationPage
	slug={PROJECT_SLUG}
	headTitle={m.coop_headTitle()}
	headDescription={m.seo_coop_description()}
	quietWhenOff
/>
<!-- "The EdMat team" / "The EdMat team’s own page: its goals, the help it needs, …" -->
