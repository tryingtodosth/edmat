<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { getWorkDashboard } from '$lib/services/work';
	import type { WorkDashboard, WorkItem } from '$lib/types/work';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import UrgencyDot from '$lib/components/UrgencyDot.svelte';
	import { formatDateTime } from '$lib/utils/datetime';

	let dashboard = $state<WorkDashboard | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Map of section keys to label functions
	const sectionLabels: Record<string, () => string> = {
		event_hosting: () => m.work_section_event_hosting(),
		event_attendance: () => m.work_section_event_attendance(),
		course_request: () => m.work_section_course_request(),
		proposal: () => m.work_section_proposal(),
		shift: () => m.work_section_shift(),
		booking: () => m.work_section_booking(),
		task: () => m.work_section_task(),
		need_application: () => m.work_section_need_application(),
		need_decision: () => m.work_section_need_decision(),
		plan_step: () => m.work_section_plan_step(),
		plan_suggestion: () => m.work_section_plan_suggestion(),
		poll: () => m.work_section_poll()
	};

	// Map of kind to label functions
	const kindLabels: Record<string, () => string> = {
		task: () => m.work_kind_task(),
		need_application: () => m.work_kind_needApplication(),
		need_decision: () => m.work_kind_needDecision(),
		plan_step: () => m.work_kind_planStep(),
		plan_suggestion: () => m.work_kind_planSuggestion(),
		poll: () => m.work_kind_poll(),
		event: () => m.work_kind_event(),
		course_request: () => m.work_kind_courseRequest(),
		proposal: () => m.work_kind_proposal(),
		shift: () => m.work_kind_shift(),
		booking: () => m.work_kind_booking()
	};

	onMount(async () => {
		try {
			dashboard = await getWorkDashboard();
		} catch {
			error = m.work_error_loading();
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
		return kindLabels[kind]?.() || kind;
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
								{#each section.items as item (item.url)}
									<li class="work-item">
										<button type="button" class="item-button" onclick={() => handleItemClick(item)}>
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
													<span class="item-status">{item.status}</span>
												{/if}
											</div>

											{#if item.node}
												<div class="item-node">
													<!-- eslint-disable svelte/no-navigation-without-resolve -- route built from dynamic variables -->
													<a href="/{item.node.kind}/{item.node.id}" class="node-link">
														{item.node.title}
													</a>
												</div>
											{/if}
										</button>
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
						{m.work_unavailable_notice()}: {dashboard.unavailable.join(', ')}
					</p>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.work-dashboard {
		padding: var(--spacing-lg);
		max-width: 900px;
		margin: 0 auto;
	}

	.work-header {
		margin-bottom: var(--spacing-xl);
		border-bottom: 1px solid var(--color-border);
		padding-bottom: var(--spacing-lg);
	}

	.work-header h1 {
		font-size: 2rem;
		margin: 0;
		font-weight: 700;
	}

	.subtitle {
		color: var(--color-text-secondary);
		margin: var(--spacing-sm) 0 0 0;
	}

	.loading,
	.error {
		padding: var(--spacing-lg);
		text-align: center;
		font-size: 1.125rem;
	}

	.error {
		color: var(--color-error);
		background: var(--color-error-light);
		border-radius: var(--border-radius);
	}

	.empty-state {
		text-align: center;
		padding: var(--spacing-3xl);
		color: var(--color-text-secondary);
		font-size: 1.125rem;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xl);
	}

	.work-section {
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius);
		padding: var(--spacing-lg);
		background: var(--color-surface);
	}

	.section-title {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0 0 var(--spacing-lg) 0;
		padding-bottom: var(--spacing-md);
		border-bottom: 2px solid var(--color-border-light);
	}

	.empty-section {
		color: var(--color-text-secondary);
		font-style: italic;
		padding: var(--spacing-md) 0;
	}

	.items {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}

	.work-item {
		padding: 0;
		margin: 0;
	}

	.item-button {
		width: 100%;
		padding: var(--spacing-md);
		border: 1px solid var(--color-border-light);
		border-radius: var(--border-radius-sm);
		background: var(--color-background);
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: left;

		&:hover {
			background: var(--color-hover);
			border-color: var(--color-border);
			transform: translateY(-2px);
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		}

		&:focus-visible {
			outline: 2px solid var(--color-focus);
			outline-offset: 2px;
		}
	}

	.item-header {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		margin-bottom: var(--spacing-sm);
	}

	.item-title {
		font-size: 1.125rem;
		font-weight: 600;
		margin: 0;
		color: var(--color-text-primary);
	}

	.item-details {
		display: flex;
		gap: var(--spacing-md);
		flex-wrap: wrap;
		color: var(--color-text-secondary);
		font-size: 0.9rem;
		margin-bottom: var(--spacing-sm);
	}

	.item-kind,
	.item-due-date,
	.item-status {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		background: var(--color-badge);
		border-radius: 4px;
		font-size: 0.85rem;
	}

	.item-node {
		margin-top: var(--spacing-sm);
		padding-top: var(--spacing-sm);
		border-top: 1px solid var(--color-border-light);
	}

	.node-link {
		color: var(--color-link);
		text-decoration: none;
		font-size: 0.95rem;

		&:hover {
			text-decoration: underline;
		}
	}

	.unavailable-notice {
		margin-top: var(--spacing-xl);
		padding: var(--spacing-lg);
		background: var(--color-warning-light);
		border-left: 4px solid var(--color-warning);
		border-radius: var(--border-radius-sm);
		color: var(--color-warning-text);
		font-size: 0.95rem;
	}

	.unavailable-notice p {
		margin: 0;
	}

	@media (max-width: 640px) {
		.work-dashboard {
			padding: var(--spacing-md);
		}

		.work-header h1 {
			font-size: 1.5rem;
		}

		.item-details {
			flex-direction: column;
			gap: var(--spacing-xs);
		}
	}
</style>
