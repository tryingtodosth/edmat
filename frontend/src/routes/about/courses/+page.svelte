<script lang="ts">
	// `/about/courses` — a course, one week of it, a deck made from that week, and the completion.
	//
	// `CourseCard` and `MaterialCard` are the real components on real sample objects, inside
	// `SampleFrame`'s inert wrapper so that neither links anywhere. The certificate is
	// `CertificateSample`, a twin of step C's print page — see its header for why.
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { coursesShowcaseFor } from '$lib/content/showcase/courses';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import DiscussableSection from '$lib/components/discussion/DiscussableSection.svelte';
	import SampleFrame from '$lib/components/showcase/SampleFrame.svelte';
	import SampleRows from '$lib/components/showcase/SampleRows.svelte';
	import DeckTile from '$lib/components/showcase/DeckTile.svelte';
	import CertificateSample from '$lib/components/showcase/CertificateSample.svelte';
	import CourseCard from '$lib/components/course/CourseCard.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';

	const doc = $derived(coursesShowcaseFor(getLocale()));
	const featureOff = $derived(!(featureFlagsStore.isEnabled('courses') || authStore.isModerator));

	// The sections readers may talk under, and the keys the server knows them by
	// (`backend/community/discussions.py`). The backend keeps no table of legal section
	// names, so the page that draws a section is the only thing that knows it exists.
	const DISCUSSION_SECTIONS = ['card', 'structure', 'material', 'deck', 'certificate'];
</script>

<ShowcasePage {doc} slug="courses" discussionSections={DISCUSSION_SECTIONS} {featureOff}>
	<DiscussableSection sectionKey="card" title={doc.cardHeading}>
		<section>
			<h2>{doc.cardHeading}</h2>
			<SampleFrame caption={doc.cardCaption}>
				<CourseCard course={doc.course} />
				<p class="run-by">{doc.runByLine}</p>
			</SampleFrame>
			{#if !featureOff}
				<p class="more">
					<a href={resolve('/courses')}>{doc.coursesLinkLabel}</a>
				</p>
			{/if}
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="structure" title={doc.structureHeading}>
		<section>
			<h2>{doc.structureHeading}</h2>
			<SampleFrame caption={doc.structureCaption}>
				<p class="chapter">{doc.chapterName}</p>
				<SampleRows rows={doc.lessonRows} title={doc.lessonName} />
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="material" title={doc.materialHeading}>
		<section>
			<h2>{doc.materialHeading}</h2>
			<SampleFrame caption={doc.materialCaption}>
				<MaterialCard material={doc.material} />
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="deck" title={doc.deckHeading}>
		<section>
			<h2>{doc.deckHeading}</h2>
			{#each doc.deckBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.deckCaption}>
				<DeckTile deck={doc.deck} />
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="certificate" title={doc.certificateHeading}>
		<section>
			<h2>{doc.certificateHeading}</h2>
			{#each doc.certificateBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.certificateCaption}>
				<CertificateSample certificate={doc.certificate} />
			</SampleFrame>
		</section>
	</DiscussableSection>
</ShowcasePage>

<style lang="scss">
	.run-by {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.chapter {
		margin: 0;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}
	.body {
		max-width: 70ch;
		margin: 0 0 var(--space-2);
	}
	.more {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-sm);
	}
</style>
