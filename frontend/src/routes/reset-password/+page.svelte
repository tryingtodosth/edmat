<script lang="ts">
	/** Where the reset link lands: `/reset-password?uid=…&token=…` (`backend/mail/`). A successful
	 *  reset signs the account out everywhere, so the next step is the login page. */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { confirmPasswordReset } from '$lib/services/mail';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	let password = $state('');
	let repeat = $state('');
	let submitting = $state(false);
	let done = $state(false);
	let error = $state('');
	let linkBroken = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (password !== repeat) {
			error = m.mail_reset_mismatch(); // "The two passwords differ."
			return;
		}
		submitting = true;
		try {
			await confirmPasswordReset(
				page.url.searchParams.get('uid') ?? '',
				page.url.searchParams.get('token') ?? '',
				password
			);
			done = true;
		} catch (e) {
			if (e instanceof ApiError && e.message === 'invalid_link') {
				linkBroken = true;
			} else {
				// A rejected password: Django's validators say why, in the server's language.
				error = e instanceof Error ? e.message : String(e);
			}
		} finally {
			submitting = false;
		}
	}
</script>

<PageHead title={m.mail_reset_heading()} description={m.mail_reset_heading()} />

<div class="page">
	<h1>{m.mail_reset_heading()}</h1>
	<!-- "Set a new password" -->
	{#if done}
		<p class="ok" role="status">{m.mail_reset_done()}</p>
		<!-- "Your password is changed, and every device that was signed in has been signed out." -->
		<a href={resolve('/login')}>{m.mail_backToLogin()}</a>
	{:else if linkBroken}
		<p class="error" role="alert">{m.mail_reset_invalid()}</p>
		<!-- "This link no longer works — it has been used, has expired, or the password has changed since. Ask for a new one." -->
		<a href={resolve('/forgot-password')}>{m.mail_reset_askAgain()}</a>
		<!-- "Ask for a new link" -->
	{:else}
		<form onsubmit={submit}>
			<label class="field">
				<span>{m.mail_reset_password()}</span>
				<!-- "New password" -->
				<input type="password" autocomplete="new-password" bind:value={password} required />
			</label>
			<label class="field">
				<span>{m.mail_reset_repeat()}</span>
				<!-- "The same again" -->
				<input type="password" autocomplete="new-password" bind:value={repeat} required />
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button type="submit" class="submit" disabled={submitting}>{m.mail_reset_submit()}</button>
			<!-- "Set the password" -->
		</form>
	{/if}
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
	}
	a {
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
</style>
