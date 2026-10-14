<script lang="ts">
	/** Where the link in the confirmation message lands (`backend/mail/`): `/confirm-email?token=…`.
	 *  Works signed in or not — the token itself says whose address it is. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { confirmEmail } from '$lib/services/mail';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	let state = $state<'working' | 'done' | 'expired' | 'invalid' | 'changed'>('working');

	onMount(async () => {
		try {
			await confirmEmail(page.url.searchParams.get('token') ?? '');
			state = 'done';
		} catch (e) {
			const detail = e instanceof Error ? e.message : '';
			state = detail === 'expired' || detail === 'changed' ? detail : 'invalid';
		}
	});
</script>

<PageHead title={m.mail_confirm_heading()} description={m.mail_confirm_heading()} />

<div class="page">
	<h1>{m.mail_confirm_heading()}</h1>
	<!-- "Confirming your email address" -->
	{#if state === 'working'}
		<p>{m.mail_confirm_working()}</p>
		<!-- "One moment…" -->
	{:else if state === 'done'}
		<p class="ok">{m.mail_confirm_done()}</p>
		<!-- "Done — your address is confirmed." -->
		<a href={resolve('/settings')}>{m.mail_confirm_toSettings()}</a>
		<!-- "Go to your settings" -->
	{:else}
		<p class="error">
			{state === 'expired'
				? m.mail_confirm_expired() // "This link has expired. Send a new one from your settings."
				: state === 'changed'
					? m.mail_confirm_changed() // "This link was for an address the account no longer uses."
					: m.mail_confirm_invalid()}
			<!-- "This link does not work. Copy the whole link from the message, or send a new one from your settings." -->
		</p>
		<a href={resolve('/settings')}>{m.mail_confirm_toSettings()}</a>
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
	}
</style>
