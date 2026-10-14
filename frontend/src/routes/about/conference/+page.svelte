<script lang="ts">
	// `/about/conference` — the conference layer (CONFERENCE-BRIEF.md): venues, event documents,
	// tickets and the door, the volunteer rota, the cloakroom, and seeing the event as a visitor.
	// Prose and screenshots from `lib/content/showcase/conference.ts`; the body is the shared
	// `ModuleSections`.
	//
	// `events` is the page's switch — every tool here hangs off an event — and each tool's own
	// switch (the six seeded together by moderation migration 0043) marks its section.
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { conferenceShowcaseFor } from '$lib/content/showcase/conference';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import type { FeatureFlagKey } from '$lib/types';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import ModuleSections from '$lib/components/showcase/ModuleSections.svelte';

	const doc = $derived(conferenceShowcaseFor(getLocale()));
	const featureOff = $derived(!(featureFlagsStore.isEnabled('events') || authStore.isModerator));
	const FLAGS: Record<string, FeatureFlagKey> = {
		venue: 'venues',
		documents: 'event_documents',
		tickets: 'tickets',
		shifts: 'shifts',
		cloakroom: 'cloakroom',
		preview: 'role_preview'
	};
	// Discussion keys (`backend/community/discussions.py`), taken from the content's own sections.
	const DISCUSSION_SECTIONS = $derived(doc.sections.map((section) => section.key));
</script>

<ShowcasePage {doc} slug="conference" discussionSections={DISCUSSION_SECTIONS} {featureOff}>
	<ModuleSections sections={doc.sections} flags={FLAGS} />
</ShowcasePage>
