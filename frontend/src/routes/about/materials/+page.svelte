<script lang="ts">
	// `/about/materials` — a material, co-authoring it, attachments, and licences. Prose and
	// screenshots from `lib/content/showcase/materials.ts`; the body is the shared `ModuleSections`.
	//
	// Browsing materials has no kill switch (it is the catalogue), so the page is never "off" as a
	// whole; co-authoring and attachments each have one, and their sections say so when they are
	// off. Licensing has no switch either (`backend/licensing/`).
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { materialsShowcaseFor } from '$lib/content/showcase/materials';
	import type { FeatureFlagKey } from '$lib/types';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import ModuleSections from '$lib/components/showcase/ModuleSections.svelte';

	const doc = $derived(materialsShowcaseFor(getLocale()));
	const FLAGS: Record<string, FeatureFlagKey> = {
		coauthoring: 'coauthoring',
		attachments: 'attachments'
	};
	// Discussion keys (`backend/community/discussions.py`), taken from the content's own sections.
	const DISCUSSION_SECTIONS = $derived(doc.sections.map((section) => section.key));
</script>

<ShowcasePage {doc} slug="materials" discussionSections={DISCUSSION_SECTIONS}>
	<ModuleSections sections={doc.sections} flags={FLAGS} />
</ShowcasePage>
