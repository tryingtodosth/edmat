<script lang="ts">
	// `/about/contests` — what a contest is here, and what a promised prize turns on.
	//
	// The eighth showcase page, in the shell the other seven use. Two things are specific to it and
	// both come from its subject being law rather than design (`lib/content/showcase/contests.ts`):
	//
	// 1. **The law table draws its own marker per row.** Every article number on this page says how
	//    well it was checked, from `LAW_MARKER_LABELS` — the same map step A's compliance panel
	//    reads, so the words a reader learns here are the words they meet on their own contest.
	// 2. **"This is not legal advice" is said twice**, once under the law table and once in the
	//    closing paragraph. Not belt and braces: a reader who scrolls to the five rules and stops
	//    must have read it, and so must one who reads only the end.
	//
	// Everything is sample data and nothing is fetched (`SampleFrame` makes each group `inert`).
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { m } from '$lib/paraglide/messages.js';
	import { contestsShowcaseFor } from '$lib/content/showcase/contests';
	import { LAW_MARKER_LABELS, contestLabel } from '$lib/utils/labels';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import ShowcasePage from '$lib/components/showcase/ShowcasePage.svelte';
	import DiscussableSection from '$lib/components/discussion/DiscussableSection.svelte';
	import SampleFrame from '$lib/components/showcase/SampleFrame.svelte';
	import SampleRows from '$lib/components/showcase/SampleRows.svelte';
	import ContestPresetCard from '$lib/components/showcase/ContestPresetCard.svelte';

	const doc = $derived(contestsShowcaseFor(getLocale()));
	const featureOff = $derived(!(featureFlagsStore.isEnabled('contests') || authStore.isModerator));

	// The sections readers may talk under, and the keys the server knows them by
	// (`backend/community/discussions.py`). The backend keeps no table of legal section names, so
	// the page that draws a section is the only thing that knows it exists.
	const DISCUSSION_SECTIONS = ['prize', 'presets', 'law', 'created', 'people', 'platform'];
</script>

<ShowcasePage {doc} slug="contests" discussionSections={DISCUSSION_SECTIONS} {featureOff}>
	<DiscussableSection sectionKey="prize" title={doc.noPrizeHeading}>
		<section>
			<h2>{doc.noPrizeHeading}</h2>
			{#each doc.noPrizeBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="presets" title={doc.presetsHeading}>
		<section>
			<h2>{doc.presetsHeading}</h2>
			{#each doc.presetsBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.presetsCaption}>
				<ul class="presets">
					{#each doc.presets as preset (preset.key)}
						<li>
							<!-- The word before the organiser, from the staff-role map rather than a key of its
							     own: "Organiser" is the same word on a real contest page. -->
							<ContestPresetCard {preset} organiserLabel={m.contestLabel_role_organiser()} />
						</li>
					{/each}
				</ul>
			</SampleFrame>
			<p class="more">
				<a href={resolve('/contests')}>{m.contests_title()}</a>
				<!-- "Contests" — the hub, which is the real thing this page is a picture of. -->
			</p>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="law" title={doc.lawHeading}>
		<section>
			<h2>{doc.lawHeading}</h2>
			{#each doc.lawBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.lawCaption}>
				<table class="law">
					<thead>
						<tr>
							<th scope="col">{m.contestsAbout_lawTableCitation()}</th>
							<!-- "What it says" -->
							<th scope="col">{m.contestsAbout_lawTableMarker()}</th>
							<!-- "How well it is checked" -->
						</tr>
					</thead>
					<tbody>
						{#each doc.law as row (row.citation)}
							<tr>
								<th scope="row">
									<span class="law__citation">{row.citation}</span>
									<span class="law__consequence">{row.consequence}</span>
								</th>
								<td>
									<span class="law__marker law__marker--{row.marker}">
										{contestLabel(LAW_MARKER_LABELS, row.marker)}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</SampleFrame>
			<p class="disclaimer">{m.contestsAbout_notLegalAdvice()}</p>
			<!-- "None of this is legal advice, and nobody on this project is a lawyer." -->
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="created" title={doc.createdHeading}>
		<section>
			<h2>{doc.createdHeading}</h2>
			{#each doc.createdBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.createdCaption}>
				<dl class="created">
					{#each doc.created as row (row.module)}
						<div class="created__row">
							<dt>{row.module}</dt>
							<dd>{row.what}</dd>
						</div>
					{/each}
				</dl>
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="people" title={doc.peopleHeading}>
		<section>
			<h2>{doc.peopleHeading}</h2>
			{#each doc.peopleBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
			<SampleFrame caption={doc.peopleCaption}>
				<p class="via">{m.contestsAbout_viaLabel()}</p>
				<!-- "why they are suggested" -->
				<SampleRows rows={doc.peopleRows} />
			</SampleFrame>
		</section>
	</DiscussableSection>

	<DiscussableSection sectionKey="platform" title={doc.platformHeading}>
		<section>
			<h2>{doc.platformHeading}</h2>
			{#each doc.platformBody as paragraph (paragraph)}
				<p class="body">{paragraph}</p>
			{/each}
		</section>
	</DiscussableSection>
</ShowcasePage>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.body {
		max-width: 70ch;
		margin: 0 0 var(--space-2);
	}
	.more {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-sm);
	}
	.presets {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
		gap: var(--space-3);
	}
	.presets li {
		display: flex;
	}
	.presets :global(.preset) {
		width: 100%;
	}

	.law {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sm);

		th,
		td {
			text-align: left;
			vertical-align: top;
			padding: var(--space-2) var(--space-2) var(--space-2) 0;
			border-bottom: 1px solid var(--border-color);
		}
		thead th {
			font-size: var(--font-size-xs);
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: var(--text-secondary);
		}
	}
	.law__citation {
		display: block;
		font-weight: 600;
	}
	.law__consequence {
		display: block;
		// The row header is a `<th>`, so everything in it inherits bold — which made the sentence
		// under each citation as loud as the citation and the two unreadable together. Seen on a
		// screenshot, not in the code (house rule 2).
		font-weight: 400;
		margin-top: var(--space-1);
		color: var(--text-secondary);
		line-height: 1.6;
		max-width: 60ch;
	}
	// The four markers in the status vocabulary (HISTORY.md §17BV): checked = success, a restatement
	// = info (an open question for the reader), not checked = warning (near enough but not settled),
	// disputed = danger (relying on it is the thing that goes wrong).
	.law__marker--verified {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.law__marker--secondary {
		@include mix.status-pill(var(--status-info), var(--status-info-bg));
	}
	.law__marker--unverified {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.law__marker--disputed {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
	}
	.disclaimer {
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		max-width: 70ch;
	}

	.created {
		margin: 0;
		display: grid;
		gap: var(--space-3);
	}
	.created__row {
		dt {
			font-weight: 600;
			margin-bottom: var(--space-1);
		}
		dd {
			margin: 0;
			color: var(--text-secondary);
			font-size: var(--font-size-sm);
			line-height: 1.6;
			max-width: 70ch;
		}
	}
	.via {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
	}
</style>
