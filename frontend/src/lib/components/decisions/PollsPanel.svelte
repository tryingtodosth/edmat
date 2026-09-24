<script lang="ts">
	/**
	 * Polls panel — decisions step (MANAGEMENT-BRIEF.md §3.E)
	 * Mounted on event, course and material pages; shows open polls with vote forms,
	 * closed polls with results and decision notes, and a create form for managers.
	 */

	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { featureFlagsStore } from '$lib/state/featureFlags.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import {
		POLL_REFUSAL_LABELS,
		POLL_STATUSES,
		pollRefusalMessage,
		pollTurnout
	} from '$lib/utils/labels';
	import type { NodeRef } from '$lib/types/node';
	import type { Poll, PollResults } from '$lib/types/poll';
	import * as pollsService from '$lib/services/polls';

	let { node }: { node: NodeRef } = $props();

	let polls = $state<Poll[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let closedResults = $state<Record<number, PollResults>>({});

	let showCreateForm = $state(false);
	let creating = $state(false);
	let createError = $state<string | null>(null);
	let createData = $state({
		question: '',
		description: '',
		mode: 'single' as 'single' | 'multiple',
		anonymous: false,
		eligibility: 'members' as 'staff' | 'members'
	});
	let optionTexts = $state<string[]>(['', '']);

	// Per-poll interaction state, keyed by poll id.
	let voteSelections = $state<Record<number, number[]>>({});
	let actionError = $state<Record<number, string>>({});
	let actionBusy = $state<Record<number, boolean>>({});
	let closeNotes = $state<Record<number, string>>({});

	const canUseDecisions = $derived(
		featureFlagsStore.isEnabled('decisions') || authStore.isModerator
	);

	async function loadClosedResults(pollList: Poll[]) {
		const closed = pollList.filter((p) => p.status === 'closed');
		await Promise.all(
			closed.map(async (p) => {
				try {
					closedResults[p.id] = await pollsService.getPollResults(p.id);
				} catch {
					// A closed poll whose results this reader cannot see (not eligible, e.g.) — the
					// panel simply shows no bars for it rather than an error banner.
				}
			})
		);
	}

	let loadedFor = $state('');
	$effect(() => {
		const key = `${node.kind}:${node.id}`;
		if (!canUseDecisions || key === loadedFor) return;
		loadedFor = key;
		loading = true;
		loadError = null;
		pollsService.getNodePolls(node.kind, parseInt(node.id)).then(
			async (data) => {
				polls = data;
				loading = false;
				await loadClosedResults(data);
			},
			(err) => {
				loadError = err instanceof Error ? err.message : 'Failed to load polls';
				loading = false;
			}
		);
	});

	function addOptionField() {
		optionTexts = [...optionTexts, ''];
	}

	function removeOptionField(index: number) {
		optionTexts = optionTexts.filter((_, i) => i !== index);
	}

	function resetCreateForm() {
		showCreateForm = false;
		createError = null;
		createData = {
			question: '',
			description: '',
			mode: 'single',
			anonymous: false,
			eligibility: 'members'
		};
		optionTexts = ['', ''];
	}

	async function handleCreatePoll() {
		const question = createData.question.trim();
		const texts = optionTexts.map((t) => t.trim()).filter(Boolean);
		if (!question) return;
		creating = true;
		createError = null;
		try {
			const newPoll = await pollsService.createPoll(node.kind, parseInt(node.id), {
				...createData,
				question
			});
			for (const [index, text] of texts.entries()) {
				await pollsService.addPollOption(newPoll.id, { text, order: index });
			}
			const full = texts.length ? await pollsService.getPoll(newPoll.id) : newPoll;
			polls = [full, ...polls];
			resetCreateForm();
		} catch (err) {
			createError = pollRefusalMessage(err, 'Failed to create poll');
		} finally {
			creating = false;
		}
	}

	async function handleOpenPoll(pollId: number) {
		actionBusy = { ...actionBusy, [pollId]: true };
		try {
			const updated = await pollsService.openPoll(pollId);
			polls = polls.map((p) => (p.id === pollId ? updated : p));
			const { [pollId]: _removed, ...rest } = actionError;
			actionError = rest;
		} catch (err) {
			actionError = { ...actionError, [pollId]: pollRefusalMessage(err, 'Failed to open poll') };
		} finally {
			actionBusy = { ...actionBusy, [pollId]: false };
		}
	}

	function toggleSingleChoice(pollId: number, optionId: number) {
		voteSelections = { ...voteSelections, [pollId]: [optionId] };
	}

	function toggleMultipleChoice(pollId: number, optionId: number, checked: boolean) {
		const current = voteSelections[pollId] ?? [];
		const next = checked ? [...current, optionId] : current.filter((id) => id !== optionId);
		voteSelections = { ...voteSelections, [pollId]: next };
	}

	async function handleVote(poll: Poll) {
		const selection = voteSelections[poll.id] ?? [];
		if (selection.length === 0) {
			actionError = { ...actionError, [poll.id]: POLL_REFUSAL_LABELS.unknown_option() };
			return;
		}
		actionBusy = { ...actionBusy, [poll.id]: true };
		try {
			await pollsService.vote(poll.id, selection);
			const updated = await pollsService.getPoll(poll.id);
			polls = polls.map((p) => (p.id === poll.id ? updated : p));
			const { [poll.id]: _removed, ...rest } = actionError;
			actionError = rest;
		} catch (err) {
			actionError = { ...actionError, [poll.id]: pollRefusalMessage(err, 'Failed to vote') };
		} finally {
			actionBusy = { ...actionBusy, [poll.id]: false };
		}
	}

	async function handleClose(poll: Poll) {
		actionBusy = { ...actionBusy, [poll.id]: true };
		try {
			const updated = await pollsService.closePoll(poll.id, closeNotes[poll.id] ?? '');
			polls = polls.map((p) => (p.id === poll.id ? updated : p));
			const { [poll.id]: _removed, ...rest } = actionError;
			actionError = rest;
			await loadClosedResults([updated]);
		} catch (err) {
			actionError = { ...actionError, [poll.id]: pollRefusalMessage(err, 'Failed to close poll') };
		} finally {
			actionBusy = { ...actionBusy, [poll.id]: false };
		}
	}
</script>

{#if !canUseDecisions}
	<!-- Poll feature is disabled -->
{:else if loading}
	<div class="polls-panel polls-loading" data-polls-panel>{m.polls_loading()}</div>
{:else if loadError}
	<div class="polls-panel polls-error" data-polls-panel>{loadError}</div>
{:else if polls.length === 0 && !showCreateForm}
	{#if node.canManage}
		<div class="polls-panel polls-empty" data-polls-panel>
			<p>{m.polls_empty()}</p>
			<button class="create-toggle" onclick={() => (showCreateForm = true)}>
				{m.polls_create()}
			</button>
		</div>
	{/if}
{:else}
	<div class="polls-panel" data-polls-panel>
		{#each polls as poll (poll.id)}
			<div class="poll poll-{poll.status}" data-poll-id={poll.id} data-poll-status={poll.status}>
				<div class="poll-header">
					<h3>
						<a href={resolve('/polls/[id]', { id: String(poll.id) })}>{poll.question}</a>
					</h3>
					<span class="poll-status-badge">{POLL_STATUSES[poll.status]()}</span>
				</div>
				{#if poll.description}
					<p class="poll-description">{poll.description}</p>
				{/if}

				{#if poll.status === 'draft'}
					{#if node.canManage}
						<div class="poll-actions">
							<button
								class="btn-small"
								disabled={actionBusy[poll.id]}
								onclick={() => handleOpenPoll(poll.id)}
							>
								{m.polls_open()}
							</button>
						</div>
					{/if}
				{:else if poll.status === 'open'}
					{#if poll.has_voted}
						<p class="poll-note">{POLL_REFUSAL_LABELS.already_voted()}</p>
					{:else}
						<form onsubmit={(e) => e.preventDefault()}>
							{#each poll.options as option (option.id)}
								<label>
									{#if poll.mode === 'single'}
										<input
											type="radio"
											name="option_{poll.id}"
											checked={(voteSelections[poll.id] ?? []).includes(option.id)}
											onchange={() => toggleSingleChoice(poll.id, option.id)}
										/>
									{:else}
										<input
											type="checkbox"
											checked={(voteSelections[poll.id] ?? []).includes(option.id)}
											onchange={(e) =>
												toggleMultipleChoice(poll.id, option.id, e.currentTarget.checked)}
										/>
									{/if}
									{option.text}
								</label>
							{/each}
							<button
								class="btn-small btn-primary"
								disabled={actionBusy[poll.id]}
								onclick={() => handleVote(poll)}
							>
								{m.polls_vote()}
							</button>
						</form>
					{/if}

					{#if node.canManage}
						<div class="poll-close-form">
							<textarea
								name="decision_note"
								placeholder={m.polls_decision_note_placeholder()}
								bind:value={closeNotes[poll.id]}
								class="form-textarea"></textarea>
							<button
								class="btn-small"
								disabled={actionBusy[poll.id]}
								onclick={() => handleClose(poll)}
							>
								{m.polls_close()}
							</button>
						</div>
					{/if}
				{:else if poll.status === 'closed'}
					{#if poll.decision_note}
						<div class="poll-decision-note">
							<p>{poll.decision_note}</p>
						</div>
					{/if}
					{#if closedResults[poll.id]}
						{@const results = closedResults[poll.id]}
						<div class="poll-results">
							{#each results.options as option (option.id)}
								<div class="result-item">
									<span class="result-label">{option.text}</span>
									<span class="result-count">{option.count}</span>
								</div>
							{/each}
						</div>
						<p class="poll-turnout">
							{pollTurnout(results.ballots.length, results.eligible_count)}
						</p>
					{:else}
						<p class="poll-note">{m.polls_loadingResults()}</p>
					{/if}
				{/if}

				{#if actionError[poll.id]}
					<p class="poll-action-error">{actionError[poll.id]}</p>
				{/if}
			</div>
		{/each}

		{#if node.canManage && !showCreateForm}
			<button class="btn-small create-toggle" onclick={() => (showCreateForm = true)}>
				{m.polls_create()}
			</button>
		{/if}

		{#if node.canManage && showCreateForm}
			<div class="create-form">
				<h3>{m.polls_create()}</h3>
				<input
					type="text"
					name="question"
					placeholder={m.polls_question()}
					bind:value={createData.question}
					class="form-input"
				/>
				<textarea
					name="description"
					placeholder={m.polls_description()}
					bind:value={createData.description}
					class="form-textarea"></textarea>
				<select name="mode" bind:value={createData.mode} class="form-select">
					<option value="single">{m.polls_mode_single()}</option>
					<option value="multiple">{m.polls_mode_multiple()}</option>
				</select>
				<select name="eligibility" bind:value={createData.eligibility} class="form-select">
					<option value="members">{m.polls_eligibility_members()}</option>
					<option value="staff">{m.polls_eligibility_staff()}</option>
				</select>
				<label>
					<input type="checkbox" name="anonymous" bind:checked={createData.anonymous} />
					{m.polls_anonymous()}
				</label>

				<div class="create-options">
					{#each optionTexts as _text, index (index)}
						<div class="create-option-row">
							<input
								type="text"
								name="option-{index}"
								placeholder={m.polls_option_number({ number: index + 1 })}
								bind:value={optionTexts[index]}
								class="form-input"
							/>
							{#if optionTexts.length > 2}
								<button type="button" class="btn-tiny" onclick={() => removeOptionField(index)}>
									{m.polls_remove_option()}
								</button>
							{/if}
						</div>
					{/each}
					<button type="button" class="btn-tiny add-option" onclick={addOptionField}>
						{m.polls_add_option()}
					</button>
				</div>

				{#if createError}
					<p class="poll-action-error">{createError}</p>
				{/if}

				<div class="form-actions">
					<button class="btn-primary" disabled={creating} onclick={handleCreatePoll}>
						{m.polls_create()}
					</button>
					<button class="btn-secondary" onclick={resetCreateForm}>
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
				gap: 0.5rem;

				h3 {
					margin: 0;
					font-size: 1.1rem;

					a {
						color: inherit;
					}
				}

				.poll-status-badge {
					font-size: 0.8rem;
					color: var(--color-text-secondary);
					text-transform: uppercase;
					letter-spacing: 0.04em;
				}
			}

			.poll-description {
				margin: 0.5rem 0 0;
				color: var(--color-text-secondary);
				font-size: 0.9rem;
			}

			form {
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
				margin-top: 0.75rem;

				label {
					display: flex;
					align-items: center;
					gap: 0.5rem;
				}
			}

			.poll-close-form {
				margin-top: 1rem;
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
				border-top: 1px dashed var(--color-border);
				padding-top: 0.75rem;
			}

			.poll-note {
				margin: 0.75rem 0 0;
				color: var(--color-text-secondary);
			}

			.poll-action-error {
				margin: 0.5rem 0 0;
				color: var(--color-error, #c0392b);
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

			.poll-turnout {
				margin: 0.75rem 0 0;
				color: var(--color-text-secondary);
				font-size: 0.9rem;
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

			.create-options {
				display: flex;
				flex-direction: column;
				gap: 0.25rem;
				margin: 0.75rem 0;

				.create-option-row {
					display: flex;
					align-items: center;
					gap: 0.5rem;

					.form-input {
						margin: 0;
					}
				}
			}

			.form-actions {
				display: flex;
				gap: 0.5rem;
				margin-top: 1rem;
			}
		}

		button {
			padding: 0.5rem 1rem;
			border: 1px solid var(--color-border);
			border-radius: 0.25rem;
			cursor: pointer;
			background: var(--color-bg);
			color: var(--color-text);

			&.btn-primary {
				background: var(--color-primary);
				color: white;
				border-color: var(--color-primary);
			}

			&.btn-secondary {
				background: var(--color-bg);
				color: var(--color-text);
			}

			&.btn-tiny {
				padding: 0.25rem 0.5rem;
				font-size: 0.85rem;
			}

			&:disabled {
				opacity: 0.6;
				cursor: not-allowed;
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
