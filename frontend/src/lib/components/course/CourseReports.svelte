<script lang="ts">
	// What has been reported inside this course, for the people who run it.
	//
	// This exists because a reported comment in somebody's course could previously only be dealt with
	// by a global staff moderator — the person who runs the room, who already approves its
	// contributions and removes its participants, had no way to touch it.
	//
	// Not the platform moderation queue: that is a platform-wide surface scoped by taxonomy, and
	// putting a course owner into it would mean either showing them other people's courses or
	// teaching that queue a second scoping axis. This is the narrower, honest question — what needs
	// dealing with here.
	//
	// Loads nothing until opened. Most courses have nothing reported, and a request per course page
	// load to discover that is a request wasted.
	import { m } from '$lib/paraglide/messages.js';
	import FoldSection from '$lib/components/shared/FoldSection.svelte';
	import { getCourseReports } from '$lib/services/course';
	import { resolveReport } from '$lib/services/moderation';
	import type { CourseReportRow } from '$lib/types/course';

	let { courseId }: { courseId: string } = $props();

	let loaded = $state(false);
	let loading = $state(false);
	let rows = $state<CourseReportRow[]>([]);
	let busy = $state('');
	let error = $state('');

	async function load() {
		if (loading) return;
		loading = true;
		error = '';
		try {
			rows = await getCourseReports(courseId);
			loaded = true;
		} catch {
			error = m.course_reports_loadError();
		} finally {
			loading = false;
		}
	}

	async function decide(row: CourseReportRow, decision: 'restore' | 'remove') {
		busy = row.id;
		error = '';
		try {
			await resolveReport(row.kind, row.id, decision);
			// Dropped locally rather than refetched: the decision resolves every pending report on
			// that comment at once, so the row is genuinely gone and a second request would only
			// confirm it.
			rows = rows.filter((r) => r.id !== row.id);
		} catch {
			error = m.course_reports_actionError();
		} finally {
			busy = '';
		}
	}
</script>

<!-- This panel had its own disclosure — a button, a `▾`/`▸` and a count — written before there was
     a shared one. It is the same control, so it is now the shared one (2026-10-08): the course page
     folds everything else the same way, and two disclosures that look different on one page read as
     two different kinds of thing. The reader's choice is now remembered, which the local one never
     did. -->
<FoldSection
	key="courseReports"
	title={m.course_reports_heading()}
	count={loaded && rows.length > 0 ? rows.length : null}
	onopen={() => {
		if (!loaded) load();
	}}
>
	<div class="reports">
		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if rows.length === 0}
			<p class="muted">{m.course_reports_none()}</p>
		{:else}
			<ul class="reports__list">
				{#each rows as row (row.id)}
					<li class="report">
						<p class="report__where">
							{row.where}
							{#if row.autoHidden}
								<!-- Said first because it changes what the decision means: this is hidden from
								     everybody right now and waiting on somebody, rather than merely complained
								     about. -->
								<strong class="report__hidden">{m.course_reports_autoHidden()}</strong>
							{/if}
						</p>
						<p class="report__body">{row.body}</p>
						<p class="report__meta">
							{m.course_reports_by({ name: row.author })} ·
							{m.course_reports_count({ n: row.reportCount })}
						</p>
						{#if row.reasons.length}
							<ul class="report__reasons">
								{#each row.reasons as reason, i (i)}
									<li>{reason}</li>
								{/each}
							</ul>
						{/if}
						<div class="report__actions">
							<button
								type="button"
								class="report__keep"
								disabled={busy === row.id}
								onclick={() => decide(row, 'restore')}
							>
								{m.course_reports_keep()}
							</button>
							<button
								type="button"
								class="report__remove"
								disabled={busy === row.id}
								onclick={() => decide(row, 'remove')}
							>
								{m.course_reports_remove()}
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
		{#if error}
			<p class="error">{error}</p>
		{/if}
	</div>
</FoldSection>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	// The toggle, its count badge and the spacing above are `FoldSection`'s since 2026-10-08.
	.reports {
		display: grid;
		gap: var(--space-2);
	}

	.reports__list {
		list-style: none;
		margin: var(--space-2) 0 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.report {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
	}

	.report__where {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		margin: 0;
	}

	.report__hidden {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		margin-left: var(--space-1);
	}

	.report__body {
		margin: var(--space-1) 0;
	}

	.report__meta {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		margin: 0;
	}

	.report__reasons {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		margin: var(--space-1) 0 0 var(--space-3);
		padding: 0;
	}

	.report__actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.report__keep,
	.report__remove {
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
	}

	.report__keep {
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		color: inherit;
	}

	.report__remove {
		background: var(--status-danger);
		border: 1px solid var(--status-danger);
		color: var(--accent-contrast);
	}

	.muted {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}

	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
</style>
