<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/utils/format';
	import { authStore } from '$lib/state/auth.svelte';
</script>

<svelte:head>
	<title>{m.settings_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.settings_heading()}</h1>

	{#if !authStore.isAuthenticated || !authStore.user}
		<p class="login-prompt"><a href={resolve('/login')}>{m.settings_loginRequired()}</a></p>
	{:else}
		{@const user = authStore.user}
		<section class="profile">
			<h2>{m.settings_profile_heading()}</h2>
			<dl>
				<dt>{m.settings_displayName()}</dt>
				<dd>{user.displayName}</dd>
				<dt>{m.settings_email()}</dt>
				<dd>{user.email}</dd>
				<dt>{m.settings_preferredLocale()}</dt>
				<dd>{user.preferredLocale.toUpperCase()}</dd>
			</dl>
			<p class="joined">{m.settings_joined({ date: formatDate(user.joinedAt, getLocale()) })}</p>
			<div class="roles">
				{#if user.isModerator}
					<span class="badge">{m.settings_role_moderator()}</span>
				{/if}
				{#if user.isVerifiedContributor}
					<span class="badge">{m.settings_role_verifiedContributor()}</span>
				{/if}
				{#if !user.isModerator && !user.isVerifiedContributor}
					<span class="badge badge--neutral">{m.settings_role_member()}</span>
				{/if}
			</div>
		</section>
	{/if}
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 480px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	.login-prompt a {
		color: var(--accent);
		font-weight: 600;
	}
	.profile {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.profile h2 {
		font-size: var(--font-size-base);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--space-1) var(--space-3);
		font-size: var(--font-size-sm);
	}
	dt {
		color: var(--text-secondary);
	}
	dd {
		margin: 0;
	}
	.joined {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.roles {
		display: flex;
		gap: var(--space-1);
	}
	.badge {
		@include mix.status-pill(var(--accent), var(--accent-soft));
	}
	.badge--neutral {
		@include mix.status-pill(var(--status-neutral), var(--status-neutral-bg));
	}
</style>
