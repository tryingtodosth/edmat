<script lang="ts">
	/**
	 * Polls panel — decisions step (MANAGEMENT-BRIEF.md §3.E)
	 * Mounted on event, course and material pages; shows open polls with vote forms,
	 * closed polls with results and decision notes, and a create form for managers.
	 */

	import { m } from '$lib/paraglide/messages.js';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import type { NodeRef } from '$lib/types/node';
	import type { Poll } from '$lib/types/poll';
	import * as pollsService from '$lib/services/polls';

	let { node }: { node: NodeRef } = $props();

	let polls = $state<Poll[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let showCreateForm = $state(false);
	let createData = $state({
		question: '',
		description: '',
		mode: 'single' as 'single' | 'multiple',
		anonymous: false,
		eligibility: 'members' as 'staff' | 'members'
	});

	const canUseDecisions = $derived(
		featureFlagsStore.isEnabled('decisions') || authStore.isModerator
	);

	$effect(() => {
		if (!canUseDecisions) return;
		loading = true;
		error = null;
		const nodeKind = node.kind as 'course' | 'event' | 'material';
		pollsService.getNodePolls(nodeKind, parseInt(node.id)).then(
			(data) => {
				polls = data;
				loading = false;
			},
			(err) => {
				error = err.message || 'Failed to load polls';
				loading = false;
			}
		);
	});

	async function handleCreatePoll() {
		if (!createData.question.trim()) return;

		try {
			const nodeKind = node.kind as 'course' | 'event' | 'material';
			const newPoll = await pollsService.createPoll(nodeKind, parseInt(node.id), createData);
			polls = [...polls, newPoll];
			showCreateForm = false;
			createData = {
				question: '',
				description: '',
				mode: 'single',
				anonymous: false,
				eligibility: 'members'
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to create poll';
			error = message;
		}
	}

	async function handleOpenPoll(pollId: number) {
		try {
			const updated = await pollsService.openPoll(pollId);
			polls = polls.map((p) => (p.id === pollId ? updated : p));
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to open poll';
			error = message;
		}
	}
</script>

{#if !canUseDecisions}
	<!-- Poll feature is disabled -->
{:else if loading}
	<div class="polls-panel polls-loading">{m.polls_loading()}</div>
{:else if error}
	<div class="polls-panel polls-error">{error}</div>
{:else if polls.length === 0 && !showCreateForm}
	{#if node.canManage}
		<div class="polls-panel polls-empty">
			<p>{m.polls_empty()}</p>
			<button onclick={() => (showCreateForm = true)}>{m.polls_create()}</button>
		</div>
	{/if}
{:else}
	<div class="polls-panel">
		{#each polls as poll (poll.id)}
			{#if poll.status === 'draft'}
				<div class="poll poll-draft">
					<div class="poll-header">
						<h3>{poll.question}</h3>
						{#if node.canManage}
							<div class="poll-actions">
								<button class="btn-small" onclick={() => handleOpenPoll(poll.id)}>
									{m.polls_open()}
								</button>
							</div>
						{/if}
					</div>
					{#if poll.description}
						<p class="poll-description">{poll.description}</p>
					{/if}
				</div>
			{:else if poll.status === 'open'}
				<div class="poll poll-open">
					<div class="poll-header">
						<h3>{poll.question}</h3>
					</div>
					{#if poll.description}
						<p class="poll-description">{poll.description}</p>
					{/if}
					{#if poll.mode === 'single'}
						<form>
							{#each poll.options as option (option.id)}
								<label>
									<input type="radio" name="option_{poll.id}" value={option.id} />
									{option.text}
								</label>
							{/each}
						</form>
					{/if}
				</div>
			{:else if poll.status === 'closed'}
				<div class="poll poll-closed">
					<div class="poll-header">
						<h3>{poll.question}</h3>
					</div>
					{#if poll.decision_note}
						<div class="poll-decision-note">
							<p>{poll.decision_note}</p>
						</div>
					{/if}
					{#if poll.options.length > 0}
						<div class="poll-results">
							{#each poll.options as option (option.id)}
								<div class="result-item">
									<span class="result-label">{option.text}</span>
									<span class="result-count">{option.count}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/each}

		{#if node.canManage && showCreateForm}
			<div class="create-form">
				<h3>{m.polls_create()}</h3>
				<input
					type="text"
					placeholder={m.polls_question()}
					bind:value={createData.question}
					class="form-input"
				/>
				<textarea
					placeholder={m.polls_description()}
					bind:value={createData.description}
					class="form-textarea"></textarea>
				<select bind:value={createData.mode} class="form-select">
					<option value="single">{m.polls_mode_single()}</option>
					<option value="multiple">{m.polls_mode_multiple()}</option>
				</select>
				<select bind:value={createData.eligibility} class="form-select">
					<option value="members">{m.polls_eligibility_members()}</option>
					<option value="staff">{m.polls_eligibility_staff()}</option>
				</select>
				<label>
					<input type="checkbox" bind:checked={createData.anonymous} />
					{m.polls_anonymous()}
				</label>
				<div class="form-actions">
					<button class="btn-primary" onclick={handleCreatePoll}>{m.polls_create()}</button>
					<button class="btn-secondary" onclick={() => (showCreateForm = false)}>
						{m.polls_cancel()}
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style lang="scss">
	.polls-panel {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;

		.poll {
			border: 1px solid var(--color-border);
			border-radius: 0.5rem;
			padding: 1rem;

			&.poll-draft {
				background: var(--color-bg-draft);
			}

			&.poll-open {
				background: var(--color-bg-open);
			}

			&.poll-closed {
				background: var(--color-bg-closed);
			}

			.poll-header {
				display: flex;
				justify-content: space-between;
				align-items: center;

				h3 {
					margin: 0;
					font-size: 1.1rem;
				}

				.poll-actions {
					display: flex;
					gap: 0.5rem;
				}
			}

			.poll-description {
				margin: 0.5rem 0 0;
				color: var(--color-text-secondary);
				font-size: 0.9rem;
			}

			.poll-results {
				margin-top: 1rem;
				display: flex;
				flex-direction: column;
				gap: 0.5rem;

				.result-item {
					display: flex;
					justify-content: space-between;
					padding: 0.5rem 0;
					border-bottom: 1px solid var(--color-border);

					.result-label {
						flex: 1;
					}

					.result-count {
						font-weight: bold;
					}
				}
			}

			.poll-decision-note {
				margin: 1rem 0;
				padding: 1rem;
				background: var(--color-bg-note);
				border-radius: 0.25rem;
				border-left: 3px solid var(--color-accent);

				p {
					margin: 0;
				}
			}
		}

		.create-form {
			border: 1px dashed var(--color-border);
			border-radius: 0.5rem;
			padding: 1.5rem;
			background: var(--color-bg-form);

			h3 {
				margin-top: 0;
			}

			.form-input,
			.form-textarea,
			.form-select {
				width: 100%;
				margin: 0.5rem 0;
				padding: 0.5rem;
				border: 1px solid var(--color-border);
				border-radius: 0.25rem;
			}

			label {
				display: flex;
				align-items: center;
				gap: 0.5rem;
				margin: 0.5rem 0;
			}

			.form-actions {
				display: flex;
				gap: 0.5rem;
				margin-top: 1rem;

				button {
					padding: 0.5rem 1rem;
					border: 1px solid var(--color-border);
					border-radius: 0.25rem;
					cursor: pointer;

					&.btn-primary {
						background: var(--color-primary);
						color: white;
						border-color: var(--color-primary);
					}

					&.btn-secondary {
						background: var(--color-bg);
						color: var(--color-text);
					}
				}
			}
		}

		&.polls-empty,
		&.polls-loading,
		&.polls-error {
			padding: 1rem;
			text-align: center;
			color: var(--color-text-secondary);
		}
	}
</style>
