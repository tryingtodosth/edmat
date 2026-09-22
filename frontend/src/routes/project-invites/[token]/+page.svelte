<script lang="ts">
	// Following an invitation to co-author.
	//
	// Readable while logged out, deliberately — somebody sent this to a person who may not have an
	// account, and telling them to sign up without saying what for is how an invite gets ignored.
	// What it shows is thin on purpose: a token travels through group chats, and anything more would
	// be published to whoever it was forwarded to.
	//
	// `noindex`, for the same reason a course invite is: a private link has no business in a search
	// index.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { authStore } from '$lib/state/auth.svelte';
	import { acceptInvite, getInvitePreview } from '$lib/services/materialProjects';
	import type { ProjectInvitePreview } from '$lib/types/materialProject';
	import FeatureGate from '$lib/components/shared/FeatureGate.svelte';
	import PageHead from '$lib/components/shared/PageHead.svelte';
	import {
		COAUTHORING_FLAG,
		messageForError,
		refusalMessage
	} from '$lib/components/coauthoring/labels';

	let token = $derived(page.params.token ?? '');
	let preview = $state<ProjectInvitePreview | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	let busy = $state(false);
	let error = $state('');
	let done = $state('');

	let loadedFor = $state('');
	$effect(() => {
		const current = token;
		if (current === loadedFor) return;
		loadedFor = current;
		loading = true;
		notFound = false;
		getInvitePreview(current)
			.then((result) => {
				preview = result;
				notFound = result === null;
			})
			.catch(() => (notFound = true))
			.finally(() => (loading = false));
	});

	async function accept() {
		busy = true;
		error = '';
		try {
			const project = await acceptInvite(token);
			done = m.coauth_inviteJoin_accepted(); // "You are a co-author now."
			// Straight into the project — the link existed to get them there, so stopping on a
			// confirmation screen would be one more click for no information.
			await goto(resolve('/material-projects/[id]', { id: project.id }));
		} catch (e) {
			error = messageForError(e);
		} finally {
			busy = false;
		}
	}

	/** Back here after signing in, so the link is not lost in the round trip. */
	let loginHref = $derived(
		`${resolve('/login')}?next=${encodeURIComponent(`/project-invites/${token}`)}`
	);
</script>

<!-- "An invitation to co-author" / "An invitation to become a co-author of a material." -->
<PageHead title={m.coauth_inviteJoin_heading()} description={m.coauth_seo_invite()} noindex />

<FeatureGate feature={COAUTHORING_FLAG}>
	<main class="invite">
		<h1>{m.coauth_inviteJoin_heading()}</h1>
		<!-- "An invitation to co-author" -->

		{#if loading}
			<p class="hint">{m.common_loading()}</p>
			<!-- "Loading…" -->
		{:else if notFound || !preview}
			<p class="error">{m.coauth_inviteJoin_unknown()}</p>
			<!-- "This link does not lead anywhere." -->
		{:else}
			<p class="lede">
				{m.coauth_inviteJoin_body({
					name: preview.createdByDisplayName,
					title: preview.title
				})}
				<!-- "{name} is inviting you to work on “{title}”." -->
			</p>
			{#if preview.branchName}
				<p class="hint">{preview.branchName}</p>
			{/if}
			<p class="hint">{m.coauth_inviteJoin_what()}</p>
			<!-- "A co-author saves new versions and decides what other people propose." -->

			{#if !preview.isUsable}
				<p class="error">
					{m.coauth_inviteJoin_unusable()}
					<!-- "This link cannot be used." -->
					{#if preview.unusableReason}
						<span>{refusalMessage(preview.unusableReason)}</span>
					{/if}
				</p>
			{:else if authStore.restoring}
				<p class="hint">{m.common_loading()}</p>
				<!-- "Loading…" -->
			{:else if !authStore.isAuthenticated}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the href is built by a helper that calls resolve() itself; the rule only sees the attribute -->
				<a class="primary" href={loginHref}>{m.coauth_inviteJoin_login()}</a>
				<!-- "Sign in to accept" -->
			{:else}
				<button type="button" class="primary" disabled={busy} onclick={accept}>
					{m.coauth_inviteJoin_accept()}
					<!-- "Become a co-author" -->
				</button>
			{/if}

			{#if done}<p class="notice">{done}</p>{/if}
			{#if error}<p class="error">{error}</p>{/if}
		{/if}
	</main>
</FeatureGate>

<style lang="scss">
	@use '../../../lib/styles/mixins' as mix;

	.invite {
		max-width: 34rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);

		h1 {
			margin: 0;
		}
	}
	.lede {
		margin: 0;
		font-size: var(--font-size-lg);
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
		white-space: normal;
	}
	.primary {
		@include mix.button-primary;
		align-self: flex-start;
		min-height: 44px;
		padding: var(--space-2) var(--space-4);
		text-decoration: none;
	}
</style>
