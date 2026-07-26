<script lang="ts">
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/state/auth.svelte';
	import { guestSetStore } from '$lib/state/guestSet.svelte';
	import { notificationStore } from '$lib/state/notifications.svelte';
	import { m } from '$lib/paraglide/messages.js';
	import ThemeToggle from './ThemeToggle.svelte';
	import LocaleSwitcher from './LocaleSwitcher.svelte';
	import RandomExerciseButton from './RandomExerciseButton.svelte';
	import NotificationBell from './NotificationBell.svelte';

	let menuOpen = $state(false);
</script>

<header class="site-header">
	<div class="site-header__row">
		<a class="brand" href={resolve('/')}>
			<span class="brand__mark" aria-hidden="true">∫</span>
			<span class="brand__name">{m.common_appName()}</span>
		</a>

		<button
			class="nav-toggle no-print"
			type="button"
			aria-expanded={menuOpen}
			aria-label={m.nav_browse()}
			onclick={() => (menuOpen = !menuOpen)}
		>
			☰
		</button>

		<!-- "Main navigation" -->
		<nav
			class="site-nav no-print"
			class:site-nav--open={menuOpen}
			aria-label={m.nav_mainNavigation()}
		>
			<a href={resolve('/fields')}>{m.nav_browse()}</a>
			<a href={resolve('/my-set')}>
				{m.nav_mySet()}
				{#if guestSetStore.count > 0 && !authStore.isAuthenticated}
					<span class="badge">{guestSetStore.count}</span>
				{/if}
			</a>
			<a href={resolve('/submit')}>{m.nav_submit()}</a>
			{#if authStore.isModerator}
				<a href={resolve('/moderation')}>{m.nav_moderation()}</a>
			{/if}
		</nav>

		<div class="site-header__actions no-print">
			<RandomExerciseButton />
			<LocaleSwitcher />
			<ThemeToggle />
			{#if authStore.isAuthenticated}
				<NotificationBell />
				<a class="account-link" href={resolve('/settings')}>{authStore.user?.displayName}</a>
				<button
					type="button"
					class="link-button"
					onclick={() => {
						authStore.logout();
						notificationStore.clear();
					}}>{m.nav_logout()}</button
				>
			{:else}
				<a href={resolve('/login')}>{m.nav_login()}</a>
				<a href={resolve('/register')} class="primary-link">{m.nav_register()}</a>
			{/if}
		</div>
	</div>
</header>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.site-header {
		@include mix.card-surface;
		border-left: none;
		border-right: none;
		border-top: none;
		border-radius: 0;
		position: sticky;
		top: 0;
		z-index: var(--z-dropdown);
	}
	.site-header__row {
		max-width: 1100px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		flex-wrap: wrap;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 700;
		font-size: var(--font-size-lg);
		color: var(--text-primary);
	}
	.brand__mark {
		color: var(--accent);
	}
	.nav-toggle {
		display: none;
		border: 1px solid var(--border-color);
		background: var(--bg-surface);
		border-radius: var(--radius-sm);
		width: 36px;
		height: 36px;
		margin-left: auto;
	}
	.site-nav {
		display: flex;
		gap: var(--space-4);
		flex: 1;
		a {
			color: var(--text-secondary);
			font-size: var(--font-size-sm);
			font-weight: 500;
			display: inline-flex;
			align-items: center;
			gap: var(--space-1);
			&:hover {
				color: var(--text-primary);
			}
		}
	}
	.badge {
		@include mix.status-pill(var(--accent-contrast), var(--accent));
		padding: 0 6px;
		font-size: 10px;
	}
	.site-header__actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--font-size-sm);
		a,
		.link-button {
			color: var(--text-secondary);
			&:hover {
				color: var(--text-primary);
			}
		}
		.primary-link {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.link-button {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
	}
	.account-link {
		font-weight: 600;
		color: var(--text-primary) !important;
	}

	@media (max-width: 720px) {
		.nav-toggle {
			display: inline-flex;
			align-items: center;
			justify-content: center;
		}
		.site-nav {
			display: none;
			flex-direction: column;
			width: 100%;
			order: 3;
			gap: var(--space-2);
			padding-top: var(--space-2);
		}
		.site-nav--open {
			display: flex;
		}
	}
</style>
