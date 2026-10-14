<script lang="ts">
	/** The last step of a first "Sign in with …" (`backend/sso/`): the provider vouched for who the
	 *  person is, and nobody here has seen that identity before. They pick a username, answer the
	 *  same age question /register asks (the rule is `accounts/minors.py`, shared by both doors), and
	 *  accept the terms — then the account exists, with no password, signed in. The ticket in the
	 *  address is worth nothing without the browser key this tab kept when the button was pressed. */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { localeStore } from '$lib/state/locale.svelte';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import { messagesStore } from '$lib/state/messages.svelte';
	import { completeSsoSignup, forgetSsoKey, getSsoTicket } from '$lib/services/sso';
	import type { SsoTicket } from '$lib/types/sso';
	import { ssoErrorLabel } from '$lib/utils/labels';
	import { takeReturnTo } from '$lib/utils/returnTo';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	const PROVIDER_NAMES: Record<string, () => string> = {
		google: m.sso_provider_google, // "Google"
		apple: m.sso_provider_apple, // "Apple"
		microsoft: m.sso_provider_microsoft // "Microsoft"
	};

	let ticketValue = '';
	let ticket = $state<SsoTicket | null>(null);
	let loadError = $state('');
	let username = $state('');
	let displayName = $state('');
	let birthYear = $state('');
	let preferredLocale = $state(getLocale());
	let acceptTerms = $state(false);
	let submitting = $state(false);
	let fieldErrors = $state<Record<string, string>>({});
	let formError = $state('');

	let providerName = $derived(ticket ? (PROVIDER_NAMES[ticket.provider]?.() ?? '') : '');
	let isRelay = $derived(
		!!ticket && ticket.email.toLowerCase().endsWith('@privaterelay.appleid.com')
	);

	onMount(async () => {
		ticketValue = page.url.searchParams.get('ticket') ?? '';
		try {
			ticket = await getSsoTicket(ticketValue);
			username = ticket.suggestedUsername;
			displayName = ticket.suggestedName;
		} catch (e) {
			loadError =
				e instanceof ApiError && e.body && typeof e.body === 'object' && 'detail' in e.body
					? String((e.body as { detail: unknown }).detail)
					: 'ticket_invalid';
		}
	});

	const USERNAME_ERRORS: Record<string, () => string> = {
		taken: m.sso_complete_usernameTaken, // "That username is taken."
		invalid: m.sso_complete_usernameInvalid, // "Letters, digits and @ . + - _ only, up to 150 characters."
		too_long: m.sso_complete_usernameInvalid,
		required: m.sso_complete_usernameRequired // "Choose a username."
	};
	const BIRTH_YEAR_ERRORS: Record<string, () => string> = {
		guardian_required: m.auth_register_guardianRequired, // "Under 16, an account is opened by a parent or guardian: ask them to sign in and add you under Settings → Children."
		required: m.sso_complete_birthYearRequired, // "Give your year of birth."
		invalid: m.sso_complete_birthYearInvalid // "That is not a year."
	};

	function first(body: Record<string, unknown>, key: string): string {
		const value = body[key];
		return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		fieldErrors = {};
		formError = '';
		const year = birthYear.trim();
		try {
			const res = await completeSsoSignup({
				ticket: ticketValue,
				username: username.trim(),
				displayName: displayName.trim(),
				birthYear: ticket?.asksAge && year ? Number.parseInt(year, 10) || -1 : undefined,
				acceptTerms,
				preferredLocale
			});
			forgetSsoKey();
			authStore.adoptSession(res.token, res.rawProfile);
			notificationStore.refresh();
			messagesStore.refresh();
			localeStore.set(preferredLocale);
			const target = new URL(page.url);
			target.searchParams.delete('ticket');
			if (res.next) target.searchParams.set('next', res.next);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- an in-app path validated same-origin by returnTo.ts (and by the backend's safe_next), not a literal route
			goto(takeReturnTo(target), { replaceState: true });
		} catch (e) {
			submitting = false;
			const body =
				e instanceof ApiError && e.body && typeof e.body === 'object'
					? (e.body as Record<string, unknown>)
					: {};
			if (typeof body.detail === 'string') {
				formError = ssoErrorLabel(body.detail);
				return;
			}
			const next: Record<string, string> = {};
			const u = first(body, 'username');
			if (u) next.username = (USERNAME_ERRORS[u] ?? m.sso_complete_usernameInvalid)();
			const b = first(body, 'birth_year');
			if (b) next.birthYear = (BIRTH_YEAR_ERRORS[b] ?? m.sso_complete_birthYearInvalid)();
			if (first(body, 'accept_terms')) next.acceptTerms = m.sso_complete_termsRequired(); // "Accept the terms of use to create an account."
			fieldErrors = next;
			if (!Object.keys(next).length) {
				formError =
					e instanceof ApiError && e.status === 429
						? m.sso_tooMany() // "Too many attempts — wait a while and try again."
						: ssoErrorLabel(null);
			}
		}
	}
</script>

<PageHead title={m.sso_complete_title()} description={m.sso_complete_title()} />

<div class="page">
	<h1>{m.sso_complete_title()}</h1>
	<!-- "Finish creating your account" -->

	{#if loadError}
		<p class="error" role="alert" data-testid="sso-error" data-code={loadError}>
			{ssoErrorLabel(loadError)}
		</p>
		<a href={resolve('/login')}>{m.sso_done_backToLogin()}</a>
		<!-- "Back to sign-in" -->
	{:else if !ticket}
		<p>{m.sso_complete_loading()}</p>
		<!-- "Loading…" -->
	{:else}
		<p class="intro">{m.sso_complete_intro({ provider: providerName })}</p>
		<!-- "You signed in with {provider}. One more step: choose how you appear here." -->

		<form onsubmit={submit} novalidate>
			<div class="field">
				<span>{m.sso_complete_email()}</span>
				<!-- "Email" -->
				<span class="email" data-testid="sso-email">{ticket.email}</span>
				<span class="field-hint">
					{ticket.emailVerified
						? m.sso_complete_emailVerified({ provider: providerName }) // "Confirmed by {provider}."
						: m.sso_complete_emailUnverified({ provider: providerName })}
					<!-- "{provider} did not confirm this address, so we will send you a link to confirm it." -->
					{#if isRelay}{m.sso_complete_relayNote()}{/if}
					<!-- "This is Apple's private relay address. Messages from us reach you through Apple." -->
				</span>
			</div>

			<label class="field">
				<span>{m.sso_complete_username()}</span>
				<!-- "Username" -->
				<input
					type="text"
					name="username"
					autocomplete="username"
					bind:value={username}
					required
					maxlength="150"
					aria-invalid={!!fieldErrors.username}
				/>
				<span class="field-hint">{m.sso_complete_usernameHint()}</span>
				<!-- "Letters, digits and @ . + - _ only." -->
				{#if fieldErrors.username}<span class="error">{fieldErrors.username}</span>{/if}
			</label>

			<label class="field">
				<span>{m.sso_complete_displayName()}</span>
				<!-- "Display name" -->
				<input
					type="text"
					name="display_name"
					autocomplete="name"
					bind:value={displayName}
					maxlength="100"
				/>
				<span class="field-hint">{m.sso_complete_displayNameHint()}</span>
				<!-- "Shown next to what you write. You can change it later." -->
			</label>

			{#if ticket.asksAge}
				<label class="field">
					<span>{m.auth_register_birthYear()}</span>
					<!-- "Year of birth" -->
					<!-- type="text" + inputmode, never type="number" (frontend/CLAUDE.md, Svelte trap 1). -->
					<input
						type="text"
						name="birth_year"
						inputmode="numeric"
						autocomplete="bday-year"
						maxlength="4"
						bind:value={birthYear}
						aria-invalid={!!fieldErrors.birthYear}
					/>
					<span class="field-hint">{m.auth_register_birthYearHint()}</span>
					<!-- "Only used to check you are old enough to open an account yourself. It is not stored." -->
					{#if fieldErrors.birthYear}
						<span class="error guardian" role="alert">{fieldErrors.birthYear}</span>
					{/if}
				</label>
			{/if}

			<label class="field">
				<span>{m.sso_complete_language()}</span>
				<!-- "Interface language" -->
				<select bind:value={preferredLocale}>
					<option value="pl">PL</option>
					<option value="en">EN</option>
				</select>
			</label>

			<div class="terms">
				<label class="check">
					<input type="checkbox" name="accept_terms" bind:checked={acceptTerms} />
					<span>{m.sso_complete_acceptTerms()}</span>
					<!-- "I accept the terms of use and have read the privacy policy." -->
				</label>
				<p class="read">
					<a href={resolve('/terms')} target="_blank" rel="noopener">{m.sso_complete_readTerms()}</a
					>
					<!-- "Terms of use" -->
					·
					<a href={resolve('/privacy')} target="_blank" rel="noopener"
						>{m.sso_complete_readPrivacy()}</a
					>
					<!-- "Privacy policy" -->
				</p>
				{#if fieldErrors.acceptTerms}<span class="error">{fieldErrors.acceptTerms}</span>{/if}
			</div>

			{#if formError}<p class="error" role="alert">{formError}</p>{/if}

			<div class="buttons">
				<button type="submit" class="submit" disabled={submitting}>{m.sso_complete_submit()}</button
				>
				<!-- "Create account" -->
				<a href={resolve('/login')}>{m.sso_complete_cancel()}</a>
				<!-- "Cancel" -->
			</div>
		</form>
	{/if}
</div>

<style lang="scss">
	@use '../../../../lib/styles/mixins' as mix;

	.page {
		max-width: 440px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.intro {
		color: var(--text-secondary);
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
	.email {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.field-hint {
		font-weight: 400;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	input[type='text'],
	select {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		color: var(--text-primary);
	}
	.terms {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	.check {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
	}
	.read {
		margin-left: calc(var(--space-2) + 1rem);
		font-size: var(--font-size-xs);
		a {
			color: var(--accent);
		}
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
		font-weight: 400;
	}
	.buttons {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		a {
			color: var(--accent);
			font-size: var(--font-size-sm);
		}
	}
	.submit {
		@include mix.button-primary;
	}
</style>
