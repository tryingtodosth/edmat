<script lang="ts">
	// One person's history as they choose to describe it, read-only.
	//
	// Split out of the old ProfileExtras section so the same rendering serves both surfaces: the modal
	// a visitor opens off the summary row, and the editor's own preview. A second copy would be a
	// second place for "null end date means present" to be got wrong.
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/utils/format';
	import type { ExperienceEntry } from '$lib/types/profileExtras';

	let { entries }: { entries: ExperienceEntry[] } = $props();

	const KIND_LABEL: Record<string, () => string> = {
		study: () => m.profile_kind_study(), // "Study"
		work: () => m.profile_kind_work(), // "Work"
		teaching: () => m.profile_kind_teaching(), // "Teaching"
		project: () => m.profile_kind_project(), // "Project"
		other: () => m.profile_kind_other() // "Other"
	};

	/** A year is what somebody reads off a CV; the day an enrolment started is noise. Falls back to the
	 * full date only if the string is not the `YYYY-MM-DD` the API sends. */
	function year(value: string | null): string {
		if (!value) return '';
		const match = /^(\d{4})-/.exec(value);
		return match ? match[1] : formatDate(value, getLocale());
	}

	function span(entry: ExperienceEntry): string {
		const from = year(entry.startedOn);
		// Null end date means ongoing, which is genuinely different from unknown — so it reads
		// "2024 – present" rather than leaving a dash somebody has to interpret.
		const to = entry.endedOn ? year(entry.endedOn) : m.profile_experiencePresent(); // "present"
		if (!from) return entry.endedOn ? to : '';
		return `${from} – ${to}`;
	}
</script>

{#if entries.length === 0}
	<p class="empty">{m.profile_experienceEmpty()}</p>
	<!-- "Nothing added yet." -->
{:else}
	<ul class="experience">
		{#each entries as entry (entry.id)}
			<li class="entry">
				<div class="entry__top">
					<h3>{entry.title}</h3>
					<span class="entry__kind">{KIND_LABEL[entry.kind]?.() ?? entry.kind}</span>
				</div>
				{#if entry.organisation || span(entry)}
					<p class="entry__meta">
						{[entry.organisation, span(entry)].filter(Boolean).join(' · ')}
					</p>
				{/if}
				{#if entry.description}
					<p class="entry__body">{entry.description}</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
<p class="note">{m.profile_experienceNote()}</p>

<!-- "Self-declared — nothing here is verified." -->

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.experience {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.entry {
		border-bottom: 1px solid var(--border-color);
		padding-bottom: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: 2px;
		&:last-child {
			border-bottom: none;
			padding-bottom: 0;
		}
	}
	.entry__top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
		h3 {
			font-size: var(--font-size-base);
		}
	}
	.entry__kind {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
		flex-shrink: 0;
	}
	.entry__meta {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.entry__body {
		font-size: var(--font-size-sm);
		white-space: pre-wrap;
	}
	.empty,
	.note {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.note {
		font-size: var(--font-size-xs);
		font-style: italic;
	}
</style>
