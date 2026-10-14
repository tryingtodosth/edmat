<script lang="ts">
	/** Ask for a reset link (`backend/mail/`). The answer is the same whether or not the address has
	 *  an account — on purpose, so this page cannot be used to find out who is registered. */
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { requestPasswordReset } from '$lib/services/mail';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	let email = $state('');
	let submitting = $state(false);
	let done = $state(false);
	let error = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		error = '';
		try {
			await requestPasswordReset(email.trim());
			done = true;
		} catch (e) {
			error =
				e instanceof ApiError && e.status === 429
					? m.settings_email_tooMany() // "Too many requests — try again in an hour."
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			submitting = false;
		}
	}
</script>

<PageHead title={m.mail_forgot_heading()} description={m.mail_forgot_intro()} />

<div class="page">
	<h1>{m.mail_forgot_heading()}</h1>
	<!-- "Forgotten password" -->
	{#if done}
		<p class="ok" role="status">{m.mail_forgot_done({ email: email.trim() })}</p>
		<!-- "If {email} belongs to an account, a link to set a new password is on its way. It works for 3 days." -->
	{:else}
		<p>{m.mail_forgot_intro()}</p>
		<!-- "Give the email address you registered with and we will send a link to set a new password." -->
		<form onsubmit={submit}>
			<label class="field">
				<span>{m.mail_forgot_email()}</span>
				<!-- "Email address" -->
				<input type="email" autocomplete="email" bind:value={email} required />
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button type="submit" class="submit" disabled={submitting}>{m.mail_forgot_submit()}</button>
			<!-- "Send the link" -->
		</form>
		<p class="hint">{m.mail_forgot_childHint()}</p>
		<!-- "A child's account has no email address: the guardian who made it can set a new password." -->
	{/if}
	<a href={resolve('/login')}>{m.mail_backToLogin()}</a>
	<!-- "Back to log in" -->
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 420px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	input {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: inherit;
	}
	.submit {
		@include mix.button-primary;
	}
	.ok {
		color: var(--status-success);
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	a {
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
</style>
