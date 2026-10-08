<script lang="ts">
	// One organisation at its slug. The page itself is `OrganizationPage`, shared with `/about`,
	// which renders the project's own body (2026-10-08).
	import { page } from '$app/state';
	import OrganizationPage from '$lib/components/organization/OrganizationPage.svelte';
</script>

<OrganizationPage slug={page.params.slug ?? ''} />
