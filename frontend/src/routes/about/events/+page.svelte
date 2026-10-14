<script lang="ts">
	// `/about/events` — the deck a session leaves behind, and how an event meets a course.
	//
	// `EventCard` and `CourseCard` are the real components on real sample objects. The second half
	// of the page is the one that needed writing: it says what is deliberately NOT built, which is
	// a link from an event to a course. Both hang off the organisation that runs them.
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { eventsShowcaseFor } from '$lib/content/showcase/events';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import DiscussableSection from '$lib/components/discussion/DiscussableSection.svelte';
	import SampleFrame from '$lib/components/showcase/SampleFrame.svelte';
	import SampleRows from '$lib/components/showcase/SampleRows.svelte';
	import DeckTile from '$lib/components/showcase/DeckTile.svelte';
	import EventCard from '$lib/components/event/EventCard.svelte';
	import CourseCard from '$lib/components/course/CourseCard.svelte';

	const doc = $derived(eventsShowcaseFor(getLocale()));
	const featureOff = $derived(!(featureFlagsStore.isEnabled('events') || authStore.isModerator));

	// The sections readers may talk under, and the keys the server knows them by
	// (`backend/community/discussions.py`). The backend keeps no table of legal section
	// names, so the page that draws a section is the only thing that knows it exists.
	const DISCUSSION_SECTIONS = ['card', 'programme', 'take-home', 'cross'];
</script>

<ShowcasePage {doc} slug="events" discussionSections={DISCUSSION_SECTIONS} {featureOff}>
	<DiscussableSection sectionKey="card" title={doc.cardHeading}>
		<section>
			<h2>{doc.cardHeading}</h2>
			<SampleFrame caption={doc.cardCaption}>
				<EventCard event={doc.event} />
			</SampleFrame>
			{#if !featureOff}
				<p class="more">
					<a href={resolve('/events')}>{doc.eventsLinkLabel}</a>
				</p>
			{/if}
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="programme" title={doc.programmeHeading}>
		<section>
			<h2>{doc.programmeHeading}</h2>
			<SampleFrame caption={doc.programmeCaption}>
				<p class="track">{doc.trackName} · {doc.sessionTime}</p>
				<SampleRows rows={doc.sessionRows} title={doc.sessionName} />
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="take-home" title={doc.takeHomeHeading}>
		<section>
			<h2>{doc.takeHomeHeading}</h2>
			{#each doc.takeHomeBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.takeHomeCaption}>
				<DeckTile deck={doc.deck} />
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="cross" title={doc.crossHeading}>
		<section>
			<h2>{doc.crossHeading}</h2>
			{#each doc.crossBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.crossCaption}>
				<p class="run-by">
					<span class="run-by__label">{doc.runByLabel}</span>
					{doc.runBy.join(' · ')}
				</p>
				<CourseCard course={doc.relatedCourse} />
			</SampleFrame>
		</section>
	</DiscussableSection>
</ShowcasePage>

<style lang="scss">
	.track {
		margin: 0;
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}
	.run-by {
		margin: 0;
		font-size: var(--font-size-sm);
	}
	.run-by__label {
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: var(--font-size-xs);
		margin-right: var(--space-1);
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
