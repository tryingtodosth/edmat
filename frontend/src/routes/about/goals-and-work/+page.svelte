<script lang="ts">
	// `/about/goals-and-work` — the management layer: goals, plans, tasks, help wanted, polls and
	// the work dashboard. Prose and screenshots from `lib/content/showcase/goalsAndWork.ts`; the
	// body is the shared `ModuleSections`, which says per section when its feature is switched off.
	//
	// Several switches, not one: the page counts as "off" only when every feature it describes is
	// (or `ShowcasePage` would tell a reader the whole thing is closed while the help-wanted board is
	// open). Each live link is filtered separately through `SHOWCASE_LIVE`.
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { goalsAndWorkShowcaseFor } from '$lib/content/showcase/goalsAndWork';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import type { FeatureFlagKey } from '$lib/types';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import ModuleSections from '$lib/components/showcase/ModuleSections.svelte';

	const doc = $derived(goalsAndWorkShowcaseFor(getLocale()));

	const FLAGS: Record<string, FeatureFlagKey | FeatureFlagKey[]> = {
		goals: 'goals',
		'plans-and-tasks': ['plans', 'tasks'],
		needs: 'needs',
		polls: 'decisions',
		work: 'work_dashboard',
		'open-board': 'organizations'
	};
	const ALL: FeatureFlagKey[] = ['goals', 'plans', 'tasks', 'needs', 'decisions', 'work_dashboard'];
	const featureOff = $derived(
		!authStore.isModerator && ALL.every((flag) => !featureFlagsStore.isEnabled(flag))
	);

	// The sections readers may talk under — the keys the server knows them by
	// (`backend/community/discussions.py`). The page that draws a section is the only thing that
	// knows it exists, so the list is derived from the content rather than typed twice.
	const DISCUSSION_SECTIONS = $derived(doc.sections.map((section) => section.key));
</script>

<ShowcasePage {doc} slug="goals-and-work" discussionSections={DISCUSSION_SECTIONS} {featureOff}>
	<ModuleSections sections={doc.sections} flags={FLAGS} />
</ShowcasePage>
