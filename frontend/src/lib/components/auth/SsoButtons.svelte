<script lang="ts">
	/** "Continue with Google" / "Sign in with Apple" / "Sign in with Microsoft" (backend `sso/`).
	 *
	 *  Draws a button ONLY for a provider the backend lists — configured AND the `social_login`
	 *  switch on — and nothing at all otherwise, not even a heading (house rules 3 and 10: what
	 *  cannot work is not offered). A failed providers fetch is the same as none: the password form
	 *  beside it must never be held up by this.
	 *
	 *  The buttons follow each provider's own sign-in button rules, which is why their colours are
	 *  fixed brand values rather than theme tokens: Google's white/neutral-border button with the
	 *  four-colour G (dark: #131314), Apple's black button with the white logo (dark: white), and
	 *  Microsoft's white button with the four-square logo (dark: #2F2F2F), GitHub's near-black button
	 *  with the Octocat mark, and Facebook's #1877F2 blue with the white "f". The words are each
	 *  provider's own approved phrase in each language. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { ApiError } from '$lib/api/client';
	import { getSsoProviders, startSso } from '$lib/services/sso';
	import type { SsoIntent, SsoProvider, SsoProviderId } from '$lib/types/sso';
	import { peekReturnTo } from '$lib/utils/returnTo';
	import { ssoErrorLabel } from '$lib/utils/labels';

	let {
		intent = 'login',
		next = undefined,
		providers: given = undefined
	}: {
		intent?: SsoIntent;
		/** Where to land afterwards. Defaults to the login page's own return path. */
		next?: string;
		/** Settings passes the list it already has; the auth pages let the component fetch it. */
		providers?: SsoProvider[];
	} = $props();

	let fetched = $state<SsoProvider[]>([]);
	let busy = $state<SsoProviderId | null>(null);
	let error = $state('');
	let list = $derived(given ?? fetched);

	onMount(() => {
		if (given) return;
		getSsoProviders()
			.then((p) => (fetched = p))
			.catch(() => {});
	});

	const LABELS: Record<SsoProviderId, () => string> = {
		google: m.sso_button_google, // "Continue with Google"
		apple: m.sso_button_apple, // "Sign in with Apple"
		github: m.sso_button_github, // "Sign in with GitHub"
		facebook: m.sso_button_facebook, // "Continue with Facebook"
		microsoft: m.sso_button_microsoft // "Sign in with Microsoft"
	};
	const LINK_LABELS: Record<SsoProviderId, () => string> = {
		google: m.sso_link_google, // "Link a Google account"
		apple: m.sso_link_apple, // "Link an Apple account"
		github: m.sso_link_github, // "Link a GitHub account"
		facebook: m.sso_link_facebook, // "Link a Facebook account"
		microsoft: m.sso_link_microsoft // "Link a Microsoft account"
	};

	async function go(id: SsoProviderId) {
		busy = id;
		error = '';
		try {
			const url = await startSso(id, intent, next ?? peekReturnTo(page.url));
			window.location.assign(url);
		} catch (e) {
			busy = null;
			error =
				e instanceof ApiError && e.status === 429
					? m.sso_tooMany() // "Too many attempts — wait a while and try again."
					: e instanceof ApiError && e.status === 404
						? ssoErrorLabel('not_configured')
						: ssoErrorLabel(null);
		}
	}
</script>

{#if list.length}
	<div class="sso" class:link={intent === 'link'}>
		{#each list as provider (provider.id)}
			{#if provider.id in LABELS}
				<button
					type="button"
					class="btn {provider.id}"
					disabled={busy !== null}
					aria-busy={busy === provider.id}
					onclick={() => go(provider.id)}
				>
					<span class="mark" aria-hidden="true">
						{#if provider.id === 'google'}
							<svg viewBox="0 0 48 48" width="18" height="18">
								<path
									fill="#EA4335"
									d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
								/>
								<path
									fill="#4285F4"
									d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
								/>
								<path
									fill="#FBBC05"
									d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
								/>
								<path
									fill="#34A853"
									d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
								/>
							</svg>
						{:else if provider.id === 'apple'}
							<svg viewBox="0 0 814 1000" width="16" height="18" fill="currentColor">
								<path
									d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
								/>
							</svg>
						{:else if provider.id === 'github'}
							<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
								<path
									d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
								/>
							</svg>
						{:else if provider.id === 'facebook'}
							<svg viewBox="0 0 24 24" width="18" height="18">
								<path
									fill="#ffffff"
									d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.026 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"
								/>
							</svg>
						{:else if provider.id === 'microsoft'}
							<svg viewBox="0 0 21 21" width="18" height="18">
								<rect x="1" y="1" width="9" height="9" fill="#F25022" />
								<rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
								<rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
								<rect x="11" y="11" width="9" height="9" fill="#FFB900" />
							</svg>
						{/if}
					</span>
					<span class="text">
						{intent === 'link' ? LINK_LABELS[provider.id]() : LABELS[provider.id]()}
					</span>
				</button>
			{/if}
		{/each}
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
	</div>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.sso {
		display: grid;
		gap: var(--space-2);
	}
	.sso.link {
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
	}
	.btn {
		@include mix.focus-ring;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 40px;
		padding: 0 12px;
		border-radius: 4px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		&:disabled {
			cursor: progress;
		}
	}
	.mark {
		display: inline-flex;
		flex-shrink: 0;
	}
	/* Brand colours, fixed by each provider's button guidelines — deliberately not theme tokens. */
	.google {
		background: #ffffff;
		color: #1f1f1f;
		border: 1px solid #747775;
		font-family: Roboto, Arial, sans-serif;
	}
	.apple {
		background: #000000;
		color: #ffffff;
		border: 1px solid #000000;
		font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
	}
	.github {
		background: #24292f;
		color: #ffffff;
		border: 1px solid #24292f;
	}
	.facebook {
		background: #1877f2;
		color: #ffffff;
		border: 1px solid #1877f2;
		font-family: Helvetica, Arial, sans-serif;
		font-weight: 600;
	}
	.microsoft {
		background: #ffffff;
		color: #5e5e5e;
		border: 1px solid #8c8c8c;
		font-family: 'Segoe UI', Arial, sans-serif;
		font-weight: 600;
	}
	:global([data-theme='dark']) {
		.google {
			background: #131314;
			color: #e3e3e3;
			border-color: #8e918f;
		}
		.apple {
			background: #ffffff;
			color: #000000;
			border-color: #ffffff;
		}
		.github {
			border-color: #8b949e;
		}
		.microsoft {
			background: #2f2f2f;
			color: #ffffff;
			border-color: #2f2f2f;
		}
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
</style>
