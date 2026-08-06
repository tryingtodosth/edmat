<script lang="ts">
	// Following an invite link.
	//
	// The preview is deliberately readable while logged out: somebody sent this to a person who may
	// not have an account, and telling them to sign up without saying what for is how an invite gets
	// ignored. What it shows is thin on purpose — a title and who runs it — because an invite token
	// travels through group chats, and anything more would be published to whoever it was forwarded
	// to.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { acceptInvite, previewInvite } from '$lib/services/course';
	import type { InvitePreview } from '$lib/types/course';
	import { authStore } from '$lib/state/auth.svelte';

	let token = $derived(page.params.token ?? '');
	let preview = $state<InvitePreview | null>(null);
	let loading = $state(true);
	let notFound = $state(false);
	let busy = $state(false);
	let error = $state('');
	let done = $state('');

	$effect(() => {
		const current = token;
		loading = true;
		notFound = false;
		previewInvite(current)
			.then((result) => {
				if (current !== token) return;
				preview = result;
				notFound = result === null;
			})
			.catch(() => (notFound = true))
			.finally(() => (loading = false));
	});

	const reasonLabels: Record<string, () => string> = {
		revoked: m.course_invite_state_revoked,
		expired: m.course_invite_state_expired,
		used_up: m.course_invite_state_used_up
	};

	async function accept() {
		busy = true;
		error = '';
		try {
			const result = await acceptInvite(token);
			done = result.detail === 'joined' ? m.course_join_joined() : m.course_join_already();
			// Straight into the course — the link existed to get them there, so stopping on a
			// confirmation screen would be one more click for no information.
			await goto(resolve('/courses/[id]', { id: result.courseId }));
		} catch (err) {
			const detail = (err as { body?: { detail?: string } })?.body?.detail;
			error =
				detail === 'full'
					? m.course_join_full()
					: detail && reasonLabels[detail]
						? m.course_join_unusable()
						: m.common_error_generic();
		} finally {
			busy = false;
		}
	}

	/** Back here after logging in, so the link is not lost in the round trip. */
	let loginHref = $derived(
		`${resolve('/login')}?next=${encodeURIComponent(`/courses/join/${token}`)}`
	);
</script>

<svelte:head>
	<title>{preview ? preview.courseTitle : m.course_join_heading()} — {m.common_appName()}</title>
	<!-- An invite is a private link; it has no business in a search index. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="join">
	{#if loading}
		<p>{m.common_loading()}</p>
	{:else if notFound || !preview}
		<h1>{m.course_join_heading()}</h1>
		<p class="error">{m.course_join_unknown()}</p>
	{:else}
		<h1>{m.course_join_heading()}</h1>
		<p class="lede">
			{m.course_join_body({ name: preview.instructorName, title: preview.courseTitle })}
		</p>
		<p class="hint">
			{preview.role === 'participant'
				? m.course_join_asParticipant()
				: m.course_join_asStaff()}
		</p>

		{#if !preview.isUsable}
			<p class="error">
				{m.course_join_unusable()}
				{#if preview.unusableReason}
					({reasonLabels[preview.unusableReason]?.() ?? preview.unusableReason})
				{/if}
			</p>
		{:else if !authStore.user}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the href is built by a helper that calls resolve() itself; the rule only sees the attribute -->
			<a class="primary" href={loginHref}>{m.course_join_login()}</a>
		{:else}
			<button type="button" class="primary" disabled={busy} onclick={accept}>
				{m.course_join_accept()}
			</button>
		{/if}

		{#if done}
			<p class="notice">{done}</p>
		{/if}
		{#if error}
			<p class="error">{error}</p>
		{/if}
	{/if}
</main>

<style lang="scss">
	@use '../../../../lib/styles/mixins' as mix;

	.join {
		max-width: 34rem;
		margin: 0 auto;
		padding: var(--space-5) var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.lede {
		font-size: var(--font-size-lg);
	}
	.hint {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.notice {
		color: var(--status-info);
	}
	.error {
		color: var(--status-danger, #c0392b);
	}
	.primary {
		@include mix.focus-ring;
		align-self: flex-start;
		padding: var(--space-2) var(--space-4);
		border: none;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--bg-surface);
		cursor: pointer;
		text-decoration: none;
	}
</style>
