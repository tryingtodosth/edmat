<script lang="ts">
	// Links that let somebody into a course without asking.
	//
	// The link is built here rather than sent by the API on purpose: the server has no reliable idea
	// what public origin a browser reached it on (dev server, preview deploy, real domain), and a
	// link that is right in production and wrong in every other environment is worse than one
	// composed from the address the person is already looking at.
	import { m } from '$lib/paraglide/messages.js';
	import type { CourseInvite, InviteRole } from '$lib/types/course';

	let {
		invites,
		error = '',
		oncreate,
		onrevoke
	}: {
		invites: CourseInvite[];
		error?: string;
		oncreate?: (draft: {
			role: InviteRole;
			label: string;
			maxUses: number;
			expiresAt: string | null;
		}) => void;
		onrevoke?: (inviteId: string) => void;
	} = $props();

	let role = $state<InviteRole>('participant');
	let label = $state('');
	let maxUses = $state(0);
	let expiresAt = $state('');
	let copiedId = $state<string | null>(null);

	const stateLabels: Record<string, () => string> = {
		revoked: m.course_invite_state_revoked,
		expired: m.course_invite_state_expired,
		used_up: m.course_invite_state_used_up
	};

	function linkFor(invite: CourseInvite): string {
		if (typeof window === 'undefined') return `/classroom/join/${invite.token}`;
		return `${window.location.origin}/classroom/join/${invite.token}`;
	}

	async function copy(invite: CourseInvite) {
		const url = linkFor(invite);
		try {
			await navigator.clipboard.writeText(url);
			copiedId = invite.id;
			setTimeout(() => (copiedId = null), 2000);
		} catch {
			// Clipboard access can be refused (an insecure origin, a permission prompt declined). The
			// link is on screen and selectable either way, so this fails quietly rather than throwing
			// an error at somebody who can simply copy it by hand.
			copiedId = null;
		}
	}

	function create(event: SubmitEvent) {
		event.preventDefault();
		oncreate?.({
			role,
			label: label.trim(),
			maxUses: Number(maxUses) || 0,
			expiresAt: expiresAt || null
		});
		label = '';
	}
</script>

<section class="invites">
	<h2>{m.course_invites_heading()}</h2>
	<p class="hint">{m.course_invites_bypassNote()}</p>

	{#if invites.length === 0}
		<p class="hint">{m.course_invites_empty()}</p>
	{:else}
		<ul>
			{#each invites as invite (invite.id)}
				<li class:spent={!invite.isUsable}>
					<div class="row">
						<strong>{invite.label || m.course_invites_heading()}</strong>
						<span class="role">{invite.role}</span>
						<span class="uses">
							{invite.maxUses
								? m.course_invites_usedOf({ uses: invite.uses, max: invite.maxUses })
								: m.course_invites_used({ uses: invite.uses })}
						</span>
						{#if invite.unusableReason}
							<span class="dead"
								>{stateLabels[invite.unusableReason]?.() ?? invite.unusableReason}</span
							>
						{/if}
					</div>
					<div class="row">
						<input class="url" type="text" readonly value={linkFor(invite)} />
						<button type="button" onclick={() => copy(invite)}>
							{copiedId === invite.id ? m.course_invites_copied() : m.course_invites_copy()}
						</button>
						{#if !invite.revokedAt && onrevoke}
							<button type="button" class="link danger" onclick={() => onrevoke?.(invite.id)}>
								{m.course_invites_revoke()}
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<form onsubmit={create}>
		<label class="field">
			<span>{m.course_invites_label()}</span>
			<input type="text" bind:value={label} maxlength="120" />
			<span class="hint">{m.course_invites_labelHint()}</span>
		</label>
		<label class="field">
			<span>{m.course_invites_role()}</span>
			<select bind:value={role}>
				<option value="participant">{m.course_invites_roleParticipant()}</option>
				<option value="assistant">{m.course_role_assistant()}</option>
				<option value="admin">{m.course_role_admin()}</option>
			</select>
		</label>
		<label class="field">
			<span>{m.course_invites_maxUses()}</span>
			<input type="number" bind:value={maxUses} min="0" />
			<span class="hint">{m.course_invites_maxUsesHint()}</span>
		</label>
		<label class="field">
			<span>{m.course_invites_expiresAt()}</span>
			<input type="datetime-local" bind:value={expiresAt} />
		</label>
		<button type="submit" class="primary">{m.course_invites_create()}</button>
	</form>

	{#if error}
		<p class="error">{error}</p>
	{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.invites {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	li {
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.spent {
		opacity: 0.6;
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.url {
		flex: 1;
		min-width: 12rem;
		font-family: var(--font-mono, monospace);
		font-size: var(--font-size-xs);
	}
	.role,
	.uses,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.dead {
		font-size: var(--font-size-xs);
		color: var(--status-danger, #c0392b);
	}
	form {
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
	.error {
		font-size: var(--font-size-sm);
		color: var(--status-danger, #c0392b);
	}
	input,
	select {
		@include mix.focus-ring;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface);
		color: var(--text-primary);
	}
	button {
		@include mix.focus-ring;
		cursor: pointer;
	}
	.primary {
		padding: var(--space-1) var(--space-3);
		border: none;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--bg-surface);
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: var(--font-size-xs);
		text-decoration: underline;
		color: var(--text-secondary);
	}
	.danger:hover {
		color: var(--status-danger, #c0392b);
	}
</style>
