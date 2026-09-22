<script lang="ts">
	// Links that make somebody a co-author without anyone having to know their account id.
	//
	// The URL is built here rather than taken from the API, the same reasoning `CourseInvites` gives
	// and for the same reason: the server has no reliable idea which public origin a browser reached
	// it on (dev server, preview deploy, the real domain), and a link that is right in production
	// and wrong everywhere else is worse than one composed from the address the person is looking
	// at. `urlPath` from the server is the fallback for a non-browser render.
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages.js';
	import { createInvite, listInvites, revokeInvite } from '$lib/services/materialProjects';
	import type { ProjectInvite } from '$lib/types/materialProject';
	import { messageForError, refusalMessage } from './labels';

	let { projectId }: { projectId: string } = $props();

	let invites = $state<ProjectInvite[]>([]);
	let label = $state('');
	// Text inputs, never `type="number"`/`type="datetime-local"` bound to a number: see
	// frontend/CLAUDE.md trap 1. `maxUses` is parsed on submit.
	let maxUses = $state('0');
	let expiresAt = $state('');
	let copiedId = $state<string | null>(null);
	let busy = $state(false);
	let error = $state('');

	let loadedFor = $state('');
	$effect(() => {
		const id = projectId;
		if (id === loadedFor) return;
		loadedFor = id;
		listInvites(id)
			.then((rows) => (invites = rows))
			.catch(() => (invites = []));
	});

	function linkFor(invite: ProjectInvite): string {
		const path = resolve('/project-invites/[token]', { token: invite.token });
		if (typeof window === 'undefined') return invite.urlPath || path;
		return `${window.location.origin}${path}`;
	}

	async function copy(invite: ProjectInvite) {
		try {
			await navigator.clipboard.writeText(linkFor(invite));
			copiedId = invite.id;
			setTimeout(() => (copiedId = null), 2000);
		} catch {
			// Clipboard access can be refused (an insecure origin, a declined permission). The link
			// is on screen and selectable either way, so this fails quietly.
			copiedId = null;
		}
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			const invite = await createInvite(projectId, {
				label: label.trim(),
				maxUses: Number(maxUses) || 0,
				expiresAt: expiresAt || null
			});
			invites = [invite, ...invites];
			label = '';
		} catch (e) {
			error = messageForError(e);
		} finally {
			busy = false;
		}
	}

	async function revoke(invite: ProjectInvite) {
		busy = true;
		error = '';
		try {
			await revokeInvite(projectId, invite.id);
			invites = await listInvites(projectId);
		} catch (e) {
			error = messageForError(e);
		} finally {
			busy = false;
		}
	}
</script>

<section class="invites">
	<h2>{m.coauth_invites_heading()}</h2>
	<!-- "Invite links" -->
	<p class="hint">{m.coauth_invites_hint()}</p>
	<!-- "Anybody who opens the link becomes a co-author. Revoking one keeps the record of it." -->

	{#if invites.length === 0}
		<p class="hint">{m.coauth_invites_empty()}</p>
		<!-- "No links yet." -->
	{:else}
		<ul>
			{#each invites as invite (invite.id)}
				<li class:spent={!invite.isUsable}>
					<div class="row">
						<!-- An unlabelled link falls back to "Invite links", the panel's own heading. -->
						<strong>{invite.label || m.coauth_invites_heading()}</strong>
						<span class="uses">
							{invite.maxUses
								? m.course_invites_usedOf({ uses: invite.uses, max: invite.maxUses })
								: m.course_invites_used({ uses: invite.uses })}
							<!-- "{uses} of {max} used" / "{uses} used" -->
						</span>
						{#if invite.unusableReason}
							<span class="dead">{refusalMessage(invite.unusableReason)}</span>
						{/if}
					</div>
					<div class="row">
						<input class="url" type="text" readonly value={linkFor(invite)} />
						<button type="button" onclick={() => copy(invite)}>
							{copiedId === invite.id ? m.course_invites_copied() : m.course_invites_copy()}
							<!-- "Copied" / "Copy link" -->
						</button>
						{#if !invite.revokedAt}
							<button
								type="button"
								class="link danger"
								disabled={busy}
								onclick={() => revoke(invite)}
							>
								{m.course_invites_revoke()}
								<!-- "Revoke" -->
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
			<!-- "Label" -->
			<input type="text" bind:value={label} maxlength="100" />
			<span class="hint">{m.course_invites_labelHint()}</span>
			<!-- "Only you see this — it is how you tell your links apart." -->
		</label>
		<label class="field">
			<span>{m.course_invites_maxUses()}</span>
			<!-- "Maximum uses" -->
			<input type="text" inputmode="numeric" bind:value={maxUses} maxlength="5" />
			<span class="hint">{m.course_invites_maxUsesHint()}</span>
			<!-- "0 means unlimited." -->
		</label>
		<label class="field">
			<span>{m.course_invites_expiresAt()}</span>
			<!-- "Expires" -->
			<input type="datetime-local" bind:value={expiresAt} />
		</label>
		<button type="submit" class="primary" disabled={busy}>
			{m.course_invites_create()}
			<!-- "Create a link" -->
		</button>
	</form>

	{#if error}<p class="error">{error}</p>{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.invites {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h2 {
			margin: 0;
			font-size: var(--font-size-sm);
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--text-secondary);
		}
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
	.uses,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	.dead {
		font-size: var(--font-size-xs);
		color: var(--status-danger);
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
	input {
		@include mix.focus-ring;
		font: inherit;
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
		@include mix.button-primary;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
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
	.danger:not(:disabled):hover {
		color: var(--status-danger);
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
		white-space: normal;
	}
</style>
