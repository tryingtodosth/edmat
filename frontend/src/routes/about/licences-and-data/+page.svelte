<script lang="ts">
	// `/about/licences-and-data` — the licence each piece of content carries (CC BY 4.0 suggested for
	// your own work: the owner's decision of 2026-10-15) and what EdMat counts about its readers.
	// Prose and screenshots from `lib/content/showcase/licencesAndData.ts`; the body is the shared
	// `ModuleSections`.
	//
	// Licensing has no kill switch (`backend/licensing/`: what a reader may do with content cannot be
	// switched off while the content is up), and neither do the statistics. The browser error
	// reports have one, `client_errors`, and their section says so in a line when it is off.
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { licencesAndDataShowcaseFor } from '$lib/content/showcase/licencesAndData';
	import type { FeatureFlagKey } from '$lib/types';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import ModuleSections from '$lib/components/showcase/ModuleSections.svelte';

	const doc = $derived(licencesAndDataShowcaseFor(getLocale()));
	const FLAGS: Record<string, FeatureFlagKey> = {
		'error-reports': 'client_errors'
	};
	// Discussion keys (`backend/community/discussions.py`), taken from the content's own sections.
	const DISCUSSION_SECTIONS = $derived(doc.sections.map((section) => section.key));
</script>

<ShowcasePage {doc} slug="licences-and-data" discussionSections={DISCUSSION_SECTIONS}>
	<ModuleSections sections={doc.sections} flags={FLAGS} />
</ShowcasePage>
