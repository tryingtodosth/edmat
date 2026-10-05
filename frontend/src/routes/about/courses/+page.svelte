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
	import SampleFrame from '$lib/components/showcase/SampleFrame.svelte';
	import SampleRows from '$lib/components/showcase/SampleRows.svelte';
	import DeckTile from '$lib/components/showcase/DeckTile.svelte';
	import CertificateSample from '$lib/components/showcase/CertificateSample.svelte';
	import CourseCard from '$lib/components/course/CourseCard.svelte';
	import MaterialCard from '$lib/components/material/MaterialCard.svelte';

	const doc = $derived(coursesShowcaseFor(getLocale()));
	const featureOff = $derived(!(featureFlagsStore.isEnabled('courses') || authStore.isModerator));
</script>

<ShowcasePage {doc} slug="courses" {featureOff}>
	<section>
		<h2>{doc.cardHeading}</h2>
		<SampleFrame caption={doc.cardCaption}>
			<CourseCard course={doc.course} />
			<p class="run-by">{doc.runByLine}</p>
		</SampleFrame>
		<p class="more">
			<a href={resolve('/courses')}>{doc.coursesLinkLabel}</a>
		</p>
	</section>

	<section>
		<h2>{doc.structureHeading}</h2>
		<SampleFrame caption={doc.structureCaption}>
			<p class="chapter">{doc.chapterName}</p>
			<SampleRows rows={doc.lessonRows} title={doc.lessonName} />
		</SampleFrame>
	</section>

	<section>
		<h2>{doc.materialHeading}</h2>
		<SampleFrame caption={doc.materialCaption}>
			<MaterialCard material={doc.material} />
		</SampleFrame>
	</section>

	<section>
		<h2>{doc.deckHeading}</h2>
		{#each doc.deckBody as paragraph (paragraph)}
			<p class="body">{paragraph}</p>
		{/each}
		<SampleFrame caption={doc.deckCaption}>
			<DeckTile deck={doc.deck} />
		</SampleFrame>
	</section>

	<section>
		<h2>{doc.certificateHeading}</h2>
		{#each doc.certificateBody as paragraph (paragraph)}
			<p class="body">{paragraph}</p>
		{/each}
		<SampleFrame caption={doc.certificateCaption}>
			<CertificateSample certificate={doc.certificate} />
		</SampleFrame>
	</section>
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
