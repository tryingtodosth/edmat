<script lang="ts">
	/**
	 * Poll detail page — /polls/[id]
	 * Full-page view of a poll with results and voting interface
	 */

	import { page } from '$app/stores';
	import { getPoll, getPollResults } from '$lib/services/polls';
	import type { Poll, PollResults } from '$lib/types/poll';

	let poll = $state<Poll | null>(null);
	let results = $state<PollResults | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	$effect(() => {
		const pollId = $page.params.id;
		if (!pollId) return;
		loading = true;
		error = null;

		const pollNumId = parseInt(pollId);
		Promise.all([getPoll(pollNumId), getPollResults(pollNumId)]).then(
			([pollData, resultsData]) => {
				poll = pollData;
				results = resultsData;
				loading = false;
			},
			(err) => {
				error = err.message || 'Failed to load poll';
				loading = false;
			}
		);
	});
</script>

{#if loading}
	<div class="poll-page loading">
		<p>Loading poll…</p>
	</div>
{:else if error}
	<div class="poll-page error">
		<p>{error}</p>
	</div>
{:else if poll}
	<div class="poll-page">
		<div class="poll-container">
			<div class="poll-header">
				<h1>{poll.question}</h1>
				{#if poll.description}
					<p class="poll-description">{poll.description}</p>
				{/if}
			</div>

			{#if poll.status === 'draft'}
				<div class="poll-draft-notice">
					<p>This poll is still in draft. It has not been opened for voting yet.</p>
				</div>
			{:else if poll.status === 'open'}
				<div class="poll-voting">
					<p>Vote in this poll:</p>
					{#if poll.mode === 'single'}
						<form>
							{#each poll.options as option (option.id)}
								<label class="vote-option">
									<input type="radio" name="option_{poll.id}" value={option.id} />
									{option.text}
								</label>
							{/each}
							<button type="button" class="btn-vote">Submit Vote</button>
						</form>
					{:else}
						<form>
							{#each poll.options as option (option.id)}
								<label class="vote-option">
									<input type="checkbox" name="option_{poll.id}" value={option.id} />
									{option.text}
								</label>
							{/each}
							<button type="button" class="btn-vote">Submit Vote</button>
						</form>
					{/if}
				</div>
			{:else if poll.status === 'closed'}
				<div class="poll-closed">
					{#if poll.decision_note}
						<div class="decision-note">
							<h2>Decision</h2>
							<p>{poll.decision_note}</p>
						</div>
					{/if}
					{#if results}
						<div class="poll-results">
							<h2>Results</h2>
							<div class="results-container">
								{#each results.options as option (option.id)}
									<div class="result-bar">
										<div class="result-label">{option.text}</div>
										<div class="result-count">{option.count}</div>
									</div>
								{/each}
							</div>
							<div class="results-summary">
								<p>{results.ballots.length} of {results.eligible_count} voted</p>
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
				}

				.poll-description {
					margin: 0;
					color: var(--color-text-secondary);
					font-size: 1.1rem;
				}
			}

			.poll-draft-notice,
			.poll-closed {
				padding: 1.5rem;
				background: var(--color-bg-secondary);
				border-radius: 0.5rem;
				margin: 1.5rem 0;
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
