<script lang="ts">
	/**
	 * The one-off card a brand-new account sees on the page it lands on after registering
	 * (first-visitor audit finding 14, 2026-10-15). It says the two things the homepage did not:
	 * that a confirmation link is on its way (only while the address is unconfirmed — `mail/`
	 * queues one on every registration with an address, `accounts/views.py: RegisterView`), and
	 * three ways to begin. Armed by `/register` through `welcomeStore` (which says why that is
	 * browser storage and not a profile flag), loaded lazily by the root layout, and gone for good
	 * once dismissed, once one of its links is followed, or on the next page.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { welcomeStore } from '$lib/state/welcome.svelte';
	import { getMyMail, type MyMail } from '$lib/services/mail';

	let mail = $state<MyMail | null>(null);
	let visible = $derived(
		welcomeStore.pendingFor !== null && authStore.user?.id === welcomeStore.pendingFor
	);

	// Plain variables, not state: they record what has already been done, and reading them must not
	// make the effects below re-run (frontend/CLAUDE.md, Svelte trap 4).
	let asked = false;
	let landing: string | null = null;

	$effect(() => {
		if (!visible || asked) return;
		asked = true;
		// Drawn once: forget it in storage now, so a reload does not bring it back.
		welcomeStore.consume();
		getMyMail()
			.then((found) => (mail = found))
			.catch(() => (mail = null));
	});

	// On the page it landed on, and nowhere after it.
	$effect(() => {
		const path = page.url.pathname;
		if (!visible) return;
		if (landing === null) landing = path;
		else if (path !== landing) welcomeStore.dismiss();
	});

	const STEPS = [
		{
			key: 'exercises',
			label: () => m.wp14b_welcome_stepExercises(), // "Find exercises for your subject"
			href: resolve('/disciplines')
		},
		{
			key: 'guide',
			label: () => m.wp14b_welcome_stepGuide(), // "Read the 5-minute guide"
			href: resolve('/about/guide/[chapter]', { chapter: 'start' })
		},
		{
			key: 'languages',
			label: () => m.wp14b_welcome_stepLanguages(), // "Choose the languages you read in"
			href: resolve('/settings')
		}
	] as const;
</script>

{#if visible && authStore.user}
	<section class="welcome" aria-labelledby="welcome-heading" data-testid="welcome-card">
		<div class="welcome__head">
			<h2 id="welcome-heading">
				{m.wp14b_welcome_heading({ name: authStore.user.displayName })}
				<!-- "Your account is ready. Welcome, {name}!" -->
			</h2>
			<button
				type="button"
				class="welcome__close"
				aria-label={m.wp14b_welcome_dismiss()}
				title={m.wp14b_welcome_dismiss()}
				onclick={() => welcomeStore.dismiss()}>✕</button
			>
			<!-- "Close the welcome" -->
		</div>
		{#if mail && !mail.emailConfirmed}
			<p class="welcome__inbox" data-testid="welcome-inbox">
				{m.wp14b_welcome_checkInbox({ email: mail.email })}
				<!-- "We have sent a confirmation link to {email}. Open it to confirm your address; if it is not there, look in spam." -->
			</p>
		{/if}
		<p class="welcome__lead">{m.wp14b_welcome_stepsLead()}</p>
		<!-- "Where to start:" -->
		<ul class="welcome__steps">
			{#each STEPS as step (step.key)}
				<li>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- each href is built by resolve() in STEPS above -->
					<a href={step.href} data-welcome-step={step.key} onclick={() => welcomeStore.dismiss()}
						><span>{step.label()}</span><span aria-hidden="true">→</span></a
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.welcome {
		@include mix.card-surface;
		box-sizing: border-box;
		// The page column every route draws in: 1100px less its own side padding.
		max-width: calc(1100px - 2 * var(--space-4));
		margin: var(--space-3) auto 0;
		width: calc(100% - 2 * var(--space-4));
		padding: var(--space-3) var(--space-4);
		border-left: 4px solid var(--accent);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.welcome__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
		h2 {
			margin: 0;
			font-size: var(--font-size-lg);
		}
	}
	.welcome__close {
		@include mix.focus-ring;
		flex: none;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-secondary);
		cursor: pointer;
		&:hover {
			background: var(--bg-surface-alt);
			color: var(--text-primary);
		}
	}
	.welcome__inbox {
		@include mix.status-message(info);
	}
	.welcome__lead {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
	}
	.welcome__steps {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
		a {
			@include mix.button-secondary;
			text-decoration: none;
		}
	}
	@media (max-width: 480px) {
		.welcome {
			width: calc(100% - 2 * var(--space-3));
			padding: var(--space-3);
		}
		.welcome__steps {
			flex-direction: column;
			a {
				width: 100%;
				box-sizing: border-box;
				justify-content: space-between;
				text-align: left;
			}
		}
	}
</style>
