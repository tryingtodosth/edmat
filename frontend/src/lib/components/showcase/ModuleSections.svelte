<script lang="ts">
	/**
	 * The body of a module page (`/about/goals-and-work`, `/tutoring`, `/materials`, `/conference`,
	 * 2026-10-14): each `ShowcaseModuleSection` in order, under its own discussion.
	 *
	 * One component rather than four hand-written bodies, because the four pages have the same shape —
	 * prose, sometimes a framed sample, sometimes a list of plain facts — and differ only in their
	 * words, which live in `lib/content/showcase/<slug>.ts`. The earlier eight pages each draw their
	 * own components (an exercise card, a flip card) and so each have their own body.
	 *
	 * **The kill switches.** `flags` maps a section key to the feature it describes. A section whose
	 * feature is off still renders — it is a description, and a reader asking what EdMat does
	 * deserves the answer either way, the same reasoning `ShowcasePage`'s `featureOff` gives for a
	 * whole page — but it says so in one line, and it carries no link anywhere (none of these
	 * sections links out: the shell's "Try it yourself" row and the screenshots do, through
	 * `SHOWCASE_LIVE`, which is where the switches remove them).
	 */
	import { m } from '$lib/paraglide/messages.js';
	import type { ShowcaseModuleSection } from '$lib/content/showcase';
	import type { FeatureFlagKey } from '$lib/types';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import DiscussableSection from '$lib/components/discussion/DiscussableSection.svelte';
	import SampleFrame from './SampleFrame.svelte';
	import SampleRows from './SampleRows.svelte';

	let {
		sections,
		flags = {}
	}: {
		sections: ShowcaseModuleSection[];
		/** Section key → the switch (or switches) its feature answers to. A key with no entry has no
		 *  switch; a section about two features (plans AND tasks) is "off" only when both are. */
		flags?: Partial<Record<string, FeatureFlagKey | FeatureFlagKey[]>>;
	} = $props();

	// The same moderator bypass `FeatureGate` and the backend have; the store fails open before its
	// first fetch, so the prerendered HTML carries no note and one appears on hydration if needed.
	function isOff(key: string): boolean {
		const entry = flags[key];
		if (!entry || authStore.isModerator) return false;
		const keys = Array.isArray(entry) ? entry : [entry];
		return keys.every((flag) => !featureFlagsStore.isEnabled(flag));
	}
</script>

{#each sections as section (section.key)}
	<DiscussableSection sectionKey={section.key} title={section.heading}>
		<section class="module-section" data-section={section.key}>
			<h2>{section.heading}</h2>
			{#if isOff(section.key)}
				<p class="module-section__off">{m.showcaseModules_sectionOff()}</p>
				<!-- "This part is switched off on this site right now — what follows describes it all the same." -->
			{/if}
			{#each section.body as paragraph (paragraph)}
				<p class="module-section__body">{paragraph}</p>
			{/each}
			{#if section.facts && section.facts.length > 0}
				<dl class="module-section__facts">
					{#each section.facts as fact (fact.term)}
						<div>
							<dt>{fact.term}</dt>
							<dd>{fact.detail}</dd>
						</div>
					{/each}
				</dl>
			{/if}
			{#if section.sample}
				<SampleFrame caption={section.sample.caption}>
					<SampleRows rows={section.sample.rows} title={section.sample.title ?? ''} />
				</SampleFrame>
			{/if}
		</section>
	</DiscussableSection>
{/each}

<style lang="scss">
	.module-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	// The shell's own paragraphs are 1.65; these sit in the same column and must read the same.
	.module-section__body {
		max-width: 70ch;
		margin: 0 0 var(--space-1);
		line-height: 1.65;
	}
	.module-section__off {
		margin: 0;
		max-width: 70ch;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--status-warning-bg);
		color: var(--text-primary);
		font-size: var(--font-size-sm);
	}
	// Plain facts, not a sample: a term and one line, the term column narrowing to nothing on a
	// phone (the grid collapses to one column below 30rem).
	.module-section__facts {
		margin: var(--space-2) 0 0;
		display: flex;
		flex-direction: column;
		max-width: 70ch;

		div {
			display: grid;
			grid-template-columns: minmax(0, 11rem) minmax(0, 1fr);
			gap: var(--space-1) var(--space-4);
			border-top: 1px solid var(--border-color);
			padding: var(--space-2) 0;
		}
		div:first-child {
			border-top: 0;
		}
		dt {
			font-weight: 600;
			overflow-wrap: anywhere;
		}
		dd {
			margin: 0;
			color: var(--text-secondary);
			font-size: var(--font-size-sm);
			line-height: 1.6;
		}
	}
	@media (max-width: 30rem) {
		.module-section__facts div {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
