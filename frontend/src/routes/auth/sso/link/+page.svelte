<script lang="ts">
	/** Confirm-and-link (`backend/sso/`, LINKING-AND-ERRORS.md §2.4). The provider's address already
	 *  belongs to an EdMat account; nothing is joined until the person proves that account is theirs:
	 *  its password, or a link mailed to its confirmed address (which must be opened in THIS browser).
	 *
	 *  Two arrivals: `?ticket=…` from the backend's callback (show the proofs), and `?mail=…` from the
	 *  mailed link (redeem it). Either way success is a signed-in session handed back in a POST body. */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import { messagesStore } from '$lib/state/messages.svelte';
	import {
		confirmSsoLinkByMail,
		confirmSsoLinkByPassword,
		getSsoLinkTicket,
		requestSsoLinkMail
	} from '$lib/services/sso';
	import type { SsoLinkTicket } from '$lib/types/sso';
	import { ssoErrorLabel, ssoProviderName } from '$lib/utils/labels';
	import { takeReturnTo } from '$lib/utils/returnTo';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	let ticketValue = '';
	let info = $state<SsoLinkTicket | null>(null);
	let status = $state<'loading' | 'choose' | 'working' | 'failed'>('loading');
	let fatal = $state('');
	let password = $state('');
	let passwordError = $state('');
	let mailSent = $state(false);
	let mailError = $state('');
	let busy = $state(false);

	let providerName = $derived(info ? ssoProviderName(info.provider) : '');

	function detailOf(e: unknown): string {
		return e instanceof ApiError && e.body && typeof e.body === 'object' && 'detail' in e.body
			? String((e.body as { detail: unknown }).detail)
			: '';
	}

	function signIn(res: {
		token: string;
		rawProfile: Parameters<typeof authStore.adoptSession>[1];
		next: string;
	}) {
		authStore.adoptSession(res.token, res.rawProfile);
		notificationStore.refresh();
		messagesStore.refresh();
		// The destination the attempt carried (validated same-origin server side), read the way
		// takeReturnTo reads an explicit `?next=`; the ticket/mail query is dropped with it.
		const query = res.next ? `?next=${encodeURIComponent(res.next)}` : '';
		const target = new URL(`${page.url.pathname}${query}`, page.url.origin);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- an in-app path validated same-origin by returnTo.ts (and by the backend's safe_next), not a literal route
		goto(takeReturnTo(target), { replaceState: true });
	}

	onMount(async () => {
		const mailToken = page.url.searchParams.get('mail');
		if (mailToken) {
			status = 'working';
			try {
				signIn(await confirmSsoLinkByMail(mailToken));
			} catch (e) {
				fatal = detailOf(e) || 'link_invalid';
				status = 'failed';
			}
			return;
		}
		ticketValue = page.url.searchParams.get('ticket') ?? '';
		try {
			info = await getSsoLinkTicket(ticketValue);
			mailSent = info.mailRequested;
			status = 'choose';
		} catch (e) {
			fatal = detailOf(e) || 'ticket_invalid';
			status = 'failed';
		}
	});

	async function byPassword(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		passwordError = '';
		try {
			signIn(await confirmSsoLinkByPassword(ticketValue, password));
		} catch (e) {
			busy = false;
			const code = detailOf(e);
			if (code === 'password_wrong') {
				passwordError = ssoErrorLabel(code);
				password = '';
			} else if (e instanceof ApiError && e.status === 429) {
				passwordError = m.sso_tooMany(); // "Too many attempts — wait a while and try again."
			} else {
				fatal = code || 'ticket_invalid';
				status = 'failed';
			}
		}
	}

	async function byMail() {
		busy = true;
		mailError = '';
		try {
			await requestSsoLinkMail(ticketValue);
			mailSent = true;
		} catch (e) {
			mailError =
				e instanceof ApiError && e.status === 429
					? m.sso_tooMany() // "Too many attempts — wait a while and try again."
					: ssoErrorLabel(detailOf(e));
		} finally {
			busy = false;
		}
	}
</script>

<PageHead title={m.sso_link_heading()} description={m.sso_link_heading()} />

<div class="page">
	<h1>{m.sso_link_heading()}</h1>
	<!-- "Is this your account?" -->

	{#if status === 'loading' || status === 'working'}
		<p>{m.sso_done_working()}</p>
		<!-- "Finishing the sign-in…" -->
	{:else if status === 'failed'}
		<p class="error" role="alert" data-testid="sso-error" data-code={fatal}>
			{ssoErrorLabel(fatal)}
		</p>
		<a class="action" href={resolve('/login')}>{m.sso_done_backToLogin()}</a>
		<!-- "Back to sign-in" -->
	{:else if info}
		<p class="intro" data-testid="sso-link-intro">
			{m.sso_link_intro({ provider: providerName })}
			<!-- "This address already has an EdMat account. Prove it is yours to connect {provider} to it — nothing is connected until you do." -->
		</p>
		<p class="email">{info.email}</p>

		{#if info.methods.includes('password')}
			<form class="proof" onsubmit={byPassword} data-testid="sso-link-password">
				<h2>{m.sso_link_byPassword()}</h2>
				<!-- "With the account's password" -->
				<label class="field">
					<span>{m.sso_link_password()}</span>
					<!-- "Password" -->
					<input
						type="password"
						name="password"
						autocomplete="current-password"
						bind:value={password}
						required
					/>
				</label>
				{#if passwordError}<p class="error" role="alert">{passwordError}</p>{/if}
				<button type="submit" class="primary" disabled={busy}>{m.sso_link_passwordSubmit()}</button>
				<!-- "Connect and sign in" -->
				<a class="forgot" href={resolve('/forgot-password')}>{m.mail_forgot_link()}</a>
			</form>
		{/if}

		{#if info.methods.includes('email')}
			<section class="proof" data-testid="sso-link-email">
				<h2>{m.sso_link_byEmail()}</h2>
				<!-- "With a link sent to this address" -->
				{#if mailSent}
					<p class="ok" role="status" data-testid="sso-link-mail-sent">
						{m.sso_link_emailSent({ email: info.email })}
						<!-- "We sent a link to {email}. Open it in this browser within 30 minutes." -->
					</p>
					<button type="button" class="secondary" disabled={busy} onclick={byMail}>
						{m.sso_link_emailAgain()}
						<!-- "Send it again" -->
					</button>
				{:else}
					<button type="button" class="secondary" disabled={busy} onclick={byMail}>
						{m.sso_link_emailSubmit()}
						<!-- "Email me a link" -->
					</button>
				{/if}
				{#if mailError}<p class="error" role="alert">{mailError}</p>{/if}
			</section>
		{/if}

		<p class="hint">
			{m.sso_link_notYou()}
			<!-- "Not your account? Leave this page — nothing will be connected." -->
			<a href={resolve('/login')}>{m.sso_complete_cancel()}</a>
		</p>
	{/if}
</div>

<style lang="scss">
	@use '../../../../lib/styles/mixins' as mix;

	.page {
		max-width: 460px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	h2 {
		font-size: var(--font-size-base);
	}
	.intro {
		color: var(--text-secondary);
	}
	.email {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.proof {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		align-items: flex-start;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
		width: 100%;
	}
	input {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
	}
	.primary,
	.action {
		@include mix.button-primary;
		text-decoration: none;
		align-self: flex-start;
	}
	.secondary {
		@include mix.button-secondary;
	}
	.forgot,
	.hint a {
		color: var(--accent);
		font-size: var(--font-size-sm);
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.ok {
		color: var(--status-success);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
</style>
