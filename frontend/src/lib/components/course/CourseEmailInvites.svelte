<script lang="ts">
	// Inviting somebody by their email address, from the course's manage page (2026-11-02). The
	// create form collects the same thing before the course exists (`CourseCollaboratorsDraft`); this
	// is the one for a course that does. Dumb about the network: the page sends and hands back the
	// outcome, which is drawn here one line per address — partial success is the normal answer.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { getMyMail } from '$lib/services/mail';
	import { splitAddresses } from '$lib/utils/emailAddresses';
	import type { EmailInviteOutcome, InviteRole } from '$lib/types/course';
	import type { Licence } from '$lib/types/licence';
	import { emailInviteReasonLabel, licenceShort } from '$lib/utils/labels';

	let {
		licence,
		onsend
	}: {
		/** The course's licence — what an invited collaborator will write under. */
		licence: Licence;
		/** Resolves with the outcome, or rejects with a refusal word for the whole request. */
		onsend: (emails: string[], role: InviteRole) => Promise<EmailInviteOutcome>;
	} = $props();

	let text = $state('');
	let role = $state<InviteRole>('assistant');
	let busy = $state(false);
	let outcome = $state<EmailInviteOutcome | null>(null);
	let error = $state('');
	let confirmed = $state<boolean | null>(null);

	onMount(() => {
		getMyMail()
			.then((mail) => (confirmed = mail.emailConfirmed))
			.catch(() => (confirmed = null));
	});

	async function send(event: SubmitEvent) {
		event.preventDefault();
		const emails = splitAddresses(text);
		if (emails.length === 0) return;
		busy = true;
		error = '';
		outcome = null;
		try {
			outcome = await onsend(emails, role);
			// Keep only what did not go through, so fixing a typo is editing one line.
			const failed = outcome.results.filter((r) => !r.ok).map((r) => r.email);
			text = failed.join('\n');
		} catch (e) {
			error = emailInviteReasonLabel(e instanceof Error ? e.message : '');
		} finally {
			busy = false;
		}
	}
</script>

<section class="email-invites" data-testid="course-email-invites">
	<h3>{m.courseCollab_emailLabel()}</h3>
	<!-- "Invite by email" -->
	<p class="hint">{m.courseCollab_emailHint()}</p>
	<!-- "One invitation per address, valid once for 14 days. We never say whether an address already has an account." -->
	<p class="hint">{m.courseCollab_underLicence({ licence: licenceShort(licence) })}</p>
	<!-- "They will write under this course’s licence, {licence}, and are told so before they accept." -->

	{#if confirmed === false}
		<p class="hint hint--attention" data-testid="email-invites-confirm-first">
			{m.courseCollab_confirmFirst()}
			<!-- "Invitations go out in your name, so confirm your own email address first." -->
			<a href={resolve('/settings')}>{m.courseCollab_confirmLink()}</a>
			<!-- "Settings" -->
		</p>
	{/if}

	<form onsubmit={send}>
		<label class="field">
			<span class="visually-hidden">{m.courseCollab_emailLabel()}</span>
			<textarea
				rows="3"
				bind:value={text}
				placeholder={m.courseCollab_emailPlaceholder()}
				data-testid="email-invites-text"></textarea>
		</label>
		<div class="row">
			<label class="field">
				<span>{m.courseCollab_emailRole()}</span>
				<!-- "They join as" -->
				<select bind:value={role}>
					<option value="assistant">{m.course_role_assistant()}</option>
					<option value="admin">{m.course_role_admin()}</option>
					<option value="participant">{m.courseCollab_roleParticipant()}</option>
				</select>
			</label>
			<button type="submit" class="primary" disabled={busy || !text.trim()}
				>{m.courseCollab_send()}</button
			>
			<!-- "Send invitations" -->
		</div>
	</form>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	{#if outcome}
		<ul class="results" aria-live="polite" data-testid="email-invites-results">
			{#each outcome.results as row (row.email)}
				<li class:ok={row.ok}>
					<strong>{row.email}</strong> —
					{row.ok ? m.courseCollab_sent() : emailInviteReasonLabel(row.reason)}
					<!-- "invitation sent" -->
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.visually-hidden {
		@include mix.visually-hidden;
	}
	.email-invites {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	h3 {
		font-size: var(--font-size-base);
		font-weight: 600;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
	}
	textarea,
	select {
		@include mix.focus-ring;
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-page);
		font: inherit;
	}
	.hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
		a {
			color: var(--accent);
		}
	}
	.hint--attention {
		color: var(--text-primary);
	}
	.primary {
		@include mix.button-primary;
	}
	.error {
		@include mix.status-message(danger);
	}
	.results {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		li.ok {
			color: var(--text-primary);
		}
	}
</style>
