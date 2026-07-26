<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale, locales } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/utils/format';
	import { authStore } from '$lib/state/auth.svelte';
	import DonationLinksEditor from '$lib/components/settings/DonationLinksEditor.svelte';

	let displayName = $state('');
	let preferredLocale = $state('en');
	let showProfilePublicly = $state(true);
	let notifyOnCommentReply = $state(true);
	let notifyOnModerationDecision = $state(true);
	let notifyOnContentAction = $state(true);
	let seeded = $state(false);
	let saving = $state(false);
	let saveError = $state('');
	let saved = $state(false);

	// Seeds the editable form fields from the loaded user exactly once — the same "one-time read,
	// not a live `$derived` mirror" discipline this app already applies wherever a form starts from
	// server state but is then locally editable, so typing into a field doesn't fight a reactive
	// re-seed on every unrelated authStore change.
	$effect(() => {
		if (seeded || !authStore.user) return;
		seeded = true;
		displayName = authStore.user.displayName;
		preferredLocale = authStore.user.preferredLocale;
		showProfilePublicly = authStore.user.showProfilePublicly ?? true;
		notifyOnCommentReply = authStore.user.notifyOnCommentReply ?? true;
		notifyOnModerationDecision = authStore.user.notifyOnModerationDecision ?? true;
		notifyOnContentAction = authStore.user.notifyOnContentAction ?? true;
	});

	async function handleSave(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		saveError = '';
		saved = false;
		const result = await authStore.updateProfile({
			displayName,
			preferredLocale,
			showProfilePublicly,
			notifyOnCommentReply,
			notifyOnModerationDecision,
			notifyOnContentAction
		});
		saving = false;
		if (result.ok) {
			saved = true;
		} else {
			saveError = result.error;
		}
	}
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
				<dt>{m.settings_email()}</dt>
				<dd>{user.email}</dd>
			</dl>
			<p class="joined">
				{m.settings_joined({
					date: formatDate(user.joinedAt ?? new Date().toISOString(), getLocale())
				})}
			</p>
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
			<a class="view-public" href={resolve('/users/[id]', { id: user.id })}>
				{m.profile_viewPublic()}
			</a>
		</section>

		<form class="edit-form" onsubmit={handleSave}>
			<section class="field-group">
				<h2>{m.settings_editHeading()}</h2>
				<label>
					<span>{m.settings_displayName()}</span>
					<input type="text" bind:value={displayName} maxlength="100" required />
				</label>
				<label>
					<span>{m.settings_preferredLocale()}</span>
					<select bind:value={preferredLocale}>
						{#each locales as locale (locale)}
							<option value={locale}>{locale.toUpperCase()}</option>
						{/each}
					</select>
				</label>
			</section>

			<section class="field-group">
				<h2>{m.settings_privacyHeading()}</h2>
				<label class="checkbox">
					<input type="checkbox" bind:checked={showProfilePublicly} />
					<span>{m.settings_showProfilePublicly()}</span>
				</label>
				<p class="field-hint">{m.settings_showProfilePubliclyHint()}</p>
			</section>

			<section class="field-group">
				<h2>{m.settings_notificationsHeading()}</h2>
				<label class="checkbox">
					<input type="checkbox" bind:checked={notifyOnCommentReply} />
					<span>{m.settings_notifyOnCommentReply()}</span>
				</label>
				<label class="checkbox">
					<input type="checkbox" bind:checked={notifyOnModerationDecision} />
					<span>{m.settings_notifyOnModerationDecision()}</span>
				</label>
				<label class="checkbox">
					<input type="checkbox" bind:checked={notifyOnContentAction} />
					<span>{m.settings_notifyOnContentAction()}</span>
				</label>
			</section>

			<div class="save-row">
				<button type="submit" disabled={saving}
					>{saving ? m.common_loading() : m.common_save()}</button
				>
				{#if saved}
					<span class="saved">{m.settings_saved()}</span>
				{/if}
				{#if saveError}
					<span class="error">{saveError}</span>
				{/if}
			</div>
		</form>

		<section class="donations">
			<h2>{m.settings_donationsHeading()}</h2>
			<p class="field-hint">{m.settings_donationsHint()}</p>
			<DonationLinksEditor />
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
	.profile,
	.edit-form,
	.donations {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.profile h2,
	.field-group h2,
	.donations h2 {
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
	.view-public {
		align-self: flex-start;
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--accent);
	}
	.edit-form {
		gap: var(--space-4);
	}
	.field-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.field-group label:not(.checkbox) {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		span {
			color: var(--text-secondary);
		}
		input,
		select {
			@include mix.focus-ring;
			padding: var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
		}
	}
	.checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}
	.field-hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.save-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		button {
			@include mix.button-primary;
		}
	}
	.saved {
		font-size: var(--font-size-sm);
		color: var(--status-success);
	}
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger);
	}
</style>
