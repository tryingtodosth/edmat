<script lang="ts">
	/** The account's email address: is it confirmed (and a button to send the link again), and the
	 *  one opt-in — an hourly digest of unread notifications (backend `mail/`). Standalone, like the
	 *  avatar: each control saves through its own endpoint the moment it is used. A child account
	 *  has no address and never sees this (the settings page guards it). */
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import {
		getMyMail,
		resendConfirmation,
		setNotificationDigest,
		type MyMail
	} from '$lib/services/mail';

	let mine = $state<MyMail | null>(null);
	let busy = $state(false);
	let message = $state('');
	let error = $state('');

	onMount(async () => {
		try {
			mine = await getMyMail();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	});

	async function resend() {
		busy = true;
		message = '';
		error = '';
		try {
			await resendConfirmation();
			message = m.settings_email_resent(); // "Sent. Check your inbox (and the spam folder)."
		} catch (e) {
			error =
				e instanceof ApiError && e.status === 429
					? m.settings_email_tooMany() // "Too many requests — try again in an hour."
					: e instanceof Error
						? e.message
						: String(e);
		} finally {
			busy = false;
		}
	}

	async function toggleDigest(event: Event) {
		const enabled = (event.currentTarget as HTMLInputElement).checked;
		error = '';
		try {
			mine = await setNotificationDigest(enabled);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<section class="email-settings">
	<h2>{m.settings_email_heading()}</h2>
	<!-- "Email" -->
	{#if mine}
		<p>
			<span class="address">{mine.email}</span>
			{#if mine.emailConfirmed}
				<span class="pill ok">{m.settings_email_confirmed()}</span>
				<!-- "Confirmed" -->
			{:else}
				<span class="pill warn">{m.settings_email_unconfirmed()}</span>
				<!-- "Not confirmed" -->
			{/if}
		</p>
		{#if !mine.emailConfirmed}
			<p class="hint">{m.settings_email_unconfirmedHint()}</p>
			<!-- "We sent a link when you registered. Until you open it, we send nothing else to this address." -->
			<button type="button" class="secondary" onclick={resend} disabled={busy}>
				{m.settings_email_resend()}
				<!-- "Send the link again" -->
			</button>
		{/if}
		<label class="checkbox">
			<input type="checkbox" checked={mine.notificationDigest} onchange={toggleDigest} />
			<span>{m.settings_email_digest()}</span>
			<!-- "Email me my unread notifications (at most once an hour)" -->
		</label>
		{#if mine.notificationDigest && !mine.emailConfirmed}
			<p class="hint">{m.settings_email_digestNeedsConfirm()}</p>
			<!-- "Nothing will be sent until the address is confirmed." -->
		{/if}
	{/if}
	{#if message}<p class="ok-text" role="status">{message}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.email-settings {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: flex-start;
	}
	h2 {
		font-size: var(--font-size-base);
	}
	p {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}
	.address {
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.pill.ok {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.pill.warn {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.secondary {
		@include mix.button-secondary;
	}
	.checkbox {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		font-size: var(--font-size-sm);
	}
	.ok-text {
		color: var(--status-success);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
</style>
