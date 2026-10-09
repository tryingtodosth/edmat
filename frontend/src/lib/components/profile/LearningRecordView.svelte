<script lang="ts">
	// The learning record, read-only: two blocks, one per-subject table each, and they never mix.
	//
	// `prompts/00-DESIGN.md` §1 rule 3 is the entire layout decision here. "3.5 in Analiza
	// Matematyczna" and "41 cards reviewed in Analiza Matematyczna" are two different kinds of fact
	// about the same corner of the curriculum, so they get two headings, two leads saying what each
	// one is and is not, and two tables — never one table with an average column that happens to be
	// empty for the EdMat rows, which would read as one measurement with gaps in it.
	//
	// Every number arrives computed (`backend/identity/record.py`), including the averages, which
	// follow rules — ECTS-weighted, and no number at all for a subject mixing grading scales — that
	// already live in Python. Re-deriving them here is how this figure and the transcript's own start
	// disagreeing on one screen, which is why `TranscriptView` says the same thing.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';
	import { formatDate } from '$lib/utils/format';
	import { LEARNING_RECORD_METRIC_HINTS, learningRecordMetricLabel } from '$lib/utils/labels';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import type { LearningRecord, LearningRecordActivityRow } from '$lib/types/identity';

	let { record }: { record: LearningRecord } = $props();

	// The contests block answers to the `contests` switch as well as to the consent: a killed
	// feature takes its block away rather than leaving a heading over an empty table (house rule 3).
	// The other two blocks are unaffected, which is the neighbouring-endpoints half of that rule.
	const showPlacements = $derived(
		record.placements !== null && featureFlagsStore.isEnabled('contests')
	);

	/** The activity table's columns, in the order the server listed them: the three metrics this
	 * cycle declares, then anything a later provider registered. Derived from the ROWS rather than
	 * hardcoded, so a metric added by a future app appears instead of being silently dropped. */
	const metricKeys = $derived.by(() => {
		// Deduplicated through a plain array rather than a `Set`: `svelte/prefer-svelte-reactivity`
		// refuses a mutable `Set` anywhere a rune can see it (frontend/CLAUDE.md trap 7), and this
		// list is at most a handful of keys, so there is nothing to optimise for.
		const extras: string[] = [];
		for (const row of record.activity ?? []) {
			for (const key of Object.keys(row.extra)) if (!extras.includes(key)) extras.push(key);
		}
		return ['sets', 'lessons_done', 'cards_reviewed', ...extras.sort()];
	});

	function metricValue(row: LearningRecordActivityRow, key: string): number {
		if (key === 'sets') return row.sets;
		if (key === 'lessons_done') return row.lessonsDone;
		if (key === 'cards_reviewed') return row.cardsReviewed;
		return row.extra[key] ?? 0;
	}
</script>

