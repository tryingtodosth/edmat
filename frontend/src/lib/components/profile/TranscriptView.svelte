<script lang="ts">
	// A transcript read the way somebody reads their own: one academic year at a time, newest first.
	//
	// **The grouping and every average come from the server.** They are not derived here even though
	// every row needed is present, because an average has real rules — ECTS-weighted, and no number at
	// all for a year that mixes grading scales — and a second implementation in TypeScript is how the
	// per-year figures and the overall one start disagreeing on the same screen. See `grades_by_year`.
	//
	// One component for both sides of the feature: the owner's own editor passes `onRemoveYear` and
	// gets a per-year delete; a visitor's public modal does not and gets the same reading experience
	// without it. A second component would be a second place for the year headings to drift.
	import { m } from '$lib/paraglide/messages.js';
	import type { GradeYear } from '$lib/types/identity';

	interface Row {
		name: string;
		term: string;
		ects: number;
		value: string;
		branchSlug: string | null;
	}

	let {
		years,
		grades,
		onRemoveYear,
		busy = false
	}: {
		years: GradeYear[];
		grades: Row[];
		/** Only passed by the owner's own editor. Its absence is what makes this read-only. */
		onRemoveYear?: (year: string) => void;
		busy?: boolean;
	} = $props();

	/** Which year sections are open. Collapsed by default — three years of results is fifteen rows, and
	 * a modal that opens fully expanded buries the year summaries the reader came for. The most recent
	 * year opens on its own, since that is the one being asked about nine times out of ten. */
	let open = $state<Record<string, boolean>>({});
	let openedFor = $state<string | undefined>(undefined);
	$effect(() => {
		// Keyed on the year list rather than run once: the editor re-renders this after a transfer, and
		// a first-run-only guard would leave a freshly imported transcript entirely collapsed.
		const key = years.map((y) => y.year).join('|');
		if (key === openedFor) return;
		openedFor = key;
		open = years.length > 0 ? { [years[0].year]: true } : {};
	});

	function rowsFor(year: GradeYear): Row[] {
		return grades.filter((g) => year.terms.includes(g.term));
	}

	function label(year: GradeYear): string {
		// A year the registry gave no readable term for. Named rather than rendered as an empty heading,
		// because a blank section header reads like a bug.
		return year.year || m.profile_transcriptUnknownYear(); // "Year not stated"
	}
</script>

{#if years.length === 0}
	<p class="empty">{m.profile_transcriptEmpty()}</p>
	<!-- "No results transferred." -->
{:else}
	<ul class="years">
		{#each years as year (year.year)}
			<li class="year">
				<div class="year__head">
					<button
						type="button"
						class="year__toggle"
						aria-expanded={Boolean(open[year.year])}
						onclick={() => (open = { ...open, [year.year]: !open[year.year] })}
					>
						<span class="year__chevron" class:year__chevron--open={open[year.year]}>▸</span>
						<span class="year__name">{label(year)}</span>
					</button>
					<span class="year__stats">
						{m.profile_transcriptYearStats({ count: year.count, ects: year.ects })}
						<!-- "{count} results · {ects} ECTS" -->
					</span>
					{#if year.average !== null}
						<span class="year__average"
							>{m.education_weightedAverage({ average: year.average })}</span
						>
						<!-- "Weighted average: {average}" -->
					{:else}
						<!-- Not a missing number: this year mixes grading scales, and there is no honest way
						     to fold an ECTS letter into the Polish 2–5 scale. Saying so beats inventing one. -->
						<span class="year__average year__average--none"
							>{m.profile_transcriptMixedScales()}</span
						>
						<!-- "Mixed grading scales — no single average" -->
					{/if}
					{#if onRemoveYear}
						<button
							type="button"
							class="year__remove"
							disabled={busy}
							onclick={() => onRemoveYear?.(year.year)}
						>
							{m.profile_transcriptRemoveYear()}
							<!-- "Remove this year" -->
						</button>
					{/if}
				</div>
				{#if open[year.year]}
					<ul class="grades">
						{#each rowsFor(year) as row (row.name + row.term)}
							<!-- Two fixed lines — name with the mark pinned right, then the term and credits —
							     rather than one wrapping row. Wrapping put the mark on line two whenever the
							     course name was short enough for the term to fit beside it, so consecutive rows
							     broke differently and a term appeared to belong to the name after it. Visible in
							     a screenshot, invisible to every assertion about the same list. -->
							<li class="grade">
								<div class="grade__top">
									<span class="grade__name">{row.name}</span>
									<span class="grade__value">{row.value}</span>
								</div>
								<div class="grade__meta">
									<span>{row.term} · {row.ects} ECTS</span>
									{#if row.branchSlug}
										<span class="grade__matched">{m.education_matchedBranch()}</span>
										<!-- "matches a branch here" -->
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.years {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.year {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
	}
	.year__head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		// Everything after the toggle wraps onto its own line on a phone rather than being crushed —
		// the average is the piece most worth reading and the first casualty of a nowrap row.
		flex-wrap: wrap;
	}
	.year__toggle {
		@include mix.focus-ring;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--text-primary);
		font-size: var(--font-size-base);
		font-weight: 600;
	}
	.year__chevron {
		display: inline-block;
		transition: transform 0.15s ease;
		color: var(--text-secondary);
	}
	.year__chevron--open {
		transform: rotate(90deg);
	}
	// Anybody who has asked for less motion gets the same behaviour with none of it.
	@media (prefers-reduced-motion: reduce) {
		.year__chevron {
			transition: none;
		}
	}
	.year__stats,
	.year__average {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.year__average {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
	.year__average--none {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
	}
	.year__remove {
		@include mix.focus-ring;
		margin-left: auto;
		background: none;
		border: 1px solid var(--status-danger);
		border-radius: var(--radius-sm);
		color: var(--status-danger);
		font-size: var(--font-size-xs);
		padding: 2px var(--space-2);
		cursor: pointer;
		&:disabled {
			opacity: 0.5;
			cursor: default;
		}
	}
	.grades {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-top: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-color);
	}
	.grade {
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-size: var(--font-size-sm);
	}
	.grade__top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.grade__name {
		overflow-wrap: anywhere;
	}
	.grade__meta {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.grade__value {
		font-weight: 600;
		flex-shrink: 0;
	}
	.grade__matched {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
	.empty {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
</style>
