<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { rememberReturnTo, takeReturnTo } from '$lib/utils/returnTo';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { localeStore } from '$lib/state/locale.svelte';
	import { authStore } from '$lib/state/auth.svelte';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import { messagesStore } from '$lib/state/messages.svelte';
	import ProviderButtons from '$lib/components/auth/ProviderButtons.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';

	afterNavigate((nav) => rememberReturnTo(nav.from?.url));

	let displayName = $state('');
	let email = $state('');
	// Phase 3: a real password field, unavoidable now that registering creates a real account
	// against a real backend (Phase 1's mock register never asked for one at all — there was
	// nothing for a password to protect yet).
	let password = $state('');
	let preferredLocale = $state(getLocale());
	let error = $state<'emailTaken' | 'generic' | null>(null);
	let errorMessage = $state('');
	let submitting = $state(false);

	async function handleSubmit() {
		submitting = true;
		error = null;
		const result = await authStore.register(
			displayName.trim(),
			email.trim(),
			password,
			preferredLocale
		);
		submitting = false;
		if (result.ok) {
			// Same "root layout's onMount only fires once" reasoning as login/+page.svelte's own fix
			// — a fresh account has nothing to show yet, but this keeps the bell's own state honest
			// from the very first authenticated render rather than depending on incidental timing.
			notificationStore.refresh();
			messagesStore.refresh();
			// Actually APPLY the language that was just chosen. The value was already being saved
			// server-side on `Profile.preferred_locale`, but nothing ever acted on it — not here,
			// and not on login or app boot either — so the "Preferred interface language" field
			// was, from the user's point of view, a control that did nothing whatsoever: pick
			// Polish, register, and the interface stays in English. `localeStore` is the same
			// thing `LocaleSwitcher.svelte` uses, so this is the identical code path a manual
			// switch takes, not a second mechanism.
			//
			// This used to need `reload: false` and then a full document load to apply the change,
			// because a compiled message is read at call time and would not re-run on a
			// client-side navigation. The locale is a rune now (lib/state/locale.svelte.ts), so
			// setting it re-renders the text on its own and an ordinary `goto` is enough — which
			// means a brand-new account lands on the home page without paying for a second cold
			// boot of the app it has only just loaded.
			//
			// One path rather than two: setting the locale it is already in is a no-op inside the
			// store, so there is nothing left for a branch here to decide.
			localeStore.set(preferredLocale);
			// Back to wherever "Log in" was clicked, not the home page — see lib/utils/returnTo.ts.
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- an in-app path remembered at runtime (validated same-origin in returnTo.ts), not a literal route resolve() could name
			goto(takeReturnTo(page.url));
		} else if (result.error === 'emailTaken') {
			error = 'emailTaken';
		} else {
			error = 'generic';
			errorMessage = result.error;
		}
	}
</script>

<PageHead title={m.auth_register_heading()} description={m.seo_register_description()} />

<div class="page">
	<h1>{m.auth_register_heading()}</h1>

	<form onsubmit={(e) => (e.preventDefault(), handleSubmit())}>
		<label class="field">
			<span>{m.auth_register_displayName()}</span>
			<input type="text" bind:value={displayName} required />
		</label>
		<label class="field">
			<span>{m.auth_register_email()}</span>
			<input type="email" bind:value={email} required />
		</label>
		<label class="field">
			<span>{m.auth_register_password()}</span>
			<input
				type="password"
				bind:value={password}
				required
				minlength="8"
				autocomplete="new-password"
			/>
			<span class="field-hint">{m.auth_register_passwordHint()}</span>
		</label>
		<label class="field">
			<span>{m.auth_register_locale()}</span>
			<select bind:value={preferredLocale}>
				<option value="en">EN</option>
				<option value="pl">PL</option>
			</select>
		</label>

		{#if error === 'emailTaken'}
			<p class="error">{m.auth_register_error_emailTaken()}</p>
		{:else if error === 'generic'}
			<p class="error">{m.auth_register_error_generic({ message: errorMessage })}</p>
		{/if}

		<button type="submit" class="submit" disabled={submitting}>{m.auth_register_submit()}</button>
	</form>

	<!-- Sign-in providers are equally a sign-UP path, so they belong on both pages rather than only
	     on /login. Same drafts, same modal, same honesty about what they do today. -->
	<div class="divider"><span>{m.auth_providers_divider()}</span></div>
	<ProviderButtons />

	<p class="switch">
		{m.auth_register_haveAccount()}
		<a href={resolve('/login')}>{m.auth_register_loginLink()}</a>
	</p>
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 400px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
		text-align: center;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.field-hint {
		font-size: var(--font-size-xs);
		font-weight: 400;
		color: var(--text-secondary);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 500;
	}
	input,
	select {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
	}
	.error {
		color: var(--status-danger);
		font-size: var(--font-size-sm);
	}
	.submit {
		@include mix.button-primary;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-secondary);
		font-size: var(--font-size-xs);
		&::before,
		&::after {
			content: '';
			flex: 1;
			height: 1px;
			background: var(--border-color);
		}
	}
	.switch {
		text-align: center;
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
</style>
