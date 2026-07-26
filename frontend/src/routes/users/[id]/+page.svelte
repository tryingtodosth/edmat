<script lang="ts">
	// A stranger's public profile — reachable from any comment/review/submission byline throughout
	// the app once that becomes a real link (see the byline `<a>` this session added to CommentNode/
	// ReviewList/moderation's own name spans). Same client-side "$effect keyed off page.params, with
	// an id-changed idempotency guard" pattern the exercise/course detail pages already establish —
	// no +page.ts, this app has no server-rendered-auth story to back one (CLAUDE.md Section 16).
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/utils/format';
	import { getUserById } from '$lib/services/users';
	import type { User } from '$lib/types';
	import DonationLinksList from '$lib/components/shared/DonationLinksList.svelte';

	let user = $state<User | undefined>(undefined);
	let loading = $state(true);
	let notFound = $state(false);

	async function loadUser(id: string) {
		loading = true;
		notFound = false;
		const found = await getUserById(id);
		if (!found) {
			notFound = true;
			loading = false;
			return;
		}
		user = found;
		loading = false;
	}

	let loadedForId = $state<string | undefined>(undefined);
	$effect(() => {
		const id = page.params.id!;
		if (id === loadedForId) return;
		loadedForId = id;
		loadUser(id);
	});
</script>

<svelte:head>
	<title>{user?.displayName ?? m.profile_heading()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	{#if loading}
		<p class="status">{m.common_loading()}</p>
	{:else if notFound || !user}
		<p class="status">{m.profile_notFound()}</p>
	{:else}
		<section class="profile">
			<h1>{user.displayName}</h1>
			<div class="roles">
				{#if user.isModerator}
					<span class="badge">{m.settings_role_moderator()}</span>
				{/if}
				{#if user.isVerifiedContributor}
					<span class="badge">{m.settings_role_verifiedContributor()}</span>
				{/if}
				{#if !user.isModerator && !user.isVerifiedContributor && user.isProfilePublic}
					<span class="badge badge--neutral">{m.settings_role_member()}</span>
				{/if}
			</div>

			{#if user.isProfilePublic === false}
				<p class="private-notice">{m.profile_private()}</p>
			{:else if user.joinedAt}
				<p class="joined">{m.settings_joined({ date: formatDate(user.joinedAt, getLocale()) })}</p>
			{/if}

			{#if user.donationLinks && user.donationLinks.length > 0}
				<div class="donations">
					<h2>{m.profile_supportHeading()}</h2>
					<DonationLinksList links={user.donationLinks} />
				</div>
			{/if}
		</section>
	{/if}
</div>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.page {
		max-width: 480px;
		margin: 0 auto;
		padding: var(--space-4);
	}
	.status {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.profile {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
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
	.private-notice {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		font-style: italic;
	}
	.joined {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.donations {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-color);
		h2 {
			font-size: var(--font-size-sm);
			color: var(--text-secondary);
		}
	}
</style>
