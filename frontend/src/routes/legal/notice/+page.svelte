<script lang="ts">
	// DSA Art. 16 notice-and-action form. Open to anyone, guest included — no account needed. A
	// plain page rather than a modal (unlike `ReportIssueModal`): this must stay reachable and
	// linkable on its own, never behind the `issues` FeatureFlag or `issueReportStore`'s own state
	// module — see backend/legal/models.py's own doc comment for why the two are kept apart.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { fileLegalNotice } from '$lib/services/legalNotices';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	let contentUrl = $state('');
	let explanation = $state('');
	let notifierName = $state('');
	let contactEmail = $state('');
	let goodFaithConfirmed = $state(false);
	let submitting = $state(false);
	let error = $state('');
	let filed = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;
		submitting = true;
		error = '';
		try {
			await fileLegalNotice({
				contentUrl: contentUrl.trim(),
				explanation: explanation.trim(),
				goodFaithConfirmed,
				notifierName: notifierName.trim(),
				contactEmail: contactEmail.trim()
			});
			filed = true;
		} catch {
			error = m.legalNotice_submitError();
		} finally {
			submitting = false;
		}
	}
</script>

<PageHead title={m.legalNotice_metaTitle()} description={m.seo_legalNotice_description()} />

<div class="page">
	<h1>{m.legalNotice_heading()}</h1>

	{#if filed}
		<p class="filed">{m.legalNotice_filedThanks()}</p>
	{:else}
		<p class="intro">{m.legalNotice_intro()}</p>

		<form class="notice-form" onsubmit={submit}>
			<label>
				<span>{m.legalNotice_fieldUrl()}</span>
				<span class="hint">{m.legalNotice_fieldUrlHint()}</span>
				<input type="url" bind:value={contentUrl} required />
			</label>

			<label>
				<span>{m.legalNotice_fieldExplanation()}</span>
				<textarea bind:value={explanation} rows="5" required></textarea>
			</label>

			<label>
				<span>{m.legalNotice_fieldName()}</span>
				<input type="text" bind:value={notifierName} maxlength="200" />
			</label>

			<label>
				<span>{m.legalNotice_fieldEmail()}</span>
				<span class="hint">{m.legalNotice_fieldEmailHint()}</span>
				<input type="email" bind:value={contactEmail} required />
			</label>

			<label class="check">
				<input type="checkbox" bind:checked={goodFaithConfirmed} required />
				<span>{m.legalNotice_goodFaithLabel()}</span>
			</label>

			{#if error}
				<p class="error" role="alert">{error}</p>
			{/if}

			<div class="actions">
				<button type="submit" class="button-primary" disabled={submitting || !goodFaithConfirmed}>
					{submitting ? m.legalNotice_sending() : m.legalNotice_submit()}
				</button>
			</div>
		</form>
	{/if}

	{#if authStore.isModerator}
		<p class="staff-link">
			<a href={resolve('/legal/queue')}>{m.legalQueue_heading()} →</a>
		</p>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4) var(--space-6);
	}
	.intro {
		color: var(--text-secondary);
		margin-bottom: var(--space-4);
	}
	.filed {
		font-size: var(--font-size-lg);
	}
	.notice-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.hint {
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
	}
	input[type='text'],
	input[type='url'],
	input[type='email'],
	textarea {
		font: inherit;
		color: var(--text-primary);
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: var(--space-1) var(--space-2);
	}
	.check {
		flex-direction: row;
		align-items: flex-start;
		gap: var(--space-2);
		input {
			margin-top: 3px;
		}
	}
	.error {
		color: var(--status-danger);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
	}
	.button-primary {
		@include mix.button-primary;
	}
	.staff-link {
		margin-top: var(--space-5);
		font-size: var(--font-size-sm);
	}
</style>
