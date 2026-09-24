<script lang="ts">
	/**
	 * Poll detail page — /polls/[id] (MANAGEMENT-BRIEF.md §3.E)
	 * The same poll the panel shows, at full size: an open poll's vote form, or a closed poll's
	 * results and decision note. Manager actions (open/close) live on the panel, where a `NodeRef`
	 * with `canManage` is already in hand — this page only has the poll itself.
	 */

	import { page } from '$app/stores';
	import { m } from '$lib/paraglide/messages.js';
	import {
		POLL_REFUSAL_LABELS,
		POLL_STATUSES,
		pollRefusalMessage,
		pollTurnout
	} from '$lib/utils/labels';
	import { getPoll, getPollResults, vote } from '$lib/services/polls';
	import type { Poll, PollResults } from '$lib/types/poll';

	let poll = $state<Poll | null>(null);
	let results = $state<PollResults | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let selection = $state<number[]>([]);
	let voteBusy = $state(false);
	let voteError = $state<string | null>(null);

	async function load(pollId: number) {
		loading = true;
		loadError = null;
		try {
			poll = await getPoll(pollId);
			selection = [];
			if (poll.status === 'closed') {
				try {
					results = await getPollResults(pollId);
				} catch {
					// Not eligible to see results even though the poll is closed — leave them unset;
					// the template shows nothing rather than an error banner for that case.
					results = null;
				}
			} else {
				results = null;
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load poll';
		} finally {
			loading = false;
		}
	}

	let loadedForId = $state('');
	$effect(() => {
		const id = $page.params.id;
		if (!id || id === loadedForId) return;
		loadedForId = id;
		load(parseInt(id));
	});

	function toggleSingle(optionId: number) {
		selection = [optionId];
	}

	function toggleMultiple(optionId: number, checked: boolean) {
		selection = checked ? [...selection, optionId] : selection.filter((id) => id !== optionId);
	}

	async function submitVote() {
		if (!poll || selection.length === 0) {
			voteError = POLL_REFUSAL_LABELS.unknown_option();
			return;
		}
		voteBusy = true;
		voteError = null;
		try {
			await vote(poll.id, selection);
			poll = await getPoll(poll.id);
		} catch (err) {
			voteError = pollRefusalMessage(err, 'Failed to vote');
		} finally {
			voteBusy = false;
		}
	}
</script>

{#if loading}
	<div class="poll-page loading">
		<p>{m.polls_loading()}</p>
	</div>
{:else if loadError}
	<div class="poll-page error">
		<p>{loadError}</p>
	</div>
{:else if poll}
	<div class="poll-page">
		<div class="poll-container">
			<div class="poll-header">
				<h1>{poll.question}</h1>
				<span class="poll-status-badge">{POLL_STATUSES[poll.status]()}</span>
				{#if poll.description}
					<p class="poll-description">{poll.description}</p>
				{/if}
			</div>

			{#if poll.status === 'draft'}
				<div class="poll-draft-notice">
					<p>{m.polls_draft_notice()}</p>
				</div>
			{:else if poll.status === 'open'}
				{#if poll.has_voted}
					<p class="poll-note">{POLL_REFUSAL_LABELS.already_voted()}</p>
				{:else}
					<div class="poll-voting">
						<p>{m.polls_vote()}</p>
						<form onsubmit={(e) => e.preventDefault()}>
							{#each poll.options as option (option.id)}
								<label class="vote-option">
									{#if poll.mode === 'single'}
										<input
											type="radio"
											name="option_{poll.id}"
											checked={selection.includes(option.id)}
											onchange={() => toggleSingle(option.id)}
										/>
									{:else}
										<input
											type="checkbox"
											checked={selection.includes(option.id)}
											onchange={(e) => toggleMultiple(option.id, e.currentTarget.checked)}
										/>
									{/if}
									{option.text}
								</label>
							{/each}
							<button type="button" class="btn-vote" disabled={voteBusy} onclick={submitVote}>
								{m.polls_vote()}
							</button>
						</form>
						{#if voteError}
							<p class="poll-action-error">{voteError}</p>
						{/if}
					</div>
				{/if}
			{:else if poll.status === 'closed'}
				<div class="poll-closed">
					{#if poll.decision_note}
						<div class="decision-note">
							<h2>{m.polls_decision_note()}</h2>
							<p>{poll.decision_note}</p>
						</div>
					{/if}
					{#if results}
						<div class="poll-results">
							<h2>{m.polls_results()}</h2>
							<div class="results-container">
								{#each results.options as option (option.id)}
									<div class="result-bar">
										<div class="result-label">{option.text}</div>
										<div class="result-count">{option.count}</div>
									</div>
								{/each}
							</div>
							<div class="results-summary">
								<p>{pollTurnout(results.ballots.length, results.eligible_count)}</p>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style lang="scss">
	.poll-page {
		padding: 2rem;

		&.loading,
		&.error {
			text-align: center;
			color: var(--color-text-secondary);
		}

		.poll-container {
			max-width: 800px;
			margin: 0 auto;

			.poll-header {
				margin-bottom: 2rem;

				h1 {
					margin: 0 0 0.5rem;
					font-size: 2rem;
					display: inline;
				}

				.poll-status-badge {
					margin-left: 0.75rem;
					font-size: 0.85rem;
					color: var(--color-text-secondary);
					text-transform: uppercase;
					letter-spacing: 0.04em;
				}

				.poll-description {
					margin: 0.5rem 0 0;
					color: var(--color-text-secondary);
					font-size: 1.1rem;
				}
			}

			.poll-note,
			.poll-draft-notice,
			.poll-closed {
				padding: 1.5rem;
				background: var(--color-bg-secondary);
				border-radius: 0.5rem;
				margin: 1.5rem 0;
			}

			.poll-action-error {
				color: var(--color-error, #c0392b);
			}

			.poll-voting {
				padding: 1.5rem;
				border: 1px solid var(--color-border);
				border-radius: 0.5rem;

				form {
					display: flex;
					flex-direction: column;
					gap: 1rem;
					margin-top: 1rem;

					.vote-option {
						display: flex;
						align-items: center;
						gap: 0.5rem;
						padding: 0.75rem;
						cursor: pointer;

						input {
							margin: 0;
						}
					}

					.btn-vote {
						align-self: flex-start;
						padding: 0.75rem 1.5rem;
						background: var(--color-primary);
						color: white;
						border: none;
						border-radius: 0.25rem;
						cursor: pointer;
						font-size: 1rem;

						&:hover {
							background: var(--color-primary-dark);
						}

						&:disabled {
							opacity: 0.6;
							cursor: not-allowed;
						}
					}
				}
			}

			.decision-note {
				margin-bottom: 2rem;
				padding: 1.5rem;
				background: var(--color-bg-note);
				border-left: 4px solid var(--color-accent);
				border-radius: 0.25rem;

				h2 {
					margin-top: 0;
				}
			}

			.poll-results {
				h2 {
					margin-top: 0;
				}

				.results-container {
					display: flex;
					flex-direction: column;
					gap: 1.5rem;

					.result-bar {
						display: flex;
						justify-content: space-between;
						align-items: center;
						padding: 1rem;
						border: 1px solid var(--color-border);
						border-radius: 0.25rem;

						.result-label {
							flex: 1;
							font-weight: 500;
						}

						.result-count {
							font-size: 1.2rem;
							font-weight: bold;
							color: var(--color-primary);
						}
					}
				}

				.results-summary {
					margin-top: 1.5rem;
					padding-top: 1.5rem;
					border-top: 1px solid var(--color-border);
					text-align: center;
					color: var(--color-text-secondary);
				}
			}
		}
	}
</style>
