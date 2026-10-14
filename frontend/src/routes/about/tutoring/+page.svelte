<script lang="ts">
	// `/about/tutoring` — listings, published hours and a booking that is a request until the tutor
	// answers. Prose and screenshots from `lib/content/showcase/tutoring.ts`; the body is the shared
	// `ModuleSections`. One switch, `tutoring`, covers the whole feature, so it is the page's
	// `featureOff` and no section has its own. The live links go to `/tutoring`, which a Polish
	// reader sees as `/korki` (`components/showcase/hrefs.ts: liveHref`).
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { tutoringShowcaseFor } from '$lib/content/showcase/tutoring';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import ModuleSections from '$lib/components/showcase/ModuleSections.svelte';

	const doc = $derived(tutoringShowcaseFor(getLocale()));
	const featureOff = $derived(!(featureFlagsStore.isEnabled('tutoring') || authStore.isModerator));
	// Discussion keys (`backend/community/discussions.py`), taken from the content's own sections.
	const DISCUSSION_SECTIONS = $derived(doc.sections.map((section) => section.key));
</script>

<ShowcasePage {doc} slug="tutoring" discussionSections={DISCUSSION_SECTIONS} {featureOff}>
	<ModuleSections sections={doc.sections} />
</ShowcasePage>
