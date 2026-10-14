<script lang="ts">
	/** Settings → Sign-in methods (backend `sso/`): whether the account has a password, the outside
	 *  accounts linked to it, Unlink, and a Link button per enabled provider not yet linked.
	 *
	 *  Drawn only when there is something to show: an enabled provider to link, or an identity
	 *  already linked. With the `social_login` switch off the providers list is empty, so the Link
	 *  buttons go (house rule 3) — but an existing link stays listed and unlinkable, because a kill
	 *  switch must not hold somebody's own sign-in method hostage. */
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { ApiError } from '$lib/api/client';
	import { getSsoIdentities, getSsoProviders, unlinkSsoIdentity } from '$lib/services/sso';
	import type { SsoIdentities, SsoProvider, SsoIdentity } from '$lib/types/sso';
	import { formatDate } from '$lib/utils/format';
	import { ssoErrorLabel } from '$lib/utils/labels';
	import SsoButtons from '$lib/components/auth/SsoButtons.svelte';

	const PROVIDER_NAMES: Record<string, () => string> = {
		google: m.sso_provider_google, // "Google"
		apple: m.sso_provider_apple, // "Apple"
		microsoft: m.sso_provider_microsoft // "Microsoft"
	};

	let mine = $state<SsoIdentities | null>(null);
	let providers = $state<SsoProvider[]>([]);
	let busy = $state('');
	let message = $state('');
	let error = $state('');

	let linkable = $derived(
		providers.filter((p) => !mine?.identities.some((i) => i.provider === p.id))
	);
	let visible = $derived(!!mine && (providers.length > 0 || mine.identities.length > 0));

	async function load() {
		const [ids, provs] = await Promise.all([
			getSsoIdentities(),
			getSsoProviders().catch(() => [] as SsoProvider[])
		]);
		mine = ids;
		providers = provs;
	}

	onMount(() => {
		load().catch(() => {});
	});

	function name(identity: SsoIdentity): string {
		return PROVIDER_NAMES[identity.provider]?.() ?? identity.provider;
	}

	async function unlink(identity: SsoIdentity) {
		if (!confirm(m.sso_settings_unlinkConfirm({ provider: name(identity) }))) return; // "Unlink {provider}? You will no longer be able to sign in with it."
		busy = identity.id;
		message = '';
		error = '';
		try {
			await unlinkSsoIdentity(identity.id);
			await load();
			message = m.sso_settings_unlinked({ provider: name(identity) }); // "{provider} unlinked."
		} catch (e) {
			const detail =
				e instanceof ApiError && e.body && typeof e.body === 'object' && 'detail' in e.body
					? String((e.body as { detail: unknown }).detail)
					: '';
			error = ssoErrorLabel(detail);
		} finally {
			busy = '';
		}
	}
</script>

{#if visible && mine}
	<section class="sign-in-methods" data-testid="sign-in-methods">
		<h2>{m.sso_settings_heading()}</h2>
		<!-- "Sign-in methods" -->
		<p class="hint">{m.sso_settings_intro()}</p>
		<!-- "Sign in with an outside account as well as, or instead of, a password. …" -->

		<div class="row">
			<span class="what">{m.sso_settings_password()}</span>
			<!-- "Password" -->
			{#if mine.hasPassword}
				<span class="pill ok">{m.sso_settings_passwordSet()}</span>
				<!-- "Set" -->
			{:else}
				<span class="hint">
					{m.sso_settings_passwordNotSet()}
					<!-- "Not set. You can set one with a link sent to your address:" -->
					<a href={resolve('/forgot-password')}>{m.mail_forgot_link()}</a>
				</span>
			{/if}
		</div>

		{#if mine.identities.length}
			<ul class="identities">
				{#each mine.identities as identity (identity.id)}
					<li class="row" data-testid="sso-identity" data-provider={identity.provider}>
						<span class="what">{name(identity)}</span>
						<span class="email">{identity.email}</span>
						<span class="hint">
							{m.sso_settings_linkedOn({ date: formatDate(identity.linkedAt, getLocale()) })}
							<!-- "linked {date}" -->
						</span>
						<button
							type="button"
							class="secondary"
							disabled={busy === identity.id}
							onclick={() => unlink(identity)}
						>
							{m.sso_settings_unlink()}
							<!-- "Unlink" -->
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="hint">{m.sso_settings_none()}</p>
			<!-- "No outside account is linked." -->
		{/if}

		{#if linkable.length}
			<SsoButtons intent="link" next="/settings" providers={linkable} />
		{/if}

		{#if message}<p class="ok-text" role="status">{message}</p>{/if}
		{#if error}<p class="error" role="alert" data-testid="sso-unlink-error">{error}</p>{/if}
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.sign-in-methods {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h2 {
		font-size: var(--font-size-base);
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
	.identities {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}
	.what {
		font-weight: 600;
		min-width: 6rem;
	}
	.email {
		overflow-wrap: anywhere;
	}
	.pill.ok {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
	}
	.secondary {
		@include mix.button-secondary;
		margin-left: auto;
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
