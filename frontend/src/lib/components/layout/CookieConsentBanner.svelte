<script lang="ts">
	// Accept all / Reject non-essential / a "Manage preferences" trigger opening the detailed panel
	// — see cookieConsent.svelte.ts's own header comment for what this app actually has to disclose
	// (Paraglide's real, pre-existing PARAGLIDE_LOCALE cookie, plus this module's own consent-choice
	// cookie) versus what it doesn't (no analytics/tracking cookie exists yet, honestly disclosed as
	// currently-unused rather than gating something that isn't real).
	import { m } from '$lib/paraglide/messages.js';
	import { cookieConsentStore } from '$lib/state/cookieConsent.svelte';
	import ModalShell from '$lib/components/shared/ModalShell.svelte';

	let showPreferences = $state(false);
</script>

<div class="cookie-banner" role="region" aria-label={m.cookies_bannerHeading()}>
	<p class="cookie-banner__text">{m.cookies_bannerBody()}</p>
	<div class="cookie-banner__actions">
		<button type="button" class="manage" onclick={() => (showPreferences = true)}>
			{m.cookies_managePreferences()}
		</button>
		<button type="button" class="reject" onclick={() => cookieConsentStore.rejectNonEssential()}>
			{m.cookies_rejectNonEssential()}
		</button>
		<button type="button" class="accept" onclick={() => cookieConsentStore.acceptAll()}>
			{m.cookies_acceptAll()}
		</button>
	</div>
</div>

{#if showPreferences}
	<ModalShell title={m.cookies_managePreferences()} onClose={() => (showPreferences = false)}>
		<section class="category">
			<h3>{m.cookies_essentialHeading()}</h3>
			<p class="category__desc">{m.cookies_essentialDescription()}</p>
			<ul class="category__list">
				<li><code>PARAGLIDE_LOCALE</code> — {m.cookies_essentialLocale()}</li>
				<li><code>edmat-cookie-consent</code> — {m.cookies_essentialConsent()}</li>
			</ul>
			<span class="always-on">{m.cookies_alwaysOn()}</span>
		</section>
		<section class="category">
			<h3>{m.cookies_analyticsHeading()}</h3>
			<p class="category__desc">{m.cookies_analyticsDescription()}</p>
		</section>
		<div class="modal-actions">
			<button
				type="button"
				class="reject"
				onclick={() => {
					cookieConsentStore.rejectNonEssential();
					showPreferences = false;
				}}>{m.cookies_rejectNonEssential()}</button
			>
			<button
				type="button"
				class="accept"
				onclick={() => {
					cookieConsentStore.acceptAll();
					showPreferences = false;
				}}>{m.cookies_acceptAll()}</button
			>
		</div>
	</ModalShell>
{/if}

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.cookie-banner {
		@include mix.card-surface;
		position: fixed;
		left: var(--space-4);
		right: var(--space-4);
		bottom: var(--space-4);
		z-index: var(--z-modal-scrim);
		box-shadow: var(--shadow-modal);
		padding: var(--space-4);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
		max-width: 720px;
		margin: 0 auto;
	}
	.cookie-banner__text {
		flex: 1;
		min-width: 220px;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.cookie-banner__actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.manage,
	.reject {
		@include mix.button-secondary;
	}
	.accept {
		@include mix.button-primary;
	}
	.category {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		h3 {
			font-size: var(--font-size-base);
		}
	}
	.category__desc {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.category__list {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		list-style: disc;
		padding-left: var(--space-4);
		code {
			color: var(--text-primary);
		}
	}
	.always-on {
		align-self: flex-start;
		@include mix.status-pill(var(--text-secondary), var(--bg-surface-alt));
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
</style>
