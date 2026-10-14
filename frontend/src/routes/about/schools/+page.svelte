<script lang="ts">
	// `/about/schools` — a school is an organisation whose courses are classes.
	//
	// The one link out of this page that is not an EdMat route is `/dziennik/`, the school-logbook
	// demonstration (HISTORY.md §17BO). It is a plain `<a … rel="external">`, not `resolve()`,
	// because it is NOT a SvelteKit route — it is a separate static bundle the vhost serves beside
	// the SPA, so the router must not try to own it and a client-side navigation would 404 inside
	// this app. The `Footer` component's own link does exactly this, for exactly this reason, and
	// is gated on the same `school_demo` flag.
	//
	// There is deliberately no data link of any kind between EdMat and that demonstration. The
	// relationship is by example, which is what this page is.
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { schoolsShowcaseFor } from '$lib/content/showcase/schools';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import DiscussableSection from '$lib/components/discussion/DiscussableSection.svelte';
	import SampleFrame from '$lib/components/showcase/SampleFrame.svelte';
	import SampleRows from '$lib/components/showcase/SampleRows.svelte';

	const doc = $derived(schoolsShowcaseFor(getLocale()));
	// The organisations layer is what a school IS here, so that is the switch this page answers to.
	const featureOff = $derived(
		!(featureFlagsStore.isEnabled('organizations') || authStore.isModerator)
	);
	const canSchoolDemo = $derived(
		featureFlagsStore.isEnabled('school_demo') || authStore.isModerator
	);

	// The sections readers may talk under, and the keys the server knows them by
	// (`backend/community/discussions.py`). The backend keeps no table of legal section
	// names, so the page that draws a section is the only thing that knows it exists.
	const DISCUSSION_SECTIONS = ['org', 'classes', 'roster', 'demo'];
</script>

<ShowcasePage {doc} slug="schools" discussionSections={DISCUSSION_SECTIONS} {featureOff}>
	<DiscussableSection sectionKey="org" title={doc.orgHeading}>
		<section>
			<h2>{doc.orgHeading}</h2>
			<SampleFrame caption={doc.orgCaption}>
				<div class="org">
					<p class="org__kind">{doc.org.kind} · {doc.org.place}</p>
					<p class="org__name">{doc.org.name}</p>
					<p class="org__summary">{doc.org.summary}</p>
					<p class="org__runs">{doc.org.runs}</p>
				</div>
			</SampleFrame>
			{#if !featureOff}
				<p class="more">
					<a href={resolve('/organizations')}>{doc.organizationsLinkLabel}</a>
				</p>
			{/if}
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="classes" title={doc.classesHeading}>
		<section>
			<h2>{doc.classesHeading}</h2>
			<SampleFrame caption={doc.classesCaption}>
				<SampleRows rows={doc.classes} />
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="roster" title={doc.rosterHeading}>
		<section>
			<h2>{doc.rosterHeading}</h2>
			{#each doc.rosterBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.rosterCaption}>
				<table class="roster">
					<thead>
						<tr>
							<th scope="col">{doc.rosterColumns.pupil}</th>
							<th scope="col">{doc.rosterColumns.guardian}</th>
							<th scope="col" class="num">{doc.rosterColumns.progress}</th>
						</tr>
					</thead>
					<tbody>
						{#each doc.roster as row (row.pupil)}
							<tr>
								<th scope="row">{row.pupil}</th>
								<td>{row.guardian}</td>
								<td class="num">{row.progress}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="demo" title={doc.demoHeading}>
		<section>
			<h2>{doc.demoHeading}</h2>
			{#each doc.demoBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<ul class="limits">
				{#each doc.demoLimits as limit (limit)}
					<li>{limit}</li>
				{/each}
			</ul>
			{#if canSchoolDemo}
				<p class="demo-link">
					<!-- Not resolve(): /dziennik is a separate static bundle, not a route of this app. -->
					<a class="btn" href="/dziennik/" rel="external">{doc.demoLinkLabel}</a>
				</p>
			{/if}
		</section>
	</DiscussableSection>
</ShowcasePage>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.org {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.org__kind {
		margin: 0;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}
	.org__name {
		margin: 0;
		font-size: var(--font-size-lg);
		font-weight: 700;
	}
	.org__summary {
		margin: 0;
		max-width: 60ch;
	}
	.org__runs {
		margin: var(--space-1) 0 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}

	.roster {
		border-collapse: collapse;
		width: 100%;
		font-size: var(--font-size-sm);

		th,
		td {
			text-align: left;
			padding: var(--space-2);
			border-top: 1px solid var(--border-color);
		}
		thead th {
			border-top: 0;
			color: var(--text-secondary);
			font-weight: 600;
			font-size: var(--font-size-xs);
			text-transform: uppercase;
			letter-spacing: 0.04em;
		}
		.num {
			text-align: right;
			font-variant-numeric: tabular-nums;
		}
	}

	.limits {
		margin: var(--space-2) 0 0;
		padding-left: 1.4em;
		list-style: disc;
		max-width: 70ch;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		line-height: 1.6;
	}
	.body {
		max-width: 70ch;
		margin: 0 0 var(--space-2);
	}
	.more {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-sm);
	}
	.demo-link {
		margin: var(--space-4) 0 0;
	}
	.btn {
		@include mix.button-secondary;
		text-decoration: none;
	}
</style>
