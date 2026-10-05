<script lang="ts">
	/**
	 * The learning record's two blocks, side by side and never in one table.
	 *
	 * That separation is the whole claim of `prompts/00-DESIGN.md` §1 rule 3, and it is a LAYOUT
	 * claim: a shared subject column with "4.5" in one cell and "312" in the next would say the two
	 * numbers are comparable, which nobody can support. Two tables, two headings, two sentences
	 * saying where each number came from.
	 *
	 * A twin of what step B mounts on a profile, because there the two blocks arrive from
	 * `GET /api/users/{id}/learning-record/` and either half can be `null`. The sample shows both.
	 */
	import type { LearningRecordShowcase } from '$lib/content/showcase/learningRecord';

	let { doc }: { doc: LearningRecordShowcase } = $props();
</script>

<div class="record">
	<section class="record__block">
		<p class="record__heading">{doc.gradeBlockHeading}</p>
		<p class="record__note">{doc.gradeBlockNote}</p>
		<table>
			<thead>
				<tr>
					<th scope="col">{doc.subjectColumn}</th>
					<th scope="col" class="num">{doc.gradeColumns.average}</th>
					<th scope="col" class="num">{doc.gradeColumns.results}</th>
				</tr>
			</thead>
			<tbody>
				{#each doc.gradeRows as row (row.branch)}
					<tr>
						<th scope="row">{row.branch}</th>
						<td class="num"><strong>{row.average}</strong></td>
						<td class="num">{row.count}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section class="record__block record__block--activity">
		<p class="record__heading">{doc.activityBlockHeading}</p>
		<p class="record__note">{doc.activityBlockNote}</p>
		<table>
			<thead>
				<tr>
					<th scope="col">{doc.subjectColumn}</th>
					<th scope="col" class="num">{doc.activityColumns.sets}</th>
					<th scope="col" class="num">{doc.activityColumns.lessons}</th>
					<th scope="col" class="num">{doc.activityColumns.cards}</th>
				</tr>
			</thead>
			<tbody>
				{#each doc.activityRows as row (row.branch)}
					<tr>
						<th scope="row">{row.branch}</th>
						<td class="num">{row.sets}</td>
						<td class="num">{row.lessonsDone}</td>
						<td class="num">{row.cardsReviewed}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.record {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.record__block {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	// The second block is visibly a different kind of thing, because that is the point of it being
	// a second block at all.
	.record__block--activity {
		border-left: 3px solid var(--accent);
	}
	.record__heading {
		margin: 0;
		font-weight: 700;
	}
	.record__note {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}
	// `min-width` rather than letting the columns compress: at phone width the four-column activity
	// block squeezed "Cards reviewed" until its numbers were cut off mid-digit, which looks like
	// broken data rather than a table that scrolls. `SampleFrame` already scrolls horizontally, so
	// this makes the overflow real and the figures whole.
	table {
		border-collapse: collapse;
		width: 100%;
		min-width: 26rem;
		font-size: var(--font-size-sm);
	}
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
</style>
