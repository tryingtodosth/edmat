<script lang="ts">
	// `/about/learning-record` — the two blocks a public profile can carry.
	//
	// `EducationCard` and `TranscriptView` are the real components: both already exist, both take
	// plain props, and the transcript's year sections genuinely open and close, which is worth
	// showing because that is what a reader does with it. They sit in `SampleFrame` all the same —
	// a sample that is read-only is still a sample, and the frame is what says so.
	//
	// The record table itself is `RecordBlocks`, a twin: on a real profile it arrives from
	// `GET /api/users/{id}/learning-record/` and either half can be withheld.
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { learningRecordShowcaseFor } from '$lib/content/showcase/learningRecord';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import DiscussableSection from '$lib/components/discussion/DiscussableSection.svelte';
	import SampleFrame from '$lib/components/showcase/SampleFrame.svelte';
	import RecordBlocks from '$lib/components/showcase/RecordBlocks.svelte';
	import EducationCard from '$lib/components/shared/EducationCard.svelte';
	import TranscriptView from '$lib/components/profile/TranscriptView.svelte';

	const doc = $derived(learningRecordShowcaseFor(getLocale()));
	const featureOff = $derived(
		!(featureFlagsStore.isEnabled('learning_record') || authStore.isModerator)
	);

	// The sections readers may talk under, and the keys the server knows them by
	// (`backend/community/discussions.py`). The backend keeps no table of legal section
	// names, so the page that draws a section is the only thing that knows it exists.
	const DISCUSSION_SECTIONS = ['grades', 'record', 'consent'];
</script>

<ShowcasePage {doc} slug="learning-record" discussionSections={DISCUSSION_SECTIONS} {featureOff}>
	<DiscussableSection sectionKey="grades" title={doc.gradesHeading}>
		<section>
			<h2>{doc.gradesHeading}</h2>
			<SampleFrame caption={doc.educationCaption}>
				<EducationCard education={doc.education} />
			</SampleFrame>
			<!-- The transcript opens and closes, so it is a live sample rather than a picture: a reader
			     who cannot press the year heading learns nothing about what the year heading does. -->
			<SampleFrame caption={doc.transcriptCaption} live>
				<TranscriptView years={doc.transcriptYears} grades={doc.transcriptRows} />
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="record" title={doc.recordHeading}>
		<section>
			<h2>{doc.recordHeading}</h2>
			<SampleFrame caption={doc.recordCaption}>
				<RecordBlocks {doc} />
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="consent" title={doc.consentHeading}>
		<section>
			<h2>{doc.consentHeading}</h2>
			{#each doc.consentBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.consentCaption}>
				<ul class="consents">
					{#each doc.consents as consent (consent.label)}
						<li>
							<span class="consents__state" class:consents__state--on={consent.on}>
								{consent.on ? m.showcase_consentOn() : m.showcase_consentOff()}
								<!-- "Shared" / "Not shared" -->
							</span>
							<span class="consents__label">{consent.label}</span>
							<span class="consents__shares">{consent.shares}</span>
						</li>
					{/each}
				</ul>
			</SampleFrame>
			<p class="more">
				<a href={resolve('/settings/profile')}>{doc.settingsLinkLabel}</a>
			</p>
		</section>
	</DiscussableSection>
</ShowcasePage>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.consents {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);

		li {
			display: grid;
			grid-template-columns: 7rem minmax(0, 1fr);
			gap: var(--space-1) var(--space-3);
			align-items: baseline;
		}
	}
	.consents__state {
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
		font-size: var(--font-size-xs);
		text-align: center;
	}
	.consents__state--on {
		@include mix.status-pill(var(--accent), var(--accent-soft));
		font-size: var(--font-size-xs);
		font-weight: 700;
		text-align: center;
	}
	.consents__label {
		font-weight: 600;
	}
	.consents__shares {
		grid-column: 2;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
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

	@media (max-width: 560px) {
		.consents li {
			grid-template-columns: 1fr;
		}
		.consents__shares {
			grid-column: 1;
		}
	}
</style>
