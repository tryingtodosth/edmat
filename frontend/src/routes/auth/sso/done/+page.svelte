<script lang="ts">
	/** Where the backend's SSO callback sends the browser (`backend/sso/`): `?code=…` to finish a
	 *  sign-in or a link, or `?error=<word>&provider=…` to say why not — one sentence per word
	 *  (house rule 6, `SSO_ERROR_LABELS`). The code is redeemed with the browser key this tab kept
	 *  when the button was pressed; a forwarded link fails here, on purpose. */
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { authStore } from '$lib/state/auth.svelte';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import { messagesStore } from '$lib/state/messages.svelte';
	import { exchangeSsoCode, forgetSsoKey } from '$lib/services/sso';
	import { ssoErrorLabel } from '$lib/utils/labels';
	import { takeReturnTo } from '$lib/utils/returnTo';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	const PROVIDER_NAMES: Record<string, () => string> = {
		google: m.sso_provider_google, // "Google"
		apple: m.sso_provider_apple, // "Apple"
		microsoft: m.sso_provider_microsoft // "Microsoft"
	};

	let status = $state<'working' | 'linked' | 'failed'>('working');
	let errorCode = $state('');
	let providerName = $state('');

	// The code is single-use and worthless without this tab's key, but there is still no reason to
	// leave it in the address bar or the history. Not called at the top of onMount: on a cold load
	// (which this page always is — the provider sent the browser here) the router is not initialised
	// yet and SvelteKit's replaceState throws, which silently stopped the whole exchange.
	function forgetAddress() {
		try {
			replaceState(resolve('/auth/sso/done'), {});
		} catch {
			/* the router is still starting; the code is spent either way */
		}
	}

	onMount(async () => {
		const params = page.url.searchParams;
		const code = params.get('code');
		const provider = params.get('provider') ?? '';
		providerName = PROVIDER_NAMES[provider]?.() ?? '';
		if (!code) {
			errorCode = params.get('error') ?? '';
			status = 'failed';
			forgetSsoKey();
			forgetAddress();
			return;
		}
		try {
			const result = await exchangeSsoCode(code);
			forgetSsoKey();
			if (result.kind === 'login') {
				authStore.adoptSession(result.token, result.rawProfile);
				notificationStore.refresh();
				messagesStore.refresh();
				const target = new URL(page.url);
				if (result.next) target.searchParams.set('next', result.next);
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- an in-app path validated same-origin by returnTo.ts (and by the backend's safe_next), not a literal route
				goto(takeReturnTo(target), { replaceState: true });
			} else {
				providerName = PROVIDER_NAMES[result.identity.provider]?.() ?? '';
				status = 'linked';
				forgetAddress();
			}
		} catch (e) {
			forgetSsoKey();
			errorCode =
				e instanceof ApiError && e.body && typeof e.body === 'object' && 'detail' in e.body
					? String((e.body as { detail: unknown }).detail)
					: '';
			status = 'failed';
			forgetAddress();
		}
	});
</script>

<PageHead title={m.sso_done_title()} description={m.sso_done_title()} />

<div class="page">
	{#if status === 'working'}
		<h1>{m.sso_done_title()}</h1>
		<!-- "Signing in" -->
		<p>{m.sso_done_working()}</p>
		<!-- "Finishing the sign-in…" -->
	{:else if status === 'linked'}
		<h1>{m.sso_settings_heading()}</h1>
		<!-- "Sign-in methods" -->
		<p class="ok" data-testid="sso-linked">{m.sso_done_linked({ provider: providerName })}</p>
		<!-- "{provider} is now linked to your account." -->
		<a class="action" href={resolve('/settings')}>{m.sso_done_toSettings()}</a>
		<!-- "Back to Settings" -->
	{:else}
		<h1>{m.sso_done_failedHeading()}</h1>
		<!-- "Signing in did not work" -->
		<p class="error" role="alert" data-testid="sso-error" data-code={errorCode}>
			{#if providerName}<strong>{providerName}:</strong>{/if}
			{ssoErrorLabel(errorCode)}
		</p>
		<div class="actions">
			{#if authStore.isAuthenticated}
				<a class="action" href={resolve('/settings')}>{m.sso_done_toSettings()}</a>
			{:else}
				<a class="action" href={resolve('/login')}>{m.sso_done_backToLogin()}</a>
				<!-- "Back to sign-in" -->
				{#if errorCode === 'email_in_use'}
					<a href={resolve('/forgot-password')}>{m.mail_forgot_link()}</a>
					<!-- "Forgotten your password?" -->
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '../../../../lib/styles/mixins' as mix;

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
	.actions {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		flex-wrap: wrap;
	}
	.action {
		@include mix.button-primary;
		align-self: flex-start;
		text-decoration: none;
	}
</style>
