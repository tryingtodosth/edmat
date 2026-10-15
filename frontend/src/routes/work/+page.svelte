<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { getWorkDashboard } from '$lib/services/work';
	import type { WorkDashboard, WorkItem } from '$lib/types/work';
	import { nodeHref } from '$lib/utils/nodeHref';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import UrgencyDot from '$lib/components/UrgencyDot.svelte';
	import { formatDateTime } from '$lib/utils/datetime';
	import { workKindLabel, workStatusLabel } from '$lib/utils/labels';

	// `NodeRef.kind` is the backend's short word (`config/nodes.py: NODE_KINDS` — 'course', 'event',
	// 'material', 'organization'), singular; every one of their frontend routes is plural. Building
	// `/{node.kind}/{node.id}` directly 404s — found by `e2e/work.mjs` actually clicking the link,
	// not by reading the code (house rule 2).
	// `utils/nodeHref.ts` (2026-10-08) — this page's own copy sent an organisation to
	// `/organizations/<id>`, which is not a route; the shared one knows the slug.

	let dashboard = $state<WorkDashboard | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Map of section keys to label functions
	const sectionLabels: Record<string, () => string> = {
		event_hosting: () => m.work_section_event_hosting(), // "Events I'm hosting"
		event_attendance: () => m.work_section_event_attendance(), // "Events I'm attending"
		course_request: () => m.work_section_course_request(), // "Courses with pending requests"
		proposal: () => m.work_section_proposal(), // "Material proposals"
		shift: () => m.work_section_shift(), // "Upcoming shifts"
		booking: () => m.work_section_booking(), // "Tutoring bookings"
		task: () => m.work_section_task(), // "Assigned tasks"
		need_application: () => m.work_section_need_application(), // "My applications"
		need_decision: () => m.work_section_need_decision(), // "Help wanted decisions"
		plan_step: () => m.work_section_plan_step(), // "Plan steps due"
		plan_suggestion: () => m.work_section_plan_suggestion(), // "Plan suggestions"
		poll: () => m.work_section_poll(), // "Open polls"
		cards_due: () => m.work_section_cards_due(), // "Flashcards due"
		// Contests (contests/, CONTESTS-BRIEF.md §3.B). Four sections because they are four
		// different things waiting on a person; the keys are `contests/work.py`'s own four kinds,
		// and the labels are step B's (`contestLabel_*`) because step A, which yields the rows,
		// does not own this page. A section with no rows is dropped by `collect()`, so none of
		// these appears for somebody who is not running or entering a contest.
		contest_registration: () => m.contestLabel_workSection_registration(), // "Contest entries to decide"
		contest_judging: () => m.contestLabel_workSection_judging(), // "Contest work to score"
		contest_complaint: () => m.contestLabel_workSection_complaint(), // "Contest complaints to answer"
		contest_stage: () => m.contestLabel_workSection_stage() // "Contest stages coming up"
	};

	// The kind's and the status's words both live in `utils/labels.ts` (`WORK_KIND_LABELS`,
	// `workStatusLabel`), beside the mirror of the backend's declared status codes. `item.status`
	// is a CODE — never print it as-is: that put `in_progress` and the English `3 due` in front of
	// Polish readers until 2026-10-14.

	onMount(async () => {
		try {
			dashboard = await getWorkDashboard();
		} catch {
			error = m.work_error_loading(); // "Error loading work dashboard"
		} finally {
			loading = false;
		}
	});

	function handleItemClick(item: WorkItem) {
		window.location.href = item.url;
	}

	function getSectionLabel(key: string): string {
		return sectionLabels[key]?.() || key;
	}

	function getKindLabel(kind: string): string {
		return workKindLabel(kind)();
	}
</script>

<PageHead title={m.work_title()} description={m.work_subtitle()} />

