<script lang="ts">
	/** Where the link in the "your account will be deleted" mail lands: `/cancel-deletion?token=…`
	 *  (`backend/accounts/erasure.py: cancel_token`). It cancels and nothing more — the person then
	 *  signs in with their password as usual, because a link in a mailbox is not a password. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { cancelErasureWithToken } from '$lib/services/account';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	let phase = $state<'working' | 'done' | 'invalid' | 'nothing' | 'guardian' | 'error'>('working');

	onMount(async () => {
		try {
			await cancelErasureWithToken(page.url.searchParams.get('token') ?? '');
			phase = 'done';
		} catch (e) {
			const reason =
				e instanceof ApiError ? (e.body as Record<string, unknown> | null)?.reason : undefined;
			phase =
				reason === 'invalid'
					? 'invalid'
					: reason === 'nothing_pending'
						? 'nothing'
						: reason === 'guardian_requested'
							? 'guardian'
							: 'error';
		}
	});
</script>

<PageHead title={m.account_cancelHeading()} description={m.account_cancelHeading()} />

<div class="page">
	<h1>{m.account_cancelHeading()}</h1>
	<!-- "Cancel the account deletion" -->
	{#if phase === 'working'}
		<p>{m.account_cancelWorking()}</p>
		<!-- "Cancelling…" -->
	{:else if phase === 'done'}
		<p class="ok" role="status">{m.account_cancelDone()}</p>
		<!-- "The deletion is cancelled and your account is active again." -->
		<a href={resolve('/login')}>{m.mail_backToLogin()}</a>
	{:else if phase === 'invalid'}
		<p class="error" role="alert">{m.account_cancelInvalid()}</p>
		<!-- "This link does not work…" -->
	{:else if phase === 'nothing'}
		<p class="error" role="alert">{m.account_cancelNothing()}</p>
		<!-- "There is no deletion waiting any more…" -->
	{:else if phase === 'guardian'}
		<p class="error" role="alert">{m.account_loginGuardian()}</p>
	{:else}
		<p class="error" role="alert">{m.common_error()}</p>
	{/if}
</div>

<style lang="scss">
	.page {
		max-width: 480px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
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
