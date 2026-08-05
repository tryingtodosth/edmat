<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, setLocale } from '$lib/paraglide/runtime';
	import { authStore } from '$lib/state/auth.svelte';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import { messagesStore } from '$lib/state/messages.svelte';

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
			// Polish, register, and the interface stays in English. `setLocale` is the same
			// function `LocaleSwitcher.svelte` already uses, so this is the identical code path a
			// manual switch takes, not a second mechanism.
			//
			// `reload: false` plus an explicit full-page navigation, rather than a bare
			// `setLocale(preferredLocale)`. Left to its default, `setLocale` reloads the CURRENT
			// page to apply the change — which would strand a brand-new account back on
			// `/register` instead of landing them on the home page. Disabling that and navigating
			// ourselves gets both halves right, and it is a real document load rather than
			// `goto`, so every compiled Paraglide message is re-evaluated under the new locale
			// (the messages are read at call time and would not otherwise re-run on a
			// client-side navigation).
			//
			// Only a genuinely different locale does this; picking the language the interface is
			// already in takes the ordinary client-side `goto` and skips a pointless full reload.
			if (preferredLocale !== getLocale()) {
				setLocale(preferredLocale, { reload: false });
				window.location.href = resolve('/');
			} else {
				goto(resolve('/'));
			}
		} else if (result.error === 'emailTaken') {
			error = 'emailTaken';
		} else {
			error = 'generic';
			errorMessage = result.error;
		}
	}
</script>

<svelte:head>
	<title>{m.auth_register_heading()} — {m.common_appName()}</title>
</svelte:head>

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
	.switch {
		text-align: center;
		font-size: var(--font-size-sm);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
</style>
