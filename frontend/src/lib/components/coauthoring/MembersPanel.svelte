<script lang="ts">
	// Who may write here, and the three things a manager can do about it: add, remove, hand over.
	//
	// Adding is by account id because this app still has no people search (a named gap, root
	// CLAUDE.md) — the hint says so rather than leaving somebody to guess what "account id" means,
	// and points at the invite link, which is the path that does not need one.
	import { m } from '$lib/paraglide/messages.js';
	import { formatDate } from '$lib/utils/datetime';
	import { authStore } from '$lib/state/auth.svelte';
	import { addMember, removeMember, transferOwnership } from '$lib/services/materialProjects';
	import type { ProjectMember } from '$lib/types/materialProject';
	import { MEMBER_ROLE_LABELS, messageForError } from './labels';

	let {
		projectId,
		members,
		canManage = false,
		onchanged = undefined
	}: {
		projectId: string;
		members: ProjectMember[];
		canManage?: boolean;
		/** The panel does its own writes and asks the page to reload what it owns. */
		onchanged?: () => void;
	} = $props();

	// `type="text"` with a numeric inputmode, never `type="number"`: Svelte 5 binds a real `number`
	// (or `undefined`) to a number input, and this value is `.trim()`ed — the exact mismatch that
	// has produced a live `.trim is not a function` on this project four times (frontend/CLAUDE.md).
	let newMemberId = $state('');
	let busy = $state(false);
	let error = $state('');

	let myId = $derived(authStore.user?.id ?? null);

	async function run(action: () => Promise<unknown>) {
		busy = true;
		error = '';
		try {
			await action();
			onchanged?.();
		} catch (e) {
			error = messageForError(e);
		} finally {
			busy = false;
		}
	}

	function add(event: SubmitEvent) {
		event.preventDefault();
		const id = newMemberId.trim();
		if (!id) return;
		run(async () => {
			await addMember(projectId, id);
			newMemberId = '';
		});
	}
</script>

<section class="members">
	<h2>{m.coauth_members_heading()}</h2>
	<!-- "Co-authors" -->

	{#if members.length === 0}
		<p class="hint">{m.coauth_members_empty()}</p>
		<!-- "No co-authors yet." -->
	{:else}
		<ul>
			{#each members as member (member.userId)}
				<li>
					<span class="name">{member.displayName}</span>
					<span class="role">{MEMBER_ROLE_LABELS[member.role]()}</span>
					<span class="since">{m.coauth_members_since({ date: formatDate(member.addedAt) })}</span>
					<!-- "since {date}" -->
					{#if canManage && member.role !== 'owner'}
						<button
							type="button"
							class="link"
							disabled={busy}
							onclick={() => run(() => transferOwnership(projectId, member.userId))}
						>
							{m.coauth_members_transfer()}
							<!-- "Hand the project over" -->
						</button>
					{/if}
					{#if member.role !== 'owner' && (canManage || member.userId === myId)}
						<button
							type="button"
							class="link danger"
							disabled={busy}
							onclick={() => run(() => removeMember(projectId, member.userId))}
						>
							{member.userId === myId ? m.coauth_members_leave() : m.coauth_members_remove()}
							<!-- "Leave the project" / "Remove" -->
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if canManage}
		{#if members.some((member) => member.role !== 'owner')}
			<!-- Only beside a Transfer button: with nobody to hand over to, it explained nothing. -->
			<p class="hint">{m.coauth_members_transferHint()}</p>
			<!-- "The new owner can do everything you can; you stay a co-author." -->
		{/if}
		<form onsubmit={add}>
			<label class="field">
				<span>{m.coauth_members_addLabel()}</span>
				<!-- "Account id" -->
				<input type="text" inputmode="numeric" bind:value={newMemberId} maxlength="20" />
			</label>
			<button type="submit" class="primary" disabled={busy || !newMemberId.trim()}>
				{m.coauth_members_add()}
				<!-- "Add" -->
			</button>
		</form>
		<p class="hint">{m.coauth_members_addHint()}</p>
		<!-- "There is no people search yet, so adding somebody by hand needs their account id…" -->
	{/if}

	{#if error}<p class="error">{error}</p>{/if}
</section>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.members {
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
		gap: var(--space-1);
	}
	li {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.name {
		font-weight: 600;
		font-size: var(--font-size-sm);
	}
	.role,
	.since,
	.hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	form {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-sm);

		input {
			@include mix.focus-ring;
			font: inherit;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-surface);
			color: var(--text-primary);
		}
	}
	.primary {
		@include mix.button-primary;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
	}
	.link {
		@include mix.focus-ring;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: var(--font-size-xs);
		text-decoration: underline;
		color: var(--text-secondary);
		cursor: pointer;
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