<div class="work-dashboard">
	<header class="work-header">
		<h1>{m.work_title()}</h1>
		<p class="subtitle">{m.work_subtitle()}</p>
	</header>

	{#if loading}
		<div class="loading">{m.work_loading()}</div>
	{:else if error}
		<div class="error">{error}</div>
	{:else if dashboard}
		{#if dashboard.sections.length === 0}
			<!-- No work items at all -->
			<div class="empty-state">
				<p>{m.work_nothing_waiting()}</p>
			</div>
		{:else}
			<!-- Sections with work items -->
			<div class="sections">
				{#each dashboard.sections as section (section.key)}
					<section class="work-section">
						<h2 class="section-title">{getSectionLabel(section.key)}</h2>

						{#if section.items.length === 0}
							<p class="empty-section">{m.work_section_empty()}</p>
						{:else}
							<ul class="items">
								<!-- Keyed by url AND title, not by url alone (2026-10-09). A work item has no id of
								     its own — the §3.F shape is eight keys and none of them is one — and
								     several rows legitimately share a url: every due step of one plan links to
								     `/plans/28`, which is `each_key_duplicate` and a page that renders nothing.
								     It was always possible and the contests preset, whose plan has eleven dated
								     steps, made it certain. A real id in the item shape is the proper fix and is
								     a change to every provider; `todo.md` carries it. -->
								{#each section.items as item (item.url + '|' + item.title)}
									<li class="work-item">
										<div class="item-card" data-urgency={item.urgency} data-kind={item.kind}>
											<button
												type="button"
												class="item-button"
												onclick={() => handleItemClick(item)}
											>
												<div class="item-header">
													<UrgencyDot urgency={item.urgency} />
													<h3 class="item-title">{item.title}</h3>
												</div>

												<div class="item-details">
													<span class="item-kind">{getKindLabel(item.kind)}</span>
													{#if item.due_at}
														<span class="item-due-date">
															{formatDateTime(item.due_at)}
														</span>
													{/if}
													{#if item.status}
														<span class="item-status" data-status={item.status}>
															{workStatusLabel(item.kind, item.status, item.count)}
														</span>
													{/if}
												</div>
											</button>
											{#if item.node}
												<!-- A sibling of the button, not nested inside it: a `<button>`'s content model
												     forbids interactive content (an `<a>` here would be invalid HTML, and
												     ambiguous for both a click and a screen reader — nested interactive
												     controls, one of `check:a11y`'s own rules). -->
												<div class="item-node">
													<!-- eslint-disable svelte/no-navigation-without-resolve -- route built from dynamic variables -->
													<a href={nodeHref(item.node)} class="node-link">
														{item.node.title}
													</a>
												</div>
											{/if}
										</div>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			</div>

			<!-- Unavailable providers notice -->
			{#if dashboard.unavailable.length > 0}
				<div class="unavailable-notice">
					<p>
						<!-- Section labels, not the raw provider keys this used to join. -->
						{m.work_unavailable_notice()}: {dashboard.unavailable.map(getSectionLabel).join(', ')}
					</p>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	// Every custom property below is one `_theme.scss` actually defines (--space-*, --radius-*,
	// --text-*, --bg-*, --status-*, --accent, --border-color, --font-size-*) — the previous pass
	// invented a `--color-*`/`--spacing-*`/`--border-radius` naming scheme that does not exist
	// anywhere in the stylesheet, so none of it rendered.

	.work-dashboard {
		padding: var(--space-4);
		max-width: 900px;
		margin: 0 auto;
	}

	.work-header {
		margin-bottom: var(--space-5);
		border-bottom: 1px solid var(--border-color);
		padding-bottom: var(--space-4);
	}

	.work-header h1 {
		font-size: var(--font-size-xl);
		margin: 0;
		font-weight: 700;
	}

	.subtitle {
		color: var(--text-secondary);
		margin: var(--space-2) 0 0 0;
	}

	.loading,
	.error {
		padding: var(--space-4);
		text-align: center;
		font-size: var(--font-size-lg);
	}

	.error {
		color: var(--status-danger);
		background: var(--status-danger-bg);
		border-radius: var(--radius-md);
	}

	.empty-state {
		text-align: center;
		padding: var(--space-6);
		color: var(--text-secondary);
		font-size: var(--font-size-lg);
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.work-section {
		@include mix.card-surface;
		padding: var(--space-4);
	}

	.section-title {
		font-size: var(--font-size-lg);
		font-weight: 600;
		margin: 0 0 var(--space-4) 0;
		padding-bottom: var(--space-3);
		border-bottom: 2px solid var(--border-color);
	}

	.empty-section {
		color: var(--text-secondary);
		font-style: italic;
		padding: var(--space-3) 0;
	}

	.items {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.work-item {
		padding: 0;
		margin: 0;
	}

	// The card is the visual unit (border, radius, background); the button inside it is
	// borderless and transparent, so it and the sibling `.item-node` link below it read as one box
	// without the button having to contain another interactive element (see the template comment).
	// The urgency dot, this 3px rule and the due-date chip are the only colour on /work: they
	// appear only when something is near (warning) or past (danger) due.
	.item-card {
		border: 1px solid var(--border-color);
		border-left: 3px solid transparent;
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		overflow: hidden; // clips the button's own radius/hover fill to the card's shape
		transition: border-color 0.2s ease;

		&[data-urgency='2'] {
			border-left-color: var(--status-warning);
		}
		&[data-urgency='3'] {
			border-left-color: var(--status-danger);
		}

		// Hover must not paint over the urgency rule on the left: three sides, and the fourth only
		// when there is no urgency to keep.
		&:has(.item-button:hover) {
			border-top-color: var(--accent);
			border-right-color: var(--accent);
			border-bottom-color: var(--accent);
		}
		&:not([data-urgency='2']):not([data-urgency='3']):has(.item-button:hover) {
			border-left-color: var(--accent);
		}
	}

	.item-button {
		@include mix.focus-ring;
		width: 100%;
		padding: var(--space-3);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		cursor: pointer;
		transition: background-color 0.2s ease;
		text-align: left;

		&:hover {
			background: var(--bg-elevated);
		}
	}

	.item-header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.item-title {
		font-size: var(--font-size-base);
		font-weight: 600;
		margin: 0;
		color: var(--text-primary);
	}

	.item-details {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin-bottom: var(--space-2);
	}

	.item-kind,
	.item-due-date,
	.item-status {
		display: inline-flex;
		align-items: center;
		font-size: var(--font-size-xs);
	}
	// The due date keeps the outlined chip; the kind is plain text (it names a KIND, not a state)
	// and the status is a neutral fact pill.
	.item-due-date {
		padding: 2px var(--space-2);
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
	}
	.item-kind {
		background: none;
		border: none;
		padding: 0;
		color: var(--text-secondary);
	}
	.item-card[data-urgency='2'] .item-due-date {
		color: var(--status-warning);
		border-color: currentColor;
	}
	.item-card[data-urgency='3'] .item-due-date {
		color: var(--status-danger);
		border-color: currentColor;
	}
	.item-status {
		@include mix.neutral-pill;
		// The card itself sits on --bg-surface-alt, so the pill needs the plain surface and an
		// edge to exist at all.
		background: var(--bg-surface);
		border: 1px solid var(--border-color);
	}

	.item-node {
		padding: var(--space-2) var(--space-3) var(--space-3);
		border-top: 1px solid var(--border-color);
	}

	.node-link {
		color: var(--accent);
		text-decoration: none;
		font-size: var(--font-size-sm);

		&:hover {
			text-decoration: underline;
		}
	}

	.unavailable-notice {
		margin-top: var(--space-5);
		padding: var(--space-4);
		background: var(--status-warning-bg);
		border-left: 4px solid var(--status-warning);
		border-radius: var(--radius-sm);
		color: var(--status-warning);
		font-size: var(--font-size-sm);
	}

	.unavailable-notice p {
		margin: 0;
	}

	@media (max-width: 640px) {
		.work-dashboard {
			padding: var(--space-3);
		}

		.work-header h1 {
			font-size: var(--font-size-lg);
		}

		.item-details {
			flex-direction: column;
			gap: var(--space-1);
		}
	}
</style>