{#if record.isOwner}
	<!-- The one thing the viewer argument exists for: the account holder is looking at the public
	     section, so it says so. Without it, the one person who needs to know their consents are off
	     is the one person shown nothing at all. -->
	<p class="owner-note">{m.record_ownerNote()}</p>
	<!-- "This is what other people see. Each block appears only while its own consent is on — Settings → Education." -->
	{#if record.grades === null && record.activity === null}
		<p class="owner-note owner-note--empty">{m.record_ownerNothingShared()}</p>
		<!-- "You are sharing nothing here, so nobody else sees this section at all." -->
	{/if}
{/if}

{#if record.withheldReason === 'minor'}
	<p class="minor-note">{m.record_minorNote()}</p>
	<!-- "This account belongs to a minor, so its learning record is never public — whatever the consents say." -->
{/if}

<section class="block">
	<h3>{m.record_gradesHeading()}</h3>
	<!-- "Results from an institution" -->
	<p class="lead">{m.record_gradesLead()}</p>
	<!-- "Marks a university's own registry reported, grouped by subject. EdMat did not award them and does not assess anybody." -->
	{#if record.grades === null}
		<p class="muted">{m.record_notShared()}</p>
		<!-- "Not shared" -->
	{:else if record.grades.length === 0}
		<p class="muted">{m.record_emptyBlock()}</p>
		<!-- "Nothing to show here yet." -->
	{:else}
		<table>
			<thead>
				<tr>
					<th scope="col">{m.record_tableBranch()}</th>
					<!-- "Subject" -->
					<th scope="col" class="num">{m.record_tableAverage()}</th>
					<!-- "Average" -->
					<th scope="col" class="num">{m.record_tableCount()}</th>
					<!-- "Results" -->
				</tr>
			</thead>
			<tbody>
				{#each record.grades as row (row.branch.slug)}
					<tr>
						<th scope="row">{row.branch.title}</th>
						<td class="num">
							{#if row.average !== null}
								{row.average}
							{:else}
								<!-- Not a missing number: this subject mixes grading scales, and there is no
								     honest way to fold an ECTS letter into the Polish 2–5 scale. -->
								<span class="muted">{m.record_noAverage()}</span>
								<!-- "Mixed scales" -->
							{/if}
						</td>
						<td class="num">{row.count}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section class="block">
	<h3>{m.record_activityHeading()}</h3>
	<!-- "Done on EdMat" -->
	<p class="lead">{m.record_activityLead()}</p>
	<!-- "What this account has done here, counted per subject. Counts only — never a single exercise, never a single card — and not a mark of any kind." -->
	{#if record.activity === null}
		<p class="muted">{m.record_notShared()}</p>
	{:else if record.activity.length === 0}
		<p class="muted">{m.record_emptyBlock()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th scope="col">{m.record_tableBranch()}</th>
					{#each metricKeys as key (key)}
						<!-- The hint is the column's `title`, not a second row of small print: it explains
						     what a number IS ("lessons they said they finished"), which matters most to the
						     reader who stops to ask about one column. -->
						<th scope="col" class="num" title={LEARNING_RECORD_METRIC_HINTS[key]?.() ?? ''}>
							{learningRecordMetricLabel(key)()}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each record.activity as row (row.branch.slug)}
					<tr>
						<th scope="row">{row.branch.title}</th>
						{#each metricKeys as key (key)}
							<td class="num">{metricValue(row, key)}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

{#if showPlacements}
	<!-- The third block (`backend/identity/record.py`). Its own section with its own lead for the
	     reason the first two have theirs: a laureate title drawn in the grades table would read as a
	     mark an institution gave, and drawn in the activity table it would read as something this
	     site measured. Neither is true — the organiser decided it and EdMat was the medium. -->
	<section class="block">
		<h3>{m.contestLabel_recordHeading()}</h3>
		<!-- "Contests" -->
		<p class="lead">{m.contestLabel_recordLead()}</p>
		<!-- "What this account was awarded in contests other people ran…" -->
		{#if record.placements === null || record.placements.length === 0}
			<p class="muted">{m.record_emptyBlock()}</p>
			<!-- "Nothing to show here yet." -->
		{:else}
			<table>
				<thead>
					<tr>
						<th scope="col">{m.contestLabel_recordTableContest()}</th>
						<!-- "Contest" -->
						<th scope="col">{m.contestLabel_recordTableResult()}</th>
						<!-- "Result" -->
						<th scope="col">{m.contestLabel_recordTablePublished()}</th>
						<!-- "Published" -->
					</tr>
				</thead>
				<tbody>
					{#each record.placements as row (row.contestId + row.resultTitle)}
						<tr>
							<th scope="row">
								<a href={resolve('/contests/[id]', { id: row.contestId })}>{row.title}</a>
							</th>
							<td>{row.resultTitle}</td>
							<td>
								{#if row.publishedAt}
									{formatDate(row.publishedAt, getLocale())}
								{:else}
									<span class="muted-inline">{m.contestLabel_recordUndated()}</span>
									<!-- "Not published yet" -->
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
{/if}

<style lang="scss">
	.block {
		margin-bottom: var(--space-4);
		// The two blocks are visually separated as hard as they are logically: a rule above each
		// heading, so no reader ever takes the second table's numbers for a continuation of the first.
		& + .block {
			border-top: 1px solid var(--border-color);
			padding-top: var(--space-3);
		}
	}
	h3 {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-base);
	}
	.lead,
	.muted {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		margin: 0 0 var(--space-2);
	}
	.owner-note,
	.minor-note {
		font-size: var(--font-size-xs);
		margin: 0 0 var(--space-3);
		padding: var(--space-2);
		border-radius: var(--radius-sm);
	}
	.owner-note {
		color: var(--text-secondary);
		background: var(--bg-surface-alt);
	}
	.owner-note--empty {
		color: var(--text-primary);
	}
	// Dimmed to `--text-secondary` rather than with opacity (frontend/CLAUDE.md: never opacity on
	// content) — "not published yet" is a fact about the row, not a disabled control.
	.muted-inline {
		color: var(--text-secondary);
	}
	.minor-note {
		color: var(--text-primary);
		background: var(--status-neutral-bg);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--font-size-sm);
	}
	th,
	td {
		text-align: left;
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--border-color);
		// A long subject name wraps rather than pushing the numbers off a phone screen.
		overflow-wrap: anywhere;
	}
	thead th {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		font-weight: 600;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	tbody th {
		font-weight: 500;
	}
</style>
